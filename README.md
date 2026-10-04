# 听见 · AI 智能听写

Next.js / React / TypeScript 全栈应用。图片圈选后默认由腾讯高精度 OCR 保留文字位置，SenseNova 学习助手调用工具准备清单，用户确认后由 Edge 在线语音或电脑上的 MLX-Audio Qwen3-TTS 逐项朗读。朗读结束只等待用户，最后一项也必须明确确认才完成。

## 微信小程序（个人主体、免费版）

新增原生微信小程序，复用现有 AI 服务，支持微信登录、账号隔离、跨设备学习记录、拍照识别、听写对话和核查错词。所有功能免费，不包含收款、会员或充值；每日 AI 额度用于防滥用。

```bash
npm run mini:typecheck
npm run mini:build
# 用微信开发者工具导入本项目根目录
```

配置、部署、使用边界及注册进展见 [小程序说明](docs/miniprogram/README.md)。小程序必须使用真实 AppID 和可用的 HTTPS 服务域名，当前代码交付不代表已审核发布。

## 新版学习空间与听写对话

- 前端采用奶油白、鸢尾蓝与杏黄，首页书页插画、真实练习进度、历史和错词入口统一重构，适配桌面、平板和手机。
- 听写中的对话搭档支持文字及主动开启麦克风后的自然表达。ASR 转写送交独立的听写 Agent，模型通过 `control_dictation`、`explain_current_item`、`respond_to_student` 选择单次操作或回应，并保留当前词的对话上下文。
- 只有等待状态可以进入下一项；结束仍需确认。换题、按钮操作、取消请求或退出页面会使旧回复失效。模型不能直接写入进度，最终由现有状态机执行；普通对话不向模型主动提供当前答案。
- 解释按标题、正文与分段卡片显示，清理 Markdown 标记，支持自动朗读、停止与重听。长讲解分段完整发送到 TTS，不截断模型正文。讲解与词语朗读互斥，停止后释放音频资源，扬声器回声不能推进题目。
- 应用不设置模型输出 token 上限，也不覆盖默认推理设置。模型仍可能输出错误知识，讲解会提示对照课本核查。

验证和使用边界见 [前端与对话验证](docs/frontend/verification.md)。

## 混合架构与词表

- 程序保存原始 OCR 文字、文字框、行列和来源。英文词表按单词生成独立项，括号、逗号里的多个词形分别拆开；短语和句子支持保持完整。
- 学习助手使用真实 function calling。程序先提供材料概览，助手按要求调用 `prepare_dictation`；更细的筛选和提示/答案配对使用 `select_passages`，后端逐字核验来源。需要时可调用 `inspect_material` 查看完整文字框、`recognize_source` 重新识别选区。
- 只有选择“AI 辅助出题”时才允许 `propose_exercises`，新增项目保留 AI 标记。任何提案均需确认，可撤销；工具不能播放音频或修改听写进度。
- 取消任务后不会应用迟到结果；处理期间修改了清单会阻止旧草稿覆盖编辑。旧版乱码和疑似整行串读需要重建或人工核查后才能试听、开始听写。
- “按列快捷整理”直接使用真实列坐标，服务限流时仍可使用。它会明确标注没有请求 AI，不假装为模型返回。原文及重复项默认保留。

本轮验证见 [混合架构验证记录](docs/hybrid/verification.md)。重复真实集成检查（会调用已配置服务，限流时以非零状态退出）：

```bash
node --env-file=.env.local scripts/check-hybrid.mjs /绝对路径/不规则动词词表.jpg
```

## 本机启动

需要 Node.js 22+、Python 3.11+ 和 FFmpeg。当前默认使用 Edge 在线语音，原有 `http://127.0.0.1:8765` 本地 TTS 配置保留，可在听写设置中切换；选择本地时须自行启动已有服务。

```bash
npm install
python3 -m venv services/edge/.venv
services/edge/.venv/bin/pip install -r services/edge/requirements.txt
# 新部署才执行复制；不要覆盖已有 .env.local
cp .env.example .env.local
# 启动后在网页“服务与设置”里填写 AI 配置，也可使用环境变量
npm run dev
```

访问 http://localhost:3000 。生产运行：

```bash
npm run build
npm start
```

