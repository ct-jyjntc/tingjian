"use client";
import { useEffect, useRef, useState } from "react";
import {
  Volume2,
  Pause,
  Play,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  Mic,
  MicOff,
  Flag,
  Eye,
  Square,
} from "lucide-react";
import { Session } from "@/lib/types";
import { Intent, parseIntent, transition } from "@/lib/machine";
import { api, audioBlob, stopPreview } from "@/lib/client";
import { Microphone, Transcript } from "@/lib/asr";
import SessionConversation, {
  type ConversationTurn,
} from "./SessionConversation";
import { NarrationPlayer, type NarrationState } from "@/lib/narration";
import {
  sessionContext,
  isCurrentSessionTurn,
  isPlaybackCommand,
  commandLabels,
  type SessionAgentReply,
} from "@/lib/session-agent";
const labels = {
  idle: "准备开始",
  preparing: "正在准备音频",
  playing: "正在朗读",
  waiting: "等你写好",
  paused: "已暂停",
  confirming: "确认结束",
  completed: "已完成",
  error: "播放中断，可重试",
};
export default function Dictation({
  initial,
  onSave,
  onComplete,
  notify,
}: {
  initial: Session;
  onSave: (s: Session) => void;
  onComplete: (s: Session) => void;
  notify: (s: string) => void;
}) {
  const [s, setS] = useState(initial),
    [mic, setMic] = useState(false),
    [micStatus, setMicStatus] = useState("麦克风未开启"),
    [feedback, setFeedback] = useState(
      "可以自然地说：刚才没跟上，或者，这个词怎么记？",
    ),
    [revealed, setRevealed] = useState(false),
    [turns, setTurns] = useState<ConversationTurn[]>([]),
    [assistantBusy, setAssistantBusy] = useState(false),
    [autoSpeak, setAutoSpeak] = useState(true),
    [narrating, setNarrating] = useState<NarrationState>("idle"),
    [speakingId, setSpeakingId] = useState("");
  const turnsRef = useRef<ConversationTurn[]>([]),
    autoSpeakRef = useRef(autoSpeak),
    assistantAbort = useRef<AbortController | null>(null),
    assistantGeneration = useRef(0),
    narrationText = useRef(""),
    narration = useRef<NarrationPlayer | null>(null);
  autoSpeakRef.current = autoSpeak;
  if (!narration.current) narration.current = new NarrationPlayer();
  const state = useRef(s),
    audio = useRef<HTMLAudioElement | null>(null),
    playToken = useRef(0),
    microphone = useRef<Microphone | null>(null),
    lastVoice = useRef(0),
    seen = useRef(new Set<string>()),
    ringUntil = useRef(0),
    mounted = useRef(true),
    micPending = useRef(false),
    playbackAbort = useRef<AbortController | null>(null),
    cancelWait = useRef<(() => void) | null>(null);
  const save = useRef(onSave);
  save.current = onSave;
  function update(next: Session) {
    state.current = next;
    setS(next);
    save.current(next);
  }
  function stop() {
    narration.current?.stop();
    playToken.current++;
    playbackAbort.current?.abort();
    cancelWait.current?.();
    cancelWait.current = null;
    if (audio.current) {
      audio.current.pause();
      audio.current.src = "";
      audio.current = null;
    }
    ringUntil.current = Date.now() + 800;
  }
  function replaceTurns(next: ConversationTurn[]) {
    turnsRef.current = next;
    setTurns(next);
  }
  function appendTurn(turn: ConversationTurn) {
    replaceTurns([...turnsRef.current, turn].slice(-12));
  }
  function cancelAssistant() {
    assistantGeneration.current++;
    assistantAbort.current?.abort();
    assistantAbort.current = null;
    if (mounted.current) setAssistantBusy(false);
  }
  function action(
    intent: Intent,
    round = state.current.round,
    fromAgent = false,
  ): boolean {
    if (!fromAgent) cancelAssistant();
    if (intent === "explain") {
      if (state.current.settings.allowHints)
        void askAssistant("请解释当前词语，给出一个记忆方法和例句。");
      return false;
    }
    const before = state.current;
    const next = transition(before, intent, round);
    if (next === before) return false;
    if (isPlaybackCommand(intent)) stop();
    update(next);
    if (next.index !== before.index) {
      setRevealed(false);
      replaceTurns([]);
    }
    return true;
  }
  async function speakTurn(turn: ConversationTurn) {
    if (["completed", "confirming"].includes(state.current.phase)) return;
    stop();
    if (["playing", "preparing"].includes(state.current.phase))
      update(transition(state.current, "pause", state.current.round));
    setSpeakingId(turn.id);
    narrationText.current = turn.text;
    try {
      await narration.current!.speak(
        turn.text,
        state.current.settings,
        (status) => {
          if (mounted.current) setNarrating(status);
          if (status === "idle") ringUntil.current = Date.now() + 800;
        },
      );
    } catch (error) {
      if (
        mounted.current &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        notify("文字回复已保留，朗读暂时失败，可以点击朗读重试。");
    }
  }
  async function askAssistant(text: string, source: "text" | "voice" = "text") {
    if (
      !text.trim() ||
      ["completed", "confirming"].includes(state.current.phase)
    )
      return;
    cancelAssistant();
    stop();
    if (["playing", "preparing"].includes(state.current.phase))
      update(transition(state.current, "pause", state.current.round));
    const context = sessionContext(state.current);
    const history = turnsRef.current
      .slice(-8)
      .map((turn) => ({ role: turn.role, content: turn.text.slice(0, 30000) }));
    appendTurn({ id: crypto.randomUUID(), role: "user", text });
    const generation = ++assistantGeneration.current;
    const controller = new AbortController();
    assistantAbort.current = controller;
    const valid = () =>
      mounted.current &&
      generation === assistantGeneration.current &&
      !controller.signal.aborted &&
      isCurrentSessionTurn(context, state.current) &&
      (source !== "voice" || Boolean(microphone.current?.active));
    setAssistantBusy(true);
    setFeedback("听见正在理解你的想法…");
    try {
      const reply = (await api(
        "session-agent",
        { text, context, history },
        controller.signal,
      )) as SessionAgentReply;
      if (!valid()) return;
      if (reply.type === "control") {
        if (source === "voice" && reply.command === "next") {
          if (Date.now() - lastVoice.current < 1800) return;
          lastVoice.current = Date.now();
        }
        const applied = action(reply.command, context.round, true);
        const receipt = applied
          ? `已执行：${commandLabels[reply.command]}`
          : "当前状态无法执行这个操作，进度保持不变。";
        setFeedback(receipt);
        if (
          state.current.index === context.index &&
          state.current.phase !== "completed"
        )
          appendTurn({
            id: crypto.randomUUID(),
            role: "assistant",
            text: `${reply.message}\n\n${receipt}`,
          });
      } else {
        if (reply.type === "explanation")
          update(transition(state.current, "explain", context.round));
        const turn: ConversationTurn = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: reply.message,
          ...(reply.type === "explanation"
            ? { explanation: reply.explanation }
            : {}),
        };
        appendTurn(turn);
        setFeedback(
          reply.type === "explanation"
            ? "讲解已准备好，听写仍停留在当前项。"
            : "已回复，进度保持不变。",
        );
        if (autoSpeakRef.current) void speakTurn(turn);
      }
    } catch (error) {
      if (valid()) {
        const message = `助手暂时没有完成：${String(error).replace(/^Error: /, "")}。你可以重试，或继续使用听写按钮。`;
        appendTurn({
          id: crypto.randomUUID(),
          role: "assistant",
          text: message,
        });
        setFeedback("助手请求失败，当前进度未改变。");
      }
    } finally {
      if (generation === assistantGeneration.current && mounted.current) {
        setAssistantBusy(false);
        assistantAbort.current = null;
      }
    }
  }
  const actionRef = useRef(action);
  actionRef.current = action;
  async function transcript(t: Transcript) {
    if (
      !mounted.current ||
      !microphone.current?.active ||
      !t.final ||
      seen.current.has(t.id)
    )
      return;
    seen.current.add(t.id);
    if (seen.current.size > 100)
      seen.current.delete(seen.current.values().next().value!);
    const intent = parseIntent(t.text);
    const current = state.current;
    if (t.round !== current.round) return;
    const echoWindow =
      current.phase === "playing" ||
      current.phase === "preparing" ||
      narration.current?.active ||
      t.started < ringUntil.current;
    if (echoWindow) {
      const spoken =
        current.items[current.index]?.pronunciation ||
        current.items[current.index]?.spoken ||
        "";
      if (
        intent !== "pause" ||
        (narration.current?.active &&
          parseIntent(narrationText.current) === "pause") ||
        (current.phase === "playing" && parseIntent(spoken) === "pause")
      ) {
        setFeedback("朗读时先暂停再提问，避免扬声器回声误操作。");
        return;
      }
      actionRef.current("pause", t.round);
      setFeedback("已暂停，现在可以继续说你的想法。");
      return;
    }
    if (
      intent === "pause" &&
      /^(暂停|等一下|先停一下|停一下)[。！!，,\s]*$/.test(t.text)
    ) {
      actionRef.current("pause", t.round);
      setFeedback("已暂停，可以自然地继续提问。");
      return;
    }
    await askAssistant(t.text, "voice");
    if (microphone.current?.active) setMicStatus("麦克风已开启 · 可以直接对话");
  }
  async function toggleMic() {
    if (micPending.current) return;
    if (mic) {
      cancelAssistant();
      microphone.current?.stop();
      setMic(false);
      setMicStatus("麦克风未开启");
      return;
    }
    micPending.current = true;
    try {
      await api("health").then((d) => {
        if (d.ASR.state === "missing")
          throw Error("ASR 未配置，仍可输入文字与助手对话或使用按钮");
      });
      if (!mounted.current) return;
      const m = new Microphone();
      microphone.current = m;
      await m.start(
        () => state.current.round,
        (t) => void transcript(t),
        setMicStatus,
      );
      if (!mounted.current) {
        m.stop();
        return;
      }
      setMic(true);
    } catch (e) {
      microphone.current?.stop();
      setMicStatus("麦克风不可用 · 可以输入文字对话");
      notify(String(e));
    } finally {
      micPending.current = false;
    }
  }
  useEffect(() => {
    stopPreview();
    mounted.current = true;
    const visibility = () => {
      if (document.hidden) {
        actionRef.current("pause");
        microphone.current?.stop();
        setMic(false);
        setMicStatus("已进入后台，麦克风已关闭");
      } else if (state.current.phase === "paused")
        setFeedback("页面曾进入后台，请主动继续听写");
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      cancelAssistant();
      stop();
      microphone.current?.stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (s.phase === "completed") {
      cancelAssistant();
      stop();
      microphone.current?.stop();
      onComplete(s);
    }
  }, [s.phase]);
  useEffect(() => {
    if (s.phase !== "preparing") return;
    const token = ++playToken.current;
    const controller = new AbortController();
    playbackAbort.current = controller;
    const item = s.items[s.index];
    const data = {
      backend: s.settings.ttsBackend || "edge-tts",
      text: item.spoken,
      voice: s.settings.voice,
      speed: s.settings.speed,
      language: item.language,
      pronunciation: item.pronunciation,
    };
    let url = "";
    const valid = () => mounted.current && token === playToken.current;
    (async () => {
      try {
        const blob = await audioBlob(data, controller.signal);
        if (!valid()) return;
        url = URL.createObjectURL(blob);
        for (let i = 0; i < s.settings.repeats; i++) {
          if (!valid()) return;
          const a = new Audio(url);
          audio.current = a;
          update({ ...state.current, phase: "playing" });
          await new Promise<void>((resolve, reject) => {
            cancelWait.current = () => reject(new Error("播放已取消"));
            a.onended = () => {
              cancelWait.current = null;
              resolve();
            };
            a.onerror = () => reject(Error("音频播放失败，请重试当前项"));
            a.play().catch(reject);
          });
          if (!valid()) return;
          if (i < s.settings.repeats - 1) {
            await new Promise((r) => setTimeout(r, s.settings.gap * 1000));
          }
        }
        if (!valid()) return;
        ringUntil.current = Date.now() + 800;
        update({ ...state.current, phase: "waiting" });
        const next = s.items[s.index + 1];
        if (next)
          void audioBlob(
            {
              ...data,
              text: next.spoken,
              language: next.language,
              pronunciation: next.pronunciation,
            },
            controller.signal,
          ).catch(() => {});
      } catch (e) {
        if (valid())
          update({ ...state.current, phase: "error", error: String(e) });
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    })();
    // A round is the sole playback trigger. Phase changes never replay audio.
  }, [s.round]);
  const item = s.items[s.index];
  return (
    <section className="session panel">
      <div className="session-top">
        <span className="eyebrow">
          专注听写 · {s.settings.mode} ·{" "}
          {s.settings.ttsBackend === "mlx-audio" ? "本地语音" : "Edge 在线语音"}
        </span>
        <button onClick={() => action("end")}>
          <Square size={15} />
          结束听写
        </button>
      </div>
      <div className="progress">
        <i style={{ width: `${(s.index / s.items.length) * 100}%` }} />
      </div>
      <p className="muted">
        第 <strong>{s.index + 1}</strong> / {s.items.length} 项
      </p>
      <div
        className={`sound-orb ${s.phase === "playing" || narrating === "playing" ? "pulsing" : ""}`}
      >
        <Volume2 size={46} strokeWidth={1.3} />
      </div>
      <h1 aria-live="polite">
        {narrating === "loading"
          ? "正在准备讲解"
          : narrating === "playing"
            ? "正在为你讲解"
            : labels[s.phase]}
      </h1>
      <p className="muted">
        {s.phase === "waiting"
          ? "慢慢写，我会一直等你。"
          : s.phase === "paused"
            ? "准备好后，继续这一项。"
            : "每一项，都按你的节奏。"}
      </p>
      {(revealed || s.settings.showAnswer) && (
        <div className="answer">{item.answer}</div>
      )}
      {s.error && s.phase === "error" && <p className="error">{s.error}</p>}
      <div className="main-controls">
        <button onClick={() => action("previous")} disabled={s.index === 0}>
          <ArrowLeft />
          上一项
        </button>
        <button onClick={() => action("repeat")}>
          <RotateCcw />
          再听一遍
        </button>
        <button
          className="primary"
          disabled={s.phase !== "waiting"}
          onClick={() => action("next")}
        >
          <span>
            {s.index === s.items.length - 1
              ? "写完，完成听写"
              : "写好了，下一项"}
          </span>
          <ArrowRight />
        </button>
        <button
          onClick={() =>
            action(
              s.phase === "paused" || s.phase === "idle" || s.phase === "error"
                ? "resume"
                : "pause",
            )
          }
        >
          {s.phase === "paused" || s.phase === "idle" || s.phase === "error" ? (
            <Play />
          ) : (
            <Pause />
          )}
          {s.phase === "paused" || s.phase === "idle" || s.phase === "error"
            ? "继续"
            : "暂停"}
        </button>
      </div>
      <div className="row centered">
        <button onClick={() => action("mark")}>
          <Flag size={16} />
          {item.marked ? "已标记" : "标记不会"}
        </button>
        {s.settings.allowHints && (
          <>
            <button
              onClick={() => {
                cancelAssistant();
                setRevealed(true);
                update({
                  ...state.current,
                  items: state.current.items.map((v, i) =>
                    i === s.index ? { ...v, hint: true } : v,
                  ),
                });
              }}
            >
              <Eye size={16} />
              查看答案
            </button>
            <button onClick={() => action("explain")}>解释与提示</button>
          </>
        )}
        <button onClick={() => action("slower")}>
          慢一点 · {s.settings.speed.toFixed(1)}×
        </button>
      </div>
      <SessionConversation
        turns={turns}
        busy={assistantBusy}
        onSend={(text) => void askAssistant(text)}
        onCancel={() => {
          cancelAssistant();
          setFeedback("助手已取消，当前进度未改变。");
        }}
        autoSpeak={autoSpeak}
        onAutoSpeak={(value) => {
          setAutoSpeak(value);
          if (!value) narration.current?.stop();
        }}
        narrating={narrating}
        speakingId={speakingId}
        onSpeak={(turn) => {
          cancelAssistant();
          void speakTurn(turn);
        }}
        onStop={() => narration.current?.stop()}
      />
      {mic && (
        <div className="mic-live" role="status">
          <Mic size={15} />
          麦克风正在工作<button onClick={toggleMic}>关闭</button>
        </div>
      )}
      <div className="voice-strip">
        <button className={mic ? "selected" : ""} onClick={toggleMic}>
          {mic ? <Mic size={18} /> : <MicOff size={18} />}{" "}
          {mic ? "关闭麦克风" : "开启语音对话"}
        </button>
        <span>{micStatus}</span>
      </div>
      <p className="feedback" aria-live="polite">
        {feedback}
      </p>
      <p className="note">
        开启后会将短录音发送给语音识别服务，再由助手理解并选择操作。朗读时可说“暂停”打断；嘈杂环境建议使用耳机。
      </p>
      {s.phase === "confirming" && (
        <div className="modal-backdrop">
          <div className="panel modal">
            <h2>结束这次听写？</h2>
            <p>已确认完成 {s.index} 项。当前进度会保留。</p>
            <button
              className="primary"
              onClick={() =>
                update({
                  ...state.current,
                  phase: "completed",
                  confirmedCount: state.current.index,
                  ended: Date.now(),
                })
              }
            >
              确认结束
            </button>
            <button
              onClick={() =>
                update({
                  ...state.current,
                  phase: "paused",
                  round: state.current.round + 1,
                })
              }
            >
              继续听写
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
