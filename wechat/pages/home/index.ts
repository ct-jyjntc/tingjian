import {
  defaults,
  type DraftDocument,
  type Session,
  type Item,
} from "../../shared";
import { signedIn } from "../../utils/api";
import { readDocument, saveDocument, listHistory } from "../../utils/storage";
import { confirm, showError, requireLogin } from "../../utils/ui";
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
  },
  onShow() {
    void this.refresh();
  },
  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },
  async refresh() {
    const loggedIn = signedIn();
    this.setData({
      loggedIn,
      error: "",
      hasDraft: false,
      active: false,
      historyCount: 0,
      wrongCount: 0,
    });
    if (!loggedIn) return;
    this.setData({ loading: true });
    try {
      const [draft, session, history, wrong] = await Promise.all([
        readDocument<DraftDocument>("draft"),
        readDocument<Session>("session"),
        listHistory(),
        readDocument<Item[]>("wrong"),
      ]);
      this.setData({
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
      this.setData({
        error: error instanceof Error ? error.message : "暂时无法读取记录",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  async newDraft(event: WechatMiniprogram.BaseEvent) {
    if (!requireLogin()) return;
    if (
      this.data.hasDraft &&
      !(await confirm(
        "开始一份新清单？",
        "会替换当前正在编辑的草稿，已保存的听写历史不受影响。",
        "新建清单",
      ))
    )
      return;
    try {
      // Read first so a new document never silently overwrites another device.
      await readDocument("draft");
      await saveDocument("draft", {
        title: "新的听写",
        items: [],
        materials: [],
      });
      wx.navigateTo({
        url: `/pages/editor/index?source=${event.currentTarget.dataset.source || "text"}`,
      });
    } catch (error) {
      showError(error);
    }
  },
  continueDraft() {
    if (requireLogin()) wx.navigateTo({ url: "/pages/editor/index" });
  },
  continuePractice() {
    if (requireLogin()) wx.navigateTo({ url: "/pages/practice/index" });
  },
  library() {
    wx.switchTab({ url: "/pages/library/index" });
  },
  profile() {
    wx.switchTab({ url: "/pages/profile/index" });
  },
  onShareAppMessage() {
    return { title: "听见 · 按自己的节奏听写", path: "/pages/home/index" };
  },
});
