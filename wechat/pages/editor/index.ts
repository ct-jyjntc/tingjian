import {
  defaults,
  itemIssue,
  splitExistingItems,
  extractMaterial,
  shuffle,
  recordId,
  type DraftDocument,
  type Item,
  type Material,
  type Settings,
  type Session,
} from "../../shared";
import { ai, bootstrap, cachedBootstrap } from "../../utils/api";
import {
  readDocument,
  localDocument,
  writeLocal,
  saveDocument,
  syncDocument,
  dirty,
} from "../../utils/storage";
import { choosePhoto, cropPhoto, photoData } from "../../utils/media";
import { AudioPlayer } from "../../utils/audio";
import { TaskScope, Cancelled } from "../../utils/task";
import { formFocus } from "../../behaviors/form";
import {
  confirm,
  notify,
  showError,
  requireLogin,
  type InputEvent,
  type TapEvent,
} from "../../utils/ui";

import {
  readWork,
  saveWork,
  clearWork,
  textItems,
  inputCount,
  type EditorWork,
} from "../../utils/workspace";

type ItemView = Pick<
  Item,
  | "id"
  | "spoken"
  | "answer"
  | "pronunciation"
  | "source"
  | "generated"
  | "reviewed"
> & { issue: string; number: number };
type Proposal = {
  message: string;
  proposal?: Item[];
  materials?: Material[];
  trace: { label: string; detail: string; status: string }[];
};
const viewItems = (items: Item[]): ItemView[] =>
  items.map((item, index) => ({
    id: item.id,
    spoken: item.spoken,
    answer: item.answer,
    pronunciation: item.pronunciation,
    source: item.source,
    generated: item.generated || false,
    reviewed: item.reviewed || false,
    issue: itemIssue(item) || "",
    number: index + 1,
  }));
