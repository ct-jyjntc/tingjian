import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { buildSync, transformSync } from "esbuild";

// Exercise the actual native modules in a JS-only WeChat-like runtime: no DOM,
// Web Crypto, fetch, AbortController, or browser audio objects are provided.
const root = path.resolve("wechat");
const shared = buildSync({
  entryPoints: [path.join(root, "shared.ts")],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: "es2018",
}).outputFiles[0].text;
const copy = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));
type Callback = (...args: any[]) => void;
function runtime() {
  const storage = new Map<string, any>(),
    pages: any[] = [],
    callbacks: Record<string, Callback> = {},
    registrations: Record<string, number> = {};
  let requestHandler: (options: any) => void = (options) => {
    options.success({
      statusCode: 200,
      data: { key: "session", revision: 1, value: null, updatedAt: 1 },
    });
    options.complete?.();
  };
  const recorder = {
    onStart(fn: Callback) {
      callbacks.start = fn;
      registrations.start = (registrations.start || 0) + 1;
    },
    onStop(fn: Callback) {
      callbacks.stop = fn;
      registrations.stop = (registrations.stop || 0) + 1;
    },
    onError(fn: Callback) {
      callbacks.error = fn;
      registrations.error = (registrations.error || 0) + 1;
    },
    onInterruptionBegin(fn: Callback) {
      callbacks.interruption = fn;
      registrations.interruption = (registrations.interruption || 0) + 1;
    },
    start() {
      callbacks.start();
    },
    stop() {},
  };
  const wx: any = {
    getStorageSync: (key: string) => copy(storage.get(key) ?? ""),
    setStorageSync: (key: string, value: any) => storage.set(key, copy(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    request(options: any) {
      setImmediate(() => requestHandler(options));
      return {
        abort() {
          options.fail?.({ errMsg: "abort" });
          options.complete?.();
        },
      };
    },
    requirePrivacyAuthorize: (options: any) => options.success(),
    authorize: (options: any) => options.success(),
    getRecorderManager: () => recorder,
    showToast() {},
    showModal(options: any) {
      options.success({ confirm: false });
    },
    onAudioInterruptionBegin() {},
    offAudioInterruptionBegin() {},
    navigateTo() {},
    redirectTo() {},
    switchTab() {},
  };
  const context = vm.createContext({
    wx,
    console,
    setTimeout,
    clearTimeout,
    __MINI_API_BASE_URL__: "https://mini.test",
    Behavior: (behavior: any) => behavior,
    Page: (page: any) => {
      for (const behavior of page.behaviors || []) {
        page.data = { ...behavior.data, ...page.data };
        for (const [key, method] of Object.entries(behavior.methods || {})) {
          if (!(key in page)) page[key] = method;
        }
      }
      pages.push(page);
    },
    Component() {},
  });
  const modules = new Map<string, any>();
  const load = (relative: string): any => {
    const file = path.resolve(
      root,
      relative.endsWith(".ts") ? relative : relative + ".ts",
    );
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code =
      file === path.join(root, "shared.ts")
        ? shared
        : transformSync(readFileSync(file, "utf8"), {
            loader: "ts",
            format: "cjs",
            target: "es2018",
          }).code;
    const execute = vm.runInContext(
      `(function(require,module,exports){${code}\n})`,
      context,
      { filename: file },
    );
    execute(
      (specifier: string) =>
        load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module,
      module.exports,
    );
    return module.exports;
  };
  const signIn = (id = "alice") =>
    storage.set("tingjian:auth:v1", {
      token: `mini-${id}`,
      expiresAt: Date.now() + 100000,
      user: { id },
    });
  const page = (name: string) => {
    load(`pages/${name}/index`);
    const instance = pages[pages.length - 1];
    instance.data = copy(instance.data);
    instance.setData = (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split(".");
        let target = instance.data;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        target[parts[parts.length - 1]] = copy(value);
      }
    };
    return instance;
  };
  return {
    storage,
    wx,
    load,
    page,
    signIn,
    callbacks,
    registrations,
    requests: (handler: typeof requestHandler) => {
      requestHandler = handler;
    },
  };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("first WeChat login handles the empty string returned for missing storage", async () => {
  const app = runtime(),
    api = app.load("utils/api");
  assert.equal(app.wx.getStorageSync("tingjian:auth:v1"), "");
  const session = {
    token: "fixture-session",
    expiresAt: Date.now() + 60000,
    user: { id: "first-user" },
  };
  app.wx.login = (options: any) => options.success({ code: "fixture-code" });
  app.requests((options) => {
    assert.ok(options.url.endsWith("/login"));
    options.success({ statusCode: 200, data: session });
    options.complete();
  });
  await api.login("2026-10-03");
  assert.equal(api.auth().user.id, "first-user");
  assert.deepEqual(app.storage.get("tingjian:auth:v1"), session);
});

test("shared record and material helpers work without browser globals", () => {
  const app = runtime(),
    domain = app.load("shared");
  const material = domain.buildMaterial({
    source: "test",
    provider: "test",
    mode: "words",
    blocks: [{ id: "block", text: "go went gone" }],
  });
  const items = domain.extractMaterial(material, { mode: "words" });
  assert.deepEqual(
    Array.from(items, (item: any) => item.spoken),
    ["go", "went", "gone"],
  );
  assert.equal(new Set(items.map((item: any) => item.id)).size, 3);
  assert.equal(domain.grade("appl", "apple", true), "错误");
});

test("native requests attach only the current user's token and discard responses after an account change", async () => {
  const app = runtime();
  app.signIn();
  const api = app.load("utils/api");
  let pending: any;
  app.requests((options) => {
    pending = options;
  });
  const result = api.request("data?key=draft");
  await flush();
  assert.equal(pending.header.Authorization, "Bearer mini-alice");
  app.signIn("bob");
  pending.success({ statusCode: 200, data: { private: "alice" } });
  pending.complete();
  await assert.rejects(result, (error: any) => error.name === "Cancelled");
});

test("native unsynced records stay scoped to their account and conflicts preserve local edits", async () => {
  const app = runtime();
  app.signIn();
  const store = app.load("utils/storage");
  app.requests((options) => {
    options.success({ statusCode: 409, data: { error: "conflict" } });
    options.complete();
  });
  store.writeLocal("draft", { title: "alice local" });
  await assert.rejects(
    store.syncDocument("draft"),
    (error: any) => error.status === 409,
  );
  assert.equal(store.localDocument("draft").title, "alice local");
  assert.equal(store.dirty("draft"), true);
  app.signIn("bob");
  assert.equal(store.localDocument("draft"), null);
  store.writeLocal("draft", { title: "bob local" });
  app.signIn("alice");
  assert.equal(store.localDocument("draft").title, "alice local");
});

test("in-flight cloud saves cannot erase edits typed after submission", async () => {
  const app = runtime();
  app.signIn();
  const store = app.load("utils/storage");
  let pending: any, submitted!: () => void;
  let ready = new Promise<void>((resolve) => {
    submitted = resolve;
  });
  app.requests((options) => {
    pending = options;
    submitted();
  });
  store.writeLocal("draft", { title: "first" });
  const saving = store.syncDocument("draft");
  await ready;
  store.writeLocal("draft", { title: "second" });
  pending.success({
    statusCode: 200,
    data: {
      key: "draft",
      revision: 1,
      value: { title: "first" },
      updatedAt: 1,
    },
  });
  pending.complete();
  await saving;
  assert.equal(store.localDocument("draft").title, "second");
  assert.equal(store.dirty("draft"), true);
  ready = new Promise<void>((resolve) => {
    submitted = resolve;
  });
  const second = store.syncDocument("draft");
  await ready;
  assert.equal(pending.data.revision, 1);
  assert.equal(pending.data.value.title, "second");
  pending.success({
    statusCode: 200,
    data: {
      key: "draft",
      revision: 2,
      value: { title: "second" },
      updatedAt: 2,
    },
  });
  pending.complete();
  await second;
  assert.equal(store.dirty("draft"), false);
});

test("history removed on another device is not resurrected by a clean local cache", async () => {
  const app = runtime();
  app.signIn();
  const store = app.load("utils/storage"),
    domain = app.load("shared");
  const history = {
    session: {
      id: "old",
      items: [domain.newItem("old")],
      index: 0,
      started: 1,
    },
    results: [],
  };
  app.storage.set("tingjian:user:alice:history:old", {
    key: "history:old",
    value: history,
    revision: 1,
    dirty: false,
    updatedAt: 1,
  });
  app.requests((options) => {
    options.success({ statusCode: 200, data: [] });
    options.complete();
  });
  assert.equal((await store.listHistory()).length, 0);
});

test("pausing native playback prevents a late audio completion from changing the phase", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("practice"),
    domain = app.load("shared");
  let finish!: () => void;
  page.player = {
    stop() {},
    playItem: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  };
  page.session = {
    id: "session",
    items: [domain.newItem("apple")],
    index: 0,
    phase: "preparing",
    round: 1,
    settings: domain.defaults,
    started: 1,
  };
  const playback = page.readCurrent();
  page.action("pause");
  finish();
  await playback;
  assert.equal(page.session.phase, "paused");
  assert.equal(page.session.index, 0);
  assert.equal(page.session.round, 2);
  await flush();
});

test("native next requires an explicit waiting-state action, including the last item", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("practice"),
    domain = app.load("shared");
  page.player = { stop() {}, playItem: async () => {} };
  let completed = 0;
  page.finish = async () => {
    completed++;
  };
  page.session = {
    id: "session",
    items: [domain.newItem("apple")],
    index: 0,
    phase: "playing",
    round: 1,
    settings: domain.defaults,
    started: 1,
  };
  assert.equal(page.action("next"), false);
  assert.equal(completed, 0);
  page.session.phase = "waiting";
  assert.equal(page.action("next"), true);
  assert.equal(page.session.phase, "completed");
  assert.equal(page.session.confirmedCount, 1);
  assert.equal(completed, 1);
  await flush();
});

