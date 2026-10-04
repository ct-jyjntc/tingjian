import { serviceBaseUrl } from "../config";
import { recordId, type TtsBackend } from "../shared";
import { Cancelled, TaskScope } from "./task";

export type Auth = { token: string; expiresAt: number; user: { id: string } };
export type PublicConfig = {
  name: string;
  operator: string;
  contact: string;
  privacyVersion: string;
  configured: boolean;
};
export type Bootstrap = {
  user: { id: string };
  quota: { day: string; used: number; limit: number; remaining: number };
  ttsBackend: TtsBackend;
  voices: { id: string; label: string }[];
  revision: string;
  config: PublicConfig;
};
const authKey = "tingjian:auth:v1";
let bootstrapValue: Bootstrap | undefined;
export class APIError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export function auth(): Auth | null {
  const value = wx.getStorageSync(authKey) as Auth | undefined;
  return value?.user?.id && value.expiresAt > Date.now() && value.token
    ? value
    : null;
}
export function signedIn() {
  return Boolean(auth());
}
export function clearAuth() {
  wx.removeStorageSync(authKey);
  bootstrapValue = undefined;
}
export function cachedBootstrap() {
  return bootstrapValue;
}

export function request<T>(
  endpoint: string,
  options: {
    data?: unknown;
    method?: "GET" | "POST" | "DELETE";
    public?: boolean;
    scope?: TaskScope;
    binary?: boolean;
  } = {},
): Promise<T> {
  if (!serviceBaseUrl)
    return Promise.reject(new APIError("服务尚未开放，请联系运营者"));
  options.scope?.check();
  const identity = auth();
  if (!options.public && !identity)
    return Promise.reject(new APIError("请先微信登录", 401));
  return new Promise<T>((resolve, reject) => {
    let remove = () => {};
    const task = wx.request({
      url: `${serviceBaseUrl}/api/mini/${endpoint}`,
      method: options.method || (options.data === undefined ? "GET" : "POST"),
      data: options.data as WechatMiniprogram.IAnyObject,
      header: {
        "Content-Type": "application/json",
        ...(identity && !options.public
          ? { Authorization: `Bearer ${identity.token}` }
          : {}),
      },
      timeout: 30_000,
      responseType: options.binary ? "arraybuffer" : "text",
      dataType: options.binary ? "other" : "json",
      success(response) {
        if (
          options.scope?.cancelled ||
          (!options.public && auth()?.token !== identity?.token)
        ) {
          reject(new Cancelled());
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const message =
            !options.binary &&
            response.data &&
            typeof response.data === "object" &&
            "error" in response.data
              ? String(response.data.error)
              : "服务未完成，请稍后重试";
          if (
            response.statusCode === 401 &&
            !options.public &&
            auth()?.token === identity?.token
          )
            clearAuth();
          reject(new APIError(message, response.statusCode));
        } else resolve(response.data as T);
      },
      fail() {
        reject(
          options.scope?.cancelled
            ? new Cancelled()
            : new APIError("网络未连接，记录仍保留在本机，请稍后重试"),
        );
      },
      complete() {
        remove();
      },
    });
    remove = options.scope?.onCancel(() => task.abort()) || (() => {});
  });
}
export async function login(version: string) {
  const code = await new Promise<string>((resolve, reject) =>
    wx.login({
      timeout: 10_000,
      success: (result) =>
        result.code
          ? resolve(result.code)
          : reject(new APIError("无法取得微信登录凭证")),
      fail: () => reject(new APIError("微信登录失败，请稍后重试")),
    }),
  );
  const result = await request<Auth>("login", {
    public: true,
    data: { code, privacyVersion: version },
  });
  const previous = wx.getStorageSync(authKey) as Auth | undefined;
  if (previous?.user?.id && previous.user.id !== result.user.id)
    clearUserCache(previous.user.id);
  wx.setStorageSync(authKey, result);
  bootstrapValue = undefined;
  return result;
}
export async function bootstrap() {
  const result = await request<Bootstrap>("bootstrap");
  bootstrapValue = result;
  return result;
}
export function clearUserCache(id: string) {
  for (const key of wx.getStorageInfoSync().keys)
    if (key.startsWith(`tingjian:user:${id}:`)) wx.removeStorageSync(key);
}
export async function logout(removeAccount = false) {
  const identity = auth();
  if (!identity) {
    clearAuth();
    return;
  }
  await request(removeAccount ? "account-delete" : "logout", {
    data: removeAccount ? { confirm: "DELETE" } : {},
  });
  clearUserCache(identity.user.id);
  clearAuth();
}
type Job = {
  id: string;
  state: string;
  result?: unknown;
  audio?: boolean;
  error?: string;
  status?: number;
};
export async function ai<T>(
  action: string,
  payload: unknown,
  scope = new TaskScope(),
): Promise<T> {
  scope.check();
  // Let the short submission finish even when the user cancels, so that its
  // returned job ID can be cancelled instead of orphaning an expensive task.
  const created = await request<{ id: string }>("jobs", {
    data: { action, payload, requestId: recordId() },
  });
  const endpoint = `jobs?id=${encodeURIComponent(created.id)}`;
  const cancel = () => {
    void request(endpoint, { method: "DELETE" }).catch(() => {});
  };
  const remove = scope.onCancel(cancel);
  try {
    const deadline = Date.now() + 200_000;
    while (Date.now() < deadline) {
      scope.check();
      const job = await request<Job>(endpoint, { scope });
      if (job.state === "done")
        return job.audio
          ? await request<T>(`audio?id=${encodeURIComponent(job.id)}`, {
              scope,
              binary: true,
            })
          : (job.result as T);
      if (job.state === "failed")
        throw new APIError(job.error || "AI 服务暂时不可用", job.status);
      if (job.state === "cancelled") throw new Cancelled();
      await scope.wait(1500);
    }
    throw new APIError("等待超时，请稍后重新尝试", 504);
  } finally {
    remove();
    cancel();
  }
}
