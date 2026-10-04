"use client";
import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  LoaderCircle,
  MessageCircle,
  Send,
  Square,
  Volume2,
} from "lucide-react";
import { readableText, type Explanation } from "@/lib/explanation";
import type { NarrationState } from "@/lib/narration";

export type ConversationTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  explanation?: Explanation;
};

export default function SessionConversation({
  turns,
  busy,
  onSend,
  onCancel,
  autoSpeak,
  onAutoSpeak,
  narrating,
  speakingId,
  onSpeak,
  onStop,
}: {
  turns: ConversationTurn[];
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  autoSpeak: boolean;
  onAutoSpeak: (value: boolean) => void;
  narrating: NarrationState;
  speakingId: string;
  onSpeak: (turn: ConversationTurn) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const conversation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (turns.at(-1)?.role !== "assistant") return;
    const container = conversation.current;
    const latest = container?.lastElementChild as HTMLElement | null;
    if (container && latest) {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches
        ? "instant"
        : "smooth";
      container.scrollTo({ top: latest.offsetTop, behavior });
      container.scrollIntoView({ block: "nearest", behavior });
    }
  }, [turns]);
  function send() {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText("");
  }
  return (
    <section className="session-assistant" aria-label="听写对话搭档">
      <div className="assistant-heading">
        <div>
          <span>
            <MessageCircle size={20} />
          </span>
          <div>
            <h2>听见 · 对话搭档</h2>
            <p>直接说你的想法，不必记住固定口令。</p>
          </div>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={autoSpeak}
            onChange={(event) => onAutoSpeak(event.target.checked)}
          />
          自动朗读回复
        </label>
      </div>
      {!turns.length && (
        <div className="conversation-examples">
          <span>你可以说</span>
          {[
            "刚才那个没跟上，再念一遍",
            "这个词有什么好记的方法？",
            "这一项写完了，我们往下吧",
          ].map((example) => (
            <button
              key={example}
              disabled={busy}
              onClick={() => onSend(example)}
            >
              {example}
            </button>
          ))}
        </div>
      )}
      <div
        className="conversation-turns"
        ref={conversation}
        aria-live="polite"
        aria-relevant="additions text"
      >
        {turns.map((turn) => (
          <article key={turn.id} className={`conversation-turn ${turn.role}`}>
            <span className="conversation-role">
              {turn.role === "user" ? "你" : "听见"}
            </span>
            {turn.explanation ? (
              <div className="explanation-card">
                <span className="explanation-origin">
                  AI 学习讲解 · 请对照课本核查
                </span>
                <h3>{turn.explanation.title}</h3>
                <p>{turn.explanation.summary}</p>
                <div className="explanation-sections">
                  {turn.explanation.sections.map((section, index) => (
                    <section key={index}>
                      <h4>{section.label}</h4>
                      <p>{section.text}</p>
                    </section>
                  ))}
                </div>
              </div>
            ) : (
              <div className="conversation-copy">
                {readableText(turn.text)
                  .split(/\n\s*\n/)
                  .map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
              </div>
            )}
            {turn.role === "assistant" && (
              <button
                className="narration-button"
                onClick={() =>
                  narrating !== "idle" && speakingId === turn.id
                    ? onStop()
                    : onSpeak(turn)
                }
              >
                {narrating !== "idle" && speakingId === turn.id ? (
                  <>
                    <Square size={14} />
                    {narrating === "loading"
                      ? "正在准备语音 · 停止"
                      : "停止朗读"}
                  </>
                ) : (
                  <>
                    <Volume2 size={15} />
                    {turn.explanation ? "朗读讲解" : "朗读回复"}
                  </>
                )}
              </button>
            )}
          </article>
        ))}
      </div>
      {busy && (
        <div className="assistant-working" role="status">
          <LoaderCircle className="spinning" size={16} />
          正在理解你的想法…<button onClick={onCancel}>取消</button>
        </div>
      )}
      <form
        className="conversation-form"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          aria-label="和听写助手对话"
          placeholder="想问什么，或者想怎么继续？"
          maxLength={3000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          className="primary"
          type="submit"
          disabled={busy || !text.trim()}
        >
          <Send size={16} />
          发送
        </button>
      </form>
      <p className="conversation-note">
        <AudioLines size={13} />
        讲解不会推进题目。朗读时可以点“停止朗读”，再继续提问。
      </p>
    </section>
  );
}
