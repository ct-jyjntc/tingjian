import { clearTemporaryAudio } from "./utils/audio";
App({
  onLaunch() {
    clearTemporaryAudio();
    const manager = wx.getUpdateManager();
    manager.onUpdateReady(() =>
      wx.showModal({
        title: "新版本已准备好",
        content: "重新打开后即可使用。请先保存正在编辑的清单。",
        confirmText: "重新打开",
        success: (result) => {
          if (result.confirm) manager.applyUpdate();
        },
      }),
    );
  },
});
