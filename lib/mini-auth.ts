import "server-only";
import { ServiceError } from "./server";

export const privacyVersion = () =>
  process.env.MINI_PRIVACY_VERSION || "2026-10-03";
export function publicMiniConfig() {
  return {
    name: "听见",
    privacyVersion: privacyVersion(),
    operator: process.env.MINI_OPERATOR || "",
    contact: process.env.MINI_CONTACT || "",
    processors: process.env.MINI_AI_PROCESSORS || "",
    configured: Boolean(
      process.env.WECHAT_APP_ID &&
      process.env.WECHAT_APP_SECRET &&
      (process.env.APP_ACCESS_TOKEN?.length || 0) >= 24 &&
      process.env.MINI_OPERATOR &&
      process.env.MINI_CONTACT &&
      process.env.MINI_AI_PROCESSORS,
    ),
  };
}
export function dailyLimits() {
  const number = (key: string, fallback: number) => {
    const value = Number(process.env[key] || fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000)
      throw new ServiceError(503, "服务额度配置错误，请联系运营者");
    return value;
  };
  return {
    user: number("MINI_DAILY_CREDITS", 200),
    global: number("MINI_GLOBAL_DAILY_CREDITS", 5000),
  };
}
export async function exchangeWeChatCode(code: string, signal: AbortSignal) {
  if (!publicMiniConfig().configured)
    throw new ServiceError(503, "服务尚未开放，请联系运营者");
  const appId = process.env.WECHAT_APP_ID!;
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.search = new URLSearchParams({
    appid: appId,
    secret: process.env.WECHAT_APP_SECRET!,
    js_code: code,
    grant_type: "authorization_code",
  }).toString();
  let data: { errcode?: number; openid?: string };
  try {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      cache: "no-store",
    });
    if (!response.ok) throw Error("WeChat unavailable");
    data = await response.json();
  } catch {
    // Never log the URL, login code, session_key, or WeChat secret.
    throw new ServiceError(503, "微信登录暂时不可用，请稍后重试");
  }
  if (
    data.errcode ||
    typeof data.openid !== "string" ||
    !data.openid ||
    data.openid.length > 128
  )
    throw new ServiceError(401, "微信登录凭证已失效，请重新点击登录");
  return { appId, openId: data.openid };
}