`.env.local` 与 `.local/` 均已加入忽略规则；示例不含真实密钥。模型密钥在“AI 服务配置”中填写后保存在服务器私有文件中，不回传现有明文密钥，也不存入浏览器学习记录。页面“应用访问口令”只接受自设的 `APP_ACCESS_TOKEN`，不要在那里填写模型密钥。

## 网页 AI 配置

进入“服务与设置 → AI 服务配置”，可编辑以下 7 组配置：

- 对话与 Agent：兼容接口地址、模型 ID、API Key、工具选择策略。
- 图片文字识别：默认腾讯或兼容接口、备用接口地址、模型和密钥。
- 语音朗读：默认 Edge 或 MLX、MLX 地址、接口类型、模型 ID、服务令牌。
- 腾讯云：SecretId、SecretKey、地域。
- 语音识别：腾讯或兼容接口、腾讯引擎、兼容接口地址、模型和密钥。
- 手写批改：腾讯或兼容接口、模型地址、模型和密钥。
- 本地依赖：Edge TTS Python 和 FFmpeg 可执行文件路径。

网页修改保存到 `.local/ai-settings.json`，目录权限 700、文件权限 600，优先于对应环境配置；不会改写 `.env.local`。保存后新请求直接生效，无需重启。进行中的请求固定使用开始时的配置，音频缓存按配置版本更新。已有听写仍保留启动时的声音等选项。

已配置密钥显示状态，留空保持不变；替换时填写新值，清除需勾选“清除已保存密钥”。“恢复本组环境配置”会撤销该组网页覆盖，保存后生效。更换服务域名时需要新密钥或明确选择沿用。多页面编辑存在版本冲突时拒绝覆盖，需重新载入。

可测试已保存的对话模型、试听已保存的朗读服务。测试会实际调用服务。其他识别功能按保存的凭据在使用时验证；“已配置”不等于已成功调用。

工具选择默认 `auto`，兼容 DeepSeek 思考模式；只有服务支持时才选 `required`。不设置输出 token 上限、不覆盖默认推理强度。思考模型工具循环所需的 `reasoning_content` 只在服务端原样续传，不显示给用户。

本地模型需由外部语音服务加载；修改模型 ID 不会安装、下载或重启模型服务。应用访问口令与网络监听属于部署配置，继续使用 `APP_ACCESS_TOKEN`，不通过 AI 设置页修改。

验证记录见 [网页 AI 配置验证](docs/ai-settings/verification.md)。

## 当前服务接入

- TTS：默认 Edge 在线语音，支持晓晓、云希、Aria、Guy 和按语言自动选择，联网文字传输在设置页明确说明。`services/edge/synthesize.py` 仅生成音频，无模型下载。`EDGE_TTS_PYTHON` 指向安装了 edge-tts 的 Python，使用环境变量避免构建器打包本机 Python 虚拟环境。仍可显式选择 MLX-Audio。
- ASR：腾讯官方 Node.js SDK `SentenceRecognition`，普通 `16k_zh` 引擎。浏览器音频经 FFmpeg 转 16 kHz 单声道 PCM，按 SDK 文档提交原始字节长度及 Base64。取消信号传递至 SDK 请求。
- 内容整理、解释、复杂意图：SenseNova `sensenova-6.8-flash-lite`，官方 `https://token.sensenova.cn/v1/chat/completions`、Bearer 鉴权、JSON 模式。应用不设置最大输出 tokens，也不覆盖模型的默认推理设置。服务端偶有 429，保留原清单并支持重试。
- 手写 OCR：腾讯 `GeneralHandwritingOCR`。SenseNova 只输出行 ID 与答案索引的匹配关系，后端从腾讯原文重建识别答案，不采纳模型改写的答案。低置信度（腾讯真实返回值 < 80）、重复使用一行或无唯一对应时要求人工核查；80 是应用复核阈值，不是模型判错规则。
- 对齐服务失败时保留已经识别的原始文字，返回待确认项，避免重试丢失 OCR 结果。
- 服务状态页区分字段已配置和带时间戳的“最近调用成功”。后者不是持续联网监控；进程重启后需再次实际调用才有成功记录。

密钥从用户提供的腾讯 CSV 和 SenseNova 配置导入 `.env.local`。没有把 CSV 或密钥复制到公开页面。腾讯 SDK 的 uuid 依赖固定覆盖到兼容的 11.1.1+（SDK 只使用 `v4()`），修复上游仍引用 uuid 9 的审计问题。

最新接入与限制见 [docs/integration/verification.md](docs/integration/verification.md)。

