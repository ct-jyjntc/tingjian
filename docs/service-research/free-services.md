# 智能听写免费服务调查与实测

> 历史记录：后续已接入腾讯云、SenseNova 和 Edge，当前状态见 [最新接入验证](../integration/verification.md)。
> 核验日期：2026-10-02。按图片识别、TTS、ASR、内容整理/解释、手写识别/批改五类覆盖主流候选。免费政策可能调整，不能保证列尽整个互联网；以下区分每月/每日免费额度、一次性试用、非官方工具。没有密钥的服务只核验官方文档，没有宣称已调用成功。

## 先给出选择建议

- **正式的中文云 TTS 首选候选：Azure Speech F0**。每月 50 万字符；同时有实时 ASR 每月 5 小时。需要注册账号、创建相应免费层资源和密钥，尚未实测延迟。不要把 Azure 的免费层等同于所有语音产品免费。
- **个人听写的免申请密钥候选：edge-tts**。本轮中文/英文分别真实生成成功，约 1.65 / 1.05 秒。但它是第三方对 Edge 在线朗读的封装，不是微软承诺给开发者的永久免费 API，没有可依赖的服务保证，不宜成为正式产品唯一后端。
- **国内 ASR 候选：腾讯云普通版一句话识别**，每月 5,000 次，适合短口令；普通实时识别每月 5 小时。大模型版和跨境版不能套用这个额度。
- **OCR 暂时不必因速度替换现有讯飞**：本图讯飞 1.44 秒、OCR.space 3.02 秒。OCR.space 的优点是保留四列表格的分隔与坐标，更容易还原词对。
- **国内内容整理候选：硅基流动控制台标为免费的对话模型**。官方确认实名认证后免费模型按固定限流使用；本轮未取得你账号内可用的具体免费模型 ID，不填写猜测的 ID，也不声称其 TTS/ASR 都免费。
- **独立手写识别候选：腾讯云通用手写体 OCR**，每月 1,000 次；英文单词听写可在识别后由本应用确定性比对，再人工核查。它和一次性试用的“中英文手写作文识别”“作文批改 Agent”不是同一产品。
- **海外 LLM/多模态候选：Groq、OpenRouter 免费模型、Gemini 免费层**。具体模型、地区、限流与隐私规则需分别确认。

这些方案尚未自动替换应用默认后端。本轮只做资料核验及独立实测；没有注册账号、开通计费或填入临时演示密钥充当生产配置。

## 有按月/按日免费额度或免费模型的候选

