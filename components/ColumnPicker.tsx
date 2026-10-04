"use client";
import { useState } from "react";
import { extractMaterial, isMaterial, type RawMaterial } from "@/lib/materials";
import type { Item } from "@/lib/types";
export default function ColumnPicker({
  materials,
  onPropose,
  disabled = false,
}: {
  materials: RawMaterial[];
  onPropose: (items: Item[], message: string) => void;
  disabled?: boolean;
}) {
  const tables = Array.from(
    new Map(
      materials
        .filter(isMaterial)
        .filter((m) => m.kind === "word-table")
        .map((m) => [m.source, m]),
    ).values(),
  );
  const [chosen, setChosen] = useState<Record<string, number[]>>({});
  if (!tables.length) return null;
  return (
    <details className="column-picker">
      <summary>按列快捷整理 · 无需等待 AI</summary>
      <p className="note">根据下面的真实列样例选择；每个英文单词单独一项。</p>
      {tables.map((m) => {
        const columns = [
          ...new Set(
            m.blocks
              .map((b) => b.column)
              .filter((v): v is number => v !== undefined),
          ),
        ];
        const selected = chosen[m.id] || columns;
        return (
          <div key={m.id} className="column-material">
            <small>{m.source}</small>
            <div className="column-grid">
              {columns.map((c) => (
                <label
                  key={c}
                  className={selected.includes(c) ? "column active" : "column"}
                >
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={selected.includes(c)}
                    onChange={(e) =>
                      setChosen((v) => ({
                        ...v,
                        [m.id]: e.target.checked
                          ? [...selected, c]
                          : selected.filter((i) => i !== c),
                      }))
                    }
                  />
                  <strong>第 {c} 列</strong>
                  <span>
                    {m.blocks
                      .filter((b) => b.column === c)
                      .slice(0, 4)
                      .map((b) => b.text)
                      .join(" · ")}
                  </span>
                </label>
              ))}
            </div>
            <button
              disabled={disabled || !selected.length}
              onClick={() => {
                const proposal = extractMaterial(m, {
                  mode: "words",
                  columns: selected,
                });
                onPropose(
                  proposal,
                  `已按第 ${[...selected].sort((a, b) => a - b).join("、")} 列准备 ${proposal.length} 个单词。这次使用快捷整理，未请求 AI；请确认后应用。`,
                );
              }}
            >
              预览所选列的单词
            </button>
          </div>
        );
      })}
    </details>
  );
}
