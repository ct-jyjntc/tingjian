import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { buildSync, transformSync } from "esbuild";
import ts from "typescript";

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
type RuntimeOptions = { legacyRegExp?: boolean };
const checkedLegacyCode = new Set<string>();
function checkLegacyRegexSyntax(code: string, file: string) {
  if (checkedLegacyCode.has(code)) return;
  const syntax = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const visit = (node: ts.Node) => {
    if (ts.isRegularExpressionLiteral(node) && /\\[pP]\{/.test(node.text))
      throw new SyntaxError(
        `Invalid regular expression in ${file}: Unicode property escapes unavailable`,
      );
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  checkedLegacyCode.add(code);
}
function runtime({ legacyRegExp = false }: RuntimeOptions = {}) {
  const storage = new Map<string, any>(),
    pages: any[] = [],
    callbacks: Record<string, Callback> = {},
    registrations: Record<string, number> = {},
    recordings: any[] = [],
    removedFiles: string[] = [];
  let stops = 0;
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
    onFrameRecorded(fn: Callback) {
      callbacks.frame = fn;
      registrations.frame = (registrations.frame || 0) + 1;
    },
    onError(fn: Callback) {
      callbacks.error = fn;
      registrations.error = (registrations.error || 0) + 1;
    },
    onInterruptionBegin(fn: Callback) {
      callbacks.interruption = fn;
      registrations.interruption = (registrations.interruption || 0) + 1;
    },
    start(options: any) {
      recordings.push(options);
      callbacks.start();
    },
    stop() {
      stops++;
    },
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
    getFileSystemManager: () => ({
      unlink: (options: any) => removedFiles.push(options.filePath),
    }),
    arrayBufferToBase64: (buffer: ArrayBuffer) =>
      Buffer.from(buffer).toString("base64"),
    showToast() {},
    showModal(options: any) {
      options.success({ confirm: false });
    },
    onAudioInterruptionBegin() {},
    offAudioInterruptionBegin() {},
    navigateTo() {},
    redirectTo() {},
    pageScrollTo() {},
    stopPullDownRefresh() {},
    setKeepScreenOn() {},
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
  if (legacyRegExp)
    vm.runInContext(
      String.raw`
    const NativeRegExp = RegExp;
    const construct = (args) => {
      if (/\\[pP]\{/.test(String(args[0])))
        throw new SyntaxError("Invalid regular expression: Unicode property escapes unavailable");
      return Reflect.construct(NativeRegExp, args);
    };
    RegExp = new Proxy(NativeRegExp, {
      apply(_target, _receiver, args) { return construct(args); },
      construct(_target, args) { return construct(args); },
    });
  `,
      context,
    );
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
    if (legacyRegExp) checkLegacyRegexSyntax(code, file);
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
    instance.setData = (
      patch: Record<string, unknown>,
      callback?: () => void,
    ) => {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split(".");
        let target = instance.data;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        target[parts[parts.length - 1]] = copy(value);
      }
      callback?.();
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
    recorder,
    recordings,
    removedFiles,
    stops: () => stops,
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

test("backgrounding cancels continuous recording, voice recognition and audio, retaining the current item", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("practice"),
    domain = app.load("shared");
  const stopped: string[] = [];
  page.player = { stop: () => stopped.push("audio") };
  page.voiceScope = { cancel: () => stopped.push("recognition") };
  page.listenScope = { cancel: () => stopped.push("record") };
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
  assert.deepEqual(stopped, ["record", "recognition", "audio"]);
  assert.equal(page.session.phase, "waiting");
  assert.equal(page.session.index, 0);
  assert.equal(
    app.load("utils/storage").localDocument("session").phase,
    "waiting",
  );
  await flush();
});

test("continuous recorder registers once, ignores cancelled frames and waits for native stop before reopening", async () => {
  const app = runtime(),
    { ContinuousRecorder } = app.load("utils/listening"),
    { TaskScope } = app.load("utils/task");
  const recorder = new ContinuousRecorder(),
    scope = new TaskScope(),
    secondScope = new TaskScope();
  let frames = 0;
  try {
    await recorder.start(scope, () => frames++, assert.fail);
    app.callbacks.frame({ frameBuffer: pcmFrame(0.1) });
    scope.cancel();
    app.callbacks.frame({ frameBuffer: pcmFrame(0.1) });
    assert.equal(frames, 1);
    assert.equal(app.stops(), 1);
    const second = recorder.start(secondScope, () => frames++, assert.fail);
    await flush();
    assert.equal(app.recordings.length, 1);
    app.callbacks.stop({ duration: 1000, tempFilePath: "cancelled.pcm" });
    await second;
    app.callbacks.frame({ frameBuffer: pcmFrame(0.1) });
    assert.equal(frames, 2);
    assert.equal(app.recordings.length, 2);
    assert.deepEqual(app.removedFiles, ["cancelled.pcm"]);
    for (const event of ["stop", "start", "frame", "error", "interruption"])
      assert.equal(app.registrations[event], 1);
    assert.equal(app.recordings[0].format, "PCM");
    assert.equal(app.recordings[0].sampleRate, 16000);
    assert.equal(app.recordings[0].frameSize, 2);
    assert.equal(app.recordings[0].duration, 600000);
  } finally {
    scope.cancel();
    secondScope.cancel();
    app.callbacks.stop({ duration: 1000, tempFilePath: "cleanup.pcm" });
  }
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

test("new draft navigation is locked and never clears the previous list", () => {
  const app = runtime();
  app.signIn();
  const page = app.page("home"),
    store = app.load("utils/storage");
  const previous = {
    title: "keep",
    items: [{ id: "old", spoken: "old", answer: "old" }],
    materials: [],
  };
  store.writeLocal("draft", previous);
  let navigation: any,
    count = 0;
  app.wx.navigateTo = (options: any) => {
    navigation = options;
    count++;
  };
  const event = { currentTarget: { dataset: { source: "camera" } } };
  page.newDraft(event);
  page.newDraft(event);
  assert.equal(count, 1);
  assert.match(navigation.url, /new=1&source=camera/);
  assert.deepEqual(copy(store.localDocument("draft")), previous);
  navigation.fail();
  navigation.complete();
  assert.equal(page.data.creating, "");
  page.newDraft(event);
  assert.equal(count, 2);
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

function echoDocuments(app: ReturnType<typeof runtime>, failKey = "") {
  app.requests((options) => {
    const data = options.data;
    if (data?.key) {
      options.success({
        statusCode: data.key === failKey ? 503 : 200,
        data:
          data.key === failKey
            ? { error: "暂时断网" }
            : { ...data, revision: data.revision + 1, updatedAt: 1 },
      });
    } else if (options.url.includes("list=history")) {
      options.success({ statusCode: 200, data: [] });
    } else {
      options.success({
        statusCode: 200,
        data: { key: "unused", revision: 0, value: null, updatedAt: 1 },
      });
    }
    options.complete?.();
  });
}
const tap = (dataset: Record<string, unknown>) => ({
  currentTarget: { dataset },
});
function resultFixture(app: ReturnType<typeof runtime>) {
  const page = app.page("result"),
    domain = app.load("shared");
  page.key = "history:review";
  page.record = {
    session: {
      id: "review",
      index: 2,
      confirmedCount: 3,
      items: ["apple", "banana", "orange"].map(domain.newItem),
    },
    results: ["apple", "banana", "orange"].map(() => ({
      recognized: "",
      status: "待确认",
      confirmed: false,
      reason: "尚未核查",
    })),
  };
  return page;
}

test("local new-list and raw input are account scoped and are never uploaded as cloud documents", async () => {
  const app = runtime();
  app.signIn();
  const work = app.load("utils/workspace"),
    store = app.load("utils/storage");
  work.saveWork("new-draft", {
    draft: { title: "new", items: [], materials: [] },
    input: "apple\nbanana",
  });
  work.saveWork("draft-input", "unfinished");
  let requests = 0;
  app.requests(() => requests++);
  await store.syncAll();
  assert.equal(requests, 0);
  app.signIn("bob");
  assert.equal(work.readWork("new-draft"), null);
  app.signIn();
  app.load("utils/api").clearUserCache("alice");
  assert.equal(work.readWork("new-draft"), null);
});

test("unadded editor input survives leaving, cancelled photo picking and a cancelled start", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("editor"),
    domain = app.load("shared"),
    store = app.load("utils/storage"),
    work = app.load("utils/workspace");
  const old = { title: "old", items: [domain.newItem("keep")], materials: [] };
  const session = { id: "keep", phase: "waiting", items: old.items, index: 0 };
  store.writeLocal("draft", old);
  store.writeLocal("session", session);
  page.loaded = true;
  page.staged = true;
  page.textInput({ detail: { value: "apple\n苹果 → apple" } });
  page.onHide();
  assert.equal(work.readWork("new-draft").input, "apple\n苹果 → apple");
  app.wx.chooseMedia = (options: any) =>
    options.fail({ errMsg: "chooseMedia:fail cancel" });
  await page.pick("camera");
  assert.deepEqual(copy(store.localDocument("draft")), copy(old));
  await page.start();
  assert.equal(page.data.typedCount, 0);
  assert.deepEqual(
    copy(page.draft.items.map((item: any) => [item.spoken, item.answer])),
    [
      ["apple", "apple"],
      ["苹果", "apple"],
    ],
  );
  assert.equal(work.readWork("new-draft").draft.items.length, 2);
  assert.deepEqual(copy(store.localDocument("session")), copy(session));
  assert.deepEqual(copy(store.localDocument("draft")), copy(old));
  assert.equal(page.data.busy, false);
});

test("start incorporates raw input once, and a full list does not discard overflow", async () => {
  const app = runtime();
  app.signIn();
  echoDocuments(app);
  const page = app.page("editor"),
    domain = app.load("shared"),
    store = app.load("utils/storage");
  page.loaded = true;
  page.staged = true;
  page.setData({ inputText: "one\ntwo", typedCount: 2 });
  let route = "";
  app.wx.navigateTo = (options: any) => {
    route = options.url;
  };
  await page.start();
  assert.equal(store.localDocument("session").items.length, 2);
  assert.match(route, /practice\/index\?autostart=1/);
  page.draft.items = Array.from({ length: 300 }, () => domain.newItem("word"));
  page.setData({ inputText: "keep me", typedCount: 1 });
  await page.start();
  assert.equal(page.draft.items.length, 300);
  assert.equal(page.data.inputText, "keep me");
});

test("editing ordinary words keeps prompt-answer pairs together, distinct prompts stay distinct", () => {
  const app = runtime();
  app.signIn();
  const page = app.page("editor"),
    domain = app.load("shared");
  page.draft.items = [
    domain.newItem("apple"),
    { ...domain.newItem("苹果"), answer: "apple" },
  ];
  for (const item of page.draft.items)
    page.field({
      ...tap({ id: item.id, field: "spoken" }),
      detail: { value: "orange" },
    });
  assert.equal(page.draft.items[0].answer, "orange");
  assert.equal(page.draft.items[1].answer, "apple");
});

test("an issue routes start to the offending item instead of leaving a disabled dead end", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("editor"),
    domain = app.load("shared");
  page.loaded = true;
  page.draft.items = [{ ...domain.newItem("apple"), answer: "" }];
  let selector = "";
  app.wx.pageScrollTo = (options: any) => {
    selector = options.selector;
  };
  await page.start();
  assert.equal(page.data.editingId, page.draft.items[0].id);
  assert.equal(selector, `#item-${page.draft.items[0].id}`);
});

test("home refresh retains visible content and ignores responses from an older account", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("home");
  page.owner = "alice";
  page.loaded = true;
  page.setData({ active: true, hasDraft: true, historyCount: 7 });
  const pending: any[] = [];
  app.requests((options) => pending.push(options));
  const refresh = page.refresh();
  await flush();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.historyCount, 7);
  app.signIn("bob");
  for (const request of pending) {
    request.success({
      statusCode: 200,
      data: request.url.includes("list=history") ? [] : { value: null },
    });
    request.complete();
  }
  await refresh;
  assert.equal(page.data.historyCount, 7);
  app.storage.delete("tingjian:auth:v1");
  await page.refresh();
  assert.equal(page.data.historyCount, 0);
  assert.equal(page.data.active, false);
});

test("cancel ending a waiting practice restores the ready-to-advance state", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("practice"),
    domain = app.load("shared");
  page.player = { stop() {} };
  page.session = {
    id: "session",
    items: [domain.newItem("apple")],
    index: 0,
    phase: "waiting",
    round: 1,
    settings: domain.defaults,
    started: 1,
  };
  page.action("end");
  await flush();
  assert.equal(page.session.phase, "waiting");
  page.onUnload();
  await flush();
});

test("backgrounding during playback invalidates late audio callbacks and pauses safely", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("practice"),
    domain = app.load("shared");
  let resolve: () => void = () => {},
    callback: (state: string) => void = () => {};
  page.player = {
    stop() {},
    playItem(_item: any, _settings: any, handler: any) {
      callback = handler;
      return new Promise<void>((done) => {
        resolve = done;
      });
    },
  };
  page.session = {
    id: "session",
    items: [domain.newItem("apple")],
    index: 0,
    phase: "preparing",
    round: 3,
    settings: domain.defaults,
    started: 1,
  };
  const playback = page.readCurrent();
  page.onHide();
  callback("playing");
  resolve();
  await playback;
  assert.equal(page.session.phase, "paused");
  assert.equal(page.session.round, 4);
  await flush();
});

