import { test } from "node:test";
import assert from "node:assert/strict";
import { pictureId, mergePictures } from "../lib/images";
import { replaceRecognition } from "../lib/draft";
import { buildMaterial, extractMaterial } from "../lib/materials";
import { newItem, type Picture } from "../lib/types";

function recognized(
  imageId: string,
  name: string,
  words: string[],
  region?: string,
) {
  const material = {
    ...buildMaterial({
      source: `${name} (${imageId}) / ${region || "整张图片"}`,
      provider: "test",
      blocks: words.map((text, i) => ({ id: String(i), text })),
      mode: "words",
    }),
    sourceImageId: imageId,
    sourceRegion: region ? { id: region, points: [{ x: 0, y: 0 }] } : undefined,
  };
  return { material, items: extractMaterial(material, { mode: "words" }) };
}

test("image identity survives repeated uploads and renamed files", async () => {
  const original = new File(["same image bytes"], "words.jpg");
  const renamed = new File(["same image bytes"], "renamed.jpg");
  const other = new File(["different bytes"], "words.jpg");
  assert.equal(await pictureId(original), await pictureId(renamed));
  assert.notEqual(await pictureId(original), await pictureId(other));
});

test("adding the same picture preserves its edited regions without adding duplicates", () => {
  const original: Picture = {
    id: "image-a",
    name: "words.jpg",
    url: "data:a",
    width: 10,
    height: 10,
    regions: [{ id: "selection", points: [] }],
  };
  const duplicate = { ...original, name: "renamed.jpg", regions: [] };
  const different = { ...original, id: "image-b", url: "data:b", regions: [] };
  const merged = mergePictures([original], [duplicate, different, different]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0], original);
  assert.equal(merged[1], different);
  assert.equal(
    mergePictures([original], [{ ...original, id: "old-random-id" }]).length,
    1,
  );
});

test("recognizing the same image replaces saved items and raw records, preserving real repeated words", () => {
  const old = recognized("image-a", "words.jpg", ["put", "put", "read"]);
  const again = recognized("image-a", "renamed.jpg", ["put", "put", "read"]);
  const saved = JSON.parse(
    JSON.stringify({ items: old.items, raw: [old.material] }),
  );
  const next = replaceRecognition(
    saved.items,
    saved.raw,
    [again.material],
    again.items,
  );
  assert.deepEqual(
    next.items.map((i) => i.spoken),
    ["put", "put", "read"],
  );
  assert.equal(next.raw.length, 1);
  assert.equal(next.raw[0].id, again.material.id);
  assert.equal(saved.raw[0].id, old.material.id);
});

test("recognizing changed regions replaces the entire previous image group atomically", () => {
  const old = recognized("image-a", "words.jpg", ["old"]);
  const left = recognized("image-a", "words.jpg", ["left"], "left");
  const right = recognized("image-a", "words.jpg", ["right"], "right");
  const manual = newItem("manual");
  const other = recognized("image-b", "words.jpg", ["other"]);
  const next = replaceRecognition(
    [manual, ...old.items, ...other.items],
    [old.material, other.material],
    [left.material, right.material],
    [...left.items, ...right.items],
  );
  assert.deepEqual(
    next.items.map((i) => i.spoken),
    ["manual", "left", "right", "other"],
  );
  assert.equal(next.raw.length, 3);
  const whole = recognized("image-a", "words.jpg", ["whole"]);
  const reset = replaceRecognition(
    next.items,
    next.raw,
    [whole.material],
    whole.items,
  );
  assert.deepEqual(
    reset.items.map((i) => i.spoken),
    ["manual", "whole", "other"],
  );
  assert.equal(reset.raw.length, 2);
});

test("legacy exact-source records are consolidated without touching unrelated materials", () => {
  const fresh = recognized("image-a", "words.jpg", ["apple"]);
  const manual = newItem("apple");
  const legacy = newItem("apple", fresh.material.source);
  const next = replaceRecognition(
    [legacy, legacy, manual],
    [
      { source: fresh.material.source, text: "apple" },
      { source: fresh.material.source, text: "apple" },
    ],
    [fresh.material],
    fresh.items,
  );
  assert.equal(next.items.length, 2);
  assert.equal(next.items[1].id, manual.id);
  assert.equal(next.raw.length, 1);
});
