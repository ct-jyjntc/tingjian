import { signedIn } from "./api";
import { Cancelled } from "./task";
export function notify(message: string) {
  wx.showToast({ title: message, icon: "none", duration: 3000 });
}
export function showError(error: unknown) {
  if (error instanceof Cancelled) return;
  notify(error instanceof Error ? error.message : "操作未完成，请重试");
}
export function confirm(title: string, content: string, confirmText = "确定") {
  return new Promise<boolean>((resolve) =>
    wx.showModal({
      title,
      content,
      confirmText,
      confirmColor: "#5368b9",
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false),
    }),
  );
}
export function requireLogin() {
  if (signedIn()) return true;
  notify("登录后开始练习，记录会保存在你的账号中");
  wx.switchTab({ url: "/pages/profile/index" });
  return false;
}
export function dateLabel(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
export type InputEvent = WechatMiniprogram.CustomEvent<{ value: string }>;
export type TapEvent = WechatMiniprogram.BaseEvent;
