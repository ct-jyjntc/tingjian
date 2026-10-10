import {
  auth,
  request,
  login,
  logout,
  bootstrap,
  type PublicConfig,
} from "../../utils/api";
import { readWork, hasWork, type EditorWork } from "../../utils/workspace";
import { dirtyCount, syncAll } from "../../utils/storage";
import { confirm, notify, showError, continueAfterLogin } from "../../utils/ui";
import { registration } from "../../utils/registration";
Page({
  data: {
    registration,
    loggedIn: false,
    agreed: false,
    busy: false,
    syncing: false,
    loading: true,
    showQuota: false,
    quotaReady: false,
    localWork: false,
    error: "",
    userLabel: "",
    remaining: 0,
    limit: 0,
    used: 0,
    pending: 0,
    config: {
      name: "听见",
      operator: "",
      contact: "",
      privacyVersion: "",
      configured: false,
    } as PublicConfig,
  },
  loaded: false,
  owner: "",
  onShow() {
    this.getTabBar?.()?.setData({ selected: 2 });
    void this.refresh();
  },
  refreshId: 0,
  async refresh() {
    const identity = auth(),
      owner = identity?.user.id || "",
      id = ++this.refreshId;
    if (owner !== this.owner) {
      this.owner = owner;
      this.loaded = false;
      this.setData({
        remaining: 0,
        limit: 0,
        used: 0,
        showQuota: false,
        quotaReady: false,
      });
    }
    this.setData({
      loggedIn: Boolean(identity),
      loading: !this.loaded,
      localWork: identity
        ? hasWork(readWork<EditorWork>("new-draft")) ||
          Boolean(readWork<string>("draft-input")?.trim())
        : false,
      userLabel: identity ? `学习账号 · ${identity.user.id.slice(-6)}` : "",
      error: "",
      pending: identity ? dirtyCount() : 0,
    });
    try {
      if (identity) {
        const data = await bootstrap();
        if (id !== this.refreshId || auth()?.user.id !== owner) return;
        this.setData({
          quotaReady: true,
          config: data.config,
          remaining: data.quota.remaining,
          limit: data.quota.limit,
          used: data.quota.used,
          pending: dirtyCount(),
        });
      } else {
        const config = await request<PublicConfig>("config", { public: true });
        if (id !== this.refreshId || auth()) return;
        this.setData({ config });
      }
      this.loaded = true;
    } catch (error) {
      if (id !== this.refreshId || (auth()?.user.id || "") !== owner) return;
      this.setData({
        error: error instanceof Error ? error.message : "暂时无法读取账号",
      });
    } finally {
      if (id === this.refreshId) this.setData({ loading: false });
    }
  },
  toggleQuota() {
    this.setData({ showQuota: !this.data.showQuota });
  },
  agree(event: WechatMiniprogram.CustomEvent<{ value: string[] }>) {
    this.setData({ agreed: event.detail.value.includes("agree") });
  },
  async login() {
    if (this.data.busy || !this.data.agreed) return;
    this.setData({ busy: true, error: "" });
    try {
      await login(this.data.config.privacyVersion);
      await this.refresh();
      notify("登录成功");
      continueAfterLogin();
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "登录未完成，请重试",
      });
      showError(error);
    } finally {
      this.setData({ busy: false, syncing: false });
    }
  },
  async sync() {
    if (this.data.busy) return;
    this.setData({ busy: true, syncing: true });
    try {
      await syncAll();
      await this.refresh();
      notify("学习记录已同步");
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false, syncing: false });
    }
  },
  async logout() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      if (
        !(await confirm(
          "退出登录？",
          this.data.localWork
            ? "还有未开始的新清单或尚未加入清单的输入，只保存在本机。退出会清除，请先完成并保存。"
            : this.data.pending
              ? "还有未同步的修改。退出将清除本机缓存，建议先同步。"
              : "云端学习记录会保留，本机缓存将清除。",
          "退出登录",
        ))
      )
        return;
      await logout();
      await this.refresh();
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false, syncing: false });
    }
  },
  async deleteAccount() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      if (
        !(await confirm(
          "注销账号并删除记录？",
          "这会删除你的清单、听写历史、批改和错词，所有设备都会退出登录。删除后无法恢复。",
          "删除账号",
        ))
      )
        return;
      await logout(true);
      await this.refresh();
      notify("账号与学习记录已删除");
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false, syncing: false });
    }
  },
  privacy() {
    wx.navigateTo({ url: "/pages/privacy/index" });
  },
  contract() {
    wx.openPrivacyContract({ fail: () => this.privacy() });
  },
  contact() {
    wx.showModal({
      title: "联系运营者",
      content:
        this.data.config.contact || "服务尚未开放，联系方式将在开放时展示。",
      showCancel: false,
    });
  },
  permissions() {
    wx.openSetting({});
  },
  home() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
