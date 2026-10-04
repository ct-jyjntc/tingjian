import { Cancelled, TaskScope } from "./task";

function mediaError(error: { errMsg?: string }, fallback: string) {
  const message = error.errMsg || "";
  if (/cancel/i.test(message)) return new Cancelled();
  if (/api scope is not declared in the privacy agreement/i.test(message))
    return new Error(
      "照片或录音功能尚未完成微信隐私声明，请联系开发者；你可以先使用文字输入",
    );
  return new Error(fallback);
}

export async function privacyAuthorize() {
  await new Promise<void>((resolve, reject) =>
    wx.requirePrivacyAuthorize({
      success: () => resolve(),
      fail: (error) =>
        reject(
          mediaError(error, "你尚未同意隐私保护指引，可以继续使用文字输入"),
        ),
    }),
  );
}
export async function choosePhoto(
  sourceType: ("album" | "camera")[] = ["album", "camera"],
) {
  await privacyAuthorize();
  const path = await new Promise<string>((resolve, reject) =>
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType,
      sizeType: ["compressed"],
      success: (result) => resolve(result.tempFiles[0].tempFilePath),
      fail: (error) =>
        reject(mediaError(error, "无法打开照片，请检查微信的相机或相册权限")),
    }),
  );
  return compressPhoto(path);
}
export async function compressPhoto(path: string) {
  const info =
    await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>(
      (resolve, reject) =>
        wx.getImageInfo({
          src: path,
          success: resolve,
          fail: () => reject(new Error("无法读取这张图片")),
        }),
    );
  const ratio = Math.min(1, 2000 / Math.max(info.width, info.height));
  return new Promise<string>((resolve, reject) =>
    wx.compressImage({
      src: path,
      quality: 85,
      compressedWidth: Math.round(info.width * ratio),
      compressedHeight: Math.round(info.height * ratio),
      success: (result) => resolve(result.tempFilePath),
      fail: () => reject(new Error("图片压缩失败，请换一张照片")),
    }),
  );
}
export function cropPhoto(src: string) {
  return new Promise<string>((resolve, reject) =>
    wx.editImage({
      src,
      success: (result) => resolve(result.tempFilePath),
      fail: (error) =>
        reject(
          /cancel/.test(error.errMsg)
            ? new Cancelled()
            : new Error("当前设备无法裁剪，可在相册裁剪后重新选择"),
        ),
    }),
  );
}
export function readBytes(filePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) =>
    wx.getFileSystemManager().readFile({
      filePath,
      success: (result) => resolve(result.data as ArrayBuffer),
      fail: () => reject(new Error("临时文件已失效，请重新选择或录音")),
    }),
  );
}
export async function photoData(path: string) {
  const buffer = await readBytes(path),
    bytes = new Uint8Array(buffer);
  if (bytes.length > 6_000_000)
    throw new Error("图片仍然过大，请裁剪到需要听写的内容");
  const mime =
    bytes[0] === 255 && bytes[1] === 216
      ? "jpeg"
      : bytes[0] === 137 && bytes[1] === 80
        ? "png"
        : String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
          ? "webp"
          : "";
  if (!mime) throw new Error("请选择 JPG、PNG 或 WebP 图片");
  return `data:image/${mime};base64,${wx.arrayBufferToBase64(buffer)}`;
}
type Capture = {
  owner: VoiceRecorder;
  onStart: () => void;
  finish: (
    error?: Error,
    result?: WechatMiniprogram.OnStopListenerResult,
  ) => void;
};
let recordingManager: WechatMiniprogram.RecorderManager | undefined;
let activeCapture: Capture | null = null;
function recorderManager() {
  if (recordingManager) return recordingManager;
  const manager = (recordingManager = wx.getRecorderManager());
  // RecorderManager has no off* APIs. Register once, then route events to the
  // active capture. Keep a cancelled capture until its terminal event arrives.
  manager.onStart(() => activeCapture?.onStart());
  manager.onStop((result) => {
    const capture = activeCapture;
    activeCapture = null;
    capture?.finish(undefined, result);
  });
  manager.onError((error) => {
    const capture = activeCapture;
    activeCapture = null;
    capture?.finish(mediaError(error, "录音失败，请检查麦克风权限"));
  });
  manager.onInterruptionBegin(() => {
    activeCapture?.finish(new Cancelled());
    manager.stop();
  });
  return manager;
}
export class VoiceRecorder {
  stop() {
    if (activeCapture?.owner === this) recordingManager?.stop();
  }
  async capture(scope: TaskScope, onStart: () => void): Promise<string> {
    await privacyAuthorize();
    scope.check();
    await new Promise<void>((resolve, reject) =>
      wx.authorize({
        scope: "scope.record",
        success: () => resolve(),
        fail: (error) =>
          reject(
            mediaError(
              error,
              "麦克风未授权，请在微信设置中允许录音；也可以直接打字",
            ),
          ),
      }),
    );
    scope.check();
    const manager = recorderManager();
    if (activeCapture) throw new Error("上一段录音尚未结束，请稍后再试");
    return new Promise((resolve, reject) => {
      let settled = false,
        remove = () => {};
      const capture: Capture = {
        owner: this,
        onStart() {
          if (!scope.cancelled && !settled) onStart();
        },
        finish(error, result) {
          if (settled) return;
          settled = true;
          remove();
          if (error) reject(error);
          else if (scope.cancelled) reject(new Cancelled());
          else if (!result || result.duration < 300)
            reject(new Error("录音太短，请再说一次"));
          else resolve(result.tempFilePath);
        },
      };
      activeCapture = capture;
      remove = scope.onCancel(() => {
        capture.finish(new Cancelled());
        manager.stop();
      });
      manager.start({
        duration: 20_000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "mp3",
      });
    });
  }
}
