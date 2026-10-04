import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ttsHealth } from "@/lib/tts-server";
import { chat, config, ServiceError } from "@/lib/server";
import { tencentConfigured } from "@/lib/tencent-server";
import { recentService, type ServiceName } from "@/lib/service-health";
import { AgentServiceError } from "@/lib/agent-server";
import { runAIAction } from "@/lib/ai-actions-server";
import { acquireAISlot, readJSON } from "@/lib/api-http";
import { aiSaveSchema } from "@/lib/ai-settings";
import {
  AISettingsError,
  aiSettingsStore,
  publicAISettings,
  withAISettings,
  getAISetting,
  aiSettingsRevision,
} from "@/lib/ai-settings-server";

type ActionContext = { params: Promise<{ action: string }> };
export async function GET(req: NextRequest, context: ActionContext) {
  try {
    return await withAISettings(async () => {
      const response = await getResponse(req, (await context.params).action);
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("X-AI-Config-Revision", aiSettingsRevision());
      return response;
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: NextRequest, context: ActionContext) {
  try {
    return await withAISettings(async () => {
      const response = await postResponse(req, context);
      response.headers.set("Cache-Control", "private, no-store");
      if (!response.headers.has("X-AI-Config-Revision"))
        response.headers.set("X-AI-Config-Revision", aiSettingsRevision());
      return response;
    });
  } catch (error) {
    return failure(error);
  }
}
export const runtime = "nodejs";
export const maxDuration = 180;
const counts = new Map<string, { at: number; n: number }>();
function protect(req: NextRequest) {
  const token = process.env.APP_ACCESS_TOKEN;
  if (process.env.WECHAT_APP_ID && (!token || token.length < 24))
    throw new ServiceError(503, "小程序部署需先设置至少 24 位的管理员 APP_ACCESS_TOKEN");
  const authority = req.headers.get("host") || "";
  const host = authority.replace(/:\d+$/, "");
  if (token) {
    if (req.headers.get("authorization") !== `Bearer ${token}`)
      throw new ServiceError(401, "请输入应用访问口令");
  } else if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
    throw new ServiceError(403, "手机或外部访问需先设置 APP_ACCESS_TOKEN");
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== authority)
    throw new ServiceError(403, "拒绝跨站请求");
  const key = "global";
  const now = Date.now();
  let c = counts.get(key);
  if (!c || now - c.at > 60000) {
    c = { at: now, n: 0 };
    counts.set(key, c);
  }
  if (++c.n > 100) throw new ServiceError(429, "请求过于频繁，请稍后重试");
}
async function getResponse(req: NextRequest, action: string) {
  try {
    protect(req);
    if (action === "ai-settings") return NextResponse.json(publicAISettings());
    if (action === "ai-settings-revision")
      return NextResponse.json({
        revision: aiSettingsRevision(),
        ttsBackend: getAISetting("TTS_BACKEND"),
      });
    if (action !== "health") throw new ServiceError(404, "接口不存在");
    const health: Record<string, unknown> = {};
    for (const p of ["VISION", "LLM", "ASR", "HANDWRITING"] as ServiceName[]) {
      try {
        const tencent =
          (p === "ASR" || p === "HANDWRITING" || p === "VISION") &&
          (p === "VISION"
            ? getAISetting("VISION_PROVIDER") === "tencent"
            : getAISetting(`${p}_PROVIDER`) === "tencent");
        if (tencent) {
          if (!tencentConfigured()) throw new Error("missing");
        } else config(p);
        health[p] = {
          state: "configured",
          label: "已配置，待调用验证",
          provider: tencent
            ? "tencent"
            : getAISetting(`${p}_PROVIDER`) || "xfyun",
          model: tencent
            ? p === "ASR"
              ? `腾讯一句话识别 · ${getAISetting("TENCENT_ASR_ENGINE")}`
              : p === "VISION"
                ? "腾讯通用高精度 OCR · 保留版面"
                : "腾讯通用手写体 OCR"
            : getAISetting(`${p}_MODEL`),
          ...recentService(p),
        };
      } catch {
        health[p] = { state: "missing", label: "未配置" };
      }
    }
    health.TTS = await ttsHealth();
    return NextResponse.json(health);
  } catch (e) {
    return failure(e);
  }
}
async function postResponse(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  let release: (() => void) | undefined;
  try {
    protect(req);
    release = acquireAISlot("admin");
    const { action } = await params;
    const b = await readJSON(req);
    if (action === "ai-settings") {
      const data = aiSaveSchema.parse(b);
      const saved = await aiSettingsStore().save(
        data.revision,
        data.changes,
        data.reuseSecrets,
      );
      return NextResponse.json(saved, {
        headers: { "X-AI-Config-Revision": saved.revision },
      });
    }
    if (action === "ai-settings-test") {
      z.object({ service: z.literal("LLM") })
        .strict()
        .parse(b);
      const result = await chat(
        "LLM",
        [{ role: "user", content: "这是连接测试，请只回复：连接成功。" }],
        false,
        req.signal,
      );
      if (!result.trim())
        throw new ServiceError(502, "模型返回了空内容，请检查模型名称");
      return NextResponse.json({ message: "模型已实际响应，连接测试通过" });
    }
    return await runAIAction(action, b, req.signal);
  } catch (e) {
    return failure(e);
  } finally {
    release?.();
  }
}
function failure(e: unknown) {
  return NextResponse.json(
    {
      ...(e instanceof AgentServiceError ? { trace: e.trace } : {}),
      error:
        e instanceof ServiceError || e instanceof AISettingsError
          ? e.message
          : e instanceof z.ZodError
            ? "输入或模型结果不符合要求"
            : "请求失败，请检查配置后重试",
    },
    {
      status:
        e instanceof ServiceError || e instanceof AISettingsError
          ? e.status
          : e instanceof z.ZodError
            ? 400
            : 500,
    },
  );
}