test("filtered manual assessment keeps original indices, supports undo and preserves paper decisions across rules", () => {
  const app = runtime();
  app.signIn();
  const page = resultFixture(app);
  page.assess(tap({ index: 0, status: "correct" }));
  assert.deepEqual(copy(page.data.rows.map((row: any) => row.number)), [2, 3]);
  page.assess(tap({ index: 1, status: "wrong" }));
  assert.equal(page.record.results[1].status, "错误");
  page.undoAssessment();
  assert.equal(page.record.results[1].confirmed, false);
  page.assess(tap({ index: 1, status: "wrong" }));
  page.rules({ ...tap({ rule: "caseSensitive" }), detail: { value: true } });
  assert.equal(page.record.results[1].status, "错误");
  assert.equal(page.record.results[1].confirmed, true);
  assert.equal(page.record.results[2].confirmed, false);
});

test("editing under wrong-only filter keeps the focused row visible until closed", () => {
  const app = runtime();
  app.signIn();
  const page = resultFixture(app);
  page.assess(tap({ index: 1, status: "wrong" }));
  page.filter(tap({ filter: "wrong" }));
  page.editRow(tap({ index: 1 }));
  page.edit({ ...tap({ index: 1 }), detail: { value: "banan" } });
  assert.equal(page.data.rows.length, 1);
  assert.equal(page.data.rows[0].number, 2);
  assert.equal(page.data.rows[0].confirmed, false);
  page.editRow(tap({ index: 1 }));
  assert.equal(page.data.rows.length, 0);
});

