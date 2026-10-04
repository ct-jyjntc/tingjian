import { Session } from "./types";
export type Intent =
  | "next"
  | "repeat"
  | "slower"
  | "faster"
  | "pause"
  | "resume"
  | "previous"
  | "mark"
  | "explain"
  | "end"
  | "unknown";
export function parseIntent(text: string): Intent {
  const t = text.replace(/[\s，。！？、,.!?]/g, "");
  if (/等一下|暂停|还没|没写完|不要下一个|别.*(下一|前进)/.test(t))
    return "pause";
  if (/不用重复|不要重复|听清了|不要.*(结束|停止)/.test(t)) return "unknown";
  if (/结束听写/.test(t)) return "end";
  if (/前一个|上一个/.test(t)) return "previous";
  if (/慢一点|读太快/.test(t)) return "slower";
  if (/快一点/.test(t)) return "faster";
  if (/听不清|没听到|再念|再读|重复/.test(t)) return "repeat";
  if (/继续|接着来/.test(t)) return "resume";
  if (/标记|不会/.test(t)) return "mark";
  if (/什么意思|解释/.test(t)) return "explain";
  if (/^(好了|写好了|写完了|下一题|下一个)+$/.test(t)) return "next";
  return "unknown";
}
export function transition(s: Session, intent: Intent, round: number): Session {
  if (round !== s.round || s.phase === "completed" || s.phase === "confirming")
    return s;
  if (intent === "pause") return { ...s, phase: "paused", round: s.round + 1 };
  if (intent === "end")
    return { ...s, phase: "confirming", round: s.round + 1 };
  if (intent === "explain" && !s.settings.allowHints) return s;
  if (intent === "mark" || intent === "explain")
    return {
      ...s,
      items: s.items.map((v, i) =>
        i === s.index
          ? {
              ...v,
              marked: intent === "mark" || v.marked,
              hint: intent === "explain" || v.hint,
            }
          : v,
      ),
    };
  if (intent === "next" && s.phase === "waiting")
    return s.index === s.items.length - 1
      ? {
          ...s,
          phase: "completed",
          confirmedCount: s.items.length,
          ended: Date.now(),
          round: s.round + 1,
        }
      : { ...s, index: s.index + 1, phase: "preparing", round: s.round + 1 };
  if (intent === "faster")
    return {
      ...s,
      settings: { ...s.settings, speed: Math.min(1.5, s.settings.speed + 0.1) },
    };
  if (["repeat", "slower", "resume", "previous"].includes(intent))
    return {
      ...s,
      index: intent === "previous" ? Math.max(0, s.index - 1) : s.index,
      phase: "preparing",
      error: undefined,
      round: s.round + 1,
      settings: {
        ...s.settings,
        speed:
          intent === "slower"
            ? Math.max(0.5, s.settings.speed - 0.1)
            : s.settings.speed,
      },
    };
  return s;
}
export function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function grade(
  answer: string,
  expected: string,
  readable: boolean,
  caseSensitive = false,
  punctuation = false,
) {
  if (!readable) return "无法辨认";
  const norm = (s: string) =>
    (caseSensitive ? s : s.toLowerCase())
      .normalize("NFKC")
      .replace(punctuation ? /\s+/g : /[\s\p{P}]/gu, "");
  return !answer.trim()
    ? "漏写"
    : norm(answer) === norm(expected)
      ? "正确"
      : "错误";
}
