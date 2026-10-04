import { z } from "zod";
import { isMaterial } from "./materials";
const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const block = z.object({
  id: z.string().max(120),
  text: z.string().max(4000),
  confidence: z.number().min(0).max(100).optional(),
  box: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
  polygon: z.array(point).max(100).optional(),
  row: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
});
export const materialSchema = z
  .object({
    text: z.string().max(100000),
    source: z.string().max(2000),
    id: z.string().max(120).optional(),
    version: z.literal(2).optional(),
    provider: z.string().max(80).optional(),
    blocks: z.array(block).max(1200).optional(),
    kind: z.enum(["word-table", "word-list", "text"]).optional(),
    mode: z.enum(["words", "phrases", "sentences"]).optional(),
    warnings: z.array(z.string().max(2000)).max(20).optional(),
    sourceImageId: z.string().max(120).optional(),
    sourceRegion: z
      .object({ id: z.string().max(120), points: z.array(point).max(10000) })
      .optional(),
  })
  .refine((value) => value.version !== 2 || isMaterial(value), {
    message: "版面材料字段不完整，请重新识别原图",
  });
export const itemSchema = z.object({
  id: z.string().max(120),
  original: z.string().max(4000),
  spoken: z.string().max(1000),
  answer: z.string().max(1000),
  source: z.string().max(2000),
  language: z.string().max(40),
  pronunciation: z.string().max(1000),
  marked: z.boolean(),
  hint: z.boolean(),
  materialId: z.string().max(120).optional(),
  blockId: z.string().max(120).optional(),
  unit: z.enum(["words", "phrases", "sentences"]).optional(),
  generated: z.boolean().optional(),
  reviewReason: z.string().max(2000).optional(),
  reviewed: z.boolean().optional(),
  note: z.string().max(10000).optional(),
});
