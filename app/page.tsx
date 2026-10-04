"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  ChevronRight,
  Clock,
  Home,
  Leaf,
  Settings2,
  Wifi,
  X,
} from "lucide-react";
import StudyHome from "@/components/StudyHome";
import AISettings from "@/components/AISettings";
import { speechVoices } from "@/lib/voices";
import ImageEditor from "@/components/ImageEditor";
import ContentEditor, { Raw } from "@/components/ContentEditor";
import Settings from "@/components/Settings";
import Dictation from "@/components/Dictation";
import Completion from "@/components/Completion";
import {
  Item,
  Picture,
  Session,
  Settings as Config,
  defaults,
  newItem,
} from "@/lib/types";
import { clear, get, put, deleteHistory } from "@/lib/store";
import { api, setAccess, stopPreview } from "@/lib/client";
import { mergePictures, readPicture } from "@/lib/images";
import { replaceRecognition } from "@/lib/draft";
import { shuffle } from "@/lib/machine";
import { itemIssue, type Material } from "@/lib/materials";
type Page =
  | "home"
  | "images"
  | "content"
  | "settings"
  | "dictation"
  | "completion"
  | "history"
  | "wrong"
  | "services";
type Health = Record<
  string,
  {
    state: string;
    label: string;
    model?: string;
    backend?: string;
    checkedAt?: string;
  }
