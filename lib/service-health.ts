import "server-only";
import { aiSettingsFingerprint } from "./ai-settings-server";
export type ServiceName = "VISION" | "LLM" | "ASR" | "HANDWRITING" | "TTS";
type Check = {
  state: "ready" | "error";
  label: string;
  checkedAt: string;
  signature: string;
};
const checks = new Map<ServiceName, Check>();
function signature(_name: ServiceName) {
  return aiSettingsFingerprint();
}
export function recordService(name: ServiceName, ok: boolean, label?: string) {
  checks.set(name, {
    state: ok ? "ready" : "error",
    label: label || (ok ? "最近调用成功" : "最近调用失败"),
    checkedAt: new Date().toISOString(),
    signature: signature(name),
  });
}
export function recentService(name: ServiceName) {
  const check = checks.get(name);
  if (!check || check.signature !== signature(name)) return {};
  return { state: check.state, label: check.label, checkedAt: check.checkedAt };
}
