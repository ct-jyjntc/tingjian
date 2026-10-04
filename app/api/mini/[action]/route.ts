import { after, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { miniStore } from "@/lib/mini-store";
import {
  exchangeWeChatCode,
  dailyLimits,
  privacyVersion,
  publicMiniConfig,
} from "@/lib/mini-auth";
import { miniJobs, aiCosts, type MiniAction } from "@/lib/mini-jobs";
import { documentKey } from "@/lib/mini-schema";
import { readJSON } from "@/lib/api-http";
import { ServiceError } from "@/lib/server";
import {
  withAISettings,
  getAISetting,
  aiSettingsRevision,
} from "@/lib/ai-settings-server";
import { speechVoices, type TtsBackend } from "@/lib/voices";

export const runtime = "nodejs";
export const maxDuration = 190;
type Context = { params: Promise<{ action: string }> };

async function handle(req: NextRequest, context: Context) {
  try {
    const { action } = await context.params;
    let response: Response;
    if (req.method === "GET" && action === "config")
      response = Response.json(publicMiniConfig());
    else response = await authenticated(req, action);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ServiceError
            ? error.message
            : error instanceof z.ZodError
              ? "请求格式不正确"
              : "服务暂时不可用，请稍后重试",
      },
      {
        status:
          error instanceof ServiceError
            ? error.status
            : error instanceof z.ZodError
              ? 400
              : 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
async function authenticated(
  req: NextRequest,
  action: string,
): Promise<Response> {
  const store = miniStore();
  if (action === "login" && req.method === "POST") {
    store.rateLimit("login:global", 120);
    if (process.env.MINI_TRUST_PROXY === "1")
      store.rateLimit(
        `login:ip:${createHash("sha256")
          .update(req.headers.get("x-real-ip")?.slice(0, 64) || "unknown")
          .digest("hex")}`,
        15,
      );
    const data = z
      .object({
        code: z.string().min(4).max(256),
        privacyVersion: z.literal(privacyVersion()),
      })
      .strict()
      .parse(await readJSON(req, 4096));
    const { appId, openId } = await exchangeWeChatCode(data.code, req.signal);
    return Response.json(store.login(appId, openId, data.privacyVersion));
  }
  const authorization = req.headers.get("authorization");
  const user = store.authenticate(authorization);
  store.rateLimit(`requests:${user.id}`, 240);
  if (req.method === "GET" && action === "bootstrap")
    return withAISettings(() => {
      const backend = (getAISetting("TTS_BACKEND") as TtsBackend) || "edge-tts";
      return Response.json({
        user: { id: user.id },
        quota: store.quota(user.identity, dailyLimits().user),
        ttsBackend: backend,
        voices: speechVoices[backend],
        revision: aiSettingsRevision(),
        config: publicMiniConfig(),
        costs: aiCosts,
      });
    });
  if (req.method === "POST" && action === "logout") {
    store.logout(authorization);
    return Response.json({ ok: true });
  }
  if (req.method === "POST" && action === "account-delete") {
    z.object({ confirm: z.literal("DELETE") })
      .strict()
      .parse(await readJSON(req, 4096));
    miniJobs().deleteUser(user.id);
    store.deleteAccount(user.id);
    return Response.json({ ok: true });
  }
  if (action === "data") {
    if (req.method === "GET") {
      if (req.nextUrl.searchParams.get("list") === "history")
        return Response.json(store.history(user.id));
      return Response.json(
        store.read(
          user.id,
          documentKey.parse(req.nextUrl.searchParams.get("key")),
        ),
      );
    }
    if (req.method === "POST") {
      const data = z
        .object({
          key: documentKey,
          revision: z.number().int().nonnegative(),
          value: z.unknown(),
        })
        .strict()
        .parse(await readJSON(req, 750_000));
      return Response.json(
        store.save(user.id, data.key, data.revision, data.value),
      );
    }
    if (req.method === "DELETE") {
      const key = documentKey.parse(req.nextUrl.searchParams.get("key"));
      const revision = z.coerce
        .number()
        .int()
        .min(1)
        .parse(req.nextUrl.searchParams.get("revision"));
      store.deleteDocument(user.id, key, revision);
      return Response.json({ ok: true });
    }
  }
  if (action === "jobs") {
    if (req.method === "POST") {
      const data = z
        .object({
          action: z.enum(Object.keys(aiCosts) as [MiniAction, ...MiniAction[]]),
          requestId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
          payload: z.record(z.string(), z.unknown()),
        })
        .strict()
        .parse(await readJSON(req));
      const limits = dailyLimits();
      const job = miniJobs().create(
        user.id,
        data.requestId,
        data.action,
        data.payload,
        () =>
          store.consume(
            user.identity,
            aiCosts[data.action],
            limits.user,
            limits.global,
          ),
      );
      after(job.run);
      return Response.json({ id: job.id }, { status: 202 });
    }
    const id = z.string().uuid().parse(req.nextUrl.searchParams.get("id"));
    if (req.method === "GET")
      return Response.json(miniJobs().read(user.id, id));
    if (req.method === "DELETE") {
      miniJobs().cancel(user.id, id);
      return Response.json({ ok: true });
    }
  }
  if (action === "audio" && req.method === "GET") {
    const id = z.string().uuid().parse(req.nextUrl.searchParams.get("id"));
    return new Response(new Uint8Array(miniJobs().audio(user.id, id)), {
      headers: { "Content-Type": "audio/wav" },
    });
  }
  throw new ServiceError(404, "接口不存在");
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
