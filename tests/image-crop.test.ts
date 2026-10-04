import { test } from "node:test";
import assert from "node:assert/strict";
import { createCanvas, Image, loadImage } from "@napi-rs/canvas";
import { crop, rotate } from "../lib/images";
import type { Picture } from "../lib/types";
Object.assign(globalThis, {
  Image,
  document: {
    createElement: (tag: string) => {
      assert.equal(tag, "canvas");
      return createCanvas(1, 1);
    },
  },
});
function picture(): Picture {
  const c = createCanvas(200, 120),
    x = c.getContext("2d");
  x.fillStyle = "red";
  x.fillRect(0, 0, 100, 120);
  x.fillStyle = "blue";
  x.fillRect(100, 0, 100, 120);
  return {
    id: "fixture",
    name: "geometry",
    url: c.toDataURL("image/png"),
    width: 200,
    height: 120,
    regions: [],
  };
}
async function pixel(url: string, x: number, y: number) {
  const img = await loadImage(url),
    c = createCanvas(img.width, img.height),
    ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
}
test("rectangle crop uses original coordinates and dimensions", async () => {
  const p = picture(),
    result = await crop(p, {
      id: "r",
      points: [
        { x: 110, y: 10 },
        { x: 180, y: 10 },
        { x: 180, y: 90 },
        { x: 110, y: 90 },
      ],
    });
  const img = await loadImage(result);
  assert.equal(img.width, 70);
  assert.equal(img.height, 80);
  const rgb = await pixel(result, 30, 30);
  assert.ok(rgb[2] > 230 && rgb[0] < 20);
});
test("free polygon masks unrelated content inside its bounding box", async () => {
  const p = picture(),
    result = await crop(p, {
      id: "triangle",
      points: [
        { x: 10, y: 10 },
        { x: 90, y: 10 },
        { x: 10, y: 100 },
      ],
    });
  const inside = await pixel(result, 10, 10),
    outside = await pixel(result, 70, 70);
  assert.ok(inside[0] > 230 && inside[1] < 20);
  assert.ok(outside.slice(0, 3).every((v) => v > 235));
});
test("rotation carries regions into rotated original pixel space", async () => {
  const p = picture();
  p.regions = [
    {
      id: "r",
      points: [
        { x: 20, y: 20 },
        { x: 70, y: 20 },
        { x: 70, y: 90 },
        { x: 20, y: 90 },
      ],
    },
  ];
  const rotated = await rotate(p);
  assert.equal(rotated.width, 120);
  assert.equal(rotated.height, 200);
  assert.deepEqual(rotated.regions[0].points[0], { x: 100, y: 20 });
  const result = await crop(rotated, rotated.regions[0]);
  const rgb = await pixel(result, 20, 20);
  assert.ok(rgb[0] > 230 && rgb[2] < 20);
});