## 可选的本地 TTS

当前服务的实际模型列表返回：

`mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit`

后端使用该服务的 `GET /v1/models` 检查模型是否加载，并通过 `POST /v1/audio/speech` 请求 WAV，使用其 OpenAPI 中的 `model`、`input`、`voice`、`lang_code`、`response_format`、`stream` 字段。这不是凭兼容性猜测的路径。服务的 `/v1/audio/voices` 对该 Qwen 模型返回空列表；声音选项采用 MLX-Audio 官方 Qwen 文档中的 CustomVoice 预设：Vivian、Serena、Ryan、Aiden、Uncle_Fu、Dylan、Eric。

中文使用 Chinese，英文 English，混合 Auto。发音配置是完整替代朗读文本，标准答案不受影响；可以用同音字消除多音字歧义。

Qwen 不直接保证 speed 参数生效，所以对已有服务固定请求原速，再用 **FFmpeg atempo** 做保持音调的时长变换。需安装 `ffmpeg` 并加入 PATH，或设置 `FFMPEG_PATH`。原速不依赖 FFmpeg；缺失时变速明确报错。

网页后端限制并发、按模型/服务地址/文本/语言/声音/语速/发音缓存音频（内存最多约 64 MB）。客户端最多缓存 30 段，自动预生成下一项，不自动播放。正在运行的 MLX 推理不强制杀死：取消后丢弃旧播放结果，已进入推理的任务可完成并写缓存；排队中已取消任务不会开始。不会静默改用浏览器朗读或云 TTS。

## 备用独立 Python 服务

`services/tts/server.py` 是项目自有 FastAPI 包装层，使用官方 `load_model` / `generate_custom_voice` Python 调用；**不是 MLX-Audio 官方 HTTP 路径**。已部署 8765 时不需要运行。

Apple Silicon + Python 3.11+：

```bash
python3 -m venv services/tts/.venv
services/tts/.venv/bin/pip install -r services/tts/requirements.txt
export TTS_MODEL_ID=mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit
export TTS_SERVICE_TOKEN='自己设置的服务口令'
services/tts/.venv/bin/uvicorn services.tts.server:app --host 127.0.0.1 --port 8766
```

然后网页后端设置 `TTS_BASE_URL=http://127.0.0.1:8766`、`TTS_API_STYLE=project-wrapper` 和相同 `TTS_SERVICE_TOKEN`。首次使用从 Hugging Face 下载模型；健康接口 `/health` 区分 loading、ready、error。`/synthesize` 单线程加载/推理，限制队列并合并相同请求，用 librosa 保持音调变速。音频缓存目录 `services/tts/cache` 最多 256 个 / 7 天，删除该目录可清除缓存。进程必须绑定 loopback，不要暴露到公网。

## 所有服务配置