>;
export default function App() {
  const [page, setPage] = useState<Page>("home"),
    [pictures, setPictures] = useState<Picture[]>([]),
    [items, setItems] = useState<Item[]>([]),
    [raw, setRaw] = useState<Raw[]>([]),
    [settings, setSettings] = useState<Config>(defaults),
    [session, setSession] = useState<Session | null>(null),
    [history, setHistory] = useState<Session[]>([]),
    [wrong, setWrong] = useState<Item[]>([]),
    [health, setHealth] = useState<Health>({}),
    [toast, setToast] = useState(""),
    [loaded, setLoaded] = useState(false),
    [openingDraft, setOpeningDraft] = useState(false),
    [token, setToken] = useState(""),
    [saveImages, setSaveImages] = useState(false),
    [filter, setFilter] = useState(""),
    [manual, setManual] = useState(""),
    [deleteAll, setDeleteAll] = useState(false),
    [aiConnectionVersion, setAIConnectionVersion] = useState(0),
    [pendingAISettings, setPendingAISettings] = useState(false),
    [draftBackup, setDraftBackup] = useState<{
      items: Item[];
      raw: Raw[];
    } | null>(null);
  const itemsRef = useRef(items),
    rawRef = useRef(raw);
  itemsRef.current = items;
  rawRef.current = raw;
  const upload = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    latest = useRef<Session | null>(null);
  const storageFailed = useRef(false);
  const notify = useCallback((text: string) => {
    setToast(text.replace(/^Error: /, ""));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 9000);
  }, []);
  const storageError = useCallback(() => {
    if (!storageFailed.current) {
      storageFailed.current = true;
      notify("浏览器保存失败，请检查存储权限或空间；本次内容仍在页面中。");
    }
  }, [notify]);
  const checkHealth = useCallback(
    () =>
      api("health")
        .then(setHealth)
        .catch((e) => notify(String(e))),
    [notify],
  );
  useEffect(() => {
    setAccess(sessionStorage.getItem("access") || "");
    setToken(sessionStorage.getItem("access") || "");
    void checkHealth();
    void Promise.all([
      get<{ items: Item[]; raw: Raw[]; settings: Config }>("draft"),
      get<Session>("session"),
      get<Session[]>("history"),
      get<Item[]>("wrong"),
      get<Picture[]>("pictures"),
      get<{ items: Item[]; raw: Raw[] }>("draft-backup"),
      api("ai-settings-revision").catch(() => null),
    ])
      .then(([draft, s, h, w, p, backup, serverDefaults]) => {
        if (backup) setDraftBackup(backup);
        if (draft) {
          setItems(draft.items);
          setRaw(draft.raw);
          setSettings({ ...defaults, ...draft.settings });
        } else if (serverDefaults) {
          const backend =
            serverDefaults.ttsBackend === "mlx-audio"
              ? "mlx-audio"
              : "edge-tts";
          setSettings({
            ...defaults,
            ttsBackend: backend,
            voice: speechVoices[backend][0].id,
          });
        }
        if (s) {
          const restored = {
            ...s,
            phase:
              s.phase === "completed"
                ? ("completed" as const)
                : ("paused" as const),
            round: s.round + 1,
          };
          setSession(restored);
          latest.current = restored;
        }
        if (h) setHistory(h);
        if (w) setWrong(w);
        if (p) {
          setPictures(p);
          setSaveImages(true);
        }
        setLoaded(true);
      })
      .catch(() => {
        storageError();
        setLoaded(true);
      });
    return () => stopPreview();
  }, [checkHealth, storageError]);
  useEffect(() => {
    if (loaded) void put("draft", { items, raw, settings }).catch(storageError);
  }, [items, raw, settings, loaded, storageError]);
  useEffect(() => {
    if (loaded) void put("wrong", wrong).catch(storageError);
  }, [wrong, loaded, storageError]);
  useEffect(() => {
    if (loaded) void put("history", history).catch(storageError);
  }, [history, loaded, storageError]);
  useEffect(() => {
    if (loaded)
      void put("pictures", saveImages ? pictures : undefined).catch(
        storageError,
      );
  }, [pictures, saveImages, loaded, storageError]);
  function go(next: Page) {
    if (
      page === "services" &&
      next !== "services" &&
      pendingAISettings &&
      !window.confirm("AI 配置尚未保存，是否放弃修改并离开？")
    )
      return;
    stopPreview();
    setPage(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function addPictures(files: File[]) {
    if (!files.length || !loaded || openingDraft) return;
    setOpeningDraft(true);
    try {
      const pics = await Promise.all(files.map(readPicture));
      await applyDraft([], [], []);
      setPictures(mergePictures([], pics));
      go("images");
    } catch (e) {
      notify(String(e));
    } finally {
      setOpeningDraft(false);
    }
  }
  async function startTextDraft() {
    setOpeningDraft(true);
    try {
      await applyDraft([], [], []);
      setPictures([]);
      go("content");
    } catch (e) {
      notify(String(e));
    } finally {
      setOpeningDraft(false);
    }
  }
  async function applyDraft(
    next: Item[],
    newMaterials: Material[] = [],
    replacementRaw?: Raw[],
  ) {
    const previous = { items: itemsRef.current, raw: rawRef.current };
    try {
      await put("draft-backup", previous);
    } catch {
      storageError();
      throw Error("无法保存撤销快照，清单尚未修改");
    }
    if (itemsRef.current !== previous.items || rawRef.current !== previous.raw)
      throw Error("清单在保存期间已变化，请重新应用草稿");
    const nextRaw = replacementRaw ?? [
      ...rawRef.current.filter(
        (r) => !newMaterials.some((m) => m.source === r.source),
      ),
      ...newMaterials,
    ];
    setDraftBackup(previous);
    itemsRef.current = next;
    rawRef.current = nextRaw;
    setItems(next);
    setRaw(nextRaw);
  }
  async function undoDraft() {
    if (!draftBackup) return;
    itemsRef.current = draftBackup.items;
    rawRef.current = draftBackup.raw;
    setItems(draftBackup.items);
    setRaw(draftBackup.raw);
    setDraftBackup(null);
    await put("draft-backup", undefined);
    notify("已恢复上次应用前的清单和原始记录");
  }
  async function recognized(materials: Material[], imported: Item[]) {
    const next = replaceRecognition(
      itemsRef.current,
      rawRef.current,
      materials,
      imported,
    );
    await applyDraft(next.items, [], next.raw);
  }
  const saveSession = useCallback(
    (s: Session) => {
      latest.current = s;
      setSession(s);
      void put("session", s).catch(storageError);
      setHistory((h) => [s, ...h.filter((v) => v.id !== s.id)].slice(0, 100));
    },
    [storageError],
  );
  function start() {
    if (!items.length) return;
    if (items.some((i) => itemIssue(i))) {
      notify("清单中还有整行串读、乱码或待核查内容，请先修正。");
      go("content");
      return;
    }
    if (items.some((v) => !v.spoken.trim() || !v.answer.trim())) {
      notify("请补全每一项的朗读内容和标准答案");
      return;
    }
    if (
      settings.mode.includes("提示") &&
      items.some((v) => v.spoken === v.answer)
    ) {
      notify("提示模式需要不同的朗读提示与标准答案，请返回内容页补全并确认");
      return;
    }
    stopPreview();
    const ordered = settings.order === "random" ? shuffle(items) : items;
    const s: Session = {
      id: crypto.randomUUID(),
      items: ordered.map((v) => ({ ...v, hint: settings.showAnswer })),
      index: 0,
      phase: "preparing",
      round: 1,
      settings: { ...settings },
      started: Date.now(),
    };
    saveSession(s);
    go("dictation");
  }
  function resume(s: Session) {
    if (s.items.some((i) => itemIssue(i))) {
      setItems(s.items);
      notify("这份旧清单需要核查，已转到编辑页；原听写记录仍保留。");
      go("content");
      return;
    }
    const next = { ...s, phase: "paused" as const, round: s.round + 1 };
    saveSession(next);
    go("dictation");
  }
  function review(list: Item[]) {
    setItems(
      list.map((v) => ({
        ...v,
        id: crypto.randomUUID(),
        hint: false,
        marked: false,
      })),
    );
    setSettings((v) => ({ ...v, mode: "错词复习" }));
    go("settings");
  }
  function addWrong(list: Item[]) {
    setWrong((v) => [
      ...v,
      ...list
        .filter((a) => !v.some((b) => b.answer === a.answer))
        .map((a) => ({ ...a, id: crypto.randomUUID() })),
    ]);
  }
  const pageTitles: Record<Page, string> = {
    home: "让每一次听写，都从容一点。",
    images: "选择这次的学习内容",
    content: "确认你的听写清单",
    settings: "准备开始听写",
    dictation: "跟着自己的节奏",
    completion: "记录这一次进步",
    history: "每一次练习，都有迹可循",
    wrong: "把不熟悉，慢慢变成熟悉",
    services: "服务与隐私设置",
  };
  return (
    <div className="app">
      <a className="skip-link" href="#study-content">
        跳转到学习内容
      </a>
      <aside className="sidebar" aria-label="学习导航">
        <button
          className="brand"
          aria-label="听见首页"
          onClick={() => go("home")}
        >
          <span className="brand-icon">
            <AudioLines size={27} />
          </span>
          <span>
            听见<small>TINGJIAN STUDIO</small>
          </span>
        </button>
        <div className="nav-label">
          我的学习空间 <span>WORKSPACE</span>
        </div>
        <nav aria-label="主要导航">
          {(
            [
              { id: "home", label: "开始听写", icon: Home },
              { id: "history", label: "听写记录", icon: Clock },
              { id: "wrong", label: "我的错词本", icon: BookOpen },
            ] as const
          ).map((n) => (
            <button
              className={
                page === n.id ||
                (n.id === "home" &&
                  [
                    "images",
                    "content",
                    "settings",
                    "dictation",
                    "completion",
                  ].includes(page))
                  ? "active"
                  : ""
              }
              aria-current={
                page === n.id ||
                (n.id === "home" &&
                  [
                    "images",
                    "content",
                    "settings",
                    "dictation",
                    "completion",
                  ].includes(page))
                  ? "page"
                  : undefined
              }
              aria-label={n.label}
              key={n.id}
              onClick={() => go(n.id)}
            >
              <n.icon size={20} />
              {n.label}
              {n.id === "wrong" && wrong.length > 0 && (
                <span className="nav-count">{wrong.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="little-note">
            <Leaf size={19} />
            <p>
              不赶进度，
              <br />
              只陪你一点点进步。
            </p>
          </div>
          <button
            className={page === "services" ? "active" : ""}
            aria-current={page === "services" ? "page" : undefined}
            aria-label="服务与设置"
            onClick={() => go("services")}
          >
            <Settings2 size={19} />
            服务与设置
          </button>
          <small>听 · 写 · 慢慢记住</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="topbar-mark">
              <AudioLines size={16} />
            </span>{" "}
            我的学习空间 <ChevronRight size={14} />{" "}
            <span>
              {
                {
                  home: "开始听写",
                  images: "图片处理",
                  content: "内容确认",
                  settings: "听写设置",
                  dictation: "正在听写",
                  completion: "听写完成",
                  history: "听写记录",
                  wrong: "错词本",
                  services: "服务与设置",
                }[page]
              }
            </span>
          </div>
          <button
            className="connection"
            onClick={() => {
              go("services");
              void checkHealth();
            }}
          >
            <span
              className={`status-dot ${health.TTS?.state === "ready" ? "online" : ""}`}
            />
            {health.TTS?.state === "ready"
              ? health.TTS?.backend === "edge-tts"
                ? "在线语音已验证"
                : "本地语音已连接"
              : "查看服务状态"}
          </button>
        </header>
        <main id="study-content" tabIndex={-1}>
          <input
            ref={upload}
            hidden
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              void addPictures(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <input
            ref={camera}
            hidden
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              void addPictures(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          {page !== "home" && page !== "dictation" && page !== "completion" && (
            <div className="page-heading">
              <div>
                <span className="eyebrow">听见 · YOUR LEARNING STUDIO</span>
                <h1>{pageTitles[page]}</h1>
                <p className="muted">
                  {page === "images"
                    ? "图片只在本次页面中保留，识别时会发送给你配置的模型服务。"
                    : page === "wrong"
                      ? "只收录你确认的错词。复习一次，就更靠近掌握一点。"
                      : ""}
                </p>
              </div>
              {["images", "content", "settings"].includes(page) && (
                <div className="steps">
                  {(["images", "content", "settings"] as const).map((a, i) => (
                    <button
                      className={page === a ? "current" : ""}
                      key={a}
                      onClick={() => go(a)}
                    >
                      <b>{i + 1}</b>
                      {["圈选", "确认", "设置"][i]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {page === "home" && (
            <StudyHome
              ready={loaded}
              busy={openingDraft}
              draftCount={items.length}
              hasDraft={items.length > 0 || raw.length > 0}
              session={session}
              history={history}
              wrongCount={wrong.length}
              onCamera={() => camera.current?.click()}
              onUpload={() => upload.current?.click()}
              onDrop={(files) => void addPictures(files)}
              onText={() => void startTextDraft()}
              onDraft={() => go("content")}
              onHistory={() => go("history")}
              onWrong={() => go("wrong")}
              onResume={resume}
            />
          )}
          {page === "images" && (
            <>
              <ImageEditor
                pictures={pictures}
                setPictures={setPictures}
                onRecognized={recognized}
                notify={notify}
              />
              <div className="footer-actions">
                <span className="muted">已提取 {items.length} 项内容</span>
                <button
                  className="primary"
                  disabled={!items.length}
                  onClick={() => go("content")}
                >
                  检查识别结果
                  <ArrowRight size={17} />
                </button>
              </div>
            </>
          )}
          {page === "content" && (
            <ContentEditor
              items={items}
              setItems={setItems}
              raw={raw}
              pictures={pictures}
              settings={settings}
              onNext={() => go("settings")}
              notify={notify}
              onApply={applyDraft}
              onUndo={() => void undoDraft()}
              canUndo={Boolean(draftBackup)}
            />
          )}
          {page === "settings" && (
            <Settings
              value={settings}
              onChange={setSettings}
              count={items.length}
              onStart={start}
              notify={notify}
            />
          )}
          {page === "dictation" && session && (
            <Dictation
              key={session.id}
              initial={session}
              onSave={saveSession}
              onComplete={(s) => {
                saveSession(s);
                go("completion");
              }}
              notify={notify}
            />
          )}
          {page === "completion" && session && (
            <Completion
              key={session.id}
              session={session}
              onReview={review}
              onWrong={addWrong}
              notify={notify}
            />
          )}
          {page === "history" && (
            <section className="panel">
              <h2>
                听写记录 <span className="count">{history.length}</span>
              </h2>
              {history.length ? (
                history.map((h) => (
                  <div className="history-row" key={h.id}>
                    <span className="book-tile">
                      <BookOpen />
                    </span>
                    <div>
                      <h3>
                        {h.items
                          .slice(0, 3)
                          .map((v) => v.answer)
                          .join("、")}
                      </h3>
                      <p>
                        {new Date(h.started).toLocaleString("zh-CN")} ·{" "}
                        {h.items.length} 项 ·{" "}
                        {h.phase === "completed" ? "已结束" : "未完成"}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        if (h.phase === "completed") {
                          setSession(h);
                          go("completion");
                        } else resume(h);
                      }}
                    >
                      {h.phase === "completed" ? "查看与核对" : "继续听写"}
                    </button>
                    <button
                      onClick={() => {
                        setHistory((v) => v.filter((a) => a.id !== h.id));
                        void put(`grade:${h.id}`, undefined);
                        if (session?.id === h.id) {
                          setSession(null);
                          void put("session", undefined);
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty">
                  还没有听写记录。完成一次练习后会出现在这里。
                </div>
              )}
            </section>
          )}
          {page === "wrong" && (
            <section className="panel">
              <div className="section-title">
                <h2>
                  我的错词本 <span className="count">{wrong.length}</span>
                </h2>
                <button
                  className="primary"
                  disabled={!wrong.length}
                  onClick={() =>
                    review(wrong.filter((v) => v.answer.includes(filter)))
                  }
                >
                  开始复习
                </button>
              </div>
              <div className="row">
                <input
                  aria-label="搜索错词"
                  placeholder="搜索错词"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <input
                  aria-label="手动添加词语"
                  placeholder="手动添加词语"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                />
                <button
                  disabled={!manual.trim()}
                  onClick={() => {
                    addWrong([newItem(manual.trim())]);
                    setManual("");
                  }}
                >
                  添加
                </button>
              </div>
              {wrong
                .filter((v) => v.answer.includes(filter))
                .map((v) => (
                  <div className="wrong-card" key={v.id}>
                    <strong>{v.answer}</strong>
                    <small>{v.source}</small>
                    <label>
                      记忆提示
                      <textarea
                        placeholder="写下自己的记忆方法，也可以用 AI 生成"
                        value={v.note || ""}
                        onChange={(e) =>
                          setWrong((a) =>
                            a.map((b) =>
                              b.id === v.id
                                ? { ...b, note: e.target.value }
                                : b,
                            ),
                          )
                        }
                      />
                    </label>
                    <div className="row">
                      <button
                        onClick={() =>
                          void api("explain", { text: v.answer })
                            .then((d) =>
                              setWrong((a) =>
                                a.map((b) =>
                                  b.id === v.id
                                    ? {
                                        ...b,
                                        note: `AI 生成（请核对）：${d.text}`,
                                      }
                                    : b,
                                ),
                              ),
                            )
                            .catch((e) => notify(String(e)))
                        }
                      >
                        AI 记忆提示
                      </button>
                      <button onClick={() => review([v])}>听写这一项</button>
                      <button
                        onClick={() =>
                          setWrong((a) => a.filter((b) => b.id !== v.id))
                        }
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              {!wrong.length && (
                <div className="empty">
                  还没有错词。批改后确认的错词可以加入这里。
                </div>
              )}
            </section>
          )}
          {page === "services" && (
            <>
              <AISettings
                key={aiConnectionVersion}
                onDirtyChange={setPendingAISettings}
                onSaved={(saved, changed) => {
                  if (changed.includes("TTS_BACKEND")) {
                    const backend =
                      saved.values.TTS_BACKEND === "mlx-audio"
                        ? "mlx-audio"
                        : "edge-tts";
                    setSettings((current) => ({
                      ...current,
                      ttsBackend: backend,
                      voice: speechVoices[backend][0].id,
                    }));
                  }
                  void checkHealth();
                }}
              />
              <div className="settings-layout">
                <section className="panel">
                  <div className="section-title">
                    <h2>模型服务</h2>
                    <button onClick={() => void checkHealth()}>
                      <Wifi size={16} />
                      重新检查
                    </button>
                  </div>
                  {(
                    ["VISION", "TTS", "ASR", "LLM", "HANDWRITING"] as const
                  ).map((k) => (
                    <div className="service-row" key={k}>
                      <div>
                        <strong>
                          {
                            {
                              VISION: "图片文字识别",
                              TTS: "语音朗读",
                              ASR: "语音识别与对话",
                              LLM: "内容整理与解释",
                              HANDWRITING: "手写识别与批改",
                            }[k]
                          }
                        </strong>
                        <small>{health[k]?.model || k}</small>
                        {health[k]?.checkedAt && (
                          <small>
                            最近验证：
                            {new Date(health[k].checkedAt!).toLocaleTimeString(
                              "zh-CN",
                            )}
                          </small>
                        )}
                      </div>
                      <span
                        className={`badge ${health[k]?.state === "ready" ? "green" : ""}`}
                      >
                        {health[k]?.label || "待检查"}
                      </span>
                    </div>
                  ))}
                  <p className="note">
                    “已配置”只表示字段完整；“最近调用成功”是实际调用记录，不代表持续在线。未配置的能力会明确报错。
                  </p>
                  <label>
                    应用访问口令
                    <input
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="填写服务器 APP_ACCESS_TOKEN"
                    />
                  </label>
                  <button
                    onClick={() => {
                      setAccess(token);
                      setAIConnectionVersion((version) => version + 1);
                      void checkHealth();
                    }}
                  >
                    连接服务
                  </button>
                </section>
                <section className="panel">
                  <h2>隐私与数据</h2>
                  <p>
                    内容、设置、顺序和进度保存在当前浏览器的
                    IndexedDB，不在不同设备间同步。识别图片和短录音会发送给配置的服务，应用不保存录音。
                  </p>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={saveImages}
                      onChange={(e) => setSaveImages(e.target.checked)}
                    />
                    在此浏览器保存来源图片，便于下次对照
                  </label>
                  <p className="note">
                    本地 TTS 会缓存音频。独立服务缓存最多 7 天 / 256
                    条；当前已部署服务的缓存由其自身管理。
                  </p>
                  <div className="stack">
                    <button
                      onClick={() => {
                        setPictures([]);
                        setSaveImages(false);
                        notify("已清除来源图片");
                      }}
                    >
                      清除图片
                    </button>
                    <button
                      onClick={() => {
                        setHistory([]);
                        setSession(null);
                        void put("session", undefined);
                        void deleteHistory().catch(storageError);
                        notify("已清除听写历史");
                      }}
                    >
                      清除听写历史
                    </button>
                    <button onClick={() => setWrong([])}>清空错词本</button>
                    <button
                      className="danger"
                      onClick={() => setDeleteAll(true)}
                    >
                      清除所有本地数据
                    </button>
                  </div>
                  <p className="note">
                    手机拍照和麦克风需要 HTTPS。手机只访问网页后端；Edge
                    朗读会将文字发送到在线服务，本地 TTS 始终由电脑后端连接。
                  </p>
                </section>
              </div>
            </>
          )}
        </main>
        <footer>
          听见 · 一次专注，一点进步 <span>按你的节奏 / AI 智能听写</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={18} />
          </button>
        </div>
      )}
      {deleteAll && (
        <div className="modal-backdrop">
          <div className="panel modal">
            <h2>清除所有本地数据？</h2>
            <p>将删除此浏览器内的图片、清单、历史、批改和错词记录。</p>
            <button
              className="danger"
              onClick={async () => {
                await clear();
                location.reload();
              }}
            >
              确认清除
            </button>
            <button onClick={() => setDeleteAll(false)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
