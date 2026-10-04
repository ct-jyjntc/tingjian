"use client";
import { speechVoices, type TtsBackend } from "@/lib/voices";
import { useEffect } from "react";
import { Settings as Config } from "@/lib/types";
import { previewText, stopPreview } from "@/lib/client";
import { Play, Volume2 } from "lucide-react";
export default function Settings({
  value,
  onChange,
  onStart,
  count,
  notify,
}: {
  value: Config;
  onChange: (v: Config) => void;
  onStart: () => void;
  count: number;
  notify: (s: string) => void;
}) {
  function set<K extends keyof Config>(key: K, v: Config[K]) {
    onChange({ ...value, [key]: v });
  }
  const backend = value.ttsBackend || "edge-tts";
  useEffect(() => {
    if (!speechVoices[backend].some((v) => v.id === value.voice))
      onChange({
        ...value,
        ttsBackend: backend,
        voice: speechVoices[backend][0].id,
      });
  }, [backend, value.voice]);
  return (
    <div className="settings-layout">
      <section className="panel">
        <h2>让听写，适合你的节奏</h2>
        <p className="muted">读完就等你，只有确认写好才进入下一项。</p>
        <div className="settings-fields">
          <label>
            听写模式
            <select
              value={value.mode}
              onChange={(e) => set("mode", e.target.value)}
            >
              {[
                "原文听写",
                "中文释义提示，书写英文",
                "英文提示，书写中文含义",
                "句子听写",
                "错词复习",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <p className="note">
            提示模式使用清单中已确认的“朗读内容”和“标准答案”。缺少释义时请返回编辑，AI
            补充须确认后使用。
          </p>
          <label>
            排列顺序
            <select
              value={value.order}
              onChange={(e) => set("order", e.target.value)}
            >
              <option value="original">原文顺序</option>
              <option value="random">随机顺序（本次固定保存）</option>
              <option value="custom">自定义顺序（使用编辑后的顺序）</option>
            </select>
          </label>
          <label>
            朗读服务
            <select
              value={backend}
              onChange={(e) => {
                const ttsBackend = e.target.value as TtsBackend;
                onChange({
                  ...value,
                  ttsBackend,
                  voice: speechVoices[ttsBackend][0].id,
                });
              }}
            >
              <option value="edge-tts">Edge 在线语音 · 需要联网</option>
              <option value="mlx-audio">本地 Qwen3-TTS · 需要启动服务</option>
            </select>
          </label>
          <p className="note">
            {backend === "edge-tts"
              ? "朗读文字会发送给 Edge 在线服务。该服务为非官方封装，不保证长期可用；失败会停留当前项。"
              : "使用电脑上的 MLX-Audio 服务生成声音。"}
          </p>
          <div className="two-col">
            <label>
              朗读声音
              <select
                value={value.voice}
                onChange={(e) => set("voice", e.target.value)}
              >
                {speechVoices[backend].map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              语速 · {value.speed.toFixed(1)}×
              <input
                type="range"
                min=".5"
                max="1.5"
                step=".1"
                value={value.speed}
                onChange={(e) => set("speed", +e.target.value)}
              />
            </label>
          </div>
          <button
            onClick={() =>
              void previewText(
                "你好，我们开始听写。Hello, let’s begin.",
                value.voice,
                value.speed,
                "Auto",
                "",
                backend,
              ).catch((e) => notify(String(e)))
            }
          >
            <Volume2 size={18} />
            试听声音
          </button>
          <button onClick={stopPreview}>停止试听</button>
          <div className="two-col">
            <label>
              每项朗读次数
              <input
                type="number"
                min="1"
                max="5"
                value={value.repeats}
                onChange={(e) =>
                  set("repeats", Math.max(1, Math.min(5, +e.target.value)))
                }
              />
            </label>
            <label>
              重复间隔（秒）
              <input
                type="number"
                min="0"
                max="10"
                step=".5"
                value={value.gap}
                onChange={(e) =>
                  set("gap", Math.max(0, Math.min(10, +e.target.value)))
                }
              />
            </label>
          </div>
          {(
            [
              ["showAnswer", "默认显示答案（会记录提示使用）"],
              ["voiceControl", "使用语音对话（开始后主动开启麦克风）"],
              ["allowHints", "允许查看答案和解释"],
            ] as const
          ).map(([key, label]) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                checked={value[key]}
                onChange={(e) => set(key, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
      </section>
      <aside className="panel start-panel">
        <span className="eyebrow">这一次，专心听写</span>
        <h1>
          {count}
          <small>项内容</small>
        </h1>
        <p>
          准备好纸和笔
          <br />
          其余的，交给你的节奏。
        </p>
        <div className="note">
          {backend === "edge-tts" ? "Edge 在线语音朗读" : "本地 Qwen3-TTS 朗读"}
          <br />
          进度自动保存在当前浏览器
          <br />
          刷新后可继续
        </div>
        <button className="primary" disabled={!count} onClick={onStart}>
          <Play size={18} />
          开始听写
        </button>
      </aside>
    </div>
  );
}