test("partial result save retains prior wrong words whose results are still unconfirmed", async () => {
  const app = runtime();
  app.signIn();
  echoDocuments(app);
  const page = resultFixture(app),
    store = app.load("utils/storage");
  store.writeLocal("wrong", [
    page.record.session.items[0],
    page.record.session.items[1],
  ]);
  page.assess(tap({ index: 0, status: "correct" }));
  assert.equal(await page.save(), true);
  assert.deepEqual(
    copy(store.localDocument("wrong").map((item: any) => item.answer)),
    ["banana"],
  );
  assert.equal(page.data.pending, false);
});

test("wrong-list sync failure cannot masquerade as a fully saved result or exit successfully", async () => {
  const app = runtime();
  app.signIn();
  echoDocuments(app, "wrong");
  const page = resultFixture(app),
    store = app.load("utils/storage");
  store.writeLocal("wrong", []);
  page.assess(tap({ index: 0, status: "wrong" }));
  assert.equal(await page.save(), false);
  assert.equal(store.dirty(page.key), false);
  assert.equal(page.data.pending, true);
  let left = false;
  app.wx.switchTab = () => {
    left = true;
  };
  await page.done();
  assert.equal(left, false);
  echoDocuments(app);
  await page.done();
  assert.equal(left, true);
});

