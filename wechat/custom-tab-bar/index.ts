Component({
  data: {
    selected: 0,
    tabs: [
      { path: "/pages/home/index", label: "听写", icon: "home" },
      { path: "/pages/library/index", label: "练习本", icon: "book" },
      { path: "/pages/profile/index", label: "我的", icon: "user" },
    ],
  },
  methods: {
    switchTab(event: WechatMiniprogram.BaseEvent) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = this.data.tabs[index];
      if (!tab || index === this.data.selected) return;
      wx.switchTab({ url: tab.path });
    },
  },
});
