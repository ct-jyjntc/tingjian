import { z } from "zod";
import { itemSchema, materialSchema } from "./material-schema";

export const documentKey = z
  .string()
  .regex(/^(draft|settings|session|wrong|history:[A-Za-z0-9_-]{1,120})$/);
const settings = z.object({
  ttsBackend: z.enum(["edge-tts", "mlx-audio"]),
  voice: z.string().min(1).max(80),
  speed: z.number().min(0.5).max(1.5),
  repeats: z.number().int().min(1).max(5),
  gap: z.number().min(0).max(10),
  order: z.enum(["original", "random", "custom"]),
  mode: z.string().max(100),
  showAnswer: z.boolean(),
  voiceControl: z.boolean(),
  allowHints: z.boolean(),
});
const session = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
    items: z.array(itemSchema).min(1).max(300),
    index: z.number().int().nonnegative(),
    phase: z.enum([
      "idle",
      "preparing",
      "playing",
      "waiting",
      "paused",
      "confirming",
      "completed",
      "error",
    ]),
    round: z.number().int().nonnegative(),
    settings,
    started: z.number().int().nonnegative(),
    ended: z.number().int().nonnegative().optional(),
    confirmedCount: z.number().int().min(0).max(300).optional(),
    error: z.string().max(2000).optional(),
  })
  .refine(
    (s) =>
      s.index < s.items.length && (s.confirmedCount ?? 0) <= s.items.length,
  );
const grading = z.object({
  recognized: z.string().max(4000),
  status: z.enum(["待确认", "无法辨认", "漏写", "正确", "错误"]),
  reason: z.string().max(4000),
  confirmed: z.boolean(),
});
export function validateStudyDocument(key: string, value: unknown): unknown {
  documentKey.parse(key);
  if (key === "draft")
    return z
      .object({
        title: z.string().max(100),
        items: z.array(itemSchema).max(300),
        materials: z.array(materialSchema).max(10),
      })
      .parse(value);
  if (key === "settings") return settings.parse(value);
  if (key === "session") return session.nullable().parse(value);
  if (key === "wrong") return z.array(itemSchema).max(300).parse(value);
  const history = z
    .object({ session, results: z.array(grading).max(300) })
    .parse(value);
  if (
    key !== `history:${history.session.id}` ||
    history.results.length !== history.session.items.length
  )
    throw new Error("INVALID_HISTORY");
  return history;
}
