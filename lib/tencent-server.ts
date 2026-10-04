import "server-only";
import { getAISetting } from "./ai-settings-server";
import { asr } from "tencentcloud-sdk-nodejs-asr";
import { ocr } from "tencentcloud-sdk-nodejs-ocr";
import { ServiceError } from "./server";
import { ffmpegAudio } from "./audio-server";
import { recordService } from "./service-health";
import type { RecognizedLine } from "./handwriting";
export function tencentConfigured() {
  return Boolean(
    getAISetting("TENCENT_SECRET_ID") && getAISetting("TENCENT_SECRET_KEY"),
  );
}
function options() {
  if (!tencentConfigured())
    throw new ServiceError(503, "腾讯云未配置 SecretId 和 SecretKey");
  return {
    credential: {
      secretId: getAISetting("TENCENT_SECRET_ID")!,
      secretKey: getAISetting("TENCENT_SECRET_KEY")!,
    },
    region: getAISetting("TENCENT_REGION") || "ap-guangzhou",
    profile: { httpProfile: { reqTimeout: 25 } },
  };
}
function cloudError(e: unknown) {
  if (e instanceof ServiceError) return e;
  const code =
    typeof e === "object" &&
    e &&
    "code" in e &&
    typeof e.code === "string" &&
    /^[A-Za-z0-9._]{1,100}$/.test(e.code)
      ? e.code
      : "ProviderError";
  const label = /AuthFailure|Unauthorized/.test(code)
    ? "腾讯云鉴权或权限不足，请检查子账号授权"
    : /InArrears|ResourcePackage|Quota|LimitExceeded/.test(code)
      ? "腾讯云额度不足或请求受限，请检查免费资源包"
      : /UserNotRegistered|ServiceNot|NotActivated|UnOpen/.test(code)
        ? "腾讯云服务尚未开通，请在控制台开通对应服务"
        : "腾讯云调用失败，请检查服务开通和账号状态";
  return new ServiceError(503, `${label}（${code}）`);
}
export async function transcribeTencent(audio: Buffer, signal: AbortSignal) {
  try {
    const pcm = await ffmpegAudio(
      audio,
      ["-vn", "-ac", "1", "-ar", "16000", "-t", "12", "-f", "s16le"],
      signal,
    );
    if (!pcm.length || pcm.length > 384000)
      throw new ServiceError(400, "音频为空或过长，请录制短口令");
    const client = new asr.v20190614.Client(options());
    const params: Parameters<typeof client.SentenceRecognition>[0] = {
      EngSerViceType: getAISetting("TENCENT_ASR_ENGINE") || "16k_zh",
      SourceType: 1,
      VoiceFormat: "pcm",
      Data: pcm.toString("base64"),
      DataLen: pcm.length,
      FilterPunc: 0,
      FilterModal: 0,
      FilterDirty: 0,
      ConvertNumMode: 0,
    };
    const result = (await client.request("SentenceRecognition", params, {
      signal,
    })) as Awaited<ReturnType<typeof client.SentenceRecognition>>;
    if (signal.aborted) throw new ServiceError(499, "请求已取消");
    if (typeof result.Result !== "string")
      throw new ServiceError(502, "腾讯云没有返回识别文字");
    recordService("ASR", true, "腾讯一句话识别 · 最近调用成功");
    return {
      text: result.Result,
      final: true,
      provider: "tencent",
      durationMs: result.AudioDuration,
    };
  } catch (e) {
    if (signal.aborted) throw new ServiceError(499, "请求已取消");
    const error = cloudError(e);
    if (error.status !== 499) recordService("ASR", false, error.message);
    throw error;
  }
}
export async function recognizeHandwriting(
  image: string,
  signal: AbortSignal,
): Promise<RecognizedLine[]> {
  try {
    const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(image);
    if (!match) throw new ServiceError(400, "不支持的图片格式");
    let bytes = Buffer.from(match[2], "base64");
    if (match[1] === "webp") {
      const { default: sharp } = await import("sharp");
      bytes = await sharp(bytes).jpeg().toBuffer();
    }
    if (bytes.toString("base64").length > 10 * 1024 * 1024)
      throw new ServiceError(413, "腾讯手写识别要求 Base64 图片不超过 10 MB");
    if (signal.aborted) throw new ServiceError(499, "请求已取消");
    const client = new ocr.v20181119.Client(options());
    const params: Parameters<typeof client.GeneralHandwritingOCR>[0] = {
      ImageBase64: bytes.toString("base64"),
      EnableWordPolygon: false,
    };
    const result = (await client.request("GeneralHandwritingOCR", params, {
      signal,
    })) as Awaited<ReturnType<typeof client.GeneralHandwritingOCR>>;
    if (signal.aborted) throw new ServiceError(499, "请求已取消");
    const lines = (result.TextDetections || [])
      .filter(
        (v) => typeof v.DetectedText === "string" && v.DetectedText.trim(),
      )
      .map((v, id) => ({
        id,
        text: v.DetectedText!,
        confidence: v.Confidence,
        polygon: v.Polygon?.map((p) => ({ x: p.X ?? 0, y: p.Y ?? 0 })),
      }));
    recordService("HANDWRITING", true, "腾讯通用手写体识别 · 最近调用成功");
    return lines;
  } catch (e) {
    if (signal.aborted) throw new ServiceError(499, "请求已取消");
    const error = cloudError(e);
    if (error.status !== 499)
      recordService("HANDWRITING", false, error.message);
    throw error;
  }
}

// Printed textbook OCR retains geometry, unlike free-form generative OCR text.
export async function recognizePrinted(image: string, signal: AbortSignal) {
  try {
    const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(image);
    if (!match) throw new ServiceError(400, "不支持的图片格式");
    let bytes = Buffer.from(match[2], "base64");
    if (match[1] === "webp") {
      const { default: sharp } = await import("sharp");
      bytes = await sharp(bytes).jpeg().toBuffer();
    }
    if ((bytes.length * 4) / 3 > 10 * 1024 * 1024)
      throw new ServiceError(413, "图片过大，请缩小后重试");
    if (signal.aborted) throw new ServiceError(499, "已取消");
    const client = new ocr.v20181119.Client(options());
    const params: Parameters<typeof client.GeneralAccurateOCR>[0] = {
      ImageBase64: bytes.toString("base64"),
    };
    const result = (await client.request("GeneralAccurateOCR", params, {
      signal,
    })) as Awaited<ReturnType<typeof client.GeneralAccurateOCR>>;
    const blocks = (result.TextDetections || [])
      .filter((v) => v.DetectedText?.trim())
      .map((v, i) => ({
        id: `block-${i + 1}`,
        text: v.DetectedText!,
        confidence: v.Confidence,
        box: v.ItemPolygon
          ? {
              x: v.ItemPolygon.X || 0,
              y: v.ItemPolygon.Y || 0,
              width: v.ItemPolygon.Width || 0,
              height: v.ItemPolygon.Height || 0,
            }
          : undefined,
        polygon: v.Polygon?.map((p) => ({ x: p.X || 0, y: p.Y || 0 })),
      }));
    recordService("VISION", true, "腾讯版面识别 · 最近调用成功");
    return blocks;
  } catch (e) {
    if (signal.aborted) throw new ServiceError(499, "请求已取消");
    const error = cloudError(e);
    recordService("VISION", false, error.message);
    throw error;
  }
}
