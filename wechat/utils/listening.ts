import { privacyAuthorize } from "./media";
import { Cancelled, TaskScope } from "./task";

/** 16 kHz, mono, signed little-endian PCM. No browser audio APIs are needed. */
export function pcmWave(chunks: ArrayBuffer[]): ArrayBuffer {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new ArrayBuffer(44 + length),
    view = new DataView(output);
  const word = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  word(0, "RIFF");
  view.setUint32(4, 36 + length, true);
  word(8, "WAVE");
  word(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, "data");
  view.setUint32(40, length, true);
  let offset = 44;
  for (const chunk of chunks) {
    new Uint8Array(output, offset, chunk.byteLength).set(new Uint8Array(chunk));
    offset += chunk.byteLength;
  }
  return output;
}

/** Short speech turns only: pre-roll protects initial consonants; silence is never uploaded. */
export class SpeechTurns<T> {
  speaking = false;
  private chunks: ArrayBuffer[] = [];
  private preRoll: ArrayBuffer[] = [];
  private context?: T;
  private duration = 0;
  private voiced = 0;
  private silence = 0;
  private noise = 0.003;
  private overlong = false;
  reset() {
    this.speaking = false;
    this.chunks = [];
    this.preRoll = [];
    this.context = undefined;
    this.duration = 0;
    this.voiced = 0;
    this.silence = 0;
    this.overlong = false;
  }
  push(
    frame: ArrayBuffer,
    context: T,
  ): { wave: ArrayBuffer; context: T } | null {
    if (!frame.byteLength || frame.byteLength % 2) return null;
    const samples = new DataView(frame);
    let power = 0;
    for (let i = 0; i < frame.byteLength; i += 2)
      power += (samples.getInt16(i, true) / 32768) ** 2;
    const rms = Math.sqrt(power / (frame.byteLength / 2)),
      ms = frame.byteLength / 32;
    const speech = rms > Math.max(0.012, this.noise * 3);
    if (this.overlong) {
      this.silence = speech ? 0 : this.silence + ms;
      if (this.silence >= 700) this.reset();
      return null;
    }
    if (!this.speaking && !speech) {
      this.noise = Math.min(0.012, this.noise * 0.96 + rms * 0.04);
      this.preRoll.push(frame.slice(0));
      while (
        this.preRoll.reduce((sum, chunk) => sum + chunk.byteLength, 0) > 8192
      )
        this.preRoll.shift();
      return null;
    }
    if (!this.speaking) {
      this.speaking = true;
      this.context = context;
      this.chunks = this.preRoll;
      this.preRoll = [];
    }
    this.chunks.push(frame.slice(0));
    this.duration += ms;
    this.voiced += speech ? ms : 0;
    this.silence = speech ? 0 : this.silence + ms;
    if (this.duration >= 9000) {
      // Never execute a truncated long sentence whose final words may negate a command.
      this.reset();
      this.overlong = true;
      return null;
    }
    if (this.silence < 700) return null;
    const result =
      this.voiced >= 180 && this.context !== undefined
        ? { wave: pcmWave(this.chunks), context: this.context }
        : null;
    this.reset();
    return result;
  }
}

type Capture = {
  start: () => void;
  frame: (buffer: ArrayBuffer) => void;
  end: (error?: Error, duration?: number) => void;
};
let manager: WechatMiniprogram.RecorderManager | undefined;
let active: Capture | null = null;
function nativeRecorder() {
  if (manager) return manager;
  const recorder = (manager = wx.getRecorderManager());
  recorder.onStart(() => active?.start());
  recorder.onFrameRecorded((result) => active?.frame(result.frameBuffer));
  recorder.onStop((result) => {
    const capture = active;
    active = null;
    if (result.tempFilePath)
      wx.getFileSystemManager().unlink({
        filePath: result.tempFilePath,
        fail: () => {},
      });
    capture?.end(undefined, result.duration);
  });
  recorder.onError(() => {
    const capture = active;
    active = null;
    capture?.end(new Error("麦克风启动失败，请检查微信录音权限后重试"));
  });
  recorder.onInterruptionBegin(() => {
    const capture = active;
    capture?.end(new Error("录音被通话中断，结束通话后可重新开启"));
  });
  return recorder;
}

/** The microphone stays open between utterances; only the native ten-minute limit restarts it. */
export class ContinuousRecorder {
  async start(
    scope: TaskScope,
    onFrame: (buffer: ArrayBuffer) => void,
    onError: (error: Error) => void,
  ): Promise<void> {
    await privacyAuthorize();
    scope.check();
    await new Promise<void>((resolve, reject) =>
      wx.authorize({
        scope: "scope.record",
        success: () => resolve(),
        fail: () =>
          reject(
            new Error("麦克风未授权，可在微信设置中允许录音；按钮仍可使用"),
          ),
      }),
    );
    scope.check();
    const recorder = nativeRecorder();
    for (let wait = 0; active && wait < 40; wait++) await scope.wait(50);
    scope.check();
    if (active) throw new Error("麦克风正在释放，请稍后重试");
    return new Promise<void>((resolve, reject) => {
      let started = false,
        terminal = false;
      let remove = () => {};
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(
          () => fail(new Error("当前微信未提供实时录音帧，请更新微信后重试")),
          8000,
        );
      };
      const fail = (error: Error) => {
        if (terminal) return;
        terminal = true;
        clearTimeout(watchdog);
        remove();
        if (active === capture) recorder.stop();
        if (started && !(error instanceof Cancelled)) onError(error);
        else reject(error);
      };
      const launch = () => {
        if (scope.cancelled || terminal) return;
        active = capture;
        arm();
        try {
          recorder.start({
            duration: 600000,
            sampleRate: 16000,
            numberOfChannels: 1,
            format: "PCM",
            frameSize: 2,
            audioSource: "auto",
          });
        } catch {
          if (active === capture) active = null;
          fail(new Error("当前设备无法持续录音，按钮仍可使用"));
        }
      };
      const capture: Capture = {
        start() {
          if (!scope.cancelled && !terminal) {
            started = true;
            arm();
            resolve();
          }
        },
        frame(buffer) {
          if (!scope.cancelled && !terminal) {
            arm();
            onFrame(buffer);
          }
        },
        end(error, duration = 0) {
          clearTimeout(watchdog);
          if (error) fail(error);
          else if (!scope.cancelled && !terminal) {
            if (duration >= 590000) launch();
            else fail(new Error("录音意外停止，请重新开启语音控制"));
          }
        },
      };
      remove = scope.onCancel(() => fail(new Cancelled()));
      launch();
    });
  }
}