test("photo regrading locks before confirmation and cancelling releases the control", async () => {
  const app = runtime();
  app.signIn();
  const page = resultFixture(app);
  page.record.results[0].confirmed = true;
  page.setData({ photo: "local-photo" });
  let modal: any,
    count = 0;
  app.wx.showModal = (options: any) => {
    modal = options;
    count++;
  };
  const first = page.recognize();
  await page.recognize();
  assert.equal(count, 1);
  assert.equal(page.data.busy, true);
  modal.success({ confirm: false });
  await first;
  assert.equal(page.data.busy, false);
  assert.equal(page.record.results[0].confirmed, true);
  assert.equal(page.data.taskError, "");
});

test("selected review stages only chosen words and preserves the current draft and session", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("library"),
    domain = app.load("shared"),
    store = app.load("utils/storage"),
    work = app.load("utils/workspace");
  const items = [domain.newItem("apple"), domain.newItem("banana")];
  store.writeLocal("draft", {
    title: "keep",
    items: [items[0]],
    materials: [],
  });
  store.writeLocal("session", { id: "keep-session" });
  page.setData({ wrong: items, selectedIds: [items[1].id], selectedCount: 1 });
  await page.review();
  assert.equal(work.readWork("new-draft").draft.items[0].answer, "banana");
  assert.equal(work.readWork("new-draft").draft.items.length, 1);
  assert.equal(store.localDocument("draft").title, "keep");
  assert.equal(store.localDocument("session").id, "keep-session");
});

test("mastered removal is undoable even when network sync fails", async () => {
  const app = runtime();
  app.signIn();
  echoDocuments(app, "wrong");
  const page = app.page("library"),
    domain = app.load("shared"),
    store = app.load("utils/storage");
  const word = domain.newItem("banana");
  store.writeLocal("wrong", [word]);
  await page.refresh();
  await page.removeWrong(tap({ id: word.id }));
  assert.equal(page.data.wrong.length, 0);
  assert.equal(page.data.removedWord, "banana");
  assert.equal(page.removedItem.selected, undefined);
  await page.undoRemove();
  assert.equal(page.data.wrong.length, 1);
  assert.equal(page.data.selectedCount, 1);
  assert.equal(store.localDocument("wrong")[0].id, word.id);
});

test("login returns once to the originally requested editor", () => {
  const app = runtime(),
    ui = app.load("utils/ui");
  const destinations: string[] = [];
  app.wx.navigateTo = app.wx.switchTab = (options: any) =>
    destinations.push(options.url);
  assert.equal(
    ui.requireLogin("/pages/editor/index?new=1&source=camera"),
    false,
  );
  app.signIn();
  ui.continueAfterLogin();
  ui.continueAfterLogin();
  assert.deepEqual(destinations, [
    "/pages/profile/index",
    "/pages/editor/index?new=1&source=camera",
    "/pages/home/index",
  ]);
});

test("leaving while the regrade confirmation is open cancels the request before any photo processing", async () => {
  const app = runtime();
  app.signIn();
  const page = resultFixture(app);
  page.record.results[0].confirmed = true;
  page.setData({ photo: "keep-local" });
  let modal: any;
  app.wx.showModal = (options: any) => {
    modal = options;
  };
  const task = page.recognize();
  page.onHide();
  modal.success({ confirm: true });
  await task;
  assert.equal(page.data.busy, false);
  assert.equal(page.data.taskError, "");
  assert.equal(page.record.results[0].confirmed, true);
});

