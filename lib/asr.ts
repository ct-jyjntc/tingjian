import { api } from "./client";
export type Transcript = {
  text: string;
  final: boolean;
  round: number;
  id: string;
  started: number;
};
// Segmented VAD adapter. Providers are explicitly selected on the backend.
export class Microphone {
  stream?: MediaStream;
  context?: AudioContext;
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setInterval>;
  active = false;
  controller?: AbortController;
  busy = false;
  async start(
    round: () => number,
    onText: (t: Transcript) => void,
    onStatus: (s: string) => void,
  ) {
    if (!window.isSecureContext)
      throw Error("麦克风需要 HTTPS 或本机 localhost");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.context = new AudioContext();
    await this.context.resume();
    const source = this.context.createMediaStreamSource(this.stream),
      analyser = this.context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    this.active = true;
    let silent = 0,
      speech = false,
      began = 0,
      captured = 0,
      chunks: Blob[] = [];
    const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((v) =>
      MediaRecorder.isTypeSupported(v),
    );
    if (!mime) {
      this.stop();
      throw Error("浏览器不支持可用录音格式，请使用按钮操作");
    }
    this.timer = setInterval(() => {
      if (!this.active || this.busy) return;
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((a, b) => a + b * b, 0) / samples.length,
      );
      const now = Date.now();
      if (rms > 0.022) {
        silent = now;
        if (!speech) {
          speech = true;
          began = now;
          captured = round();
          chunks = [];
          this.recorder = new MediaRecorder(this.stream!, { mimeType: mime });
          this.recorder.ondataavailable = (e) => {
            if (e.data.size) chunks.push(e.data);
          };
          this.recorder.onstop = async () => {
            if (!this.active) return;
            this.busy = true;
            onStatus("正在识别你说的话…");
            this.controller = new AbortController();
            try {
              const blob = new Blob(chunks, { type: mime });
              const buf = new Uint8Array(await blob.arrayBuffer());
              let binary = "";
              for (const v of buf) binary += String.fromCharCode(v);
              const d = await api(
                "asr",
                { audio: btoa(binary), mime },
                this.controller.signal,
              );
              if (this.active)
                onText({
                  text: d.text,
                  final: d.final === true,
                  round: captured,
                  id: crypto.randomUUID(),
                  started: began,
                });
            } catch (e) {
              if (this.active)
                onStatus(`${String(e)}；下一段语音会重试，按钮仍可使用`);
            } finally {
              this.busy = false;
            }
          };
          this.recorder.start();
          onStatus("检测到语音，正在录音…");
        }
      }
      if (speech && (now - silent > 900 || now - began > 10000)) {
        speech = false;
        this.recorder?.stop();
      }
    }, 60);
    onStatus("麦克风已开启 · 可以直接对话");
  }
  stop() {
    this.active = false;
    clearInterval(this.timer);
    this.controller?.abort();
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context?.close();
  }
}
