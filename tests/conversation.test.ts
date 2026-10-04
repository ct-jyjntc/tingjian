import { test } from "node:test";
import assert from "node:assert/strict";
import { readableText, speechChunks } from "../lib/explanation";
import { NarrationPlayer, type NarrationState } from "../lib/narration";
import { defaults, newItem, type Session } from "../lib/types";
import {
  availableSessionCommands,
  isCurrentSessionTurn,
  sessionContext,
} from "../lib/session-agent";
import { transition } from "../lib/machine";

const base = (): Session => ({
  id: "test",
  items: [newItem("ran"), newItem("spring")],
  index: 0,
  round: 4,
  phase: "waiting",
  settings: defaults,
  started: 1,
});
test("Markdown markers do not leak into explanation text or narration", () => {
  assert.equal(
    readableText(
      "**记忆提示：** `run` 的过去式是 **ran**。\n\n### 例句\n- He ran.",
    ),
    "记忆提示： run 的过去式是 ran。\n\n例句\nHe ran.",
  );
});
test("long explanations are spoken in full, with Unicode-safe TTS requests", () => {
  const text = "这是一段说明😀。".repeat(400);
  const chunks = speechChunks(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 850));
  assert.equal(chunks.join(""), text);
  assert.ok(
    chunks.every((chunk) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk)),
  );
});
test("old agent replies cannot control a later item or playback round", () => {
  const session = base(),
    context = sessionContext(session);
  assert.equal(isCurrentSessionTurn(context, session), true);
  for (const command of ["next", "pause", "repeat", "end"] as const)
    assert.equal(
      isCurrentSessionTurn(
        context,
        transition(session, command, context.round),
      ),
      false,
    );
  assert.equal(
    isCurrentSessionTurn(context, { ...session, id: "different" }),
    false,
  );
});
test("the agent can only advance a waiting item and cannot act during end confirmation", () => {
  assert.ok(
    availableSessionCommands({ phase: "waiting", index: 0 }).includes("next"),
  );
  assert.ok(
    !availableSessionCommands({ phase: "waiting", index: 0 }).includes(
      "previous",
    ),
  );
  for (const phase of ["paused", "playing", "preparing", "error"] as const)
    assert.ok(!availableSessionCommands({ phase, index: 1 }).includes("next"));
  assert.deepEqual(
    availableSessionCommands({ phase: "confirming", index: 1 }),
    [],
  );
});

class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "test";
  paused = false;
  constructor(private endAutomatically = true) {}
  async play() {
    if (this.endAutomatically) queueMicrotask(() => this.onended?.());
  }
  pause() {
    this.paused = true;
  }
}
test("narration plays every chunk sequentially and releases audio URLs", async () => {
  const spoken: string[] = [],
    created: string[] = [],
    revoked: string[] = [],
    statuses: NarrationState[] = [];
  const player = new NarrationPlayer({
    synthesize: async (data) => {
      spoken.push((data as { text: string }).text);
      return new Blob(["audio"]);
    },
    createAudio: () => new FakeAudio() as unknown as HTMLAudioElement,
    createUrl: () => {
      const url = `blob:${created.length}`;
      created.push(url);
      return url;
    },
    revokeUrl: (url) => {
      revoked.push(url);
    },
  });
  const text = "完整讲解。".repeat(400);
  await player.speak(text, defaults, (status) => statuses.push(status));
  assert.equal(spoken.join(""), text);
  assert.deepEqual(created, revoked);
  assert.equal(statuses.at(-1), "idle");
  assert.equal(player.active, false);
});
test("cancelling narration during synthesis never starts late audio", async () => {
  let finish!: (blob: Blob) => void;
  let audioCreated = 0;
  const player = new NarrationPlayer({
    synthesize: async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    createAudio: () => {
      audioCreated++;
      return new FakeAudio() as unknown as HTMLAudioElement;
    },
    createUrl: () => "blob:test",
    revokeUrl: () => {},
  });
  const pending = player.speak("讲解", defaults, () => {});
  player.stop();
  finish(new Blob(["audio"]));
  await pending;
  assert.equal(audioCreated, 0);
  assert.equal(player.active, false);
});
test("stopping spoken explanations pauses audio and releases resources", async () => {
  const audio = new FakeAudio(false),
    revoked: string[] = [];
  const player = new NarrationPlayer({
    synthesize: async () => new Blob(["audio"]),
    createAudio: () => audio as unknown as HTMLAudioElement,
    createUrl: () => "blob:test",
    revokeUrl: (url) => revoked.push(url),
  });
  const pending = player.speak("讲解", defaults, () => {});
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await new Promise((resolve) => setImmediate(resolve));
  player.stop();
  await rejected;
  assert.equal(audio.paused, true);
  assert.equal(audio.src, "");
  assert.deepEqual(revoked, ["blob:test"]);
});