test("finishing retries a locally saved but unsynced history before opening results", async () => {
  const app = runtime();
  app.signIn();
  echoDocuments(app);
  const page = app.page("practice"),
    domain = app.load("shared"),
    store = app.load("utils/storage");
  page.session = {
    id: "finish-retry",
    items: [domain.newItem("apple")],
    phase: "completed",
    index: 0,
    settings: domain.defaults,
    started: 1,
  };
  store.writeLocal("history:finish-retry", {
    session: page.session,
    results: [],
  });
  store.writeLocal("session", page.session);
  let opened = false;
  app.wx.redirectTo = () => {
    opened = true;
  };
  await page.finish();
  assert.equal(store.dirty("history:finish-retry"), false);
  assert.equal(opened, true);
});

test("profile ignores an older refresh finishing after a newer one", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("profile"),
    pending: any[] = [];
  app.requests((options) => pending.push(options));
  const old = page.refresh();
  const current = page.refresh();
  await flush();
  const respond = (request: any, remaining: number) => {
    request.success({
      statusCode: 200,
      data: { config: {}, quota: { remaining, used: 0, limit: 100 } },
    });
    request.complete();
  };
  respond(pending[1], 99);
  await current;
  respond(pending[0], 50);
  await old;
  assert.equal(page.data.remaining, 99);
  assert.equal(page.data.loading, false);
});

test("profile distinguishes unavailable quota from zero quota and preserves known values on retry failure", async () => {
  const app = runtime();
  app.signIn();
  const page = app.page("profile");
  app.requests((request) => {
    request.fail({ errMsg: "network unavailable" });
    request.complete();
  });
  await page.refresh();
  assert.equal(page.data.quotaReady, false);
  assert.ok(page.data.error);
  app.requests((request) => {
    request.success({
      statusCode: 200,
      data: { config: {}, quota: { remaining: 80, limit: 100, used: 20 } },
    });
    request.complete();
  });
  await page.refresh();
  assert.equal(page.data.quotaReady, true);
  app.requests((request) => {
    request.fail({ errMsg: "network unavailable" });
    request.complete();
  });
  await page.refresh();
  assert.equal(page.data.quotaReady, true);
  assert.equal(page.data.remaining, 80);
});

function pcmFrame(amplitude: number, milliseconds = 64) {
  const frame = new ArrayBuffer(milliseconds * 32),
    view = new DataView(frame);
  for (let offset = 0; offset < frame.byteLength; offset += 2)
    view.setInt16(
      offset,
      Math.round(amplitude * 32767) * (offset % 4 ? -1 : 1),
      true,
    );
  return frame;
}
function speechTurn(push: (frame: ArrayBuffer) => unknown) {
  for (let i = 0; i < 5; i++) push(pcmFrame(0.12));
  let result: any;
  for (let i = 0; i < 11; i++) result = push(pcmFrame(0)) || result;
  return result;
}
function voiceFixture(options: RuntimeOptions = {}) {
  const app = runtime(options);
  app.signIn();
  const page = app.page("practice"),
    domain = app.load("shared");
  page.session = {
    id: "voice-test",
    items: [domain.newItem("apple"), domain.newItem("banana")],
    index: 0,
    phase: "waiting",
    round: 1,
    settings: { ...domain.defaults },
    started: 1,
  };
  page.player = { stop() {}, playItem: async () => {} };
  page.micLive = true;
  page.render();
  return { app, page, domain };
}
function voiceJobs(
  app: ReturnType<typeof runtime>,
  result: (action: string) => any,
) {
  const jobs = new Map<string, string>(),
    calls: { action: string; payload: any }[] = [];
  app.requests((options) => {
    let data: any = {};
    if (options.url.endsWith("/jobs") && options.data?.action) {
      const id = String(calls.length + 1);
      calls.push(options.data);
      jobs.set(id, options.data.action);
      data = { id };
    } else if (
      options.url.includes("/jobs?id=") &&
      options.method !== "DELETE"
    ) {
      const id = new URL(options.url).searchParams.get("id")!;
      data = { id, state: "done", result: result(jobs.get(id)!) };
    } else if (options.data?.key) {
      data = {
        ...options.data,
        revision: options.data.revision + 1,
        updatedAt: 1,
      };
    }
    options.success({ statusCode: 200, data });
    options.complete?.();
  });
  return calls;
}

test("speech detection sends no silence or clicks, keeps pre-roll and encodes complete independent WAV turns", () => {
  const app = runtime(),
    { SpeechTurns } = app.load("utils/listening"),
    vad = new SpeechTurns();
  for (let i = 0; i < 100; i++)
    assert.equal(vad.push(pcmFrame(0.002), { round: 1 }), null);
  assert.equal(vad.push(pcmFrame(0.15), { round: 1 }), null);
  for (let i = 0; i < 11; i++)
    assert.equal(vad.push(pcmFrame(0), { round: 1 }), null);
  for (let i = 0; i < 4; i++) vad.push(pcmFrame(0), { round: 1 });
  const onset = { round: 2 },
    later = { round: 3 };
  vad.push(pcmFrame(0.15), onset);
  for (let i = 0; i < 4; i++) vad.push(pcmFrame(0.15), later);
  for (let i = 0; i < 10; i++) assert.equal(vad.push(pcmFrame(0), later), null);
  const turn = vad.push(pcmFrame(0), later),
    bytes = Buffer.from(turn.wave),
    view = new DataView(turn.wave);
  assert.equal(turn.context, onset);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 20 * 2048);
  assert.equal(bytes.length, 44 + 20 * 2048);
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(vad.speaking, false);
  const second = speechTurn((frame) => vad.push(frame, later));
  assert.equal(second.context, later);
  assert.equal(second.wave.byteLength, 44 + 16 * 2048);
});

