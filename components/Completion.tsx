"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, RotateCcw, BookOpen } from "lucide-react";
import { Item, Session } from "@/lib/types";
import { readPicture } from "@/lib/images";
import { api } from "@/lib/client";
import { grade } from "@/lib/machine";
import { get, put } from "@/lib/store";
import type { RecognizedLine } from "@/lib/handwriting";
export type Grading = {
  recognized: string;
  status: string;
  reason: string;
  confirmed: boolean;
};
export default function Completion({
  session: s,
  onReview,
  onWrong,
  notify,
}: {
  session: Session;
  onReview: (items: Item[]) => void;
  onWrong: (items: Item[]) => void;
  notify: (s: string) => void;
}) {
  const [photo, setPhoto] = useState(""),
    [results, setResults] = useState<Grading[]>(
      s.items.map(() => ({
        recognized: "",
        status: "待确认",
        reason: "尚未批改",
        confirmed: false,
      })),
    ),
    [busy, setBusy] = useState(false),
    [caseSensitive, setCase] = useState(false),
    [punctuation, setPunctuation] = useState(false),
    [loaded, setLoaded] = useState(false),
    [ocrLines, setOcrLines] = useState<RecognizedLine[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void get<RecognizedLine[]>(`grade-raw:${s.id}`)
      .then((v) => {
        if (v) setOcrLines(v);
      })
      .catch(() => {});
    void get<Grading[]>(`grade:${s.id}`)
      .then((v) => {
        if (v) setResults(v);
        setLoaded(true);
      })
      .catch(() => {
        setLoaded(true);
        notify("无法读取批改记录");
      });
  }, [s.id]);
  useEffect(() => {
    if (loaded)
      void put(`grade:${s.id}`, results).catch(() =>
        notify("批改记录保存失败，请检查浏览器存储空间"),
      );
  }, [results, loaded, s.id]);
  async function upload(file?: File) {
    if (!file) return;
    try {
      const p = await readPicture(file);
      setPhoto(p.url);
    } catch (e) {
      notify(String(e));
    }
  }
  async function evaluate() {
    setBusy(true);
    try {
      const d = await api("grade", {
        image: photo,
        answers: s.items.map((v) => v.answer),
      });
      if (d.ocrLines) {
        setOcrLines(d.ocrLines);
        void put(`grade-raw:${s.id}`, d.ocrLines);
      }
      const next = s.items.map((v, i) => {
        const matches = d.results.filter(
          (a: { index: number }) => a.index === i,
        );
        if (matches.length !== 1)
          return {
            recognized: "",
            status: "待确认",
            reason: "模型结果缺失或对齐重复，请人工核查",
            confirmed: false,
          };
        const a = matches[0];
        return {
          recognized: a.recognized,
          status: !a.readable
            ? "无法辨认"
            : !a.aligned
              ? "待确认"
              : grade(a.recognized, v.answer, true, caseSensitive, punctuation),
          reason: a.reason,
          confirmed: false,
        };
      });
      setResults(next);
      notify(d.warning || "批改建议已生成。请逐项核查后勾选确认。");
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }
  function change(i: number, patch: Partial<Grading>) {
    setResults((v) => v.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  const confirmed = results.filter(
      (v) => v.confirmed && ["正确", "错误", "漏写"].includes(v.status),
    ),
    correct = confirmed.filter((v) => v.status === "正确").length;
  const finished =
    s.ended &&
    s.index === s.items.length - 1 &&
    s.phase === "completed" &&
    !s.error
      ? s.items.length
      : s.index;
  return (
    <>
      <section className="panel completion-hero">
        <div className="done-icon">
          <Check size={32} />
        </div>
        <span className="eyebrow">每一次练习，都算数</span>
        <h1>这一轮，辛苦了</h1>
        <p className="muted">核对答案，把还不熟悉的内容留给下一次。</p>
        <div className="stats">
          <div>
            <strong>{s.confirmedCount ?? finished}</strong>
            <span>已确认完成</span>
          </div>
          <div>
            <strong>
              {Math.max(
                1,
                Math.round(((s.ended || Date.now()) - s.started) / 60000),
              )}
              <small>分钟</small>
            </strong>
            <span>本次历时</span>
          </div>
          <div>
            <strong>{s.items.filter((v) => v.marked).length}</strong>
            <span>标记的内容</span>
          </div>
        </div>
        <div className="row centered">
          <button onClick={() => onReview(s.items)}>
            <RotateCcw size={17} />
            重新听写
          </button>
          <button
            disabled={!s.items.some((v) => v.marked)}
            onClick={() => onReview(s.items.filter((v) => v.marked))}
          >
            复习标记项
          </button>
        </div>
      </section>
      <section className="panel">
        <div className="section-title">
          <h2>核对这次的答案</h2>
          <span className="badge">
            {confirmed.length
              ? `${Math.round((correct / confirmed.length) * 100)}% · 已确认 ${confirmed.length} 项`
              : "尚未产生正确率"}
          </span>
        </div>
        <p className="note">
          正确率只统计已人工确认的正确、错误和漏写项；待确认、无法辨认不计入分母。完成数量不代表正确数量。
        </p>
        <div className="toolbar">
          <button onClick={() => cam.current?.click()}>
            <Camera size={18} />
            拍照批改
          </button>
          <button onClick={() => input.current?.click()}>上传手写答案</button>
          <button
            className="primary"
            disabled={!photo || busy}
            onClick={evaluate}
          >
            {busy ? "正在识别与对齐…" : "开始 AI 批改"}
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCase(e.target.checked)}
            />
            区分大小写
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={punctuation}
              onChange={(e) => setPunctuation(e.target.checked)}
            />
            检查标点
          </label>
        </div>
        <input
          ref={input}
          hidden
          type="file"
          accept="image/*"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <input
          ref={cam}
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        {photo && (
          <details open>
            <summary>手写答案原图（仅当前页面保留）</summary>
            <img className="grading-image" src={photo} alt="待核查的手写答案" />
            <button onClick={() => setPhoto("")}>清除答案图片</button>
          </details>
        )}
        {ocrLines.length > 0 && (
          <details>
            <summary>查看原始手写识别文字（未被语言模型改写）</summary>
            {ocrLines.map((line) => (
              <p key={line.id} className="note">
                行 {line.id + 1}：{line.text}
                {typeof line.confidence === "number"
                  ? ` · 腾讯识别置信度 ${line.confidence}`
                  : ""}
              </p>
            ))}
          </details>
        )}
        <div className="grading-list">
          {s.items.map((v, i) => (
            <article key={v.id} className="grading-row">
              <div>
                <small>
                  第 {i + 1} 项 · {v.hint ? "使用过提示" : "未使用提示"}
                </small>
                <strong>{v.answer}</strong>
              </div>
              <label>
                识别 / 手动输入
                <input
                  value={results[i]?.recognized || ""}
                  onChange={(e) =>
                    change(i, { recognized: e.target.value, confirmed: false })
                  }
                />
              </label>
              <div>
                <select
                  aria-label={`第 ${i + 1} 项批改结论`}
                  value={results[i]?.status || "待确认"}
                  onChange={(e) =>
                    change(i, { status: e.target.value, confirmed: false })
                  }
                >
                  {["正确", "错误", "漏写", "无法辨认", "待确认"].map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    change(i, {
                      status: grade(
                        results[i].recognized,
                        v.answer,
                        true,
                        caseSensitive,
                        punctuation,
                      ),
                      reason: "根据人工核对后的文字比较",
                      confirmed: false,
                    })
                  }
                >
                  按文字比对
                </button>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={results[i]?.confirmed || false}
                  onChange={(e) => change(i, { confirmed: e.target.checked })}
                />
                已核查
              </label>
              <p className="note grading-reason">{results[i]?.reason}</p>
            </article>
          ))}
        </div>
        <button
          className="primary"
          disabled={
            !results.some(
              (v) => v.confirmed && ["错误", "漏写"].includes(v.status),
            )
          }
          onClick={() => {
            onWrong(
              s.items.filter(
                (_, i) =>
                  results[i].confirmed &&
                  ["错误", "漏写"].includes(results[i].status),
              ),
            );
            notify("已将确认的错词加入错词本");
          }}
        >
          <BookOpen size={18} />
          将确认错词加入错词本
        </button>
      </section>
    </>
  );
}
