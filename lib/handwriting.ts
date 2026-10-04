export type RecognizedLine = {
  id: number;
  text: string;
  confidence?: number;
  polygon?: { x: number; y: number }[];
};
export type Alignment = {
  index: number;
  lineIds: number[];
  certain: boolean;
  reason: string;
};
// The LLM may select line IDs, but can never rewrite OCR text or manufacture confidence.
export function materializeGrading(
  lines: RecognizedLine[],
  matches: Alignment[],
  count: number,
) {
  const used = new Map<number, number>();
  for (const m of matches)
    for (const id of new Set(m.lineIds)) used.set(id, (used.get(id) || 0) + 1);
  // Only remove an explicit question label when multiple uniquely aligned rows
  // corroborate numbering. Keep the answer substring verbatim, including typos.
  const numbered = new Map<number, string>();
  for (const m of matches) {
    if (
      !m.certain ||
      m.index < 0 ||
      m.index >= count ||
      m.lineIds.length !== 1 ||
      used.get(m.lineIds[0]) !== 1 ||
      matches.filter((other) => other.index === m.index).length !== 1
    )
      continue;
    const line = lines.find((v) => v.id === m.lineIds[0]);
    if (!line || (typeof line.confidence === "number" && line.confidence < 80))
      continue;
    const n = m.index + 1;
    const label = new RegExp(
      `^\\s*(?:${n}[.．](?:\\s+|(?=[^\\d\\s]))|${n}、\\s*|[（(]${n}[）)]\\s*)(\\S[\\s\\S]*)$`,
    );
    const match = label.exec(line.text);
    if (match) numbered.set(m.index, match[1]);
  }
  return Array.from({ length: count }, (_, index) => {
    const candidates = matches.filter((m) => m.index === index);
    const m = candidates[0];
    if (candidates.length !== 1 || !m)
      return {
        index,
        recognized: "",
        readable: true,
        aligned: false,
        reason: "未得到唯一对齐结果，请人工核查",
      };
    const selected = m.lineIds.map((id) => lines.find((v) => v.id === id));
    const valid =
      selected.length > 0 &&
      selected.every(Boolean) &&
      new Set(m.lineIds).size === m.lineIds.length;
    const ambiguous = !valid || m.lineIds.some((id) => (used.get(id) || 0) > 1);
    const low = selected.some(
      (v) => v && typeof v.confidence === "number" && v.confidence < 80,
    );
    return {
      index,
      recognized:
        (numbered.size >= 2 ? numbered.get(index) : undefined) ??
        selected
          .filter(Boolean)
          .map((v) => v!.text)
          .join(" "),
      readable: valid && !low,
      aligned: valid && !ambiguous && m.certain,
      reason: low
        ? "腾讯返回的识别置信度低于复核阈值 80，请对照图片确认"
        : ambiguous
          ? "文字缺失、重复匹配或来源不明确，请人工核查"
          : m.reason,
    };
  });
}
