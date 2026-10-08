import { auth, APIError } from "./api";
import { newItem, type DraftDocument } from "../shared";

export type EditorWork = { draft: DraftDocument; input: string };
type Slot = "new-draft" | "draft-input" | "voice-enabled";
function key(slot: Slot) {
  const id = auth()?.user.id;
  if (!id) throw new APIError("请先登录", 401);
  // This is local form state, not a dirty cloud document. Logout clears it too.
  return `tingjian:user:${id}:form:${slot}`;
}
export function readWork<T>(slot: Slot): T | null {
  const value = wx.getStorageSync(key(slot));
  return value === "" || value == null ? null : value;
}
export function saveWork<T>(slot: Slot, value: T) {
  try {
    wx.setStorageSync(key(slot), value);
  } catch {
    throw new APIError("本机空间不足，输入暂留在当前页面，请勿退出");
  }
}
export function clearWork(slot: Slot) {
  wx.removeStorageSync(key(slot));
}
export function hasWork(work: EditorWork | null) {
  return Boolean(work && (work.draft.items.length || work.input.trim()));
}
export function textItems(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [spoken, ...answer] = line.split(/\t|→|=>/);
      return {
        ...newItem(spoken.trim()),
        original: line,
        answer: answer.length ? answer.join(" ").trim() : spoken.trim(),
      };
    });
}
export function inputCount(text: string) {
  return text.split(/\r?\n/).filter((line) => line.trim()).length;
}
