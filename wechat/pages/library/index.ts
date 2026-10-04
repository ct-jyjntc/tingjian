import type { HistorySummary, Item } from "../../shared";
import { signedIn } from "../../utils/api";
import {
  listHistory,
  readDocument,
  saveDocument,
  deleteDocument,
} from "../../utils/storage";
import {
  requireLogin,
  confirm,
  showError,
  dateLabel,
  type TapEvent,
} from "../../utils/ui";
Page({
  data: {
    tab: "history",
    loggedIn: false,
    loading: false,
    error: "",
    history: [] as (HistorySummary & { date: string })[],
    wrong: [] as Item[],
    busy: false,
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
    this.setData({ loggedIn, error: "", history: [], wrong: [] });
    if (!loggedIn) return;
    this.setData({ loading: true });
    try {
      const [history, wrong] = await Promise.all([
        listHistory(),
        readDocument<Item[]>("wrong"),
      ]);
      this.setData({
        history: history.map((item) => ({
          ...item,
          date: dateLabel(item.started),
        })),
        wrong: wrong || [],
      });
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "记录读取失败",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  tab(event: TapEvent) {
    this.setData({ tab: event.currentTarget.dataset.tab });
  },
  open(event: TapEvent) {
    wx.navigateTo({
      url: `/pages/result/index?id=${encodeURIComponent(String(event.currentTarget.dataset.key).slice(8))}`,
    });
  },
  async removeHistory(event: TapEvent) {
    if (
      !(await confirm(
        "删除这份听写记录？",
        "将从你的账号中删除这份历史及批改结果，错词本中的词语仍保留。",
        "删除记录",
      ))
    )
      return;
    try {
      await deleteDocument(
        event.currentTarget.dataset.key,
        Number(event.currentTarget.dataset.revision),
      );
      await this.refresh();
    } catch (error) {
      showError(error);
    }
  },
  async removeWrong(event: TapEvent) {
    if (
      !(await confirm(
        "这个词已经记住了？",
        "会将它移出错词本，历史听写结果仍保留。",
        "移出错词本",
      ))
    )
      return;
    try {
      await saveDocument(
        "wrong",
        this.data.wrong.filter(
          (item) => item.id !== event.currentTarget.dataset.id,
        ),
      );
      await this.refresh();
    } catch (error) {
      showError(error);
    }
  },
  async review() {
    if (!requireLogin() || !this.data.wrong.length || this.data.busy) return;
    if (
      !(await confirm(
        "开始整理错词练习？",
        "会将错词本内容放进当前编辑草稿，准备好后再开始听写。",
        "准备练习",
      ))
    )
      return;
    this.setData({ busy: true });
    try {
      await readDocument("draft");
      await saveDocument("draft", {
        title: "错词复习",
        items: this.data.wrong.map((item) => ({
          ...item,
          marked: false,
          hint: false,
        })),
        materials: [],
      });
      wx.navigateTo({ url: "/pages/editor/index" });
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  login() {
    wx.switchTab({ url: "/pages/profile/index" });
  },
  home() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
