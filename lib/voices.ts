export type TtsBackend = "edge-tts" | "mlx-audio";
export const speechVoices = {
  "edge-tts": [
    { id: "edge-auto", label: "自动 · 晓晓中文 / Aria 英文" },
    { id: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 中文女声" },
    { id: "zh-CN-YunxiNeural", label: "云希 · 中文男声" },
    { id: "en-US-AriaNeural", label: "Aria · 英文女声" },
    { id: "en-US-GuyNeural", label: "Guy · 英文男声" },
  ],
  "mlx-audio": [
    "Vivian",
    "Serena",
    "Ryan",
    "Aiden",
    "Uncle_Fu",
    "Dylan",
    "Eric",
  ].map((id) => ({ id, label: id })),
};
export function resolveVoice(
  backend: TtsBackend,
  voice: string,
  text: string,
  language: string,
) {
  if (backend === "edge-tts") {
    if (
      speechVoices["edge-tts"].some((v) => v.id === voice) &&
      voice !== "edge-auto"
    )
      return voice;
    if (
      voice !== "edge-auto" &&
      !speechVoices["mlx-audio"].some((v) => v.id === voice)
    )
      throw Error("不支持的声音");
    return language === "English" ||
      (language === "Auto" && !/[\u3400-\u9fff]/.test(text))
      ? "en-US-AriaNeural"
      : "zh-CN-XiaoxiaoNeural";
  }
  if (!speechVoices["mlx-audio"].some((v) => v.id === voice))
    throw Error("不支持的本地声音");
  return voice;
}
