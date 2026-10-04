import { z } from "zod";

export const aiSections = [
  {
    id: "llm",
    title: "对话与 Agent",
    description:
      "清单整理、听写对话、讲解和答案对齐共用此模型。模型需支持工具调用；不设置输出 token 上限或推理强度。",
  },
  {
    id: "vision",
    title: "图片文字识别",
    description:
      "腾讯高精度识别保留词表行列；兼容接口用于图片转文字。图片页可临时选择另一服务。",
  },
  {
    id: "tts",
    title: "语音朗读",
    description:
      "选择默认朗读服务。声音、语速和重复次数仍可在每次听写的设置中调整。",
  },
  {
    id: "tencent",
    title: "腾讯云凭据",
    description: "图片识别、腾讯语音识别和腾讯手写识别共用这组凭据。",
  },
  {
    id: "asr",
    title: "语音识别",
    description: "把麦克风录音转写成文字，再交给听写 Agent 理解。",
  },
  {
    id: "handwriting",
    title: "手写批改",
    description:
      "负责识别手写原文。与标准答案的对齐使用上方对话模型，最终结果仍需核查。",
  },
  {
    id: "runtime",
    title: "本地语音依赖",
    description:
      "这些程序运行在网页服务器所在的电脑上。填可执行文件路径，不要填写命令参数。",
  },
] as const;
export type AISection = (typeof aiSections)[number]["id"];
type Field = {
  section: AISection;
  label: string;
  kind: "text" | "url" | "secret" | "select" | "path";
  default?: string;
  options?: readonly (readonly [string, string])[];
  hint?: string;
};
const compatible = [["openai-compatible", "OpenAI 兼容接口"]] as const;
const cloudOptions = [["tencent", "腾讯云"], ...compatible] as const;
export const aiFields = {
  LLM_PROVIDER: {
    section: "llm",
    label: "接口协议",
    kind: "select",
    default: "openai-compatible",
    options: compatible,
  },
  LLM_BASE_URL: {
    section: "llm",
    label: "服务地址（Base URL）",
    kind: "url",
    hint: "例如 https://token.sensenova.cn/v1，不含 /chat/completions。",
  },
  LLM_MODEL: {
    section: "llm",
    label: "模型名称",
    kind: "text",
    hint: "填写供应商的完整模型 ID。",
  },
  LLM_API_KEY: { section: "llm", label: "API Key", kind: "secret" },
  LLM_TOOL_CHOICE: {
    section: "llm",
    label: "工具选择策略",
    kind: "select",
    default: "auto",
    options: [
      ["auto", "自动选择（推荐）"],
      ["required", "强制工具调用"],
    ],
    hint: "自动模式兼容 DeepSeek 思考模式；仅在服务明确支持时使用强制模式。",
  },
  VISION_PROVIDER: {
    section: "vision",
    label: "默认识别服务",
    kind: "select",
    options: cloudOptions,
  },
  VISION_BASE_URL: {
    section: "vision",
    label: "兼容接口地址",
    kind: "url",
    hint: "使用腾讯识别时，这组兼容接口配置作为备用保留。",
  },
  VISION_MODEL: { section: "vision", label: "图片识别模型", kind: "text" },
  VISION_API_KEY: {
    section: "vision",
    label: "图片识别 API Key",
    kind: "secret",
  },
  TTS_BACKEND: {
    section: "tts",
    label: "默认朗读服务",
    kind: "select",
    default: "edge-tts",
    options: [
      ["edge-tts", "Edge 在线语音"],
      ["mlx-audio", "本地 MLX / Qwen3-TTS"],
    ],
  },
  TTS_BASE_URL: {
    section: "tts",
    label: "本地语音服务地址",
    kind: "url",
    hint: "例如 http://127.0.0.1:8765。保存地址不会启动或下载模型。",
  },
  TTS_API_STYLE: {
    section: "tts",
    label: "本地服务接口类型",
    kind: "select",
    default: "mlx-openai",
    options: [
      ["mlx-openai", "MLX-Audio 官方接口"],
      ["project-wrapper", "项目 FastAPI 包装服务"],
    ],
  },
  TTS_MODEL_ID: {
    section: "tts",
    label: "本地模型 ID",
    kind: "text",
    hint: "需与本地服务已加载的模型一致。模型大小和量化规格由 ID 决定。",
  },
  TTS_SERVICE_TOKEN: {
    section: "tts",
    label: "本地服务访问令牌",
    kind: "secret",
  },
  TENCENT_SECRET_ID: { section: "tencent", label: "SecretId", kind: "secret" },
  TENCENT_SECRET_KEY: {
    section: "tencent",
    label: "SecretKey",
    kind: "secret",
  },
  TENCENT_REGION: {
    section: "tencent",
    label: "地域",
    kind: "text",
    default: "ap-guangzhou",
    hint: "例如 ap-guangzhou，按已开通服务填写。",
  },
  TENCENT_ASR_ENGINE: {
    section: "asr",
    label: "腾讯一句话识别引擎",
    kind: "text",
    default: "16k_zh",
    hint: "填写腾讯支持的引擎名，例如普通中文 16k_zh。",
  },
  ASR_PROVIDER: {
    section: "asr",
    label: "语音识别服务",
    kind: "select",
    default: "tencent",
    options: cloudOptions,
  },
  ASR_BASE_URL: {
    section: "asr",
    label: "兼容接口地址",
    kind: "url",
    hint: "兼容接口需支持 /audio/transcriptions。",
  },
  ASR_MODEL: { section: "asr", label: "语音识别模型", kind: "text" },
  ASR_API_KEY: { section: "asr", label: "语音识别 API Key", kind: "secret" },
  HANDWRITING_PROVIDER: {
    section: "handwriting",
    label: "手写识别服务",
    kind: "select",
    default: "tencent",
    options: cloudOptions,
  },
  HANDWRITING_BASE_URL: {
    section: "handwriting",
    label: "兼容接口地址",
    kind: "url",
    hint: "兼容接口需支持图片输入与 JSON 输出。",
  },
  HANDWRITING_MODEL: {
    section: "handwriting",
    label: "手写识别模型",
    kind: "text",
  },
  HANDWRITING_API_KEY: {
    section: "handwriting",
    label: "手写识别 API Key",
    kind: "secret",
  },
  EDGE_TTS_PYTHON: {
    section: "runtime",
    label: "Edge TTS Python 路径",
    kind: "path",
    default: "python3",
    hint: "需已安装 edge-tts，例如 services/edge/.venv/bin/python。",
  },
  FFMPEG_PATH: {
    section: "runtime",
    label: "FFmpeg 路径",
    kind: "path",
    default: "ffmpeg",
    hint: "留空或填 ffmpeg 时从服务器 PATH 查找。",
  },
} as const satisfies Record<string, Field>;
export type AIKey = keyof typeof aiFields;
export const aiKeys = Object.keys(aiFields) as AIKey[];
export const secretKeys = aiKeys.filter(
  (key) => aiFields[key].kind === "secret",
);
export type AIValues = Record<AIKey, string>;
export type AIPatch = Partial<Record<AIKey, string | null>>;
export type PublicAISettings = {
  revision: string;
  values: Partial<Record<AIKey, string>>;
  inheritedValues: Partial<Record<AIKey, string>>;
  secrets: Partial<Record<AIKey, boolean>>;
  inheritedSecrets: Partial<Record<AIKey, boolean>>;
  overridden: AIKey[];
};

