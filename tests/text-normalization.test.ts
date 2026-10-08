import { test } from "node:test";
import assert from "node:assert/strict";
import { stripPunctuation } from "../lib/text-normalization";
import { grade } from "../lib/machine";

test("portable punctuation handling matches the Unicode reference without erasing symbols or letters", () => {
  // The production helper must not depend on property escapes. Modern Node is
  // only the test oracle. Older Node Unicode tables may not know newer characters.
  for (let start = 0; start <= 0x10ffff; start += 4096) {
    const points = Array.from(
      { length: Math.min(4096, 0x110000 - start) },
      (_, i) => start + i,
    );
    const known = String.fromCodePoint(...points).replace(/\p{Cn}/gu, "");
    assert.equal(
      stripPunctuation(known) === known.replace(/\p{P}/gu, ""),
      true,
      `Unicode punctuation mismatch in block U+${start.toString(16)}`,
    );
  }
  assert.equal(
    stripPunctuation("老师，“再读一遍”！ Let's go… ١،٢、３。"),
    "老师再读一遍 Lets go ١٢３",
  );
  assert.equal(
    stripPunctuation("中文 café 123 +−×÷= $￥€ 😀"),
    "中文 café 123 +−×÷= $￥€ 😀",
  );
});

test("answer grading retains optional punctuation and case rules with the portable normalizer", () => {
  assert.equal(grade(" ‘Ａpple’， ", "apple", true), "正确");
  assert.equal(grade("你好，世界！", "你好世界", true), "正确");
  assert.equal(grade("l’amour", "lamour", true), "正确");
  assert.equal(grade("apple!", "apple", true, false, true), "错误");
  assert.equal(grade("Ａpple", "apple", true, true), "错误");
  assert.equal(grade("a+b", "ab", true), "错误");
  assert.equal(grade("￥10", "10", true), "错误");
  assert.equal(grade("café", "cafe", true), "错误");
});
