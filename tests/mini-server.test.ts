import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { defaults, newItem } from "../lib/types";

const require = createRequire(import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, next) {
    return specifier === "server-only"
      ? {
          url: pathToFileURL(
            require.resolve("next/dist/compiled/server-only/empty.js"),
          ).href,
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});
after(() => hook.deregister());
const draft = (text: string) => ({
  title: text,
  items: [newItem(text)],
  materials: [],
});
const status = (code: number) => (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "status" in error &&
    error.status === code,
  );

test("WeChat identities are app-scoped; sessions are random, expiring, hashed credentials", async () => {
  const { MiniStore } = await import("../lib/mini-store");
  const store = new MiniStore(":memory:");
  try {
    const first = store.login("wx-app", "private-openid", "v1", 1000);
    const second = store.login("wx-app", "private-openid", "v2", 2000);
    const otherApp = store.login("wx-other", "private-openid", "v1", 2000);
    assert.equal(first.user.id, second.user.id);
    assert.notEqual(first.token, second.token);
    assert.notEqual(first.user.id, otherApp.user.id);
    assert.equal(
      store.authenticate(`Bearer ${first.token}`, 2000).id,
      first.user.id,
    );
    assert.throws(
      () => store.authenticate(`Bearer ${first.token}`, first.expiresAt),
      status(401),
    );
    assert.throws(
      () => store.authenticate("Bearer administrator-token", 2000),
      status(401),
    );
    const tables = JSON.stringify([
      store.db.prepare("SELECT * FROM mini_users").all(),
      store.db.prepare("SELECT * FROM mini_sessions").all(),
    ]);
    assert.ok(!tables.includes("private-openid"));
    assert.ok(!tables.includes(first.token));
    assert.equal(
      store.db
        .prepare("SELECT privacy_version FROM mini_users WHERE id=?")
        .get(first.user.id)?.privacy_version,
      "v2",
    );
  } finally {
    store.close();
  }
});

test("login caps sessions; logout revokes only the selected session", async () => {
  const { MiniStore } = await import("../lib/mini-store");
  const store = new MiniStore(":memory:");
  try {
    const tokens = Array.from({ length: 7 }, (_, index) =>
      store.login("app", "user", "v1", 1000 + index),
    );
    assert.throws(
      () => store.authenticate(`Bearer ${tokens[0].token}`, 2000),
      status(401),
    );
    assert.throws(
      () => store.authenticate(`Bearer ${tokens[1].token}`, 2000),
      status(401),
    );
    store.logout(`Bearer ${tokens[6].token}`);
    assert.throws(
      () => store.authenticate(`Bearer ${tokens[6].token}`, 2000),
      status(401),
    );
    assert.equal(
      store.authenticate(`Bearer ${tokens[5].token}`, 2000).id,
      tokens[5].user.id,
    );
  } finally {
    store.close();
  }
});

test("identical document keys remain isolated and stale writes cannot replace newer work", async () => {
  const { MiniStore } = await import("../lib/mini-store");
  const store = new MiniStore(":memory:");
  try {
    const a = store.login("app", "a", "v1").user.id,
      b = store.login("app", "b", "v1").user.id;
    const original = draft("apple");
    store.save(a, "draft", 0, original);
    assert.equal(store.read(b, "draft").value, null);
    store.save(b, "draft", 0, draft("banana"));
    assert.throws(() => store.save(a, "draft", 0, draft("stale")), status(409));
    assert.deepEqual(store.read(a, "draft").value, original);
    assert.equal(
      store.read<{ title: string }>(b, "draft").value?.title,
      "banana",
    );
    store.deleteDocument(b, "draft", 1);
    assert.deepEqual(store.read(a, "draft").value, original);
    assert.throws(() => store.save(a, "ai-settings", 0, {}), status(400));
  } finally {
    store.close();
  }
});

test("history IDs and results must agree, and oversized documents are rejected", async () => {
  const { MiniStore } = await import("../lib/mini-store");
  const store = new MiniStore(":memory:");
  try {
    const id = store.login("app", "a", "v1").user.id;
    const session = {
      id: "session-1",
      items: [newItem("apple")],
      index: 0,
      phase: "completed",
      round: 1,
      settings: defaults,
      started: 1,
      ended: 2,
      confirmedCount: 1,
    };
    const result = {
      session,
      results: [
        {
          recognized: "appl",
          status: "错误",
          reason: "手动核查",
          confirmed: true,
        },
      ],
    };
    assert.throws(
      () => store.save(id, "history:other", 0, result),
      status(400),
    );
    assert.throws(
      () => store.save(id, "history:session-1", 0, { ...result, results: [] }),
      status(400),
    );
    store.save(id, "history:session-1", 0, result);
    assert.equal(store.history(id)[0].confirmedCount, 1);
    const large = {
      title: "large",
      materials: [],
      items: Array.from({ length: 300 }, () => newItem("a".repeat(1000))),
    };
    assert.throws(() => store.save(id, "draft", 0, large), status(413));
  } finally {
    store.close();
  }
});

