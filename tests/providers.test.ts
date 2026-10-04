import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVoice } from "../lib/voices";
import { materializeGrading } from "../lib/handwriting";
import { parseIntent, transition } from "../lib/machine";
import { defaults, newItem, type Session } from "../lib/types";

test("Edge auto voice resolves English and Chinese while keeping old sessions usable", () => {
  assert.equal(
    resolveVoice("edge-tts", "edge-auto", "began", "Auto"),
    "en-US-AriaNeural",
  );
  assert.equal(
    resolveVoice("edge-tts", "edge-auto", "春天", "Auto"),
    "zh-CN-XiaoxiaoNeural",
  );
  assert.equal(
    resolveVoice("edge-tts", "Vivian", "apple", "Auto"),
    "en-US-AriaNeural",
  );
  assert.equal(resolveVoice("mlx-audio", "Ryan", "apple", "English"), "Ryan");
  assert.throws(() => resolveVoice("edge-tts", "untrusted-voice", "x", "Auto"));
});
test("grading retains wrong spelling from OCR; alignment cannot repair it", () => {
  const result = materializeGrading(
    [{ id: 0, text: "appl", confidence: 99 }],
    [{ index: 0, lineIds: [0], certain: true, reason: "行位置对应" }],
    1,
  );
  assert.equal(result[0].recognized, "appl");
  assert.equal(result[0].aligned, true);
});
test("missing and reused OCR lines require review instead of false wrong verdicts", () => {
  const lines = [{ id: 0, text: "apple", confidence: 95 }];
  const result = materializeGrading(
    lines,
    [
      { index: 0, lineIds: [0], certain: true, reason: "" },
      { index: 1, lineIds: [0], certain: true, reason: "" },
    ],
    3,
  );
  assert.ok(result.every((r) => !r.aligned));
  assert.equal(result[2].recognized, "");
});
test("numbered answer rows drop corroborated labels without correcting spelling", () => {
  const lines = ["1. apple", "2. bananna", "3. orange"].map((text, id) => ({
    id,
    text,
    confidence: 99,
  }));
  const matches = lines.map((line, index) => ({
    index,
    lineIds: [line.id],
    certain: true,
    reason: "题号对应",
  }));
  const results = materializeGrading(lines, matches, 3);
  assert.deepEqual(
    results.map((r) => r.recognized),
    ["apple", "bananna", "orange"],
  );
  assert.deepEqual(
    results.map((r, i) => {
      const expected = ["apple", "banana", "orange"][i];
      return r.recognized === expected;
    }),
    [true, false, true],
  );
  assert.equal(lines[1].text, "2. bananna");
});
test("grading preserves decimal answers, lone labels and uncertain numbering", () => {
  const lines = ["1.5", "2.75", "3. word"].map((text, id) => ({
    id,
    text,
    confidence: 99,
  }));
  const matches = lines.map((line, index) => ({
    index,
    lineIds: [line.id],
    certain: true,
    reason: "",
  }));
  assert.deepEqual(
    materializeGrading(lines, matches, 3).map((r) => r.recognized),
    lines.map((l) => l.text),
  );
  const labeled = ["1. apple", "2. bananna"].map((text, id) => ({
    id,
    text,
    confidence: 99,
  }));
  assert.deepEqual(
    materializeGrading(
      labeled,
      [{ ...matches[0], certain: false }, matches[1]],
      2,
    ).map((r) => r.recognized),
    labeled.map((l) => l.text),
  );
});
test("untrusted line IDs and low provider confidence cannot become automatic grades", () => {
  const r = materializeGrading(
    [{ id: 0, text: "?", confidence: 12 }],
    [
      { index: 0, lineIds: [0], certain: true, reason: "" },
      { index: 1, lineIds: [99], certain: true, reason: "" },
    ],
    2,
  );
  assert.equal(r[0].readable, false);
  assert.equal(r[1].aligned, false);
  assert.equal(r[1].recognized, "");
});
test("empty, duplicate and uncertain alignment remains pending", () => {
  assert.equal(materializeGrading([], [], 1)[0].aligned, false);
  assert.equal(
    materializeGrading(
      [{ id: 0, text: "abc" }],
      [{ index: 0, lineIds: [0, 0], certain: true, reason: "" }],
      1,
    )[0].aligned,
    false,
  );
  assert.equal(
    materializeGrading(
      [{ id: 0, text: "abc" }],
      [{ index: 0, lineIds: [0], certain: false, reason: "" }],
      1,
    )[0].aligned,
    false,
  );
});
test("real Tencent transcript punctuation maps to one safe transition", () => {
  const session: Session = {
    id: "test",
    items: [newItem("a"), newItem("b")],
    index: 0,
    phase: "waiting",
    round: 1,
    settings: defaults,
    started: 1,
  };
  const next = transition(session, parseIntent("好了。"), 1);
  assert.equal(next.index, 1);
  assert.equal(transition(next, parseIntent("好了。"), 1).index, 1);
  assert.equal(transition(session, parseIntent("还没好。"), 1).index, 0);
  assert.equal(transition(session, parseIntent("听不清。"), 1).index, 0);
});
