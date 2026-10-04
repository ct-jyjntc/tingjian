import { newItem, type Item, type Point } from "./types";
import { recordId } from "./record-id";
export type ContentMode = "auto" | "words" | "phrases" | "sentences";
export type Box = { x: number; y: number; width: number; height: number };
export type OcrBlock = {
  id: string;
  text: string;
  confidence?: number;
  box?: Box;
  polygon?: Point[];
  row?: number;
  column?: number;
};
export type Material = {
  id: string;
  version: 2;
  source: string;
  text: string;
  provider: string;
  blocks: OcrBlock[];
  kind: "word-table" | "word-list" | "text";
  mode: Exclude<ContentMode, "auto">;
  warnings: string[];
  sourceImageId?: string;
  sourceRegion?: { id: string; points: Point[] };
};
export type RawMaterial = { text: string; source: string } & Partial<
  Omit<Material, "text" | "source">
>;
export type ExtractionOptions = {
  mode: ContentMode;
  columns?: number[];
  blockIds?: string[];
  language?: "all" | "english" | "chinese";
  deduplicate?: boolean;
  limit?: number;
};
export const englishWords = (text: string) =>
  text.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g) || [];
export const artifactReason = (text: string) =>
  /&(?:[a-z]{2,15}|#\d+);|\\(?:text\w*|begin|end|frac|[{}])|<\/?[A-Za-z][^>]*>|\uFFFD/i.test(
    text,
  )
    ? "含编码或公式残片，请对照原图重新识别或修正"
    : undefined;