test("overlong speech is discarded until silence, never executed as a truncated tail", () => {
  const { SpeechTurns } = runtime().load("utils/listening"),
    vad = new SpeechTurns();
  for (let i = 0; i < 190; i++) assert.equal(vad.push(pcmFrame(0.15), 1), null);
  for (let i = 0; i < 11; i++) assert.equal(vad.push(pcmFrame(0), 1), null);
  assert.ok(speechTurn((frame) => vad.push(frame, 2)));
});

test("two speech turns share one native recording; ten-minute limit renews capture and deletes native temp files", async () => {
  const app = runtime(),
    { ContinuousRecorder, SpeechTurns } = app.load("utils/listening"),
    { TaskScope } = app.load("utils/task"),
    scope = new TaskScope(),
    vad = new SpeechTurns();
  let turns = 0;
  try {
    await new ContinuousRecorder().start(
      scope,
      (frame: ArrayBuffer) => {
        if (vad.push(frame, 1)) turns++;
      },
      assert.fail,
    );
    for (let i = 0; i < 2; i++)
      speechTurn((frame) => app.callbacks.frame({ frameBuffer: frame }));
    assert.equal(turns, 2);
    assert.equal(app.recordings.length, 1);
    assert.equal(app.stops(), 0);
    app.callbacks.stop({ duration: 600000, tempFilePath: "limit.pcm" });
    assert.equal(app.recordings.length, 2);
    assert.deepEqual(app.removedFiles, ["limit.pcm"]);
    speechTurn((frame) => app.callbacks.frame({ frameBuffer: frame }));
    assert.equal(turns, 3);
  } finally {
    scope.cancel();
    app.callbacks.stop({ duration: 1 });
  }
});

test("unexpected stop reports a failure instead of endlessly restarting the microphone", async () => {
  const app = runtime(),
    { ContinuousRecorder } = app.load("utils/listening"),
    { TaskScope } = app.load("utils/task"),
    scope = new TaskScope();
  let message = "";
  try {
    await new ContinuousRecorder().start(
      scope,
      () => {},
      (error: Error) => {
        message = error.message;
      },
    );
    app.callbacks.stop({ duration: 1200, tempFilePath: "stopped.pcm" });
    assert.match(message, /意外停止/);
    assert.equal(app.recordings.length, 1);
  } finally {
    scope.cancel();
    app.callbacks.stop({ duration: 1 });
  }
});

test("synchronous native start failure releases capture so retry can succeed", async () => {
  const app = runtime(),
    { ContinuousRecorder } = app.load("utils/listening"),
    { TaskScope } = app.load("utils/task"),
    scope = new TaskScope(),
    second = new TaskScope(),
    start = app.recorder.start;
  try {
    app.recorder.start = () => {
      throw new Error("unsupported");
    };
    await assert.rejects(
      new ContinuousRecorder().start(scope, () => {}, assert.fail),
      /无法持续录音/,
    );
    app.recorder.start = start;
    await new ContinuousRecorder().start(second, () => {}, assert.fail);
    assert.equal(app.recordings.length, 1);
  } finally {
    scope.cancel();
    second.cancel();
    app.callbacks.stop({ duration: 1 });
  }
});

test("native interruption stops frames and tells the page to offer retry", async () => {
  const app = runtime(),
    { ContinuousRecorder } = app.load("utils/listening"),
    { TaskScope } = app.load("utils/task"),
    scope = new TaskScope();
  let frames = 0,
    message = "";
  try {
    await new ContinuousRecorder().start(
      scope,
      () => frames++,
      (error: Error) => {
        message = error.message;
      },
    );
    app.callbacks.interruption();
    app.callbacks.frame({ frameBuffer: pcmFrame(0.1) });
    assert.match(message, /通话中断/);
    assert.equal(frames, 0);
    assert.equal(app.stops(), 1);
  } finally {
    scope.cancel();
    app.callbacks.stop({ duration: 1 });
  }
});

test("common teacher-style commands and negations resolve locally without explanations", () => {
  const { dictationCommand } = runtime().load("utils/commands");
  const commands: Record<string, string> = {
    "老师，请再读一遍。": "repeat",
    我没听清楚: "repeat",
    写好了: "next",
    下一个: "next",
    读太快了: "slower",
    快一点: "faster",
    上一个: "previous",
    这题不会: "mark",
    "等一下，还没有写完": "pause",
    没有写好: "pause",
    别读下一项: "pause",
    继续: "next",
    今天就到这里: "end",
    不要结束听写: "unknown",
    不用重复: "unknown",
    我不想继续: "unknown",
  };
  for (const [text, intent] of Object.entries(commands))
    assert.deepEqual(
      copy(dictationCommand(text, "waiting")),
      { intent, infer: false },
      text,
    );
  assert.equal(dictationCommand("继续", "paused").intent, "resume");
  assert.deepEqual(
    copy(dictationCommand("刚才那个能不能重新念一下", "waiting")),
    { intent: "unknown", infer: true },
  );
});