test("backgrounding cancels native recording, assistant work and audio, retaining the current item", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("practice"),
    domain = app.load("shared");
  const stopped: string[] = [];
  page.player = { stop: () => stopped.push("audio") };
  page.assistantScope = { cancel: () => stopped.push("agent") };
  page.recordScope = { cancel: () => stopped.push("record") };
  page.session = {
    id: "session",
    items: [domain.newItem("apple")],
    index: 0,
    phase: "waiting",
    round: 1,
    settings: domain.defaults,
    started: 1,
  };
  page.onHide();
  assert.deepEqual(stopped, ["agent", "record", "audio"]);
  assert.equal(page.session.phase, "paused");
  assert.equal(page.session.index, 0);
  assert.equal(
    app.load("utils/storage").localDocument("session").phase,
    "paused",
  );
  await flush();
});

test("recorder registers callbacks once and a cancelled segment cannot become the next recording", async () => {
  const app = runtime(),
    { VoiceRecorder } = app.load("utils/media"),
    { TaskScope } = app.load("utils/task");
  const recorder = new VoiceRecorder(),
    scope = new TaskScope();
  let starts = 0;
  const first = recorder.capture(scope, () => {
    starts++;
  });
  await flush();
  scope.cancel();
  await assert.rejects(first, (error: any) => error.name === "Cancelled");
  await assert.rejects(
    recorder.capture(new TaskScope(), () => {}),
    /尚未结束/,
  );
  app.callbacks.stop({ duration: 1000, tempFilePath: "cancelled.mp3" });
  const second = recorder.capture(new TaskScope(), () => {
    starts++;
  });
  await flush();
  app.callbacks.stop({ duration: 1000, tempFilePath: "current.mp3" });
  assert.equal(await second, "current.mp3");
  assert.equal(starts, 2);
  assert.equal(app.registrations.stop, 1);
  assert.equal(app.registrations.start, 1);
});

