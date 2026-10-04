import { recordId, speechChunks, type Item, type Settings } from "../shared";
import { ai } from "./api";
import { Cancelled, TaskScope } from "./task";

type State = "loading" | "playing" | "idle";
export class AudioPlayer {
  private scope?: TaskScope;
  stop() {
    this.scope?.cancel();
    this.scope = undefined;
  }
  async playItem(
    item: Item,
    settings: Settings,
    state: (state: State) => void,
  ) {
    this.stop();
    const scope = (this.scope = new TaskScope());
    try {
      for (let repeat = 0; repeat < settings.repeats; repeat++) {
        await this.segment(
          item.spoken,
          item.language,
          item.pronunciation,
          settings,
          scope,
          state,
        );
        if (repeat + 1 < settings.repeats)
          await scope.wait(settings.gap * 1000);
      }
      scope.check();
    } finally {
      if (this.scope === scope) {
        this.scope = undefined;
        state("idle");
      }
    }
  }
  async narrate(
    text: string,
    settings: Settings,
    state: (state: State) => void,
  ) {
    this.stop();
    const scope = (this.scope = new TaskScope());
    try {
      for (const chunk of speechChunks(text)) {
        await this.segment(
          chunk,
          "Chinese",
          "",
          {
            ...settings,
            voice:
              settings.ttsBackend === "edge-tts" ? "edge-auto" : settings.voice,
          },
          scope,
          state,
        );
      }
      scope.check();
    } finally {
      if (this.scope === scope) {
        this.scope = undefined;
        state("idle");
      }
    }
  }
  private async segment(
    text: string,
    language: string,
    pronunciation: string,
    settings: Settings,
    scope: TaskScope,
    state: (state: State) => void,
  ) {
    scope.check();
    state("loading");
    const bytes = await ai<ArrayBuffer>(
      "tts",
      {
        text,
        voice: settings.voice,
        backend: settings.ttsBackend,
        speed: settings.speed,
        language,
        pronunciation,
      },
      scope,
    );
    scope.check();
    if (
      bytes.byteLength < 44 ||
      String.fromCharCode(...new Uint8Array(bytes).slice(0, 4)) !== "RIFF"
    )
      throw new Error("未得到可播放的朗读音频");
    const filePath = `${wx.env.USER_DATA_PATH}/tingjian-audio-${recordId()}.wav`;
    const fs = wx.getFileSystemManager();
    let context: WechatMiniprogram.InnerAudioContext | undefined;
    try {
      await new Promise<void>((resolve, reject) =>
        fs.writeFile({
          filePath,
          data: bytes,
          success: () => resolve(),
          fail: () => reject(new Error("音频保存失败，请检查本机空间")),
        }),
      );
      scope.check();
      context = wx.createInnerAudioContext({ useWebAudioImplement: false });
      context.obeyMuteSwitch = false;
      const audio = context;
      await new Promise<void>((resolve, reject) => {
        let settled = false,
          remove = () => {};
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          remove();
          if (error) reject(error);
          else resolve();
        };
        audio.onEnded(() => finish());
        audio.onError(() => finish(new Error("音频播放失败，请点击重读")));
        audio.onPlay(() => {
          if (!scope.cancelled) state("playing");
        });
        remove = scope.onCancel(() => {
          audio.stop();
          finish(new Cancelled());
        });
        audio.src = filePath;
        audio.play();
      });
      scope.check();
    } finally {
      context?.destroy();
      fs.unlink({ filePath, fail: () => {} });
    }
  }
}
export function clearTemporaryAudio() {
  const fs = wx.getFileSystemManager();
  fs.readdir({
    dirPath: wx.env.USER_DATA_PATH,
    success(result) {
      for (const name of result.files)
        if (/^tingjian-audio-.*\.wav$/.test(name))
          fs.unlink({
            filePath: `${wx.env.USER_DATA_PATH}/${name}`,
            fail: () => {},
          });
    },
    fail: () => {},
  });
}
