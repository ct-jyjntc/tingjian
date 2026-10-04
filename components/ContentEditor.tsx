"use client";
import { useState } from "react";
import { Item, Picture, Settings, newItem } from "@/lib/types";
import { previewText, stopPreview } from "@/lib/client";
import {
  Plus,
  Volume2,
  Trash2,
  GripVertical,
  Undo2,
  ArrowRight,
} from "lucide-react";
import LearningAgent from "./LearningAgent";
import RebuildMaterial from "./RebuildMaterial";
import {
  itemIssue,
  splitExistingItems,
  type Material,
  type RawMaterial,
} from "@/lib/materials";
export type Raw = RawMaterial;
export default function ContentEditor({
  items,
  setItems,
  raw,
  pictures,
  settings,
  onNext,
  notify,
  onApply,
  onUndo,
  canUndo,
}: {
  items: Item[];
  setItems: (a: Item[]) => void;
  raw: Raw[];
  pictures: Picture[];
  settings: Settings;
  onNext: () => void;
  notify: (s: string) => void;
  onApply: (items: Item[], materials?: Material[]) => Promise<void>;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const [drag, setDrag] = useState<number | null>(null),
    [bulk, setBulk] = useState(""),
    [splitProposal, setSplitProposal] = useState<Item[] | null>(null);
  const duplicates = items.filter(
    (v, i) => items.findIndex((a) => a.answer.trim() === v.answer.trim()) < i,
  );
  function edit(index: number, field: keyof Item, value: string) {
    setItems(
      items.map((v, i) =>
        i === index
          ? {
              ...v,
              [field]: value,
              reviewed: false,
              reviewReason:
                field === "spoken" || field === "answer"
                  ? undefined
                  : v.reviewReason,
            }
          : v,
      ),
    );
  }
  function move(index: number, target: number) {
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [v] = next.splice(index, 1);
    next.splice(target, 0, v);
    setItems(next);
  }
  return (
    <div className="editor-layout">
      <aside className="panel source-panel">
        <h2>对照原文</h2>
        <p className="muted">原始识别结果始终保留，不会被整理覆盖。</p>
        {pictures.map((p) => (
          <details key={p.id}>
            <summary>{p.name}</summary>
            <img className="source-image" src={p.url} alt={p.name} />
          </details>
        ))}
        {raw.length ? (
          raw.map((v, i) => (
            <div className="raw" key={i}>
              <small>{v.source}</small>
              <pre>{v.text}</pre>
            </div>
          ))
        ) : (
          <p className="note">还没有识别结果，也可以直接输入听写内容。</p>
        )}
      </aside>
      <section>
        <LearningAgent
          items={items}
          materials={raw}
          pictures={pictures}
          onApply={onApply}
          notify={notify}
        />
        <RebuildMaterial items={items} onApply={onApply} notify={notify} />
        <div className="panel">
          <div className="section-title">
            <h2>
              听写清单 <span className="count">{items.length}</span>
            </h2>
            <button onClick={() => setItems([...items, newItem("")])}>
              <Plus size={17} />
              添加一项
            </button>
          </div>
          {duplicates.length > 0 && (
            <p className="notice">
              发现 {duplicates.length} 个重复项，请自行核对、删除或保留。
            </p>
          )}
          <p className="muted">
            朗读内容与标准答案可以不同，例如读中文、写英文。
          </p>
          <div className="toolbar">
            <button
              disabled={!items.length}
              onClick={() =>
                setSplitProposal(splitExistingItems(items, "words"))
              }
            >
              拆成单个英文单词
            </button>
            <button
              disabled={!items.length}
              onClick={() =>
                setSplitProposal(splitExistingItems(items, "sentences"))
              }
            >
              按句拆分
            </button>
            <button disabled={!canUndo} onClick={onUndo}>
              <Undo2 size={16} />
              撤销上次应用
            </button>
          </div>
          <p className="note">
            单词每项只读一个；短语和句子可保持完整。重复项默认保留，需你决定是否去重。
          </p>
          <div className="item-list">
            {items.map((item, i) => (
              <article
                key={item.id}
                className="item-card"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag !== null) move(drag, i);
                  setDrag(null);
                }}
              >
                <div
                  className="item-number"
                  draggable
                  onDragStart={() => setDrag(i)}
                >
                  <GripVertical size={17} />
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="item-fields">
                  {itemIssue(item) && (
                    <div className="item-warning">
                      <span>{itemIssue(item)}</span>
                      <button
                        onClick={() =>
                          setItems(
                            items.map((v) =>
                              v.id === item.id
                                ? {
                                    ...v,
                                    reviewed: true,
                                    reviewReason: undefined,
                                    unit:
                                      v.unit === "words" ? "phrases" : v.unit,
                                  }
                                : v,
                            ),
                          )
                        }
                      >
                        我已对照原图确认
                      </button>
                    </div>
                  )}
                  <div className="two-col">
                    <label>
                      朗读内容
                      <input
                        aria-label={`第 ${i + 1} 项朗读内容`}
                        value={item.spoken}
                        onChange={(e) => edit(i, "spoken", e.target.value)}
                      />
                    </label>
                    <label>
                      标准答案
                      <input
                        aria-label={`第 ${i + 1} 项标准答案`}
                        value={item.answer}
                        onChange={(e) => edit(i, "answer", e.target.value)}
                      />
                    </label>
                  </div>
                  <details>
                    <summary>
                      发音、来源和更多操作{item.generated ? " · AI 生成" : ""}
                    </summary>
                    <div className="two-col">
                      <label>
                        语言
                        <select
                          value={item.language}
                          onChange={(e) => edit(i, "language", e.target.value)}
                        >
                          <option value="Auto">自动 / 中英混合</option>
                          <option value="Chinese">中文</option>
                          <option value="English">英文</option>
                        </select>
                      </label>
                      <label>
                        发音替代文本
                        <input
                          placeholder="用同音字或完整替代读法修正发音"
                          value={item.pronunciation}
                          onChange={(e) =>
                            edit(i, "pronunciation", e.target.value)
                          }
                        />
                      </label>
                    </div>
                    <p className="note">
                      原文：{item.original || "手动新增"}
                      <br />
                      来源：{item.source}
                    </p>
                    <div className="row">
                      <button disabled={i === 0} onClick={() => move(i, i - 1)}>
                        上移
                      </button>
                      <button
                        disabled={i === items.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        下移
                      </button>
                      <button
                        disabled={i === items.length - 1}
                        onClick={() => {
                          const other = items[i + 1];
                          setItems(
                            items.flatMap((v, j) =>
                              j === i
                                ? [
                                    {
                                      ...v,
                                      unit: "phrases",
                                      reviewed: false,
                                      original:
                                        v.original + " " + other.original,
                                      spoken: v.spoken + " " + other.spoken,
                                      answer: v.answer + " " + other.answer,
                                      source: v.source + "；" + other.source,
                                    },
                                  ]
                                : j === i + 1
                                  ? []
                                  : [v],
                            ),
                          );
                        }}
                      >
                        与下一项合并
                      </button>
                      <button
                        onClick={() => {
                          const parts = item.answer
                            .split(/[\n;；。！？.!?]+/)
                            .filter((v) => v.trim());
                          if (parts.length < 2) {
                            notify("请先用分号或句号分隔标准答案");
                            return;
                          }
                          setItems(
                            items.flatMap((v, j) =>
                              j === i
                                ? parts.map((t) => ({
                                    ...newItem(t.trim(), item.source),
                                    original: item.original,
                                  }))
                                : [v],
                            ),
                          );
                        }}
                      >
                        按句拆分
                      </button>
                    </div>
                  </details>
                </div>
                <div className="item-actions">
                  <button
                    aria-label={`试听第 ${i + 1} 项`}
                    disabled={Boolean(itemIssue(item))}
                    onClick={() =>
                      void previewText(
                        item.spoken,
                        settings.voice,
                        settings.speed,
                        item.language,
                        item.pronunciation,
                        settings.ttsBackend,
                      ).catch((e) => notify(String(e)))
                    }
                  >
                    <Volume2 size={18} />
                  </button>
                  <button
                    aria-label={`删除第 ${i + 1} 项`}
                    onClick={() =>
                      setItems(items.filter((v) => v.id !== item.id))
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          <details className="bulk">
            <summary>粘贴文字，按行添加</summary>
            <textarea
              aria-label="批量添加听写内容"
              placeholder="每行一个词语或句子"
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
            />
            <button
              onClick={() => {
                setItems([
                  ...items,
                  ...bulk
                    .split("\n")
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((t) => newItem(t)),
                ]);
                setBulk("");
              }}
            >
              添加到清单
            </button>
          </details>
          <div className="footer-actions">
            <button onClick={stopPreview}>停止试听</button>
            <button
              className="primary"
              disabled={
                !items.length ||
                items.some(
                  (v) => !v.spoken.trim() || !v.answer.trim() || itemIssue(v),
                )
              }
              onClick={onNext}
            >
              确认内容，设置听写
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>
      {splitProposal && (
        <div className="modal-backdrop">
          <div className="panel modal wide">
            <h2>确认拆分结果 · {splitProposal.length} 项</h2>
            <p>
              只拆分现有文字，不修复 OCR
              中的错字。乱码项仍需重新识别或人工核查。
            </p>
            <div className="proposal-words">
              {splitProposal.map((v, i) => (
                <span key={v.id}>
                  {i + 1}. {v.spoken}
                  {itemIssue(v) ? " ⚠" : ""}
                </span>
              ))}
            </div>
            <button
              className="primary"
              onClick={async () => {
                try {
                  await onApply(splitProposal);
                  setSplitProposal(null);
                } catch (e) {
                  notify(String(e));
                }
              }}
            >
              确认拆分
            </button>
            <button onClick={() => setSplitProposal(null)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
