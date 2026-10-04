import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildMaterial,
  extractMaterial,
  itemIssue,
  splitExistingItems,
  englishWords,
  type OcrBlock,
} from "../lib/materials";
import {
  inspectMaterials,
  prepareDictation,
  proposeExercises,
  selectPassages,
  type AgentContext,
} from "../lib/agent-tools";
import { newItem } from "../lib/types";
import { materialSchema } from "../lib/material-schema";
const actual = JSON.parse(
  fs.readFileSync(
    new URL("../docs/word-list-fix/tencent-layout.json", import.meta.url),
    "utf8",
  ),
);
const blocks: OcrBlock[] = actual.TextDetections.map(
  (
    v: {
      DetectedText: string;
      Confidence: number;
      ItemPolygon: { X: number; Y: number; Width: number; Height: number };
    },
    i: number,
  ) => ({
    id: `block-${i + 1}`,
    text: v.DetectedText,
    confidence: v.Confidence,
    box: {
      x: v.ItemPolygon.X,
      y: v.ItemPolygon.Y,
      width: v.ItemPolygon.Width,
      height: v.ItemPolygon.Height,
    },
  }),
);
const material = () =>
  buildMaterial({
    id: "real-table",
    source: "实际用户词表",
    provider: "tencent-layout",
    blocks,
  });
test("incomplete versioned materials are rejected before tool execution", () => {
  assert.equal(
    materialSchema.safeParse({
      version: 2,
      id: "bad",
      text: "apple",
      source: "test",
      blocks: [],
    }).success,
    false,
  );
  assert.equal(materialSchema.safeParse(material()).success, true);
});
const pairs: string[][] = JSON.parse(
  fs.readFileSync(
    new URL("../docs/service-research/expected-pairs.json", import.meta.url),
    "utf8",
  ),
).pairs;
const words = (items: { spoken: string }[]) =>
  items.map((v) => v.spoken.toLowerCase()).sort();