`.env.example` 列出完整字段。腾讯两项服务使用 `ASR_PROVIDER=tencent`、`HANDWRITING_PROVIDER=tencent` 和共用的 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`；需要开通普通一句话识别、通用手写体识别。LLM 使用 `LLM_*`。TTS 默认 `TTS_BACKEND=edge-tts`，而每次听写保存自身的服务选择，缓存也按后端隔离。

如替换为其他经确认兼容的服务，可将 ASR/HANDWRITING 的 PROVIDER 改为 `openai-compatible`，并设置该前缀的 BASE_URL、MODEL、API_KEY。不能把任意地址只改 Base URL 就视作兼容。手写 OCR 与解释/对话始终分工明确。

OCR 保留原始文本和用户提供的默认提示词，未伪造置信度。SenseNova、腾讯及 Edge 的费用、额度或接口可用性由服务方决定；应用不会自动开通后付费或切换到其他供应商。

## 功能与使用

首页拍照、上传或直接输入会开启新清单；关闭页面后保存的草稿通过“继续编辑清单”恢复。需要在当前清单追加图片时，在图片处理页点击“添加图片”。同一张图片重复添加不会增加副本，重新识别会替换该图全部旧选区的条目和原始识别记录，支持撤销；历史听写和错词本独立保留。文件内容摘要在 HTTPS / localhost 下提供稳定图片标识，不会按单词去重，原图本身重复出现的词仍会保留。

1. 拍照/相册/拖拽/粘贴上传；多图排序、删除，旋转、缩放，矩形/自由圈选，多选区移动、调整、排序和撤销重做。原图像素坐标负责裁剪，圈外遮白。
2. 识别后保留原始文本和来源。编辑朗读内容、答案、语言、发音，增删、拖动/按钮排序、合并拆分、检查重复；AI 整理与生成先预览确认，支持撤销。
3. 设定固定/随机/自定义顺序、声音、速度、重复次数及间隔。中文提示写英文等模式需要先确认不同的提示与答案，缺项不会自动捏造。
4. 朗读完成进入“等你写好”。按钮随时可用，也可以输入文字与听写助手对话。开启麦克风前显示用途并申请权限；短段 VAD 转写后交给对话 Agent，只处理最终结果。断线后下一段重试；支持主动关闭并释放资源。
5. 完成后手动核对，或上传照片，调用已配置的腾讯手写识别和 SenseNova 对齐。无法辨认/无法对齐不算错误，用户修正并勾选核查，确认错误才入错词本。正确率只统计已确认的可判定项目。
6. 进度、清单、随机后的实际顺序、设置、标记、批改、历史及错词保存在浏览器 IndexedDB。来源图片默认不长期保存，可明确勾选保存；答案照片只留在当前页面。无跨设备同步。

朗读过程中只接受暂停类语音，其他口令会忽略，避免回声推进。启用浏览器 echoCancellation，播放后保留 800ms 回声保护，使用会话轮次拒绝旧结果，并抑制连续“好了”。如果朗读文本自身包含暂停类口令，朗读时用按钮暂停。不同麦克风/扬声器的回声表现需真机验证，不能保证所有硬件完全消除；建议耳机。浏览器进入后台/锁屏时暂停，返回后主动恢复，不承诺后台持续监听。

## 手机与部署

启动脚本在 `APP_ACCESS_TOKEN` 为空时只监听 127.0.0.1；设置强口令后才监听 0.0.0.0。手机访问前必须设置口令，在网页服务设置中输入。同源保护、17 MB 请求体上限、每分钟 100 次的单进程全局限流、最多 8 个并发请求和 TTS 队列限制保护模型代理。公网部署建议再加反向代理认证、按账号/租户计费及共享限流；当前交付适合个人/家庭单进程，不是多租户服务。

手机通过同一网络上的电脑域名访问网页，**不能访问手机自身的 127.0.0.1**。选择本地朗读时，网页后端连接电脑的 127.0.0.1:8765；选择 Edge 时由网页后端联网生成。生产需反向代理 HTTPS（Caddy、Nginx 或受信任的内网证书），保持 Host 头；麦克风与部分摄像头 API 在普通 LAN HTTP 下不可用。不要把 8765 映射到公网。关闭浏览器权限会得到说明，并可继续按钮操作。

HTTPS 反向代理示意（已有合法域名与证书）：

```caddyfile
study.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

外网部署必须让 TTS 网络可达：同机运行，或通过受保护的私网隧道连接；不能在远程云服务器上填写指向你电脑的 localhost。

## 验证

```bash
npm run typecheck
npm test
npm run build
# 无应用口令时，本机健康检查
curl http://localhost:3000/api/health
# 设置口令后需 Authorization: Bearer <APP_ACCESS_TOKEN>
curl http://127.0.0.1:8765/v1/models
```

详细官方依据及实际验证边界见 [docs/verification.md](docs/verification.md)。`tests/fixtures/word-list.png` 是明确标识的测试图片，不用于伪装服务返回。

## 代码分层

- `components/ImageEditor.tsx`、`lib/images.ts`：图片坐标和裁剪。
- `components/ContentEditor.tsx`：清单与 AI 提案编辑。
- `lib/materials.ts`、`lib/ocr-server.ts`：版面、独立听写单位和质量核查。
- `lib/agent-server.ts`、`lib/agent-tools.ts`：受限工具循环、原文片段核验和待确认草稿。
- `lib/server.ts`、`app/api/[action]/route.ts`：真实服务请求、验证、鉴权、限流。
- `lib/tts-server.ts`、`services/tts/`：已部署 TTS 适配及备用 Python 服务。
- `lib/asr.ts`：麦克风、VAD、分段识别与资源释放。
- `lib/machine.ts`、`components/Dictation.tsx`：意图和状态机、音频生命周期。
- `components/Completion.tsx`：批改、人工核查、统计。
- `lib/store.ts`、`app/page.tsx`：本地存储、历史和错词本、页面编排。