test("playback, echo cooldown and recognition in flight discard frames; waiting automatically hears the next utterance", () => {
  const { page, domain } = voiceFixture();
  const turns: any[] = [];
  page.voiceCommand = async (_wave: ArrayBuffer, context: any) => {
    turns.push(context);
  };
  for (const phase of ["playing", "preparing", "confirming", "completed"]) {
    page.session.phase = phase;
    speechTurn((frame) => page.hearFrame(frame));
  }
  page.session.phase = "waiting";
  page.echoUntil = Date.now() + 1000;
  speechTurn((frame) => page.hearFrame(frame));
  page.echoUntil = 0;
  page.voiceScope = {};
  speechTurn((frame) => page.hearFrame(frame));
  assert.equal(turns.length, 0);
  page.voiceScope = null;
  speechTurn((frame) => page.hearFrame(frame));
  speechTurn((frame) => page.hearFrame(frame));
  assert.equal(turns.length, 2);
  assert.deepEqual(copy(turns[0]), copy(domain.sessionContext(page.session)));
  page.visible = false;
  speechTurn((frame) => page.hearFrame(frame));
  assert.equal(turns.length, 2);
});

test("final ASR of a familiar command executes directly with no model round trip", async () => {
  const { app, page, domain } = voiceFixture(),
    calls = voiceJobs(app, () => ({ text: "写好了", final: true }));
  await page.voiceCommand(pcmFrame(0.1), domain.sessionContext(page.session));
  assert.equal(page.session.index, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "asr");
  assert.equal(calls[0].payload.mime, "audio/wav");
  assert.equal(page.data.voiceFeedback, "已执行：下一项");
  await flush();
});

test("unfamiliar phrasing only requests control intent with hints disabled and no chat history", async () => {
  const { app, page, domain } = voiceFixture();
  const calls = voiceJobs(app, (action) =>
    action === "asr"
      ? { text: "这一题给我做个记号", final: true }
      : {
          type: "control",
          command: "mark",
          message: "untrusted model narration",
        },
  );
  await page.voiceCommand(pcmFrame(0.1), domain.sessionContext(page.session));
  assert.deepEqual(
    calls.map((call) => call.action),
    ["asr", "session-agent"],
  );
  assert.equal(calls[1].payload.context.allowHints, false);
  assert.equal(calls[1].payload.history.length, 0);
  assert.equal(page.session.items[0].marked, true);
  assert.equal(page.data.voiceFeedback, "已执行：标记不会");
  assert.equal(page.data.turns, undefined);
  await flush();
});

for (const reply of [
  { type: "explanation", explanation: {}, message: "should never appear" },
  { type: "reply", message: "should never appear" },
  { type: "control", command: "explain", message: "should never appear" },
])
  test(`voice rejects model ${reply.type}/${reply.command || "text"} output`, async () => {
    const { app, page, domain } = voiceFixture();
    voiceJobs(app, (action) =>
      action === "asr" ? { text: "解释一下这个单词", final: true } : reply,
    );
    await page.voiceCommand(pcmFrame(0.1), domain.sessionContext(page.session));
    assert.equal(page.session.index, 0);
    assert.equal(page.session.items[0].hint, false);
    assert.equal(page.data.turns, undefined);
    assert.doesNotMatch(page.data.voiceFeedback, /should never appear/);
    await flush();
  });

test("incomplete ASR never executes, waiting stays waiting on hold, and stale commands cannot toggle marks", async () => {
  const { app, page, domain } = voiceFixture();
  voiceJobs(app, () => ({ text: "写好了", final: false }));
  await page.voiceCommand(pcmFrame(0.1), domain.sessionContext(page.session));
  assert.equal(page.session.index, 0);
  assert.equal(page.action("pause", 1, true), true);
  assert.equal(page.session.phase, "waiting");
  page.action("mark", 1, true);
  page.action("mark", 1, true);
  assert.equal(page.session.items[0].marked, true);
  assert.equal(page.action("mark", 0), false);
  assert.equal(page.action("pause", 0, true), false);
  page.session.phase = "completed";
  assert.equal(page.action("mark", 1), false);
  assert.equal(page.session.items[0].marked, true);
  await flush();
});