const fieldSchemas = Object.fromEntries(
  aiKeys.map((key) => {
    const field: Field = aiFields[key];
    const schema = z
      .string()
      .trim()
      .max(field.kind === "secret" ? 12000 : 2000)
      .refine(
        (value) => !/[\u0000-\u001f\u007f]/.test(value),
        `${field.label}不能包含换行或控制字符`,
      )
      .refine((value) => {
        if (!value) return field.kind !== "select";
        if (field.options)
          return field.options.some(([option]) => option === value);
        if (field.kind === "url") {
          try {
            const url = new URL(value);
            return (
              ["https:", "http:"].includes(url.protocol) &&
              !url.username &&
              !url.password &&
              !url.hash &&
              !url.search
            );
          } catch {
            return false;
          }
        }
        if (field.kind === "path") {
          const name = value.split(/[\\/]/).at(-1) || "";
          return key === "FFMPEG_PATH"
            ? /^ffmpeg(?:\.exe)?$/.test(name)
            : /^python(?:3(?:\.\d+)?)?(?:\.exe)?$/.test(name);
        }
        return true;
      }, `${field.label}格式不正确`);
    return [key, schema.nullable().optional()];
  }),
) as Record<
  AIKey,
  z.ZodOptional<z.ZodNullable<z.ZodString | z.ZodType<string>>>
>;
export const aiPatchSchema = z.object(fieldSchemas).strict();
export const aiSaveSchema = z
  .object({
    revision: z.string().min(1).max(120),
    changes: aiPatchSchema,
    reuseSecrets: z
      .array(z.enum(aiKeys as [AIKey, ...AIKey[]]))
      .max(aiKeys.length)
      .default([]),
  })
  .strict();

export const endpointSecrets = {
  LLM_BASE_URL: "LLM_API_KEY",
  VISION_BASE_URL: "VISION_API_KEY",
  ASR_BASE_URL: "ASR_API_KEY",
  HANDWRITING_BASE_URL: "HANDWRITING_API_KEY",
  TTS_BASE_URL: "TTS_SERVICE_TOKEN",
} as const;
export function differentOrigin(a: string, b: string) {
  if (!a || !b) return false;
  try {
    return new URL(a).origin !== new URL(b).origin;
  } catch {
    return false;
  }
}

export function inheritedAIValues(
  environment: Record<string, string | undefined>,
): AIValues {
  const result = Object.fromEntries(
    aiKeys.map((key) => [
      key,
      environment[key]?.trim() || (aiFields[key] as Field).default || "",
    ]),
  ) as AIValues;
  if (!result.VISION_PROVIDER)
    result.VISION_PROVIDER =
      result.TENCENT_SECRET_ID && result.TENCENT_SECRET_KEY
        ? "tencent"
        : "openai-compatible";
  return result;
}
