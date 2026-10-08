import { stripPunctuation, type Intent, type Session } from "../shared";

/** Conservative fast path; unfamiliar phrasing can use the control-only model. */
export function dictationCommand(
  text: string,
  phase: Session["phase"],
): { intent: Intent; infer: boolean } {
  const raw = text.trim();
  const t = stripPunctuation(raw)
    .replace(/\s/g, "")
    .replace(/能不能/g, "能否")
    .replace(/可不可以/g, "可否")
    .replace(/^(老师|听见|请|麻烦你|麻烦|帮我)+/, "")
    .replace(/[吧呀啦啊哦呢]+$/, "");
  const result = (intent: Intent) => ({ intent, infer: false });
  if (!t || t.length > 160) return result("unknown");
  if (
    /还没(?:有)?(?:写|好|完)|没(?:有)?写完|没(?:有)?写好|不要.*(?:下一|往下)|别.*(?:下一|往下)|等一下|等会|等一等|稍等|暂停|停一下|等我/.test(
      t,
    )
  )
    return result("pause");
  if (/不要|不用|不想|别|不可以|不能/.test(t)) return result("unknown");
  if (
    /^(再(?:读|念)(?:一遍|一次)?|重(?:读|念)(?:一遍|一次)?|重复(?:一遍|一次)?|(?:我|刚才|这个|这项)?(?:没听清|没听到|听不清)(?:楚)?|刚刚那个没跟上)$/.test(
      t,
    )
  )
    return result("repeat");
  if (/^(?:读|念|说)?(?:慢一点|慢点|太快了|慢一些)$/.test(t))
    return result("slower");
  if (/^(?:读|念|说)?(?:快一点|快点|太慢了|快一些)$/.test(t))
    return result("faster");
  if (/^(?:上|前)一(?:个|项|题)(?:再读一遍)?$/.test(t))
    return result("previous");
  if (
    /^(?:这(?:一)?(?:个|项|题))?(?:我)?(?:已经)?(?:写好了|写完了|好了|完成了)$/.test(
      t,
    ) ||
    /^(?:下一(?:个|项|题)|往下|继续下一(?:个|项|题))$/.test(t)
  )
    return result("next");
  if (/^(?:继续|继续听写|开始|开始听写|接着来)$/.test(t))
    return result(phase === "waiting" ? "next" : "resume");
  if (/^(?:结束听写|结束这次听写|今天先到这里|今天就到这里)$/.test(t))
    return result("end");
  if (/^(?:标记|标记不会|这(?:个|项|题)不会|这(?:个|项|题)记一下)$/.test(t))
    return result("mark");
  return { intent: "unknown", infer: true };
}
