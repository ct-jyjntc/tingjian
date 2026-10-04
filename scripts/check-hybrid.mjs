import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = process.env.CHECK_BASE_URL || "http://localhost:3000";
const imagePath = process.argv[2];
if (!imagePath) throw Error("请提供不规则动词词表图片的绝对路径");
const output = "docs/hybrid/latest";
async function call(action, body) {
  const started = performance.now();
  const response = await fetch(`${base}/api/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.APP_ACCESS_TOKEN || ""}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(185000),
  });
  return {
    status: response.status,
    seconds: +((performance.now() - started) / 1000).toFixed(3),
    data: await response.json(),
  };
}
await fs.mkdir(output, { recursive: true });
const image =
  "data:image/jpeg;base64," + (await fs.readFile(imagePath)).toString("base64");
const recognition = await call("ocr", {
  image,
  source: "用户不规则动词词表 / 整张图片",
  mode: "auto",
  provider: "tencent",
});
await fs.writeFile(`${output}/ocr.json`, JSON.stringify(recognition, null, 2));
console.log(
  JSON.stringify({
    action: "ocr",
    status: recognition.status,
    seconds: recognition.seconds,
    count: recognition.data.items?.length,
    error: recognition.data.error,
  }),
);
assert.equal(recognition.status, 200, "真实 OCR 请求失败");
assert.equal(recognition.data.items.length, 100);
const snapshot = JSON.stringify(recognition.data.items);
const result = await call("agent", {
  instruction:
    "只听写这张表的过去式，左右两组都要，每个单词单独一项，保留重复。",
  items: recognition.data.items,
  materials: [recognition.data.material],
  sources: [],
  mode: "original",
});
await fs.writeFile(`${output}/agent.json`, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    action: "agent",
    status: result.status,
    seconds: result.seconds,
    count: result.data.proposal?.length,
    trace: result.data.trace,
    error: result.data.error,
  }),
);
assert.equal(result.status, 200, "真实 Agent 请求失败，详情见报告");
assert.equal(result.data.proposal?.length, 49);
const words = (text) => text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
const expected = JSON.parse(
  await fs.readFile(
    new URL("../docs/service-research/expected-pairs.json", import.meta.url),
    "utf8",
  ),
).pairs;
assert.deepEqual(
  result.data.proposal.map((i) => i.spoken.toLowerCase()).sort(),
  expected
    .flatMap((p) => words(p[1]))
    .map((w) => w.toLowerCase())
    .sort(),
);
assert.ok(
  result.data.proposal.every(
    (i) => words(i.spoken).length === 1 && i.answer === i.spoken,
  ),
);
assert.ok(
  result.data.trace.some(
    (s) => s.tool === "prepare_dictation" && s.status === "success",
  ),
);
assert.equal(JSON.stringify(recognition.data.items), snapshot);
console.log("真实 OCR、Agent 工具调用、49 项过去式及来源清单不变均通过。");
