import { Cancelled } from "./task";

function mediaError(error: { errMsg?: string }, fallback: string) {
  const message = error.errMsg || "";
  if (/cancel/i.test(message)) return new Cancelled();
  if (/api scope is not declared in the privacy agreement/i.test(message))
    return new Error(
      "照片或录音功能尚未完成微信隐私声明，请联系开发者；其余功能仍可使用",
    );
  return new Error(fallback);
}

export async function privacyAuthorize() {
  await new Promise<void>((resolve, reject) =>
    wx.requirePrivacyAuthorize({
      success: () => resolve(),
      fail: (error) =>
        reject(mediaError(error, "你尚未同意隐私保护指引，照片和语音暂不可用")),
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
