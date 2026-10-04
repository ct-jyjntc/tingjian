# 核验记录（2026-10-02）

> 历史记录：后续已接入腾讯云、SenseNova 和 Edge，当前状态见 [最新接入验证](integration/verification.md)。

## 官方依据

- 讯飞 [推理服务 HTTP 协议](https://www.xfyun.cn/doc/spark/推理服务-http.html)：给出 2026-01-10 后服务的 `/v2` Base URL、`OpenAI(api_key=..., base_url=...)`、`client.chat.completions.create`、多模态 `image_url` 消息和 `choices[0].message.content` 响应。本项目据此使用 `/v2/chat/completions`，完整密钥作为 Bearer 传递，不拆分。
- [MLX-Audio README](https://github.com/Blaizzy/mlx-audio/blob/main/README.md)：安装方式、Qwen3-TTS 0.6B CustomVoice 8bit CLI 示例、Python `load_model`。
- [MLX-Audio Qwen3-TTS 文档](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/tts/models/qwen3_tts/README.md)：`generate_custom_voice(text, speaker, language)` 和预设声音。
- [实际使用的模型仓库](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit)。最初也核验了 4bit 仓库存在；用户提供已部署服务后切换为其真实返回的 8bit 模型，没有另起第二个模型实例。
- 用户现有服务 [OpenAPI](http://127.0.0.1:8765/openapi.json) 和 [交互文档](http://127.0.0.1:8765/docs)：实际取得 SpeechRequest 字段、`/v1/models`、`/v1/audio/speech`、`/v1/audio/voices`。`/v1/models` 返回 0.6B CustomVoice 8bit；voices 返回空数组，符合该接口只枚举声音包文件的描述。

## 真实接口及浏览器流程

1. 真实 TTS 直接生成：“春天。请在纸上写下来。”，Vivian / Chinese，HTTP 200，188,204 字节，24 kHz / 16-bit / mono WAV，约 5.58 秒生成完成。
2. 通过 Next.js 后端真实生成英文 `apple`、Ryan / English / 0.8 倍速，HTTP 200。最终 FFmpeg 处理结果验证为有限帧 WAV，时长约 3.98 秒。修复了流式 FFmpeg WAV 默认未知长度头，避免把时长解释为异常大值。
3. 用 `tests/fixtures/word-list.png`（spring / apple / sunshine 三行）执行真实 OCR。整图有时只返回第一行或附带尾随字符，已保留这一实际局限；显式设置 4096 输出上限。浏览器分别框选前两行后，实际返回 `spring`、`apple`，来源选区及原始文本在内容页可见。
4. 浏览器完成：上传测试图片 → 两个矩形选区 → 真实 OCR → 内容确认 → 设置随机顺序及 Ryan → 真实音频播放 → 等待用户 → 重复 → 暂停 → 恢复重读 → 点击下一项。
5. 刷新网页后首页显示第 2 / 2 项进度；恢复时为“已暂停”，麦克风关闭。主动继续后重新朗读，结束后保持第 2 / 2 项“等你写好”，没有自行完成。点击最后一项确认后进入完成页。
6. 完成页最初显示“尚未产生正确率”。用明确的人工测试答案 `appl` 对照 `apple`，比对后仍需勾选“已核查”，确认错误才进入错词本；统计显示确认 1 项。该测试不是手写模型结果，也没有伪造 AI 批改。
7. 从错词本重新听写 `apple`，观察到真实朗读与“等你写好”状态，验证复习可用。
8. 已检查桌面和 390px 手机视口布局。截图 `dictation-desktop.jpg` 展示真实音频完成后等待用户的页面。

## 自动测试与错误路径

- `npm test`：28 / 28 通过。覆盖肯定、否定、冲突口令、重复口令、同轮语音/按钮竞态、朗读期间不得推进、最后一项确认、暂停恢复、旧轮次拒绝、提示标记、随机顺序序列化、不可辨认不判错。
- 使用真实 Canvas 实现的图像测试：原图坐标矩形裁剪尺寸/像素、自由多边形外白色遮罩、90 度旋转后选区坐标及像素一致性。
- `npm run build`：生产构建通过；`npx tsc --noEmit --noUnusedLocals --noUnusedParameters` 通过。
- Python `py_compile` 通过。备用 Python 服务依赖安装成功；没有额外启动它或重复加载模型，实际音频验证使用用户已有的 8765 服务。
- `/api/asr`、`/api/intent`、`/api/grade` 分别真实返回 HTTP 503，明确指出缺少 ASR / LLM / HANDWRITING 配置。
- 浏览器点击“开启语音控制”后显示 ASR 未配置，保持当前项，按钮继续可用。
- 跨站 Origin 请求返回 403；使用外部 Host 且未设置应用口令的请求（curl 验证）返回 403。无应用口令时启动脚本只绑定 loopback。
- 在独立端口 3001 临时启动相同生产构建，仅将 TTS 地址设为不可达地址，健康检查返回 offline，生成返回 503。测试后停止临时实例；没有停止用户的 8765 模型服务。
- 扫描 `.next/static` 与 docs：真实 OCR 密钥出现次数为 0。未将密钥写入文档、日志或截图。

## 未配置或未验证的部分

- ASR 模型、自然语言/整理/解释模型、手写模型尚未提供；对应适配器和界面已实现，无法完成真人说“听不清”“好了”的真实转写或拍照 AI 批改。这些不是通过的端到端测试。
- 麦克风权限、真实摄像头拍照、物理扬声器回声、手机锁屏中断与 HTTPS 手机访问，尚未在真实手机硬件上验证。响应式视口测试不能代替手机实测。
- 回声保护使用浏览器消回声、播放窗口限制、800ms 尾音保护与口令检查；不能宣称所有环境绝对不误识别。如果朗读本身含暂停口令，朗读中用按钮暂停。
- 备用 Python 包装服务未额外做一次模型加载/生成测试，避免与已部署的模型争用内存。现有 MLX HTTP 服务已完成真实生成验证。
- 语言模型的生成质量、内容对齐和手写识别质量仍需供应商配置后的样本验证。按原文模式会拒绝无法在来源原文中找到的输出；生成模式先给用户确认。

所以，当前已完成并验证的真实流程使用按钮控制和人工核查替代尚未配置的语音/手写模型；完整的“真人语音控制 + 拍照 AI 批改”演示仍需要上述外部配置和设备验证。
