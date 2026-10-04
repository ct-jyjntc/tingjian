import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { aiPatchSchema } from "../lib/ai-settings";

const testRequire = createRequire(import.meta.url);
const marker = pathToFileURL(
  testRequire.resolve("next/dist/compiled/server-only/empty.js"),
).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === "server-only"
      ? { url: marker, shortCircuit: true }
      : next(specifier, context);
  },
});
let directory: string;
const previousFile = process.env.AI_SETTINGS_FILE;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tingjian-settings-"));
  process.env.AI_SETTINGS_FILE = path.join(directory, "runtime.json");
});
after(async () => {
  hooks.deregister();
  if (previousFile === undefined) delete process.env.AI_SETTINGS_FILE;
  else process.env.AI_SETTINGS_FILE = previousFile;
  await rm(directory, { recursive: true, force: true });
});
const environment = () => ({
  LLM_PROVIDER: "openai-compatible",
  LLM_BASE_URL: "https://original.test/v1",
  LLM_MODEL: "original-model",
  LLM_API_KEY: "private-environment-key",
  TENCENT_SECRET_ID: "private-id",
  TENCENT_SECRET_KEY: "private-tencent-key",
});

test("public settings never expose current or inherited credentials", async () => {
  const { AISettingsStore } = await import("../lib/ai-settings-server");
  const store = new AISettingsStore(
    path.join(directory, "redacted.json"),
    environment,
  );
  const initial = store.public();
  assert.equal(initial.secrets.LLM_API_KEY, true);
  assert.equal(initial.values.LLM_API_KEY, undefined);
  assert.equal(initial.inheritedValues.LLM_API_KEY, undefined);
  assert.ok(!JSON.stringify(initial).includes("private-"));
  const saved = await store.save(initial.revision, {
    LLM_API_KEY: "private-web-key",
  });
  assert.ok(!JSON.stringify(saved).includes("private-"));
  assert.equal(saved.values.LLM_MODEL, "original-model");
});
test("web overrides persist with private permissions and can clear or restore secrets", async () => {
  const { AISettingsStore } = await import("../lib/ai-settings-server");
  const file = path.join(directory, "persist.json");
  const store = new AISettingsStore(file, environment);
  let saved = await store.save("environment", {
    LLM_MODEL: "web-model",
    LLM_API_KEY: "web-secret",
  });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(
    new AISettingsStore(file, environment).read().values.LLM_MODEL,
    "web-model",
  );
  saved = await store.save(saved.revision, { LLM_API_KEY: "" });
  assert.equal(saved.secrets.LLM_API_KEY, false);
  assert.equal(store.read().values.LLM_API_KEY, "");
  saved = await store.save(saved.revision, {
    LLM_API_KEY: null,
    LLM_MODEL: null,
  });
  assert.equal(store.read().values.LLM_API_KEY, "private-environment-key");
  assert.equal(saved.values.LLM_MODEL, "original-model");
  assert.ok(!saved.overridden.includes("LLM_API_KEY"));
  assert.ok(
    !(await readdir(directory)).some(
      (name) => name.endsWith(".tmp") || name.endsWith(".lock"),
    ),
  );
});
test("invalid settings and stale saves leave the previous document untouched", async () => {
  const { AISettingsStore } = await import("../lib/ai-settings-server");
  const file = path.join(directory, "invalid.json"),
    store = new AISettingsStore(file, environment);
  const saved = await store.save("environment", { LLM_MODEL: "saved-model" });
  const original = await readFile(file, "utf8");
  await assert.rejects(
    store.save(saved.revision, { LLM_BASE_URL: "file:///etc/passwd" }),
  );
  await assert.rejects(
    store.save(saved.revision, { EDGE_TTS_PYTHON: "/bin/sh" }),
  );
  await assert.rejects(store.save("environment", { LLM_MODEL: "stale" }));
  assert.equal(await readFile(file, "utf8"), original);
  assert.equal(
    aiPatchSchema.safeParse({ APP_ACCESS_TOKEN: "unsafe" }).success,
    false,
  );
  assert.equal(aiPatchSchema.safeParse({ max_tokens: "100" }).success, false);
  assert.equal(
    aiPatchSchema.safeParse({ LLM_API_KEY: "key\nINJECTED=value" }).success,
    false,
  );
});
test("two simultaneous writers cannot overwrite each other", async () => {
  const { AISettingsStore } = await import("../lib/ai-settings-server");
  const file = path.join(directory, "concurrent.json");
  const first = new AISettingsStore(file, environment),
    second = new AISettingsStore(file, environment);
  const results = await Promise.allSettled([
    first.save("environment", { LLM_MODEL: "one" }),
    second.save("environment", { LLM_MODEL: "two" }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.ok(["one", "two"].includes(first.read().values.LLM_MODEL));
});
test("changing credential recipients requires a new key or explicit reuse", async () => {
  const { AISettingsStore } = await import("../lib/ai-settings-server");
  const store = new AISettingsStore(
    path.join(directory, "recipient.json"),
    environment,
  );
  await assert.rejects(
    store.save("environment", { LLM_BASE_URL: "https://different.test/v1" }),
  );
  const saved = await store.save(
    "environment",
    { LLM_BASE_URL: "https://different.test/v1" },
    ["LLM_API_KEY"],
  );
  assert.equal(saved.values.LLM_BASE_URL, "https://different.test/v1");
  const restored = await store.save(saved.revision, {
    LLM_BASE_URL: null,
    LLM_API_KEY: null,
  });
  assert.equal(restored.values.LLM_BASE_URL, "https://original.test/v1");
  await store.save(restored.revision, {
    LLM_BASE_URL: "https://third.test/v1",
    LLM_API_KEY: "new-private-key",
  });
});
test("a running request keeps its snapshot while new requests see saved settings", async () => {
  const { aiSettingsStore, withAISettings, getAISetting } =
    await import("../lib/ai-settings-server");
  const store = aiSettingsStore();
  let saved = await store.save("environment", {
    LLM_MODEL: "before",
    TTS_BASE_URL: "http://localhost:8765/",
  });
  await withAISettings(async () => {
    assert.equal(getAISetting("LLM_MODEL"), "before");
    assert.equal(getAISetting("TTS_BASE_URL"), "http://localhost:8765");
    saved = await store.save(saved.revision, { LLM_MODEL: "after" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(getAISetting("LLM_MODEL"), "before");
  });
  withAISettings(() => assert.equal(getAISetting("LLM_MODEL"), "after"));
});
test("configuration API enforces authentication and rejects cross-origin writes", async () => {
  const token = process.env.APP_ACCESS_TOKEN;
  process.env.APP_ACCESS_TOKEN = "test-access";
  try {
    const { GET, POST } = await import("../app/api/[action]/route");
    const { NextRequest } = await import("next/server");
    const context = { params: Promise.resolve({ action: "ai-settings" }) };
    const get = (authorization?: string) =>
      new NextRequest("http://localhost/api/ai-settings", {
        headers: {
          host: "localhost",
          ...(authorization ? { authorization } : {}),
        },
      });
    assert.equal((await GET(get(), context)).status, 401);
    const response = await GET(get("Bearer test-access"), context);
    assert.equal(response.status, 200);
    const settings = await response.json();
    assert.equal(settings.values.LLM_API_KEY, undefined);
    const request = new NextRequest("http://localhost/api/ai-settings", {
      method: "POST",
      headers: {
        host: "localhost",
        authorization: "Bearer test-access",
        origin: "http://untrusted.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        revision: settings.revision,
        changes: { LLM_MODEL: "unwanted" },
      }),
    });
    assert.equal((await POST(request, context)).status, 403);
  } finally {
    if (token === undefined) delete process.env.APP_ACCESS_TOKEN;
    else process.env.APP_ACCESS_TOKEN = token;
  }
});
test("audio caches refresh after the server configuration revision changes", async (t) => {
  const { audioBlob } = await import("../lib/client");
  let revision = "first",
    synthesizes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const headers = { "X-AI-Config-Revision": revision };
    if (url.endsWith("ai-settings-revision"))
      return Response.json({ revision }, { headers });
    synthesizes++;
    return new Response(new Blob([revision]), { headers });
  });
  assert.equal(await (await audioBlob({ text: "same" })).text(), "first");
  assert.equal(await (await audioBlob({ text: "same" })).text(), "first");
  assert.equal(synthesizes, 1);
  revision = "second";
  assert.equal(await (await audioBlob({ text: "same" })).text(), "second");
  assert.equal(synthesizes, 2);
});
