import "server-only";
import { getAISetting, aiSettingsFingerprint } from "./ai-settings-server";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { request, ServiceError } from "./server";
import { ffmpegAudio, finiteWav } from "./audio-server";
import { speechVoices, resolveVoice, type TtsBackend } from "./voices";
import { recordService, recentService } from "./service-health";
export type Speech = {
  text: string;
  voice: string;
  speed: number;
  language: string;
  pronunciation: string;
  backend?: TtsBackend;
};
const cache = new Map<string, Buffer>();
const inflight = new Map<string, Promise<Buffer>>();
let queue = Promise.resolve();
let bytes = 0;
const edgePython = () => getAISetting("EDGE_TTS_PYTHON") || "python3";
export async function ttsHealth() {
  const backend =
    getAISetting("TTS_BACKEND") === "edge-tts" ? "edge-tts" : "mlx-audio";
  if (backend === "edge-tts") {
    try {
      await access(/* turbopackIgnore: true */ edgePython());
      return {
        state: "configured",
        label: "Edge 在线语音已配置，待试听",
        backend,
        model: "Edge 在线语音（非官方封装）",
        voices: speechVoices[backend],
        ...recentService("TTS"),
      };
    } catch {
      return { state: "missing", label: "Edge 语音依赖未安装", backend };
    }
  }
  const base = getAISetting("TTS_BASE_URL");
  if (!base) return { state: "missing", label: "本地 TTS 未配置", backend };
  try {
    if (getAISetting("TTS_API_STYLE") === "mlx-openai") {
      const r = await request(
        `${base}/v1/models`,
        {
          headers: {
            Authorization: `Bearer ${getAISetting("TTS_SERVICE_TOKEN")}`,
          },
        },
        3000,
        0,
      );
      const d = await r.json();
      const loaded = d.data?.some(
        (v: { id: string }) => v.id === getAISetting("TTS_MODEL_ID"),
      );
      return {
        state: loaded ? "ready" : "loading",
        label: loaded ? "本地模型已加载" : "服务已启动，指定模型尚未加载",
        model: getAISetting("TTS_MODEL_ID"),
        backend,
        voices: speechVoices[backend],
      };
    }
    const r = await request(
      `${base}/health`,
      {
        headers: {
          Authorization: `Bearer ${getAISetting("TTS_SERVICE_TOKEN") || ""}`,
        },
      },
      3000,
      0,
    );
    return { ...(await r.json()), backend };
  } catch {
    return { state: "offline", label: "本地 TTS 无法连接", backend };
  }
}
function edgeSpeech(text: string, voice: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ edgePython(), [
      path.join(process.cwd(), "services/edge/synthesize.py"),
    ]);
    const chunks: Buffer[] = [];
    let total = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new ServiceError(504, "Edge 在线语音超时，请重试"));
    }, 45000);
    child.stdin.on("error", () => {});
    child.stderr.resume();
    child.stdout.on("data", (c: Buffer) => {
      total += c.length;
      if (total > 8 * 1024 * 1024) {
        child.kill();
        reject(new ServiceError(413, "语音生成结果过大"));
      } else chunks.push(c);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new ServiceError(503, "Edge 语音依赖未安装，请运行安装命令"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 && total > 0
        ? resolve(Buffer.concat(chunks))
        : reject(
            new ServiceError(503, "Edge 在线语音暂时不可用，请检查网络后重试"),
          );
    });
    child.stdin.end(JSON.stringify({ text, voice }));
  });
}
export async function synthesize(data: Speech, signal: AbortSignal) {
  const backend =
    data.backend ||
    (getAISetting("TTS_BACKEND") === "edge-tts" ? "edge-tts" : "mlx-audio");
  const text = data.pronunciation || data.text;
  let voice: string;
  try {
    voice = resolveVoice(backend, data.voice, text, data.language);
  } catch {
    throw new ServiceError(400, "当前朗读服务不支持所选声音，请重新选择");
  }
  if (
    backend === "mlx-audio" &&
    (!getAISetting("TTS_BASE_URL") || !getAISetting("TTS_MODEL_ID"))
  )
    throw new ServiceError(503, "本地 TTS 未配置，请检查服务");
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        model:
          backend === "edge-tts" ? "edge-tts" : getAISetting("TTS_MODEL_ID"),
        base: backend === "edge-tts" ? "edge" : getAISetting("TTS_BASE_URL"),
        ...data,
        configuration: aiSettingsFingerprint(),
        backend,
        voice,
      }),
    )
    .digest("hex");
  if (cache.has(key)) return cache.get(key)!;
  if (!inflight.has(key)) {
    if (inflight.size >= 5)
      throw new ServiceError(429, "音频生成队列已满，请稍后重试");
    const task = queue
      .then(async () => {
        if (signal.aborted) throw new ServiceError(499, "请求已取消");
        let wav: Buffer;
        if (backend === "edge-tts") {
          const mp3 = await edgeSpeech(text, voice);
          wav = finiteWav(
            await ffmpegAudio(mp3, [
              "-vn",
              "-filter:a",
              `atempo=${data.speed}`,
              "-f",
              "wav",
            ]),
          );
        } else {
          const native = getAISetting("TTS_API_STYLE") === "mlx-openai";
          const r = await request(
            `${getAISetting("TTS_BASE_URL")}${native ? "/v1/audio/speech" : "/synthesize"}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${getAISetting("TTS_SERVICE_TOKEN") || ""}`,
              },
              body: JSON.stringify(
                native
                  ? {
                      model: getAISetting("TTS_MODEL_ID"),
                      input: text,
                      voice,
                      lang_code: data.language,
                      speed: 1,
                      response_format: "wav",
                      stream: false,
                    }
                  : { ...data, voice },
              ),
            },
            180000,
            0,
          );
          wav = Buffer.from(await r.arrayBuffer());
          if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF")
            throw new ServiceError(502, "TTS 未返回有效 WAV 音频");
          if (native && data.speed !== 1)
            wav = finiteWav(
              await ffmpegAudio(wav, [
                "-filter:a",
                `atempo=${data.speed}`,
                "-f",
                "wav",
              ]),
            );
        }
        cache.set(key, wav);
        bytes += wav.length;
        while (bytes > 64 * 1024 * 1024 && cache.size > 1) {
          const first = cache.keys().next().value!;
          bytes -= cache.get(first)!.length;
          cache.delete(first);
        }
        if (backend === (getAISetting("TTS_BACKEND") || "mlx-audio"))
          recordService(
            "TTS",
            true,
            backend === "edge-tts"
              ? "Edge 在线语音 · 最近生成成功"
              : "本地语音 · 最近生成成功",
          );
        return wav;
      })
      .catch((e) => {
        if (
          backend === (getAISetting("TTS_BACKEND") || "mlx-audio") &&
          !(e instanceof ServiceError && e.status === 499)
        )
          recordService(
            "TTS",
            false,
            e instanceof ServiceError ? e.message : "语音生成失败",
          );
        throw e;
      });
    queue = task.then(
      () => {},
      () => {},
    );
    inflight.set(key, task);
    void task.finally(() => inflight.delete(key)).catch(() => {});
  }
  return inflight.get(key)!;
}
