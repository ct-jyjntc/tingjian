import "server-only";
import { getAISetting } from "./ai-settings-server";
import { recordService, type ServiceName } from "./service-health";
export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request(
  url: string,
  init: RequestInit = {},
  timeout = 60000,
  retries = 1,
): Promise<Response> {
  for (let n = 0; ; n++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.any([
          AbortSignal.timeout(timeout),
          ...(init.signal ? [init.signal] : []),
        ]),
      });
      if (response.ok) return response;
      if ((response.status === 429 || response.status >= 500) && n < retries) {
        const retryHeader = response.headers.get("retry-after");
        const retrySeconds = retryHeader
          ? Number.isFinite(Number(retryHeader))
            ? Number(retryHeader)
            : (Date.parse(retryHeader) - Date.now()) / 1000
          : 0;
        const delay = Math.min(
          3000,
          Math.max(800 * (n + 1), retrySeconds * 1000 || 0),
        );
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            init.signal?.removeEventListener("abort", cancel);
            resolve();
          }, delay);
          const cancel = () => {
            clearTimeout(timer);
            reject(new ServiceError(499, "请求已取消"));
          };
          init.signal?.addEventListener("abort", cancel, { once: true });
          if (init.signal?.aborted) cancel();
        });
        continue;
      }
      throw new ServiceError(
        response.status === 401 || response.status === 403
          ? 502
          : response.status === 429
            ? 429
            : 502,
        response.status === 401 || response.status === 403
          ? "服务鉴权失败，请检查后端配置"
          : response.status === 429
            ? "服务请求过多，请稍后重试"
            : "模型服务请求失败，请稍后重试",
      );
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      if (init.signal?.aborted) throw new ServiceError(499, "请求已取消");
      if (n < retries) continue;
      throw new ServiceError(503, "服务未连接或请求超时，请检查服务后重试");
    }
  }
}
export function config(prefix: string) {
  const base = getAISetting(`${prefix}_BASE_URL`),
    key = getAISetting(`${prefix}_API_KEY`),
    model = getAISetting(`${prefix}_MODEL`);
  if (!base || !key || !model)
    throw new ServiceError(
      503,
      `${prefix} 未配置，请在服务器配置地址、密钥和模型`,
    );
  if (
    prefix !== "VISION" &&
    getAISetting(`${prefix}_PROVIDER`) !== "openai-compatible"
  )
    throw new ServiceError(
      503,
      `${prefix}_PROVIDER 未配置为经过供应商确认的 openai-compatible`,
    );
  return { base: base.replace(/\/$/, ""), key, model };
}
export async function chat(
  prefix: string,
  messages: unknown[],
  json = false,
  signal?: AbortSignal,
) {
  const c = config(prefix);
  try {
    const r = await request(`${c.base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: c.model,
        messages,
        stream: false,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal,
    });
    const d = await r.json();
    if (d.choices?.[0]?.finish_reason === "length")
      throw new ServiceError(502, "模型服务未返回完整结果，请重试");
    const content = d.choices?.[0]?.message?.content;
    if (typeof content !== "string")
      throw new ServiceError(502, "服务返回了无法解析的结果");
    recordService(prefix as ServiceName, true);
    return content;
  } catch (e) {
    if (!(e instanceof ServiceError && e.status === 499))
      recordService(
        prefix as ServiceName,
        false,
        e instanceof ServiceError ? e.message : "服务响应异常",
      );
    throw e;
  }
}
export function parseJSON(text: string) {
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ServiceError(502, "模型未返回有效的结构化结果，请重试");
  }
}
