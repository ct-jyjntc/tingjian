import { z } from "zod";

export const explanationSchema = z.object({
  title: z.string(),
  summary: z.string(),
  sections: z.array(z.object({ label: z.string(), text: z.string() })).max(8),
});
export type Explanation = z.infer<typeof explanationSchema>;

// Model prose is rendered as text, never as HTML. Remove presentation markers
// before displaying or speaking it, including older Markdown explanations.
export function readableText(text: string) {
  return text
    .replace(/```[^\n]*\n?/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[-*][ \t]+/gm, "")
    .trim();
}

export function explanationText(explanation: Explanation) {
  return [
    explanation.summary,
    ...explanation.sections.map(
      (section) => `${section.label}：${section.text}`,
    ),
  ]
    .map(readableText)
    .filter(Boolean)
    .join("\n\n");
}

// TTS accepts at most 1,000 characters per request. Speak all content in
// sentence-sized chunks instead of truncating the model's answer.
export function speechChunks(text: string, limit = 850): string[] {
  if (!Number.isInteger(limit) || limit < 1)
    throw Error("Invalid speech chunk size");
  const chars = readableText(text);
  const chunks: string[] = [];
  for (let offset = 0; offset < chars.length;) {
    let end = Math.min(offset + limit, chars.length);
    if (end < chars.length && /[\uD800-\uDBFF]/.test(chars[end - 1])) end--;
    if (end === offset)
      throw Error("Speech chunk size cannot fit this character");
    if (end < chars.length) {
      for (let i = end - 1; i > offset + limit / 2; i--) {
        if (/[。！？.!?；;\n]/u.test(chars[i])) {
          end = i + 1;
          break;
        }
      }
    }
    const chunk = chars.slice(offset, end).trim();
    if (chunk) chunks.push(chunk);
    offset = end;
  }
  return chunks;
}
