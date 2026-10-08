import { type DraftDocument, type Session, type Item } from "../../shared";
import { auth, signedIn } from "../../utils/api";
import { readDocument, listHistory } from "../../utils/storage";
import { showError, requireLogin } from "../../utils/ui";
import {
  readWork,
  hasWork,
  inputCount,
  type EditorWork,
} from "../../utils/workspace";
Page({
  data: {
    loggedIn: false,
    loading: false,
    hasDraft: false,
    draftCount: 0,
    active: false,
    activeProgress: "",
    historyCount: 0,
    wrongCount: 0,
    error: "",
    creating: "",
    hasNewDraft: false,
    newDraftCount: 0,
    draftTitle: "",
    refreshing: false,
  },
  loaded: false,
  owner: "",
  refreshId: 0,
  onShow() {
    this.setData({ creating: "" });
    this.getTabBar?.()?.setData({ selected: 0 });
    void this.refresh();
  },
  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },
  async refresh() {
    const loggedIn = signedIn(),
      owner = auth()?.user.id || "",
      id = ++this.refreshId;
    if (owner !== this.owner) {
      this.loaded = false;
      this.owner = owner;
      this.setData({
        hasDraft: false,
        active: false,
        historyCount: 0,
        wrongCount: 0,
        hasNewDraft: false,
      });
    }
    this.setData({
      loggedIn,
      error: "",
      loading: loggedIn && !this.loaded,
      refreshing: loggedIn,
    });
    if (!loggedIn) return;
    const work = readWork<EditorWork>("new-draft");
    this.setData({
      hasNewDraft: hasWork(work),
      newDraftCount: work
        ? work.draft.items.length + inputCount(work.input)
        : 0,
    });
    try {
      const [draft, session, history, wrong] = await Promise.all([
        readDocument<DraftDocument>("draft"),
        readDocument<Session>("session"),
        listHistory(),
        readDocument<Item[]>("wrong"),
      ]);
      if (id !== this.refreshId || auth()?.user.id !== owner) return;
      this.loaded = true;
      this.setData({
        draftTitle: draft?.title || "上次的清单",
        hasDraft: Boolean(draft?.items.length),
        draftCount: draft?.items.length || 0,
        active: Boolean(session && session.phase !== "completed"),
        activeProgress: session
          ? `${session.index + 1} / ${session.items.length}`
          : "",
        historyCount: history.length,
        wrongCount: wrong?.length || 0,
      });
    } catch (error) {
      if (id !== this.refreshId || auth()?.user.id !== owner) return;
      this.setData({
        error: error instanceof Error ? error.message : "暂时无法读取记录",
      });
    } finally {
      if (id === this.refreshId)
        this.setData({ loading: false, refreshing: false });
    }
  },
  newDraft(event: WechatMiniprogram.BaseEvent) {
    if (this.data.creating) return;
    const source = String(event.currentTarget.dataset.source || "text");
    if (!["camera", "album", "text"].includes(source)) return;
    const url = `/pages/editor/index?new=1&source=${source}`;
    if (!requireLogin(url)) return;
    this.setData({ creating: source });
    wx.navigateTo({
      url,
      fail: () => showError(new Error("页面未打开，请重试")),
      complete: () => this.setData({ creating: "" }),
    });
  },
  continueNewDraft() {
    const url = "/pages/editor/index?new=1";
    if (requireLogin(url)) wx.navigateTo({ url });
  },
  continueDraft() {
    if (requireLogin("/pages/editor/index"))
      wx.navigateTo({ url: "/pages/editor/index" });
  },
  continuePractice() {
    if (requireLogin("/pages/practice/index"))
      wx.navigateTo({ url: "/pages/practice/index" });
  },
  library() {
    wx.switchTab({ url: "/pages/library/index" });
  },
  wrongLibrary() {
    wx.switchTab({
      url: "/pages/library/index",
      success: () => {
        const pages = getCurrentPages();
        pages[pages.length - 1]?.setData({ tab: "wrong" });
      },
    });
  },
  profile() {
    wx.switchTab({ url: "/pages/profile/index" });
  },
  onShareAppMessage() {
    return { title: "听见 · 按自己的节奏听写", path: "/pages/home/index" };
  },
});
