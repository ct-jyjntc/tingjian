import "server-only";
import { getAISetting } from "./ai-settings-server";
import { chat } from "./server";
import { recognizePrinted } from "./tencent-server";
import { buildMaterial, type ContentMode } from "./materials";
export async function readMaterial(
  image: string,
  source: string,
  mode: ContentMode,
  signal: AbortSignal,
  provider?: "tencent" | "xfyun",
) {
  const chosen =
    provider ||
    (getAISetting("VISION_PROVIDER") === "tencent" ? "tencent" : "xfyun");
  if (chosen === "tencent")
    return buildMaterial({
      source,
      provider: "tencent-layout",
      blocks: await recognizePrinted(image, signal),
      mode,
    });
  const text = await chat(
    "VISION",
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请提取图片中的所有文字。仅输出识别到的纯文本内容，按原始段落与换行顺序排列，不要添加任何解释或 Markdown 格式。",
          },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ],
    false,
    signal,
  );
  return buildMaterial({
    source,
    provider: "xfyun-text",
    text,
    blocks: text
      .split("\n")
      .map((text, i) => ({ id: `line-${i + 1}`, text }))
      .filter((v) => v.text.trim()),
    mode,
  });
}