test("quota debits are atomic across per-user and global budgets, including China midnight", async () => {
  const { MiniStore, chinaDay } = await import("../lib/mini-store");
  const store = new MiniStore(":memory:");
  try {
    const before = Date.parse("2026-10-03T15:59:59Z"),
      afterMidnight = before + 1000;
    assert.equal(chinaDay(before), "2026-10-03");
    assert.equal(chinaDay(afterMidnight), "2026-10-04");
    store.consume("a", 5, 10, 6, before);
    assert.throws(() => store.consume("b", 2, 10, 6, before), status(429));
    assert.equal(store.quota("b", 10, before).used, 0);
    assert.equal(store.quota("global", 6, before).used, 5);
    assert.throws(() => store.consume("a", 6, 10, 100, before), status(429));
    assert.equal(store.quota("a", 10, before).used, 5);
    store.consume("a", 5, 10, 6, afterMidnight);
    assert.equal(store.quota("a", 10, afterMidnight).remaining, 5);
  } finally {
    store.close();
  }
});

test("account deletion removes records and sessions without resetting today's abuse budget", async () => {
  const { MiniStore } = await import("../lib/mini-store");
  const store = new MiniStore(":memory:");
  try {
    const account = store.login("app", "a", "v1"),
      other = store.login("app", "b", "v1");
    const user = store.authenticate(`Bearer ${account.token}`);
    store.save(user.id, "draft", 0, draft("delete me"));
    store.save(other.user.id, "draft", 0, draft("keep me"));
    store.consume(user.identity, 5, 5, 100);
    store.deleteAccount(user.id);
    assert.equal(store.read(user.id, "draft").value, null);
    assert.throws(
      () => store.authenticate(`Bearer ${account.token}`),
      status(401),
    );
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) AS count FROM mini_sessions WHERE user_id=?")
        .get(user.id)?.count,
      0,
    );
    const newLogin = store.login("app", "a", "v1"),
      newUser = store.authenticate(`Bearer ${newLogin.token}`);
    assert.notEqual(newUser.id, user.id);
    assert.throws(
      () => store.consume(newUser.identity, 1, 5, 100),
      status(429),
    );
    assert.equal(
      store.read<{ title: string }>(other.user.id, "draft").value?.title,
      "keep me",
    );
  } finally {
    store.close();
  }
});

test("fixed-window limits stop abusive requests and recover after the window", async () => {
  const { MiniStore } = await import("../lib/mini-store");
  const store = new MiniStore(":memory:");
  try {
    store.rateLimit("test", 2, 100, 1000);
    store.rateLimit("test", 2, 100, 1010);
    assert.throws(() => store.rateLimit("test", 2, 100, 1099), status(429));
    store.rateLimit("test", 2, 100, 1100);
  } finally {
    store.close();
  }
});

