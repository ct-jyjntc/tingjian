import { request, type PublicConfig } from "../../utils/api";
Page({
  data: {
    config: null as (PublicConfig & { processors?: string }) | null,
    error: "",
  },
  async onLoad() {
    try {
      this.setData({
        config: await request<PublicConfig>("config", { public: true }),
      });
    } catch {
      this.setData({
        error: "运营信息暂时无法加载。服务开放前需由运营者补充完整。",
      });
    }
  },
  contract() {
    wx.openPrivacyContract({
      fail: () =>
        wx.showToast({ title: "暂时无法打开微信隐私指引", icon: "none" }),
    });
  },
});