for (const leave of ["off", "background", "manual"])
  test(`${leave} cancels pending ASR and ignores a late next command`, async () => {
    const { app, page, domain } = voiceFixture();
    const pending: any[] = [];
    app.requests((options) => {
      if (options.data?.action)
        options.success({ statusCode: 200, data: { id: "pending" } });
      else if (options.url.includes("/jobs?") && options.method !== "DELETE") {
        pending.push(options);
        return;
      } else
        options.success({
          statusCode: 200,
          data: options.data?.key ? { ...options.data, revision: 1 } : {},
        });
      options.complete?.();
    });
    const command = page.voiceCommand(
      pcmFrame(0.1),
      domain.sessionContext(page.session),
    );
    await flush();
    await flush();
    assert.equal(pending.length, 1);
    if (leave === "off") page.voiceToggle({ detail: { value: false } });
    else if (leave === "background") page.onHide();
    else page.action("mark");
    pending[0].success({
      statusCode: 200,
      data: {
        id: "pending",
        state: "done",
        result: { text: "写好了", final: true },
      },
    });
    pending[0].complete?.();
    await command;
    assert.equal(page.session.index, 0);
    assert.equal(page.voiceScope, null);
    await flush();
  });

test("microphone denial keeps manual controls usable; off preference persists and is account isolated", async () => {
  const { app, page } = voiceFixture(),
    work = app.load("utils/workspace");
  app.wx.authorize = (options: any) => options.fail({ errMsg: "deny" });
  await page.startListening();
  assert.equal(page.data.micState, "error");
  assert.match(page.data.voiceError, /未授权/);
  assert.equal(page.action("mark"), true);
  page.voiceToggle({ detail: { value: false } });
  assert.equal(work.readWork("voice-enabled"), false);
  const editor = app.page("editor");
  editor.loaded = true;
  editor.onShow();
  assert.equal(editor.data.settings.voiceControl, false);
  work.saveWork("voice-enabled", true);
  editor.onShow();
  assert.equal(editor.data.settings.voiceControl, true);
  editor.voiceControl({ detail: { value: false } });
  assert.equal(work.readWork("voice-enabled"), false);
  app.signIn("bob");
  assert.equal(work.readWork("voice-enabled"), null);
  app.signIn("alice");
  assert.equal(work.readWork("voice-enabled"), false);
  app.load("utils/api").clearUserCache("alice");
  assert.equal(work.readWork("voice-enabled"), null);
  await flush();
});

test("missing native frames cannot leave a fake listening status", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = runtime(),
    { ContinuousRecorder } = app.load("utils/listening"),
    { TaskScope } = app.load("utils/task"),
    scope = new TaskScope();
  let message = "";
  try {
    await new ContinuousRecorder().start(
      scope,
      () => {},
      (error: Error) => {
        message = error.message;
      },
    );
    t.mock.timers.tick(7999);
    assert.equal(message, "");
    t.mock.timers.tick(1);
    assert.match(message, /实时录音帧/);
    assert.equal(app.stops(), 1);
  } finally {
    scope.cancel();
    app.callbacks.stop({ duration: 1 });
    t.mock.timers.reset();
  }
});

test("a stalled recognition times out and cannot execute a command much later", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { app, page, domain } = voiceFixture();
  let pending: any;
  app.requests((options) => {
    if (options.data?.action)
      options.success({ statusCode: 200, data: { id: "slow" } });
    else if (options.url.includes("/jobs?") && options.method !== "DELETE") {
      pending = options;
      return;
    } else options.success({ statusCode: 200, data: {} });
    options.complete?.();
  });
  const command = page.voiceCommand(
    pcmFrame(0.1),
    domain.sessionContext(page.session),
  );
  await flush();
  await flush();
  assert.ok(pending);
  t.mock.timers.tick(20000);
  await command;
  assert.equal(page.data.micState, "error");
  assert.match(page.data.voiceError, /等待较久/);
  pending.success({
    statusCode: 200,
    data: { state: "done", result: { text: "写好了", final: true } },
  });
  assert.equal(page.session.index, 0);
  assert.equal(page.voiceScope, null);
  t.mock.timers.reset();
  await flush();
});

test("legacy phone harness rejects the original unsupported regex literal", () => {
  assert.throws(
    () =>
      checkLegacyRegexSyntax(
        String.raw`function command() { return /[\s\p{P}]/gu; }`,
        "original-command.js",
      ),
    /Unicode property escapes unavailable/,
  );
});

test("punctuated ASR controls dictation and grading works on a phone without Unicode property escapes", async () => {
  const { app, page, domain } = voiceFixture({ legacyRegExp: true });
  const calls = voiceJobs(app, () => ({
    text: "老师，“写好了”！",
    final: true,
  }));
  await page.voiceCommand(pcmFrame(0.1), domain.sessionContext(page.session));
  assert.equal(page.session.index, 1);
  assert.equal(page.data.voiceError, "");
  assert.equal(page.data.voiceFeedback, "已执行：下一项");
  assert.deepEqual(
    calls.map((call) => call.action),
    ["asr"],
  );
  assert.equal(domain.grade("Ａpple。", "apple", true), "正确");
  assert.equal(domain.grade("apple。", "apple", true, false, true), "错误");
  assert.equal(domain.grade("1+2", "12", true), "错误");
  for (const name of [
    "home",
    "editor",
    "result",
    "library",
    "profile",
    "privacy",
  ])
    assert.doesNotThrow(() => app.page(name));
  await flush();
});
