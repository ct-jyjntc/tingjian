import type { HistorySummary, Item } from "../../shared";
import { auth, signedIn } from "../../utils/api";
import {
  listHistory,
  readDocument,
  writeLocal,
  syncDocument,
  deleteDocument,
} from "../../utils/storage";
import { prepareReview } from "../../utils/review";
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
    wrong: [] as (Item & { selected?: boolean })[],
    selectedIds: [] as string[],
    selectedCount: 0,
    removedWord: "",
    refreshing: false,
    busy: false,
  },
  loaded: false,
  owner: "",
  refreshId: 0,
  selectionReady: false,
  removedItem: null as Item | null,
  onShow() {
    this.getTabBar?.()?.setData({ selected: 1 });
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
      this.owner = owner;
      this.loaded = false;
      this.selectionReady = false;
      this.removedItem = null;
      this.setData({
        history: [],
        wrong: [],
        selectedIds: [],
        selectedCount: 0,
        removedWord: "",
      });
    }
    this.setData({
      loggedIn,
      error: "",
      loading: loggedIn && !this.loaded,
      refreshing: loggedIn,
    });
    if (!loggedIn) return;
    try {
      const [history, wrong] = await Promise.all([
        listHistory(),
        readDocument<Item[]>("wrong"),
      ]);
      if (id !== this.refreshId || auth()?.user.id !== owner) return;
      this.loaded = true;
      const selectedIds = this.selectionReady
        ? this.data.selectedIds.filter((id) =>
            wrong?.some((item) => item.id === id),
          )
        : (wrong || []).map((item) => item.id);
      this.selectionReady = true;
      this.setData({
        selectedIds,
        selectedCount: selectedIds.length,
        history: history.map((item) => ({
          ...item,
          date: dateLabel(item.started),
        })),
        wrong: (wrong || []).map((item) => ({
          ...item,
          selected: selectedIds.includes(item.id),
        })),
      });
    } catch (error) {
      if (id !== this.refreshId || auth()?.user.id !== owner) return;
      this.setData({
        error: error instanceof Error ? error.message : "记录读取失败",
      });
    } finally {
      if (id === this.refreshId)
        this.setData({ loading: false, refreshing: false });
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
  moreHistory(event: TapEvent) {
    if (this.data.busy) return;
    wx.showActionSheet({
      itemList: ["删除这份记录"],
      success: (result) => {
        if (result.tapIndex === 0) void this.removeHistory(event);
      },
    });
  },
  selection(event: WechatMiniprogram.CustomEvent<{ value: string[] }>) {
    const selectedIds = event.detail.value;
    this.setData({
      selectedIds,
      selectedCount: selectedIds.length,
      wrong: this.data.wrong.map((item) => ({
        ...item,
        selected: selectedIds.includes(item.id),
      })),
    });
  },
  selectAll() {
    const selectedIds =
      this.data.selectedCount === this.data.wrong.length
        ? []
        : this.data.wrong.map((item) => item.id);
    this.setData({
      selectedIds,
      selectedCount: selectedIds.length,
      wrong: this.data.wrong.map((item) => ({
        ...item,
        selected: selectedIds.includes(item.id),
      })),
    });
  },
  async removeHistory(event: TapEvent) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
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
    } finally {
      this.setData({ busy: false });
    }
  },
  async removeWrong(event: TapEvent) {
    if (this.data.busy) return;
    const item = this.data.wrong.find(
      (item) => item.id === event.currentTarget.dataset.id,
    );
    if (!item) return;
    this.setData({ busy: true });
    try {
      const words = (await readDocument<Item[]>("wrong")) || [];
      writeLocal(
        "wrong",
        words.filter((word) => word.id !== item.id),
      );
      const { selected: _selected, ...removed } = item;
      this.removedItem = removed;
      this.setData({ removedWord: item.answer });
      await this.refresh();
      await syncDocument("wrong");
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  async undoRemove() {
    if (!this.removedItem || this.data.busy) return;
    this.setData({ busy: true });
    try {
      const words = (await readDocument<Item[]>("wrong")) || [];
      if (!words.some((item) => item.id === this.removedItem!.id)) {
        if (words.length >= 300) throw new Error("错词本已满，请整理后再恢复");
        writeLocal("wrong", [...words, this.removedItem]);
        this.setData({
          selectedIds: [...this.data.selectedIds, this.removedItem.id],
        });
      }
      this.removedItem = null;
      this.setData({ removedWord: "" });
      await this.refresh();
      await syncDocument("wrong");
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  async review() {
    if (!requireLogin() || !this.data.selectedCount || this.data.busy) return;
    this.setData({ busy: true });
    try {
      await prepareReview(
        this.data.wrong.filter((item) =>
          this.data.selectedIds.includes(item.id),
        ),
        "错词复习",
      );
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
