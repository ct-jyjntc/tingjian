import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntent, transition, shuffle, grade } from "../lib/machine";
import { defaults, newItem, Session } from "../lib/types";
import { bounds } from "../lib/images";
const base = (): Session => ({
  id: "s",
  items: [newItem("春天"), newItem("apple")],
  index: 0,
  phase: "waiting",
  round: 7,
  settings: defaults,
  started: 1,
});
for (const [text, intent] of Object.entries({
  好了: "next",
  "好了，好了": "next",
  写完了: "next",
  还没好: "pause",
  还没写完: "pause",
  不要下一个: "pause",
  "好了，等一下": "pause",
  听不清: "repeat",
  听清了: "unknown",
  不用重复: "unknown",
  前一个再念一次: "previous",
  慢一点: "slower",
  快一点: "faster",
  什么意思: "explain",
  结束听写: "end",
}))
  test(`口令 ${text}`, () => assert.equal(parseIntent(text), intent));
test("advance exactly once for voice/button races", () => {
  const s = base();
  const next = transition(s, "next", 7);
  assert.equal(next.index, 1);
  assert.equal(next.phase, "preparing");
  assert.deepEqual(transition(next, "next", 7), next);
  assert.deepEqual(transition(next, "next", 8), next);
});
test("reading never advances, including final item", () => {
  const s = { ...base(), phase: "playing" as const, index: 1 };
  assert.equal(transition(s, "next", 7), s);
  const waiting = { ...s, phase: "waiting" as const };
  assert.equal(transition(waiting, "next", 7).phase, "completed");
  assert.equal(transition(waiting, "next", 7).confirmedCount, 2);
});
test("repeat and slow retain index and change playback round", () => {
  for (const intent of ["repeat", "slower"] as const) {
    const s = transition(base(), intent, 7);
    assert.equal(s.index, 0);
    assert.equal(s.round, 8);
    assert.equal(s.phase, "preparing");
  }
});
test("pause interrupts; resume generates a fresh round", () => {
  const s = transition({ ...base(), phase: "playing" }, "pause", 7);
  assert.equal(s.phase, "paused");
  assert.equal(transition(s, "next", 8), s);
  const resumed = transition(s, "resume", 8);
  assert.equal(resumed.index, 0);
  assert.equal(resumed.phase, "preparing");
  assert.equal(resumed.round, 9);
});
test("old playback control cannot touch a new item", () =>
  assert.equal(transition(base(), "pause", 6).phase, "waiting"));
test("random order and progress survive serialized persistence", () => {
  const s = {
    ...base(),
    items: shuffle(Array.from({ length: 20 }, (_, i) => newItem(String(i)))),
    index: 8,
  };
  const restored = JSON.parse(JSON.stringify(s));
  assert.deepEqual(
    restored.items.map((v: { id: string }) => v.id),
    s.items.map((v) => v.id),
  );
  assert.equal(restored.index, 8);
  assert.equal(new Set(s.items.map((v) => v.id)).size, 20);
});
test("mark and explanation never advance and record usage", () => {
  assert.equal(transition(base(), "mark", 7).items[0].marked, true);
  const s = transition(base(), "explain", 7);
  assert.equal(s.index, 0);
  assert.equal(s.items[0].hint, true);
});
test("end requires confirmation", () => {
  const s = transition(base(), "end", 7);
  assert.equal(s.phase, "confirming");
  assert.equal(transition(s, "next", 8), s);
});
test("unreadable is never treated as wrong", () => {
  assert.equal(grade("???", "spring", false), "无法辨认");
  assert.equal(grade("", "spring", true), "漏写");
  assert.equal(grade("SPRING!", "spring", true), "正确");
  assert.equal(grade("SPRING", "spring", true, true), "错误");
  assert.equal(grade("spring!", "spring", true, false, true), "错误");
  assert.equal(grade("春夭", "春天", true), "错误");
});
test("source coordinate bounds remain floating point, independent of DPR", () => {
  assert.deepEqual(
    bounds([
      { x: 10.5, y: 20.25 },
      { x: 300.75, y: 200.5 },
      { x: 15, y: 205 },
    ]),
    { x: 10.5, y: 20.25, width: 290.25, height: 184.75 },
  );
});