test("SQLite records, credentials and quotas survive a server restart with private permissions", async () => {
  const { MiniStore } = await import("../lib/mini-store");
  const directory = await mkdtemp(path.join(tmpdir(), "tingjian-mini-store-")),
    file = path.join(directory, "study.sqlite");
  let store = new MiniStore(file);
  try {
    const account = store.login("app", "a", "v1"),
      user = store.authenticate(`Bearer ${account.token}`);
    store.save(user.id, "draft", 0, draft("persistent"));
    store.consume(user.identity, 1, 10, 100);
    store.close();
    store = new MiniStore(file);
    assert.equal(store.authenticate(`Bearer ${account.token}`).id, user.id);
    assert.equal(
      store.read<{ title: string }>(user.id, "draft").value?.title,
      "persistent",
    );
    assert.equal(store.quota(user.identity, 10).used, 1);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("job polling and audio retrieval cannot access another user's result", async () => {
  const { MiniJobs } = await import("../lib/mini-jobs");
  const jobs = new MiniJobs(
    async () => new Response(new Uint8Array([1, 2, 3])),
  );
  let debits = 0;
  const job = jobs.create("job-a", "request-1", "tts", {}, () => debits++);
  const duplicate = jobs.create(
    "job-a",
    "request-1",
    "tts",
    {},
    () => debits++,
  );
  assert.equal(duplicate.id, job.id);
  assert.equal(debits, 1);
  assert.throws(() => jobs.read("job-b", job.id), status(404));
  assert.throws(() => jobs.audio("job-b", job.id), status(404));
  assert.throws(() => jobs.cancel("job-b", job.id), status(404));
  await job.run();
  assert.equal(jobs.read("job-a", job.id).state, "done");
  assert.deepEqual(jobs.audio("job-a", job.id), new Uint8Array([1, 2, 3]));
  jobs.cancel("job-a", job.id);
  assert.throws(() => jobs.audio("job-a", job.id), status(409));
});

test("cancelled jobs discard late model replies and keep capacity reserved until execution ends", async () => {
  const { MiniJobs } = await import("../lib/mini-jobs");
  let complete!: (response: Response) => void;
  const jobs = new MiniJobs(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const first = jobs.create("cancel-user", "first", "agent", {}, () => {});
  const run = first.run();
  jobs.cancel("cancel-user", first.id);
  const second = jobs.create("cancel-user", "second", "agent", {}, () => {});
  assert.throws(
    () => jobs.create("cancel-user", "third", "agent", {}, () => {}),
    status(429),
  );
  complete(Response.json({ proposal: ["late"] }));
  await run;
  assert.equal(jobs.read("cancel-user", first.id).state, "cancelled");
  assert.equal(jobs.read("cancel-user", first.id).result, undefined);
  jobs.cancel("cancel-user", second.id);
  await second.run();
  const third = jobs.create("cancel-user", "third", "agent", {}, () => {});
  jobs.cancel("cancel-user", third.id);
  await third.run();
});

test("failed reservations release slots and cancelling an account invalidates all its jobs", async () => {
  const { MiniJobs } = await import("../lib/mini-jobs");
  const jobs = new MiniJobs(async () => Response.json({ ok: true }));
  for (let i = 0; i < 10; i++)
    assert.throws(
      () =>
        jobs.create("quota-job", `fail-${i}`, "ocr", {}, () => {
          throw Error("quota");
        }),
      /quota/,
    );
  const a = jobs.create("quota-job", "ok", "ocr", {}, () => {});
  jobs.deleteUser("quota-job");
  await a.run();
  assert.throws(() => jobs.read("quota-job", a.id), status(404));
});

test("body size limits apply to actual streamed bytes even without Content-Length", async () => {
  const { readJSON } = await import("../lib/api-http");
  const request = new Request("https://test.test", {
    method: "POST",
    body: JSON.stringify({ text: "a".repeat(40) }),
  });
  await assert.rejects(readJSON(request, 20), status(413));
  await assert.rejects(
    readJSON(new Request("https://test.test", { method: "POST", body: "[]" })),
    status(400),
  );
  assert.deepEqual(
    await readJSON(
      new Request("https://test.test", { method: "POST", body: '{"ok":true}' }),
    ),
    { ok: true },
  );
});

test("real WeChat login exchange sends the secret only to WeChat and exposes no session_key", async (t) => {
  const env = {
    WECHAT_APP_ID: "wx1234567890abcdef",
    WECHAT_APP_SECRET: "private-secret",
    APP_ACCESS_TOKEN: "test-admin-token-with-at-least-24-characters",
    MINI_OPERATOR: "test operator",
    MINI_CONTACT: "test@example.test",
    MINI_AI_PROCESSORS: "test processors",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  try {
    const { exchangeWeChatCode, publicMiniConfig } =
      await import("../lib/mini-auth");
    t.mock.method(globalThis, "fetch", async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.weixin.qq.com");
      assert.equal(url.searchParams.get("secret"), "private-secret");
      assert.equal(url.searchParams.get("js_code"), "one-use-code");
      return Response.json({
        openid: "openid-for-test",
        session_key: "never-return-this",
      });
    });
    const result = await exchangeWeChatCode(
      "one-use-code",
      new AbortController().signal,
    );
    assert.deepEqual(result, {
      appId: env.WECHAT_APP_ID,
      openId: "openid-for-test",
    });
    assert.ok(!JSON.stringify(publicMiniConfig()).includes("private-secret"));
    delete process.env.WECHAT_APP_SECRET;
    await assert.rejects(
      exchangeWeChatCode("code", new AbortController().signal),
      status(503),
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
