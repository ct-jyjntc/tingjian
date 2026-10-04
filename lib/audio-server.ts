import "server-only";
import { getAISetting } from "./ai-settings-server";
import { spawn } from "node:child_process";
import { ServiceError } from "./server";
export function ffmpegAudio(
  input: Buffer,
  args: string[],
  signal?: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ServiceError(499, "请求已取消"));
      return;
    }
    const p = spawn(
      /* turbopackIgnore: true */ getAISetting("FFMPEG_PATH") || "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "pipe,crypto,data",
        "-i",
        "pipe:0",
        ...args,
        "pipe:1",
      ],
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    const cancel = () => {
      p.kill();
      reject(new ServiceError(499, "请求已取消"));
    };
    const timer = setTimeout(() => {
      p.kill();
      reject(new ServiceError(504, "音频转换超时"));
    }, 15000);
    signal?.addEventListener("abort", cancel, { once: true });
    p.stdout.on("data", (c: Buffer) => {
      bytes += c.length;
      if (bytes > 12 * 1024 * 1024) {
        p.kill();
        reject(new ServiceError(413, "音频超过限制"));
      } else chunks.push(c);
    });
    p.stderr.resume();
    p.stdin.on("error", () => {});
    p.on("error", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(new ServiceError(503, "音频处理需要 FFmpeg，请检查服务器安装"));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new ServiceError(502, "音频无法解码或转换，请重新录音"));
    });
    p.stdin.end(input);
  });
}
export function finiteWav(wav: Buffer) {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF")
    throw new ServiceError(502, "未返回有效 WAV 音频");
  wav.writeUInt32LE(wav.length - 8, 4);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const name = wav.toString("ascii", offset, offset + 4);
    if (name === "data") {
      wav.writeUInt32LE(wav.length - offset - 8, offset + 4);
      break;
    }
    const size = wav.readUInt32LE(offset + 4);
    offset += 8 + size + (size % 2);
  }
  return wav;
}
