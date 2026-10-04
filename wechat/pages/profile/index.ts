import {
  auth,
  request,
  login,
  logout,
  bootstrap,
  type PublicConfig,
} from "../../utils/api";
import { dirtyCount, syncAll } from "../../utils/storage";
import { confirm, notify, showError } from "../../utils/ui";
Page({
  data: {
    loggedIn: false,
    agreed: false,
    busy: false,
    loading: true,
    showQuota: false,
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
  onShow() {
    this.getTabBar?.()?.setData({ selected: 2 });
    void this.refresh();
  },
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    const identity = auth();
    this.setData({
      loggedIn: Boolean(identity),
      loading: true,
      userLabel: identity ? `学习账号 · ${identity.user.id.slice(-6)}` : "",
      error: "",
      remaining: 0,
      limit: 0,
      used: 0,
      pending: identity ? dirtyCount() : 0,
    });
    try {
      const config = await request<PublicConfig>("config", { public: true });
      this.setData({ config });
      if (identity) {
        const data = await bootstrap();
        this.setData({
          remaining: data.quota.remaining,
          limit: data.quota.limit,
          used: data.quota.used,
          pending: dirtyCount(),
        });
      }
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "暂时无法读取账号",
      });
    } finally {
      this.refreshing = false;
      this.setData({ loading: false });
    }
  },
  refreshing: false,
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
      notify("欢迎，开始今天的练习吧");
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "登录未完成，请重试",
      });
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  async sync() {
    this.setData({ busy: true });
    try {
      await syncAll();
      await this.refresh();
      notify("学习记录已同步");
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  async logout() {
    if (
      !(await confirm(
        "退出登录？",
        this.data.pending
          ? "还有未同步的修改。退出将清除本机缓存，建议先同步。"
          : "云端学习记录会保留，本机缓存将清除。",
        "退出登录",
      ))
    )
      return;
    this.setData({ busy: true });
    try {
      await logout();
      await this.refresh();
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  async deleteAccount() {
    if (
      !(await confirm(
        "注销账号并删除记录？",
        "这会删除你的清单、听写历史、批改和错词，所有设备都会退出登录。删除后无法恢复。",
        "删除账号",
      ))
    )
      return;
    this.setData({ busy: true });
    try {
      await logout(true);
      await this.refresh();
      notify("账号与学习记录已删除");
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false });
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