| 服务                                                                                        | 能覆盖什么                            | 本轮查到的免费政策                                                                                                  | 条件、限制及本轮验证状态                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Azure Speech](https://azure.microsoft.com/en-us/pricing/details/speech/)                   | TTS、ASR                              | F0 Neural TTS **50 万字符/月**；实时 STT **5 小时/月**                                                              | 需账号、免费层资源、密钥；标准/自定义 STT 共享 5 小时，Batch 不支持免费额度；未调用                                                                                                        |
| [Azure Vision](https://azure.microsoft.com/en-us/pricing/details/computer-vision/)          | OCR / Read 等视觉功能                 | F0 每月 **5,000 transactions**、每分钟 **20 次**                                                                    | 需创建可用地区的免费资源；定价页提示部分地区不可用，具体 API 版本及手写语言支持须另核查；未调用                                                                                            |
| [Google Cloud TTS](https://cloud.google.com/text-to-speech/pricing)                         | 中英文 TTS                            | 当前表格 Standard / WaveNet **400 万字符/月**；Neural2、Chirp 3 HD 等各自对应 **100 万字符/月**                     | 必须启用 billing，超额度会收费；按对应 SKU 统计，不是任意模型通用免费池；未调用                                                                                                            |
| [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text/pricing)              | ASR                                   | **V1** 标准模型前 **60 分钟/月**免费                                                                                | 不应写成所有 V2 模型也有 60 分钟免费；需项目及鉴权；未调用                                                                                                                                 |
| [Google Cloud Vision](https://cloud.google.com/vision/pricing)                              | 印刷/文档 OCR、手写提取               | 每种相应功能每月前 **1,000 units** 免费                                                                             | 按功能调用计量，不保证一张图片多功能只算一次；不是完整批改器；未调用                                                                                                                       |
| [Gemini Developer API](https://ai.google.dev/gemini-api/docs/pricing)                       | LLM、图片理解、手写核查候选、部分 TTS | 官方列出的部分模型有输入/输出免费层；例如 Gemini 2.5 Flash 和 Flash Preview TTS 的相应 Standard 免费列              | 不是所有 Gemini 模型、Batch 或 Pro TTS 都免费；限额看项目。免费内容可用于改进产品。有[支持地区限制](https://ai.google.dev/gemini-api/docs/available-regions)，本轮列表不含中国大陆；未调用 |
| [Groq](https://console.groq.com/docs/rate-limits)                                           | Whisper ASR、LLM、英文 TTS            | Whisper v3 / turbo 当前免费表为 **20 RPM、2,000 RPD、7,200 音频秒/小时、28,800 秒/日**，多项限制同时适用            | 需 Groq Key；中文 ASR 可以选多语种 Whisper，但本轮未用真人口令实测。当前 TTS 文档列出[英文和沙特阿拉伯语 Orpheus](https://console.groq.com/docs/text-to-speech)，不能用于替换中文 TTS      |
| [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/)     | ASR、LLM、部分多模态/TTS              | **10,000 Neurons/日**免费                                                                                           | 不同模型消耗不同，不能换算为统一 1 万次请求；需账号 ID 与 API Token；免费计划达到限额后不可继续。当前 Aura 英文/西文语音不能默认当中文语音；未调用                                         |
| [OpenRouter](https://openrouter.ai/docs/api-reference/limits)                               | LLM、部分免费多模态模型               | `:free` 模型变体有受限免费调用                                                                                      | 需 Key；RPM/RPD 有账户分档，当前静态页面中的动态数值未可靠取得，因此不抄旧教程的固定 50/1,000 次数字。本轮已读取公开模型目录，见下文；未生成推理结果                                       |
| [OCR.space](https://ocr.space/ocrapi)                                                       | 印刷体/表格 OCR                       | 免费计划 **25,000 请求/月、每 IP 500 请求/日、单文件 1 MB**；免费 Engine 3 另有 2,500 次限制                        | 正式使用需免费注册 Key；本轮使用官方文档公开的 demo key 验证 Engine 2 成功。免费通用引擎不能直接承诺适合手写；无免费 SLA                                                                   |
| [硅基流动](https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation)      | 免费模型中可用的 LLM 等               | 实名认证后可用免费模型，免费模型调用消耗为 0，固定 Rate Limits                                                      | 具体模型和限额在账户模型页；“平台有免费模型”不等于全部对话/视觉/TTS/ASR 免费；未调用                                                                                                       |
| [腾讯云 ASR](https://cloud.tencent.com/document/product/1093/35686)                         | 中文短口令/实时 ASR                   | 普通版：一句话 **5,000 次/月**；实时 **5 小时/月**；录音文件 **10 小时/月**；极速版和语音流异步各对应 **5 小时/月** | 大模型/跨境等表格列“无”的产品不享有以上额度；新用户后付费默认关闭，确认控制台状态；未调用                                                                                                  |
| [腾讯云 OCR](https://cloud.tencent.com/document/product/866/35945)                          | 印刷体、通用手写、英文、表格 OCR      | 对应常用接口 **1,000 次/月**，部分多个接口共享资源包                                                                | “通用手写体”每月额度与“中英文手写作文识别”一次性资源不同；需腾讯 Key、签名适配；未调用                                                                                                     |
| [百度 OCR](https://ai.baidu.com/tech/ocr/general)                                           | 印刷 OCR；另有手写产品                | 官方产品页写明公有云 API **最高 2,000 次/月免费测试资源**                                                           | “最高”不能视为每个接口均有 2,000 次，也不能据此承诺手写模型同额；具体已开通接口及限制待控制台确认；未调用                                                                                  |
| [Cartesia](https://www.cartesia.ai/pricing)                                                 | TTS、ASR                              | Free **20K credits/月**，共用额度；页面折算 Sonic-3.6 约 27 分钟 TTS，或 Ink-2 约 1 小时 51 分钟 STT                | 这两个时长不能同时全额使用；免费 TTS 并发 2。商业使用许可列在 Pro。官方[Sonic 文档](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest)列中文支持；未调用、未测中国网络延迟    |
| [ElevenLabs API](https://elevenlabs.io/pricing/api)                                         | TTS、ASR                              | 当前 Free / Pay as you go 列：Multilingual TTS **10,000 字符**，Flash/Turbo **20,000 字符**；其他音频产品按各自表格 | 页面已采用美元 API 计费，不继续套用老教程的“统一 10K credits”。商业许可和各项免费用量重置规则应在账户套餐中再确认；未调用                                                                  |
| [Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers/pricing) | 供应商支持的文本、图片、语音等        | Free Users **$0.10/月**，官方注明可调整                                                                             | 很小的体验额度，不适合当长期主力；账户与 HF Token 必需，额外用量需购买 credits；未调用                                                                                                     |

免费 OCR / 视觉模型负责提取和核查，不等于完整的“批改服务”。仍需按本次听写顺序对齐，无法辨认保持待确认，用户确认后才计错。

## 只有一次性试用，或免费条件尚不能确认的服务

| 服务                                                                         | 官方说明                                                                                                          | 结论                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [AWS Polly](https://aws.amazon.com/polly/pricing/)                           | 官方页列出旧的限期字符额度，同时说明 2025-07-15 起新用户最高 $200 credits，免费计划 6 个月、credits 最长 12 个月  | 按账号创建时间适用政策；不能把旧的字符额度当作新账户永久免费；未调用          |
| [腾讯云 TTS](https://cloud.tencent.com/document/product/1073/34112)          | 基础/精品音色 **800 万字符**；大模型音色 **10 万**；超自然音色 **2 万**；控制台领取，**一个账号一次，3 个月有效** | 可先试用，不是每月永久免费；适合核查国内访问延迟，但本轮没有 Key，未调用      |
| [阿里云智能语音交互](https://help.aliyun.com/zh/isi/getting-started/pricing) | 新用户 **3 个月免费试用**，有限并发，试用仅支持部分语音服务                                                       | 不能当作永久免费 TTS/ASR；尤其不能把试用版额度直接用于所有 CosyVoice/流式模型 |
| [Deepgram](https://deepgram.com/pricing)                                     | **$200 免费 credit**，用完按量付费，页面写明不需信用卡、无到期日                                                  | 不按月补充，属于一次性赠金；未调用                                            |
| [Cerebras](https://inference-docs.cerebras.ai/support/rate-limits)           | 验证支付方式后 **$5 / 30 天**试用；官方 FAQ 明确当前没有永久免费层                                                | 旧的“永久免费”推荐已经不可靠；未调用                                          |
| [AssemblyAI](https://www.assemblyai.com/pricing)                             | 页面提供 Start free，但本轮未核实当前赠金额和有效期                                                               | 不把旧的 $50/小时宣传抄作确认值；需控制台确认；未调用                         |
| [百度语音合成](https://ai.baidu.com/tech/speech/tts)                         | 本轮官方产品页未直接给出足以确认长期免费额度的条款                                                                | 可作为候选，当前不列为已确认的永久免费服务                                    |

## 不需要云账号的替代方式

| 方式                                                    | 本轮实测                                                        | 定位                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [edge-tts](https://github.com/rany2/edge-tts)           | Xiaoxiao 中文 1.650 秒，Aria 英文 1.052 秒，均成功生成 MP3      | 第三方封装 Edge 在线朗读，无需自己申请 Key；依赖非正式开发者接口、网络及服务策略，可用性不能保证           |
| macOS 系统语音（Tingting / Samantha）                   | 中文 1.549 秒、英文 1.002 秒，包含 `say` 进程启动及完整文件生成 | 不用 Qwen、无需 API 费用；不是在线服务。可通过电脑后端提供给手机，但浏览器原生语音在不同设备声音与能力不同 |
| 浏览器 SpeechSynthesis / SpeechRecognition              | 本轮未做设备级验证                                              | TTS 可使用设备声音；ASR 的浏览器支持、在线依赖和服务保障不统一，不能当作稳定的免费云 ASR                   |
| Tesseract / PaddleOCR / Whisper / Kokoro 等开源本地模型 | 本轮未下载或跑新模型                                            | 无每次 API 费用，但有本机计算成本；“开源”不等于供应商提供免费托管服务，声音/模型授权需独立核对             |

这些替代方式都没有被静默替换进原来的应用。Edge 音频样本：[中文](edge-tts-chinese.mp3)、[英文](edge-tts-english.mp3)。时延是该次“完整音频文件生成”墙钟时间，不是首包延迟，也不是长期平均值。当前网页也在收到完整音频后播放，后续若追求更快开口，还应考虑真正的流式音频播放。

## 使用你指定图片的真实结果

输入文件：`/Users/luna/Downloads/微信图片_20261002132758_11_2.jpg`，约 186 KB，四列英语不规则动词表。人工逐行核对：左侧 25 组、右侧 22 组，共 **47 组**。它是印刷体图片，不能验证手写能力。

| 项目            | 讯飞 xoppaddleocrv16（现有配置）                   | OCR.space Engine 2（公开 demo 验证）                                  |
| --------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| HTTP / 处理状态 | 200，返回识别文本                                  | 200，OCRExitCode=1，无处理错误                                        |
| 请求到完整响应  | **1.441 秒**                                       | **3.018 秒**                                                          |
| 词对覆盖        | 忽略大小写及标点后，47 组都可在文本中找到          | 可按制表符解析出 47 组；严格大小写/标点一致 46/47，标准化后一致 47/47 |
| 版面            | 每一行左右两组连在一起，需额外拆分                 | 保留四列制表符，提供文字坐标                                          |
| 实际差异        | `learnt, learned` 逗号丢失；未直接返回 47 条独立项 | `learnt, learned` 返回 `Learnt, learned`，有首字母大小写差异          |
| 手写有效性      | 不能从此样本判断                                   | 不能从此样本判断                                                      |

这里的覆盖和一致性是与人工标注比较的结果，**不是模型提供的置信度**，也不代表所有课本图都能达到这个效果。OCR.space 官方示例的公共 key 仅用来验证，不会写入应用生产配置。

原始返回和对照依据：

- [讯飞响应](ocr-user-image.json)
- [OCR.space 完整响应与坐标](ocrspace-user-image.json)
- [OCR.space 纯文本](ocrspace-user-image.txt)
- [人工核对的 47 组词对](expected-pairs.json)
- [对比统计](image-comparison.json)
- [Edge TTS 测量](edge-tts-benchmark.json)
- [系统 TTS 测量](system-tts-benchmark.json)

当前 8765 MLX 服务健康检查已无法连接，生成请求返回 503，所以本轮没有有效的新 Qwen 延迟；前一轮成功生成的时间不能拿来当同条件对照。本轮没有重启或停止用户的模型服务。

## 已取得的免费多模态模型目录

本轮直接读取 [OpenRouter 公开模型目录](https://openrouter.ai/api/v1/models)，筛选输入和输出标价均为 0、ID 以 `:free` 结尾的条目。例如：

- `qwen/qwen3.8-27b:free`：目录声明 text/image/video 输入及 structured_outputs。
- `dots-studio/dots-3-note-preview:free`：目录声明 text/image 输入及 structured_outputs。
- `google/gemma-4-26b-a4b-it:free`：目录声明 image/text/video 输入。

这些是**目录可见**，尚未用你的 API Key 实际调用；支持图片也不代表已验证手写识别可靠。完整筛选结果在 [openrouter-free-models.json](openrouter-free-models.json)。

## 与当前应用的接入关系

- Groq ASR、OpenRouter/硅基流动兼容对话服务可优先复用现有适配层，但必须使用对应模型自己的 Key 与官方接口参数。
- Azure、腾讯、Google Cloud、OCR.space、Cartesia、ElevenLabs 需要相应的专用适配器，不能只替换 Base URL 就假定兼容现有 MLX 接口。
- 选云 TTS 后应保留显式服务选择，显示是否联网及当前可用状态；不以免费的名义偷偷改用别的服务。
- 批改仍沿用：手写识别 → 本次顺序对齐 → 标准答案比较 → 人工确认。不确定结果不自动判错。