Page({
  behaviors: [formFocus],
  data: {
    loading: true,
    error: "",
    title: "新的听写",
    inputText: "",
    typedCount: 0,
    localDraft: false,
    saveError: "",
    syncConflict: false,
    settingsNotice: "",
    inputPlaceholder: "apple\n春天\n去的过去式 → went",
    items: [] as ItemView[],
    count: 0,
    photo: "",
    photoName: "",
    mode: 0,
    modes: ["自动判断", "单词逐项", "保留短语", "按句子"],
    busy: false,
    message: "",
    pending: false,
    instruction: "",
    generate: false,
    proposal: [] as ItemView[],
    proposalMessage: "",
    trace: [] as Proposal["trace"],
    undoable: false,
    editingId: "",
    sourceText: "",
    showSources: false,
    columns: [] as number[],
    settings: { ...defaults, voice: "edge-auto" } as Settings,
    voices: [] as { id: string; label: string }[],
    voiceIndex: 0,
    repeatLabels: ["1 遍", "2 遍", "3 遍", "4 遍", "5 遍"],
    speedPercent: 100,
    repeatIndex: 0,
    issueCount: 0,
    showImport: true,
    inputMode: "text",
    showAssistant: false,
    showSettings: false,
    starting: false,
    previewing: false,
    taskKind: "",
    taskError: "",
  },
  draft: { title: "新的听写", items: [], materials: [] } as DraftDocument,
  originalPhoto: "",
  undoDraft: null as DraftDocument | null,
  result: null as Proposal | null,
  proposalBase: "",
  scope: null as TaskScope | null,
  player: null as AudioPlayer | null,
  loaded: false,
  staged: false,
  inputTimer: null as ReturnType<typeof setTimeout> | null,
  picking: false,
  async onLoad(options: Record<string, string | undefined>) {
    if (
      !requireLogin(`/pages/editor/index${options.new === "1" ? "?new=1" : ""}`)
    )
      return;
    this.staged = options.new === "1";
    try {
      const [draft, settings, serviceResult] = await Promise.all([
        this.staged
          ? Promise.resolve(null)
          : readDocument<DraftDocument>("draft"),
        readDocument<Settings>("settings").catch(() =>
          localDocument<Settings>("settings"),
        ),
        bootstrap().catch(() => cachedBootstrap()),
      ]);
      const work = this.staged ? readWork<EditorWork>("new-draft") : null;
      this.draft = this.staged
        ? work?.draft || { title: "新的听写", items: [], materials: [] }
        : draft || { title: "新的听写", items: [], materials: [] };
      const savedInput = this.staged
        ? work?.input || ""
        : readWork<string>("draft-input") || "";
      const service = serviceResult || {
        ttsBackend: defaults.ttsBackend,
        voices: [
          { id: settings?.voice || "edge-auto", label: "默认中英文朗读" },
        ],
      };
      if (!service.voices.length)
        service.voices = [{ id: "edge-auto", label: "默认中英文朗读" }];
      this.setData({
        localDraft: this.staged,
        inputText: savedInput,
        typedCount: inputCount(savedInput),
        settingsNotice: serviceResult
          ? ""
          : "暂未刷新声音设置，编辑内容不受影响。",
      });
      const preferences = {
        ...defaults,
        ...settings,
        voiceControl: readWork<boolean>("voice-enabled") ?? true,
        allowHints: false,
        ttsBackend: service.ttsBackend,
      };
      if (!service.voices.some((v) => v.id === preferences.voice))
        preferences.voice = service.voices[0].id;
      this.setData({
        showImport:
          !this.draft.items.length ||
          Boolean(options.source) ||
          Boolean(savedInput.trim()),
        inputMode:
          options.source === "camera" || options.source === "album"
            ? "photo"
            : "text",
        settings: preferences,
        voices: service.voices,
        voiceIndex: service.voices.findIndex((v) => v.id === preferences.voice),
        speedPercent: Math.round(preferences.speed * 100),
        repeatIndex: preferences.repeats - 1,
      });
      this.loaded = true;
      this.player = new AudioPlayer();
      this.render();
      if (options.source === "camera" || options.source === "album")
        await this.pick(options.source);
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "清单读取失败",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  onShow() {
    if (!this.loaded) return;
    try {
      this.setData({
        "settings.voiceControl": readWork<boolean>("voice-enabled") ?? true,
      });
    } catch (error) {
      showError(error);
    }
  },
  onHide() {
    this.persistInput();
    if (!this.picking) this.cancel();
    this.player?.stop();
    if (this.loaded && !this.staged) void this.syncQuietly();
  },
  onUnload() {
    this.persistInput();
    this.loaded = false;
    this.cancel();
    this.player?.stop();
  },
  render(afterRender?: () => void) {
    const material = this.draft.materials[this.draft.materials.length - 1];
    this.setData(
      {
        title: this.draft.title,
        items: viewItems(this.draft.items),
        count: this.draft.items.length,
        issueCount: this.draft.items.filter((item) => itemIssue(item)).length,
        sourceText: this.draft.materials
          .map((m) => `${m.source}\n${m.text}`)
          .join("\n\n"),
        columns: [
          ...new Set(
            material?.blocks
              .map((b) => b.column)
              .filter((n): n is number => Boolean(n)) || [],
          ),
        ].sort((a, b) => a - b),
        pending: !this.staged && dirty("draft"),
        undoable: Boolean(this.undoDraft),
      },
      afterRender,
    );
  },
  snapshot() {
    this.undoDraft = JSON.parse(JSON.stringify(this.draft)) as DraftDocument;
  },
  changed(afterRender?: () => void) {
    try {
      if (this.staged)
        saveWork<EditorWork>("new-draft", {
          draft: this.draft,
          input: this.data.inputText,
        });
      else writeLocal("draft", this.draft);
      this.setData({ saveError: "", syncConflict: false });
    } catch (error) {
      this.setData({
        saveError:
          error instanceof Error ? error.message : "保存未完成，请勿关闭页面",
      });
    }
    this.render(afterRender);
  },
  titleInput(event: InputEvent) {
    this.setData({ focusKey: "" });
    this.draft.title = event.detail.value;
    this.changed();
  },
  textInput(event: InputEvent) {
    this.setData({
      inputText: event.detail.value,
      typedCount: inputCount(event.detail.value),
    });
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.inputTimer = setTimeout(() => this.persistInput(), 300);
  },
  persistInput() {
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.inputTimer = null;
    if (!this.loaded) return;
    try {
      if (this.staged)
        saveWork<EditorWork>("new-draft", {
          draft: this.draft,
          input: this.data.inputText,
        });
      else saveWork("draft-input", this.data.inputText);
    } catch (error) {
      this.setData({
        saveError:
          error instanceof Error ? error.message : "输入暂未保存，请勿退出",
      });
    }
  },
  async syncQuietly() {
    try {
      await syncDocument("draft");
      this.render();
    } catch (error) {
      this.setData({
        saveError:
          error instanceof Error ? error.message : "同步未完成，本机已保留",
        syncConflict: (error as { status?: number })?.status === 409,
      });
    }
  },
  openImport() {
    this.setData({ showImport: true }, () =>
      wx.pageScrollTo({ selector: "#import-card", duration: 200 }),
    );
  },
  togglePanel(event: TapEvent) {
    const key = event.currentTarget.dataset.panel as
      "showImport" | "showAssistant" | "showSettings";
    if (!["showImport", "showAssistant", "showSettings"].includes(key)) return;
    this.setData({ [key]: !this.data[key] });
  },
  inputMode(event: TapEvent) {
    this.setData({ inputMode: String(event.currentTarget.dataset.mode) });
  },
  retryLoad() {
    wx.redirectTo({ url: `/pages/editor/index${this.staged ? "?new=1" : ""}` });
  },
  instructionInput(event: InputEvent) {
    this.setData({ instruction: event.detail.value });
  },
  generateChange(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ generate: event.detail.value });
  },
  modeChange(event: InputEvent) {
    this.setData({ mode: Number(event.detail.value) });
  },
  addText() {
    if (!this.loaded || this.data.busy) return;
    const items = textItems(this.data.inputText);
    if (!items.length) return false;
    if (this.draft.items.length + items.length > 300) {
      notify("每份清单最多 300 项，请分成两次练习");
      return false;
    }
    this.snapshot();
    this.draft.items.push(...items);
    this.setData({ inputText: "", typedCount: 0, showImport: false });
    this.changed(() =>
      wx.pageScrollTo({ selector: "#list-heading", duration: 200 }),
    );
    this.persistInput();
    return true;
  },
  async pick(source?: "camera" | "album") {
    if (!this.loaded || this.data.busy) return;
    this.picking = true;
    try {
      const photo = await choosePhoto(source ? [source] : ["album", "camera"]);
      this.originalPhoto = photo;
      this.setData({
        photo,
        photoName: `图片 ${this.draft.materials.length + 1}`,
        message: "可以先裁剪，只留下这次想听写的内容。",
      });
    } catch (error) {
      showError(error);
    } finally {
      this.picking = false;
    }
  },
  chooseImage() {
    void this.pick();
  },
  async crop() {
    if (!this.data.photo || this.data.busy) return;
    this.picking = true;
    try {
      const photo = await cropPhoto(this.data.photo);
      this.setData({ photo });
    } catch (error) {
      showError(error);
    } finally {
      this.picking = false;
    }
  },
  restorePhoto() {
    this.setData({ photo: this.originalPhoto });
  },
  previewPhoto() {
    if (this.data.photo) wx.previewImage({ urls: [this.data.photo] });
  },
  cancel() {
    if (this.scope) {
      this.scope.cancel();
      this.scope = null;
      this.setData({
        busy: false,
        taskKind: "",
        message: "已取消任务，清单已保留。",
      });
    }
  },
  async recognize() {
    if (!this.data.photo || this.data.busy) return;
    this.cancel();
    const scope = (this.scope = new TaskScope());
    this.setData({
      busy: true,
      taskKind: "ocr",
      taskError: "",
      message: "正在识别课本，保留文字和行列位置…",
    });
    try {
      const image = await photoData(this.data.photo);
      scope.check();
      const result = await ai<{
        material: Material;
        items: Item[];
        warnings: string[];
      }>(
        "ocr",
        {
          image,
          source: this.data.photoName,
          mode: ["auto", "words", "phrases", "sentences"][this.data.mode],
        },
        scope,
      );
      scope.check();
      const replaced = this.draft.materials
        .filter(
          (m) =>
            m.sourceImageId &&
            m.sourceImageId === result.material.sourceImageId,
        )
        .map((m) => m.id);
      const kept = this.draft.items.filter(
        (item) => !replaced.includes(item.materialId || ""),
      );
      const materials = this.draft.materials.filter(
        (m) => !replaced.includes(m.id),
      );
      if (kept.length + result.items.length > 300 || materials.length >= 10)
        throw new Error(
          "这份清单已较长，请分成两份练习（最多 300 项、10 张识别材料）",
        );
      this.snapshot();
      this.draft.items = [...kept, ...result.items];
      this.draft.materials = [...materials, result.material];
      this.changed();
      this.setData({
        showImport: false,
        message: [
          `已识别 ${result.items.length} 项，请对照课本核查。`,
          ...result.warnings,
        ].join("\n"),
      });
      wx.pageScrollTo({ selector: "#list-heading", duration: 200 });
    } catch (error) {
      if (error instanceof Cancelled) return;
      this.setData({
        taskError:
          error instanceof Error ? error.message : "任务未完成，请重试",
        message: "",
      });
      showError(error);
      this.setData({ message: "识别未完成，原清单保留。可以调整图片后重试。" });
    } finally {
      if (this.scope === scope) {
        this.scope = null;
        this.setData({ busy: false, taskKind: "" });
      }
    }
  },
  toggleSources() {
    this.setData({ showSources: !this.data.showSources });
  },
  edit(event: TapEvent) {
    this.setData({
      editingId:
        this.data.editingId === event.currentTarget.dataset.id
          ? ""
          : event.currentTarget.dataset.id,
    });
  },
  field(event: InputEvent) {
    this.setData({ focusKey: "" });
    const { id, field } = event.currentTarget.dataset;
    if (!["spoken", "answer", "pronunciation"].includes(field)) return;
    const item = this.draft.items.find((item) => item.id === id);
    if (!item) return;
    this.snapshot();
    if (field === "spoken" && item.spoken === item.answer)
      item.answer = event.detail.value;
    item[field as "spoken" | "answer" | "pronunciation"] = event.detail.value;
    item.reviewed = false;
    this.changed();
  },
  reviewed(event: TapEvent) {
    this.snapshot();
    this.draft.items = this.draft.items.map((item) =>
      item.id === event.currentTarget.dataset.id
        ? { ...item, reviewed: true }
        : item,
    );
    this.changed();
  },
  remove(event: TapEvent) {
    this.snapshot();
    this.draft.items = this.draft.items.filter(
      (item) => item.id !== event.currentTarget.dataset.id,
    );
    this.changed();
  },
  move(event: TapEvent) {
    const index = this.draft.items.findIndex(
        (item) => item.id === event.currentTarget.dataset.id,
      ),
      target = index + Number(event.currentTarget.dataset.delta);
    if (index < 0 || target < 0 || target >= this.draft.items.length) return;
    this.snapshot();
    [this.draft.items[index], this.draft.items[target]] = [
      this.draft.items[target],
      this.draft.items[index],
    ];
    this.changed();
  },
  undo() {
    if (this.undoDraft) {
      this.draft = this.undoDraft;
      this.undoDraft = null;
      this.changed();
    }
  },
  splitWords() {
    const items = splitExistingItems(this.draft.items, "words");
    if (items.length > 300) {
      notify("拆分后超过 300 项，请先缩小清单");
      return;
    }
    this.propose({
      message: "按单词规则拆分，没有请求 AI。请检查提示与答案的配对关系。",
      proposal: items,
      trace: [],
    });
  },
  column(event: TapEvent) {
    const material = this.draft.materials[this.draft.materials.length - 1];
    if (!material) return;
    this.propose({
      message: `从最近一张材料的第 ${event.currentTarget.dataset.column} 列提取，没有请求 AI。确认后将替换当前清单。`,
      proposal: extractMaterial(material, {
        mode: "auto",
        columns: [Number(event.currentTarget.dataset.column)],
      }),
      trace: [],
    });
  },
  propose(result: Proposal) {
    this.result = result;
    this.proposalBase = JSON.stringify(this.draft.items);
    this.setData(
      {
        showAssistant: true,
        proposalMessage: result.message,
        proposal: viewItems(result.proposal || []),
        trace: result.trace || [],
      },
      () => wx.pageScrollTo({ selector: "#assistant-card", duration: 200 }),
    );
  },
  async ask() {
    if (!this.data.instruction.trim() || this.data.busy) return;
    const base = JSON.stringify(this.draft.items);
    const scope = (this.scope = new TaskScope());
    this.setData({
      busy: true,
      taskKind: "agent",
      taskError: "",
      message: "学习助手正在查看材料、准备清单…",
    });
    try {
      const result = await ai<Proposal>(
        "agent",
        {
          instruction: this.data.instruction,
          mode: this.data.generate ? "generate" : "original",
          items: this.draft.items,
          materials: this.draft.materials,
          sources: [],
        },
        scope,
      );
      scope.check();
      this.propose(result);
      this.proposalBase = base;
      this.setData({ message: "助手已完成，请查看下面的草稿。" });
    } catch (error) {
      this.setData({
        taskError:
          error instanceof Error ? error.message : "任务未完成，请重试",
        message: "",
      });
      showError(error);
    } finally {
      if (this.scope === scope) {
        this.scope = null;
        this.setData({ busy: false, taskKind: "" });
      }
    }
  },
  async apply() {
    if (!this.result?.proposal?.length) return;
    if (this.proposalBase !== JSON.stringify(this.draft.items)) {
      notify("清单已经编辑过，请重新让助手整理，避免覆盖刚才的修改");
      return;
    }
    this.snapshot();
    this.draft.items = this.result.proposal;
    for (const material of this.result.materials || []) {
      this.draft.materials = this.draft.materials.filter(
        (m) => m.id !== material.id,
      );
      this.draft.materials.push(material);
    }
    this.result = null;
    this.setData({
      proposal: [],
      proposalMessage: "",
      trace: [],
      showAssistant: false,
    });
    this.changed();
    wx.pageScrollTo({ selector: "#list-heading", duration: 200 });
  },
  discard() {
    this.result = null;
    this.setData({ proposal: [], proposalMessage: "", trace: [] });
  },
  async save() {
    if (!this.loaded || this.data.busy) return;
    if (this.data.inputText.trim() && !this.addText()) return;
    if (!this.draft.items.length) {
      this.openImport();
      return;
    }
    this.setData({ busy: true });
    try {
      if (this.staged) {
        const previous = await readDocument<DraftDocument>("draft");
        if (
          previous?.items.length &&
          !(await confirm(
            "保存为当前清单？",
            "将替换上次编辑的清单，听写进度和历史保留。",
            "保存清单",
          ))
        )
          return;
        await saveDocument("draft", this.draft);
        clearWork("new-draft");
        saveWork("draft-input", this.data.inputText);
        this.staged = false;
        this.setData({ localDraft: false });
      } else await syncDocument("draft");
      this.setData({ saveError: "", syncConflict: false });
      this.render();
      notify("清单已保存");
    } catch (error) {
      this.setData({
        saveError:
          error instanceof Error ? error.message : "同步未完成，本机已保留",
        syncConflict: (error as { status?: number })?.status === 409,
      });
    } finally {
      this.setData({ busy: false });
    }
  },
  async cloudVersion() {
    if (
      !(await confirm(
        "载入云端版本？",
        "当前尚未同步的草稿会被云端版本替换。",
        "载入云端",
      ))
    )
      return;
    try {
      this.draft = (await readDocument<DraftDocument>("draft", true)) || {
        title: "新的听写",
        items: [],
        materials: [],
      };
      this.setData({ saveError: "", syncConflict: false });
      this.render();
    } catch (error) {
      showError(error);
    }
  },
  voice(event: InputEvent) {
    const index = Number(event.detail.value);
    this.setData({
      voiceIndex: index,
      "settings.voice": this.data.voices[index].id,
    });
  },
  speed(event: WechatMiniprogram.CustomEvent<{ value: number }>) {
    this.setData({
      speedPercent: event.detail.value,
      "settings.speed": event.detail.value / 100,
    });
  },
  repeats(event: InputEvent) {
    const index = Number(event.detail.value);
    this.setData({ repeatIndex: index, "settings.repeats": index + 1 });
  },
  gap(event: WechatMiniprogram.CustomEvent<{ value: number }>) {
    this.setData({ "settings.gap": event.detail.value });
  },
  random(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({
      "settings.order": event.detail.value ? "random" : "original",
    });
  },
  voiceControl(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ "settings.voiceControl": event.detail.value });
    try {
      saveWork("voice-enabled", event.detail.value);
    } catch (error) {
      showError(error);
    }
  },
  answers(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ "settings.showAnswer": event.detail.value });
  },
  async preview() {
    if (!this.draft.items.length || this.data.busy || this.data.previewing)
      return;
    this.setData({ previewing: true });
    try {
      await this.player?.playItem(
        this.draft.items[0],
        { ...this.data.settings, repeats: 1 },
        () => {},
      );
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ previewing: false });
    }
  },
  async start() {
    if (!this.loaded || this.data.busy) return;
    if (this.data.inputText.trim() && !this.addText()) return;
    if (!this.draft.items.length) {
      this.openImport();
      return;
    }
    const issue = this.draft.items.find(
      (item) => !item.spoken.trim() || !item.answer.trim() || itemIssue(item),
    );
    if (issue) {
      this.setData({ editingId: issue.id }, () =>
        wx.pageScrollTo({ selector: `#item-${issue.id}`, duration: 200 }),
      );
      notify("请核对这一项的朗读内容与答案");
      return;
    }
    this.setData({ busy: true, starting: true });
    try {
      const [existing, previousDraft] = await Promise.all([
        readDocument<Session>("session"),
        this.staged
          ? readDocument<DraftDocument>("draft")
          : Promise.resolve(null),
      ]);
      const warnings = [
        existing && existing.phase !== "completed"
          ? "上次未完成的听写进度将被替换。"
          : "",
        previousDraft?.items.length ? "新清单将替换上次编辑的清单。" : "",
      ].filter(Boolean);
      if (
        warnings.length &&
        !(await confirm(
          "开始这份新听写？",
          warnings.join("\n") + "已保存的历史不受影响。",
          "开始听写",
        ))
      )
        return;
      this.player?.stop();
      const session: Session = {
        id: recordId(),
        items:
          this.data.settings.order === "random"
            ? shuffle(this.draft.items)
            : this.draft.items.map((item) => ({ ...item })),
        index: 0,
        round: 0,
        phase: "idle",
        started: Date.now(),
        settings: { ...this.data.settings },
      };
      if (this.staged) await saveDocument("draft", this.draft);
      else await syncDocument("draft");
      await saveDocument("settings", this.data.settings);
      await saveDocument("session", session);
      if (this.staged) {
        clearWork("new-draft");
        this.staged = false;
        this.setData({ localDraft: false });
      }
      clearWork("draft-input");
      wx.navigateTo({ url: "/pages/practice/index?autostart=1" });
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false, starting: false });
    }
  },
});
