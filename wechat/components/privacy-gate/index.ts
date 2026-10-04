type Resolve = (result: { event: string; buttonId?: string }) => void;
Component({
  data: { visible: false },
  options: { styleIsolation: "apply-shared" },
  lifetimes: {
    attached() {
      this.pending = new Set<Resolve>();
    },
    detached() {
      this.rejectPrivacy();
    },
  },
  pageLifetimes: {
    show() {
      wx.onNeedPrivacyAuthorization((callback) => {
        // Upstream typings incorrectly call this parameter GeneralCallbackResult;
        // the official API and examples specify a resolve function.
        const resolve = callback as unknown as Resolve;
        this.pending.add(resolve);
        this.setData({ visible: true });
        resolve({ event: "exposureAuthorization" });
      });
    },
    hide() {
      this.rejectPrivacy();
    },
  },
  methods: {
    agreePrivacy() {
      for (const resolve of this.pending)
        resolve({ event: "agree", buttonId: "privacy-agree" });
      this.pending.clear();
      this.setData({ visible: false });
    },
    rejectPrivacy() {
      for (const resolve of this.pending || []) resolve({ event: "disagree" });
      this.pending?.clear();
      this.setData({ visible: false });
    },
    openContract() {
      wx.openPrivacyContract({
        fail: () => wx.navigateTo({ url: "/pages/privacy/index" }),
      });
    },
  },
} as WechatMiniprogram.Component.Options<
  { visible: boolean },
  {},
  { agreePrivacy(): void; rejectPrivacy(): void; openContract(): void },
  [],
  { pending: Set<Resolve> }
>);