function ctx(): AgentContext {
  const m = material();
  return {
    materials: [m],
    items: extractMaterial(m, { mode: "auto" }),
    sources: [],
    allowGenerate: false,
    updatedMaterials: [],
    inspected: false,
  };
}
test("actual image preserves four columns and 25 rows and extracts 100 individual words", () => {
  const m = material();
  assert.equal(m.kind, "word-table");
  assert.deepEqual([...new Set(m.blocks.map((v) => v.column))], [1, 2, 3, 4]);
  assert.equal(new Set(m.blocks.map((v) => v.row)).size, 25);
  const items = extractMaterial(m, { mode: "auto" });
  assert.equal(items.length, 100);
  assert.ok(
    items.every(
      (v) =>
        englishWords(v.spoken).length === 1 &&
        v.spoken === v.answer &&
        !itemIssue(v),
    ),
  );
  assert.deepEqual(
    words(items),
    pairs
      .flatMap((p) => p.flatMap(englishWords))
      .map((v) => v.toLowerCase())
      .sort(),
  );
});
test("past tense columns select all 49 variants without combining words", () => {
  const c = ctx();
  inspectMaterials(c);
  prepareDictation(c, { mode: "words", columns: [2, 4] });
  assert.equal(c.proposal!.length, 49);
  assert.deepEqual(
    words(c.proposal!),
    pairs
      .flatMap((p) => englishWords(p[1]))
      .map((v) => v.toLowerCase())
      .sort(),
  );
  assert.ok(
    c.proposal!.every(
      (v) => v.materialId === "real-table" && v.blockId && v.original,
    ),
  );
});
test("base-form columns retain be/am/is/are and have/has variants", () => {
  const c = ctx();
  inspectMaterials(c);
  prepareDictation(c, { mode: "words", columns: [1, 3] });
  assert.equal(c.proposal!.length, 51);
  assert.deepEqual(
    words(c.proposal!),
    pairs
      .flatMap((p) => englishWords(p[0]))
      .map((v) => v.toLowerCase())
      .sort(),
  );
});
test("default keeps repeated put/read/let; deduplication is an explicit tool option", () => {
  const c = ctx();
  const source = JSON.stringify(c.items);
  inspectMaterials(c);
  prepareDictation(c, { mode: "auto" });
  assert.equal(c.proposal!.length, 100);
  prepareDictation(c, { mode: "words", deduplicate: true });
  assert.equal(
    c.proposal!.length,
    new Set(
      pairs.flatMap((p) => p.flatMap(englishWords)).map((v) => v.toLowerCase()),
    ).size,
  );
  assert.equal(JSON.stringify(c.items), source);
});
test("natural phrases and sentences are never automatically split into unrelated words", () => {
  const m = buildMaterial({
    source: "phrases",
    provider: "tencent-layout",
    blocks: [
      { id: "1", text: "look after" },
      { id: "2", text: "New York" },
      { id: "3", text: "She reads every day." },
    ],
  });
  assert.equal(m.kind, "text");
  assert.deepEqual(
    extractMaterial(m, { mode: "auto" }).map((v) => v.spoken),
    ["look after", "New York", "She reads every day."],
  );
  assert.deepEqual(
    extractMaterial(m, { mode: "words" }).map((v) => v.spoken),
    ["look", "after", "New", "York", "She", "reads", "every", "day"],
  );
});
test("apostrophes and hyphenated words remain individual words", () => {
  assert.deepEqual(englishWords("can't mother-in-law learnt, learned"), [
    "can't",
    "mother-in-law",
    "learnt",
    "learned",
  ]);
});
test("legacy garbled rows cannot bypass review by merely splitting on whitespace", () => {
  const old = newItem(
    "by was were &amp; \\textsubscript{open}",
    "词表 / 整张图片",
  );
  assert.ok(itemIssue(old));
  const split = splitExistingItems([old], "words");
  assert.ok(split.length > 1);
  assert.ok(split.every((v) => itemIssue(v)));
  assert.ok(itemIssue(newItem("begin began meet met", "词表 / 整张图片")));
});
test("only manually reviewed suspicious content can proceed", () => {
  const m = buildMaterial({
    source: "photo",
    provider: "tencent-layout",
    blocks: [{ id: "1", text: "apple", confidence: 50 }],
  });
  const i = extractMaterial(m, { mode: "words" })[0];
  assert.ok(itemIssue(i));
  assert.equal(itemIssue({ ...i, reviewed: true }), undefined);
});
test("tools require inspection and reject forged sources/columns/arguments", () => {
  const c = ctx();
  assert.throws(() => prepareDictation(c, { mode: "words", columns: [2] }));
  inspectMaterials(c);
  assert.throws(() => prepareDictation(c, { mode: "words", columns: [99] }));
  assert.throws(() =>
    prepareDictation(c, { mode: "words", materialIds: ["outside"] }),
  );
  assert.throws(() =>
    prepareDictation(c, { mode: "words", blockIds: ["unknown"] }),
  );
  assert.throws(() =>
    prepareDictation(c, { mode: "words", path: "/etc/passwd" }),
  );
  assert.equal(c.proposal, undefined);
});
test("plain OCR text cannot pretend to have reliable columns", () => {
  const c = ctx();
  c.materials = [
    buildMaterial({
      source: "legacy",
      provider: "legacy-text",
      blocks: [{ id: "1", text: "begin began meet met" }],
    }),
  ];
  inspectMaterials(c);
  assert.throws(() => prepareDictation(c, { mode: "words", columns: [2, 4] }));
});
test("original mode refuses generation; explicit generation remains marked for confirmation", () => {
  const c = ctx();
  const args = {
    items: [{ spoken: "苹果", answer: "apple", language: "English" }],
  };
  assert.throws(() => proposeExercises(c, args));
  c.allowGenerate = true;
  proposeExercises(c, args);
  assert.equal(c.proposal![0].generated, true);
  assert.equal(c.proposal![0].spoken, "苹果");
});
test("matching block IDs from multiple pictures are rejected without material selection", () => {
  const c = ctx();
  c.materials.push({ ...material(), id: "other" });
  inspectMaterials(c);
  assert.throws(() =>
    prepareDictation(c, { mode: "words", blockIds: ["block-1"] }),
  );
});
test("current-list filters apply without restoring deleted source words", () => {
  const c = ctx();
  c.items = [newItem("apple"), newItem("苹果"), newItem("apple")];
  inspectMaterials(c);
  prepareDictation(c, {
    scope: "current",
    mode: "phrases",
    language: "english",
    deduplicate: true,
  });
  assert.deepEqual(
    c.proposal!.map((i) => i.answer),
    ["apple"],
  );
  assert.throws(() =>
    prepareDictation(c, { scope: "current", mode: "words", columns: [2] }),
  );
  prepareDictation(c, { scope: "materials", mode: "words", deduplicate: true });
  assert.ok(c.proposal!.some((i) => i.answer === "began"));
});
test("splitting preserves Chinese items, generated markers and hints", () => {
  const input = [
    { ...newItem("apple pear"), generated: true, hint: true },
    newItem("苹果"),
  ];
  const result = splitExistingItems(input, "words");
  assert.deepEqual(
    result.map((i) => i.answer),
    ["apple", "pear", "苹果"],
  );
  assert.ok(result.slice(0, 2).every((i) => i.generated && i.hint));
});
test("English extraction retains words next to Chinese definitions", () => {
  const m = buildMaterial({
    source: "双语词表",
    provider: "editor",
    blocks: [{ id: "a", text: "apple 苹果" }],
  });
  assert.deepEqual(
    extractMaterial(m, { mode: "words", language: "english" }).map(
      (i) => i.answer,
    ),
    ["apple"],
  );
});
test("original passages support exact pairing and reject rewritten answers", () => {
  const c = ctx();
  c.materials = [
    buildMaterial({
      id: "bilingual",
      source: "双语词表",
      provider: "editor",
      blocks: [
        { id: "a", text: "1. apple 苹果" },
        { id: "b", text: "2. 画蛇添足" },
      ],
    }),
  ];
  inspectMaterials(c);
  const entry = {
    materialId: "bilingual",
    spokenBlockId: "a",
    answerBlockId: "a",
    spoken: "苹果",
    answer: "apple",
  };
  selectPassages(c, { items: [entry] });
  assert.equal(c.proposal![0].original, "1. apple 苹果");
  assert.equal(c.proposal![0].spoken, "苹果");
  assert.equal(c.proposal![0].answer, "apple");
  assert.throws(() =>
    selectPassages(c, { items: [{ ...entry, answer: "pear" }] }),
  );
  assert.throws(() =>
    selectPassages(c, { items: [{ ...entry, materialId: "unknown" }] }),
  );
});
