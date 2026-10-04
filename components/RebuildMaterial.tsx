"use client";
import { useEffect, useRef, useState } from "react";
import { ScanLine, Upload, Check } from "lucide-react";
import { api } from "@/lib/client";
import { readPicture } from "@/lib/images";
import type { Item } from "@/lib/types";
import { itemIssue, type Material, type ContentMode } from "@/lib/materials";
export default function RebuildMaterial({
  items,
  onApply,
  notify,
}: {
  items: Item[];
  onApply: (items: Item[], materials?: Material[]) => Promise<void>;
  notify: (s: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    abort = useRef<AbortController | null>(null),
    generation = useRef(0);
  const [busy, setBusy] = useState(false),
    [proposal, setProposal] = useState<{
      items: Item[];
      material: Material;
      image: string;
      filename: string;
      snapshot: string;
    } | null>(null),
    [mode, setMode] = useState<ContentMode>("auto");
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
    },
    [],
  );
  function cancel() {
    generation.current++;
    abort.current?.abort();
    setBusy(false);
  }
  async function rebuild(file?: File) {
    if (!file) return;
    abort.current?.abort();
    const token = ++generation.current;
    const snapshot = JSON.stringify(items);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const pic = await readPicture(file);
      if (controller.signal.aborted || token !== generation.current) return;
      const d = await api(
        "ocr",
        {
          image: pic.url,
          source: `${pic.name} / 重新识别原图`,
          mode,
          provider: "tencent",
        },
        controller.signal,
      );
      if (controller.signal.aborted || token !== generation.current) return;
      setProposal({
        items: d.items,
        material: { ...d.material, sourceImageId: pic.id },
        image: pic.url,
        filename: pic.name,
        snapshot,
      });
    } catch (e) {
      if (!controller.signal.aborted) notify(String(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  const issues = items.filter((i) => itemIssue(i));
  return (
    <>
      <div className={`repair-box ${issues.length ? "needs-repair" : ""}`}>
        <div>
          <strong>
            {issues.length
              ? `${issues.length} 项需要核查`
              : "识别结果不对？可以从原图重建"}
          </strong>
          <p>
            {issues.length
              ? "这些内容包含乱码、整行串读或识别疑点。请修正后再开始听写。"
              : "重新获取版面和单词边界，原始识别记录会保留。"}
          </p>
        </div>
        <div className="row">
          <select
            aria-label="重新识别后的听写单位"
            value={mode}
            onChange={(e) => setMode(e.target.value as ContentMode)}
          >
            <option value="auto">自动判断听写单位</option>
            <option value="words">英文单词 · 每词一项</option>
            <option value="phrases">词语短语 · 每格一项</option>
            <option value="sentences">句子 · 每句一项</option>
          </select>
          <button disabled={busy} onClick={() => input.current?.click()}>
            <Upload size={16} />
            {busy ? "正在重新识别…" : "重新识别原图"}
          </button>
          {busy && <button onClick={cancel}>取消</button>}
        </div>
        <input
          hidden
          ref={input}
          type="file"
          accept="image/*"
          onChange={(e) => {
            void rebuild(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {proposal && (
        <div className="modal-backdrop">
          <div className="panel modal wide">
            <h2>
              <ScanLine size={20} />
              原图重建结果 · {proposal.items.length} 项
            </h2>
            <p className="muted">
              {proposal.material.kind === "word-table"
                ? "已识别为单词表，每个单词独立朗读。"
                : "已按选择的单位整理。"}
              保留重复项，确认前可对照图片。
            </p>
            <details>
              <summary>查看原图</summary>
              <img
                src={proposal.image}
                alt="重新识别的原图"
                className="source-image"
              />
            </details>
            <div className="proposal-words">
              {proposal.items.map((v, i) => (
                <span key={v.id}>
                  {i + 1}. {v.spoken}
                  {itemIssue(v) ? " ⚠" : ""}
                </span>
              ))}
            </div>
            {proposal.material.warnings.map((w) => (
              <p className="notice" key={w}>
                {w}
              </p>
            ))}
            {proposal.snapshot !== JSON.stringify(items) && (
              <p className="notice">
                清单在识别期间发生变化，请重新上传识别，避免覆盖编辑。
              </p>
            )}
            <p className="note">
              将替换来自同一文件的旧识别项；若无法找到对应文件，则替换当前清单。旧清单可通过“撤销上次应用”恢复。
            </p>
            <button
              className="primary"
              disabled={proposal.snapshot !== JSON.stringify(items)}
              onClick={async () => {
                const old = items.filter((i) =>
                  i.source.includes(proposal.filename),
                );
                const next = old.length
                  ? [
                      ...items.filter(
                        (i) => !i.source.includes(proposal.filename),
                      ),
                      ...proposal.items,
                    ]
                  : proposal.items;
                try {
                  await onApply(next, [proposal.material]);
                } catch (e) {
                  notify(String(e));
                  return;
                }
                setProposal(null);
                notify("原图已重新识别，清单已按独立听写项更新");
              }}
            >
              <Check size={16} />
              确认使用新清单
            </button>
            <button onClick={() => setProposal(null)}>取消</button>
          </div>
        </div>
      )}
    </>
  );
}
