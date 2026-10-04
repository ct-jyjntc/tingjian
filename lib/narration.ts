import { audioBlob } from "./client";
import { speechChunks } from "./explanation";
import type { Settings } from "./types";

export type NarrationState = "idle" | "loading" | "playing";
type Dependencies = {
  synthesize: typeof audioBlob;
  createAudio: (url: string) => HTMLAudioElement;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
};
export class NarrationPlayer {
  active = false;
  private generation = 0;
  private controller?: AbortController;
  private audio?: HTMLAudioElement;
  private cancelWait?: () => void;
  private onState?: (state: NarrationState) => void;
  constructor(
    private dependencies: Dependencies = {
      synthesize: audioBlob,
      createAudio: (url) => new Audio(url),
      createUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url),
    },
  ) {}
  stop() {
    this.generation++;
    this.controller?.abort();
    this.cancelWait?.();
    this.cancelWait = undefined;
    this.audio?.pause();
    if (this.audio) this.audio.src = "";
    this.audio = undefined;
    this.active = false;
    this.onState?.("idle");
  }
  async speak(
    text: string,
    settings: Settings,
    onState: (state: NarrationState) => void,
  ) {
    this.stop();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.onState = onState;
    this.active = true;
    const valid = () =>
      generation === this.generation && !controller.signal.aborted;
    try {
      for (const chunk of speechChunks(text)) {
        onState("loading");
        const blob = await this.dependencies.synthesize(
          {
            text: chunk,
            backend: settings.ttsBackend || "edge-tts",
            voice:
              settings.ttsBackend === "mlx-audio"
                ? settings.voice
                : "edge-auto",
            language: "Chinese",
            speed: settings.speed,
            pronunciation: "",
          },
          controller.signal,
        );
        if (!valid()) return;
        const url = this.dependencies.createUrl(blob);
        try {
          const audio = this.dependencies.createAudio(url);
          this.audio = audio;
          onState("playing");
          await new Promise<void>((resolve, reject) => {
            this.cancelWait = () =>
              reject(new DOMException("讲解已停止", "AbortError"));
            audio.onended = () => {
              this.cancelWait = undefined;
              resolve();
            };
            audio.onerror = () =>
              reject(Error("讲解音频播放失败，文字内容已保留"));
            audio.play().catch(reject);
          });
        } finally {
          this.dependencies.revokeUrl(url);
        }
        if (!valid()) return;
      }
    } finally {
      if (valid()) {
        this.active = false;
        this.audio = undefined;
        this.cancelWait = undefined;
        onState("idle");
      }
    }
  }
}