test("editing a native AI proposal base prevents stale proposals from overwriting the list", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("editor"),
    domain = app.load("shared");
  page.loaded = true;
  page.draft = {
    title: "test",
    items: [domain.newItem("apple")],
    materials: [],
  };
  page.propose({
    message: "proposed",
    proposal: [domain.newItem("banana")],
    trace: [],
  });
  page.draft.items[0].spoken = "changed";
  await page.apply();
  assert.equal(page.draft.items[0].spoken, "changed");
});

test("new draft stays locked through confirmation and releases after cancellation or failure", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("home");
  page.setData({ hasDraft: true });
  let confirmation: any;
  let dialogs = 0;
  let requests = 0;
  app.wx.showModal = (options: any) => {
    dialogs++;
    confirmation = options;
  };
  app.requests((options) => {
    requests++;
    options.success({
      statusCode: 503,
      data: { error: "Service unavailable" },
    });
    options.complete();
  });
  const event = { currentTarget: { dataset: { source: "text" } } };
  const first = page.newDraft(event);
  await page.newDraft(event);
  assert.equal(dialogs, 1);
  assert.equal(requests, 0);
  confirmation.success({ confirm: false });
  await first;
  assert.equal(page.data.creating, "");
  page.setData({ hasDraft: false });
  await page.newDraft(event);
  assert.equal(requests, 1);
  assert.equal(page.data.creating, "");
});

test("editing a result still requires renewed confirmation and returns native focus state on blur", () => {
  const app = runtime();
  app.signIn();
  const page = app.page("result"),
    domain = app.load("shared");
  page.key = "history:layout-test";
  page.record = {
    session: { id: "layout-test", index: 0, items: [domain.newItem("apple")] },
    results: [
      { recognized: "apple", status: "正确", confirmed: true, reason: "" },
    ],
  };
  page.focusField({ currentTarget: { dataset: { focusKey: "answer-0" } } });
  page.edit({
    currentTarget: { dataset: { index: 0 } },
    detail: { value: "appl" },
  });
  assert.equal(page.data.focusKey, "answer-0");
  assert.equal(page.record.results[0].confirmed, false);
  assert.equal(page.data.confirmed, 0);
  assert.equal(page.data.accuracy, "—");
  page.blurField();
  assert.equal(page.data.focusKey, "");
});

test("starting a practice cannot open duplicate confirmations or replace a cancelled session", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("editor"),
    domain = app.load("shared"),
    store = app.load("utils/storage");
  const existing = {
    id: "keep-session",
    phase: "paused",
    items: [domain.newItem("original")],
    index: 0,
  };
  store.writeLocal("session", existing);
  page.loaded = true;
  page.draft.items = [domain.newItem("new")];
  let dialog: any,
    count = 0;
  app.wx.showModal = (options: any) => {
    dialog = options;
    count++;
  };
  const first = page.start();
  await page.start();
  await flush();
  assert.equal(count, 1);
  assert.equal(page.data.starting, true);
  dialog.success({ confirm: false });
  await first;
  assert.equal(page.data.starting, false);
  assert.equal(page.data.busy, false);
  assert.equal(store.localDocument("session").id, "keep-session");
});