const median = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b);
  return a[Math.floor(a.length / 2)] || 1;
};
export function addLayout(input: OcrBlock[]): OcrBlock[] {
  const blocks = input.map((v) => ({ ...v }));
  const positioned = blocks.filter((v) => v.box && v.box.height > 0);
  if (positioned.length !== blocks.length) return blocks;
  const tolerance = Math.max(
    4,
    median(positioned.map((v) => v.box!.height)) * 0.55,
  );
  const rows: { center: number; blocks: OcrBlock[] }[] = [];
  for (const b of [...blocks].sort(
    (a, b) => a.box!.y + a.box!.height / 2 - (b.box!.y + b.box!.height / 2),
  )) {
    const y = b.box!.y + b.box!.height / 2;
    let row = rows.find((r) => Math.abs(r.center - y) < tolerance);
    if (!row) {
      row = { center: y, blocks: [] };
      rows.push(row);
    }
    row.blocks.push(b);
    row.center = median(row.blocks.map((v) => v.box!.y + v.box!.height / 2));
  }
  rows.sort((a, b) => a.center - b.center);
  rows.forEach((r, i) =>
    r.blocks
      .sort((a, b) => a.box!.x - b.box!.x)
      .forEach((b) => (b.row = i + 1)),
  );
  const starts: number[] = [];
  for (const b of [...blocks].sort((a, b) => a.box!.x - b.box!.x)) {
    const left = b.box!.x;
    if (!starts.some((x) => Math.abs(x - left) <= tolerance)) starts.push(left);
    b.column = starts.findIndex((x) => Math.abs(x - left) <= tolerance) + 1;
  }
  return blocks.sort((a, b) => a.row! - b.row! || a.box!.x - b.box!.x);
}
export function classifyMaterial(blocks: OcrBlock[]): Material["kind"] {
  if (!blocks.length) return "text";
  const candidates = blocks.filter(
    (b) =>
      /[a-z]/i.test(b.text) &&
      !/[\u3400-\u9fff]/.test(b.text) &&
      !artifactReason(b.text),
  );
  const atomic = candidates.filter(
    (b) =>
      englishWords(b.text).length === 1 ||
      (/[(),/]/.test(b.text) && englishWords(b.text).length <= 6),
  );
  if (atomic.length / blocks.length < 0.85) return "text";
  const rows = new Map<number, number>();
  for (const b of blocks)
    if (b.row) rows.set(b.row, (rows.get(b.row) || 0) + 1);
  if (
    rows.size >= 3 &&
    [...rows.values()].filter((n) => n >= 2).length / rows.size >= 0.6
  )
    return "word-table";
  if (blocks.length >= 2) return "word-list";
  return "text";
}
export function buildMaterial(input: {
  id?: string;
  source: string;
  provider: string;
  blocks: OcrBlock[];
  text?: string;
  mode?: ContentMode;
}): Material {
  const blocks = addLayout(input.blocks);
  const kind = classifyMaterial(blocks);
  const requested = input.mode || "auto";
  const mode =
    requested === "auto" ? (kind === "text" ? "phrases" : "words") : requested;
  const warnings: string[] = [];
  if (blocks.some((b) => artifactReason(b.text)))
    warnings.push(
      "识别结果含明显编码残片，相关内容需要复核，不会直接开始听写。",
    );
  if (blocks.some((b) => typeof b.confidence === "number" && b.confidence < 80))
    warnings.push("部分文字的供应商置信度偏低，请对照原图确认。");
  if (!blocks.length) warnings.push("没有识别到文字，请调整选区或重新拍摄。");
  if (input.provider === "xfyun-text")
    warnings.push(
      "当前引擎未返回文字坐标，无法可靠恢复表格列；词表建议使用腾讯版面识别。",
    );
  return {
    id: input.id || recordId(),
    version: 2,
    source: input.source,
    provider: input.provider,
    text: input.text ?? blocks.map((v) => v.text).join("\n"),
    blocks,
    kind,
    mode,
    warnings,
  };
}
export function isMaterial(raw: RawMaterial): raw is Material {
  return (
    raw.version === 2 &&
    Array.isArray(raw.blocks) &&
    typeof raw.id === "string" &&
    typeof raw.provider === "string" &&
    Array.isArray(raw.warnings) &&
    ["word-table", "word-list", "text"].includes(raw.kind || "") &&
    ["words", "phrases", "sentences"].includes(raw.mode || "")
  );
}
export function extractMaterial(
  material: Material,
  options: ExtractionOptions,
): Item[] {
  const mode = options.mode === "auto" ? material.mode : options.mode;
  let selected = material.blocks.filter(
    (b) =>
      (!options.columns?.length || options.columns.includes(b.column || 0)) &&
      (!options.blockIds?.length || options.blockIds.includes(b.id)),
  );
  if (options.language === "english")
    selected = selected.filter(
      (b) =>
        /[a-z]/i.test(b.text) &&
        (mode === "words" || !/[\u3400-\u9fff]/.test(b.text)),
    );
  if (options.language === "chinese")
    selected = selected.filter((b) => /[\u3400-\u9fff]/.test(b.text));
  let items = selected.flatMap((b) => {
    const issue =
      artifactReason(b.text) ||
      (typeof b.confidence === "number" && b.confidence < 80
        ? "识别置信度偏低，请对照原图确认"
        : undefined);
    const preservePhrase =
      options.mode === "auto" &&
      mode === "words" &&
      englishWords(b.text).length > 1 &&
      !/[(),/]/.test(b.text);
    const resolvedMode = preservePhrase ? "phrases" : mode;
    const parts =
      resolvedMode === "words"
        ? englishWords(b.text)
        : resolvedMode === "sentences"
          ? b.text.match(/[^。！？.!?]+[。！？.!?]?/g) || []
          : [b.text];
    return parts
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({
        ...newItem(text, material.source),
        original: b.text,
        language: /[\u3400-\u9fff]/.test(text) ? "Chinese" : "English",
        materialId: material.id,
        blockId: b.id,
        unit: resolvedMode,
        reviewReason:
          issue ||
          (preservePhrase
            ? "这个文字框包含多个单词，请确认是短语还是需要逐词拆分"
            : undefined),
      }));
  });
  if (options.deduplicate) {
    const seen = new Set<string>();
    items = items.filter((i) => {
      const k = i.answer.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (options.limit) items = items.slice(0, options.limit);
  return items;
}
export function itemIssue(item: Item): string | undefined {
  if (item.reviewed) return undefined;
  const artifact = artifactReason(item.spoken) || artifactReason(item.answer);
  if (artifact) return artifact;
  if (item.reviewReason) return item.reviewReason;
  if (
    item.unit === "words" &&
    (englishWords(item.spoken).length !== 1 ||
      englishWords(item.answer).length !== 1)
  )
    return "单词模式下每项只能包含一个单词，请拆分或改为短语";
  if (
    !item.unit &&
    !item.generated &&
    /整张图片|选区/.test(item.source) &&
    englishWords(item.spoken).length > 2
  )
    return "旧版按整行导入的内容，请重新识别原图或按单词拆分";
  return undefined;
}
export function splitExistingItems(
  items: Item[],
  mode: Exclude<ContentMode, "auto">,
): Item[] {
  return items.flatMap<Item>((i) => {
    if (mode === "words" && !englishWords(i.answer).length)
      return [{ ...i, id: recordId() }];
    if (i.spoken !== i.answer)
      return [
        {
          ...i,
          reviewReason: "朗读提示与答案不同，需要先确认配对关系后再拆分",
          reviewed: false,
        },
      ];
    const material = buildMaterial({
      source: i.source,
      provider: "editor",
      blocks: [{ id: i.blockId || i.id, text: i.answer }],
      mode,
    });
    return extractMaterial(material, { mode }).map((v) => ({
      ...v,
      original: i.original || i.answer,
      materialId: i.materialId,
      marked: i.marked,
      hint: i.hint,
      generated: i.generated,
      note: i.note,
      reviewReason: artifactReason(i.answer) || i.reviewReason,
    }));
  });
}
