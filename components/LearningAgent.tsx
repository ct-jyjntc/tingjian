"use client";
import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Check,
  LoaderCircle,
  Square,
  ArrowRight,
} from "lucide-react";
import ColumnPicker from "./ColumnPicker";
import { api, ApiError } from "@/lib/client";
import { crop } from "@/lib/images";
import { itemIssue, type Material, type RawMaterial } from "@/lib/materials";
import type { Item, Picture } from "@/lib/types";
import type { AgentSource, AgentTrace } from "@/lib/agent-tools";
type Result = {
  message: string;
  proposal?: Item[];
  materials?: Material[];
  trace: AgentTrace[];
};
export default function LearningAgent({
  items,
  materials,
  pictures,
  onApply,
  notify,
}: {
  items: Item[];
  materials: RawMaterial[];
  pictures: Picture[];
  onApply: (items: Item[], materials?: Material[]) => Promise<void>;
  notify: (s: string) => void;
}) {
  const [instruction, setInstruction] = useState(""),
    [mode, setMode] = useState<"original" | "generate">("original"),
    [busy, setBusy] = useState(false),
    [applying, setApplying] = useState(false),
    [result, setResult] = useState<Result | null>(null),
    [base, setBase] = useState("");
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    current = useRef(items);
  current.current = items;
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  function cancel() {
    generation.current++;
    controller.current?.abort();
    setBusy(false);
    setResult(null);
    notify("已取消助手任务，当前清单未修改");
  }
  async function run(text = instruction, includeImages = false) {
    if (!text.trim()) return;
    if (busy) controller.current?.abort();
    const token = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setResult(null);
    setBase(JSON.stringify(items));
    try {
      const sources: AgentSource[] = [];
      if (includeImages) {
        picturesLoop: for (const picture of pictures) {
          const regions = picture.regions.length
            ? picture.regions
            : [undefined];
          for (const [i, region] of regions.entries()) {
            if (abort.signal.aborted) return;
            sources.push({
              id: `${picture.id}-${region?.id || "full"}`,
              source: `${picture.name} (${picture.id}) / ${region ? `选区 ${i + 1} (${region.id})` : "整张图片"}`,
              sourceImageId: picture.id,
              image: await crop(picture, region),
            });
            if (sources.length >= 6) break picturesLoop;
          }
        }
      }
      if (includeImages && !sources.length)
        throw Error("原图未保存在此浏览器，请先用下方“重新识别原图”上传图片。");
      const data = await api(
        "agent",
        {
          instruction: text,
          mode,
          items,
          materials: materials.slice(-30),
          sources,
        },
        abort.signal,
      );
      if (token !== generation.current || abort.signal.aborted) return;
      setResult(data);
    } catch (e) {
      if (token !== generation.current) return;
      if (!abort.signal.aborted && e instanceof ApiError) {
        setResult({
          message: `助手未完成：${e.message}。原清单未修改，可以稍后重试。`,
          trace: Array.isArray(e.details.trace)
            ? (e.details.trace as AgentTrace[])
            : [],
        });
      }
      if (!abort.signal.aborted) notify(String(e));
      else notify("已取消助手任务，当前清单未修改");
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  const changed = base !== JSON.stringify(current.current);
  return (
    <section className="panel ai-panel agent-panel">
      <div className="section-title">
        <h2>
          <Sparkles size={20} />
          听写学习助手
        </h2>
        <select
          aria-label="助手工作模式"
          value={mode}
          disabled={busy || applying}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="original">只整理原文</option>
          <option value="generate">AI 辅助出题</option>
        </select>
      </div>
      <p className="muted">
        告诉我这次想练什么。我会查看材料、调用工具，先给你清单。
      </p>
      <div className="agent-chips">
        {[
          "只听写过去式，每个单词一项",
          "只听写原形，每个单词一项",
          "所有单词逐个听写，保留重复",
          "去掉重复单词",
        ].map((text) => (
          <button
            key={text}
            disabled={busy || (!items.length && !materials.length)}
            onClick={() => {
              setInstruction(text);
              void run(text);
            }}
          >
            {text.replace("，每个单词一项", "")}
          </button>
        ))}
      </div>
      <div className="row">
        <input
          aria-label="告诉听写助手你的要求"
          placeholder="例如：只听写右侧两列的过去式，先不要显示答案"
          value={instruction}
          disabled={applying}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void run();
          }}
        />
        <button
          className="primary"
          disabled={
            busy || !instruction.trim() || (!items.length && !materials.length)
          }
          onClick={() => void run()}
        >
          {busy ? (
            <>
              <LoaderCircle className="spinning" size={17} />
              助手处理中
            </>
          ) : (
            <>
              准备清单
              <ArrowRight size={16} />
            </>
          )}
        </button>
        {busy && (
          <button onClick={cancel}>
            <Square size={14} />
            取消
          </button>
        )}
      </div>
      <div className="agent-footnote">
        <small>
          听写进度由程序管理，助手不能跳题或自动开始。新清单需要你确认。
        </small>
        {pictures.length > 0 && (
          <button
            disabled={busy}
            className="text-button"
            onClick={() =>
              void run(
                instruction.trim() ||
                  "重新识别提供的原图，全部单词逐个听写，保留重复项。",
                true,
              )
            }
          >
            允许助手重新识别当前选区
          </button>
        )}
      </div>
      {busy && (
        <div className="agent-progress" role="status">
          正在向 SenseNova 请求工具调用；服务繁忙时可取消，当前清单不会改变。
        </div>
      )}
      <ColumnPicker
        materials={materials}
        disabled={busy || applying}
        onPropose={(proposal, message) => {
          setBase(JSON.stringify(items));
          setResult({ message, proposal, trace: [] });
        }}
      />
      {result && (
        <div className="agent-result">
          <p>{result.message}</p>
          <ol className="agent-trace">
            {result.trace.map((step, i) => (
              <li key={i} className={step.status === "error" ? "failed" : ""}>
                <span>
                  {step.status === "success" ? <Check size={14} /> : "!"}
                </span>
                <div>
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </div>
              </li>
            ))}
          </ol>
          {result.proposal && (
            <>
              <div className="proposal-title">
                <strong>待确认清单 · {result.proposal.length} 项</strong>
                <span className="badge">
                  {result.proposal.some((v) => v.generated)
                    ? "含 AI 生成"
                    : "来自原文"}
                </span>
              </div>
              <div className="proposal-words">
                {result.proposal.map((item, i) => (
                  <span key={item.id} title={item.source}>
                    {i + 1}. {item.spoken}
                    {item.answer !== item.spoken ? ` → ${item.answer}` : ""}
                    {itemIssue(item) ? " ⚠" : ""}
                  </span>
                ))}
              </div>
              {changed && (
                <p className="notice">
                  清单在处理期间发生了修改，请重新运行助手，避免覆盖你的编辑。
                </p>
              )}
              <div className="row">
                <button
                  className="primary"
                  disabled={changed || busy || applying}
                  onClick={async () => {
                    setApplying(true);
                    try {
                      await onApply(result.proposal!, result.materials);
                    } catch (e) {
                      notify(String(e));
                      return;
                    } finally {
                      setApplying(false);
                    }
                    setResult(null);
                    notify("已应用确认的清单，可以逐项试听或开始听写。");
                  }}
                >
                  确认使用这 {result.proposal.length} 项
                </button>
                <button disabled={applying} onClick={() => setResult(null)}>
                  放弃草稿
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
