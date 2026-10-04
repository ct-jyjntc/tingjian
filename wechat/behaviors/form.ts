/** Native input focus is exposed as state so WXSS also works with native controls. */
export const formFocus = Behavior({
  data: { focusKey: "" },
  methods: {
    focusField(event: WechatMiniprogram.BaseEvent) {
      this.setData({ focusKey: String(event.currentTarget.dataset.focusKey) });
    },
    blurField() {
      this.setData({ focusKey: "" });
    },
  },
});
