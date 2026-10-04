import {
  transition,
  isPlaybackCommand,
  sessionContext,
  isCurrentSessionTurn,
  commandLabels,
  explanationText,
  readableText,
  recordId,
  type Session,
  type Intent,
  type Explanation,
  type HistoryDocument,
  type SessionAgentReply,
} from "../../shared";
import { ai } from "../../utils/api";
import {
  readDocument,
  writeLocal,
  syncDocument,
  saveDocument,
} from "../../utils/storage";
import { AudioPlayer } from "../../utils/audio";
import { VoiceRecorder, readBytes } from "../../utils/media";
import { TaskScope, Cancelled } from "../../utils/task";
import { formFocus } from "../../behaviors/form";
import {
  confirm,
  notify,
  showError,
  requireLogin,
  type InputEvent,
  type TapEvent,
} from "../../utils/ui";

type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  explanation?: Explanation;
};
const labels: Record<Session["phase"], string> = {
  idle: "准备好就开始",
  preparing: "正在准备声音",
  playing: "仔细听，慢慢记",
  waiting: "等你写好",
  paused: "休息一下也没关系",
  confirming: "确认结束这次听写",
  completed: "这次练习完成了",
  error: "声音暂时没跟上",
};
Page({
  behaviors: [formFocus],
  data: {
    loading: true,
    error: "",
    phase: "idle",
    label: "准备好就开始",
    index: 1,
    total: 0,
    progress: 0,
    answer: "",
    revealed: false,
    marked: false,
    speed: 1,
    allowHints: true,
    showAnswer: false,
    turns: [] as Turn[],
    input: "",
    assistantBusy: false,
    recording: false,
    recordBusy: false,
    feedback: "",
    speakingId: "",
    narrating: false,
    autoSpeak: true,
    syncError: "",
  },
  session: null as Session | null,
  player: null as AudioPlayer | null,
  recorder: null as VoiceRecorder | null,
  assistantScope: null as TaskScope | null,
  recordScope: null as TaskScope | null,
  visible: true,
  finishing: false,
  echoUntil: 0,
  interrupt: null as (() => void) | null,
  async onLoad(options: Record<string, string | undefined>) {
    if (!requireLogin()) return;
    this.player = new AudioPlayer();
    this.recorder = new VoiceRecorder();
    this.interrupt = () => this.pauseForBackground();
    wx.onAudioInterruptionBegin(this.interrupt);
    try {
      const session = await readDocument<Session>("session");
      if (!session?.items.length)
        throw new Error("还没有正在进行的听写，请先准备一份清单");
      this.session = session;
      if (session.phase === "completed") {
        await this.finish();
        return;
      }
      this.session = { ...session, phase: "paused", round: session.round + 1 };
      this.render();
      if (options.autostart === "1" && this.visible) this.action("resume");
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "听写读取失败",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  onShow() {
    this.visible = true;
  },
  home() {
    wx.switchTab({ url: "/pages/home/index" });
  },
  onHide() {
    this.visible = false;
    this.pauseForBackground();
  },
  onUnload() {
    this.visible = false;
    this.pauseForBackground();
    if (this.interrupt) wx.offAudioInterruptionBegin(this.interrupt);
  },
  render() {
    const session = this.session;
    if (!session) return;
    const item = session.items[session.index];
    this.setData({
      phase: session.phase,
      label: labels[session.phase],
      index: session.index + 1,
      total: session.items.length,
      progress: Math.round(
        ((session.phase === "completed"
          ? session.items.length
          : session.index) /
          session.items.length) *
          100,
      ),
      answer:
        this.data.revealed || session.settings.showAnswer ? item.answer : "",
      marked: item.marked,
      speed: Math.round(session.settings.speed * 10) / 10,
      allowHints: session.settings.allowHints,
      showAnswer: session.settings.showAnswer,
      error: session.error || "",
    });
  },
  update(session: Session, sync = false) {
    this.session = session;
    this.render();
    try {
      writeLocal("session", session);
    } catch (error) {
      this.setData({
        syncError: error instanceof Error ? error.message : "本机记录保存失败",
      });
    }
    if (sync) void this.sync();
  },
  async sync() {
    try {
      await syncDocument("session");
      this.setData({ syncError: "" });
    } catch (error) {
      if (!(error instanceof Cancelled))
        this.setData({
          syncError:
            error instanceof Error
              ? error.message
              : "云端同步失败，本机已保留进度",
        });
    }
  },
  cancelAssistant() {
    this.assistantScope?.cancel();
    this.assistantScope = null;
    this.setData({ assistantBusy: false });
  },
  cancelRecording() {
    this.recordScope?.cancel();
    this.recordScope = null;
    this.setData({ recording: false, recordBusy: false });
  },
  stopAudio() {
    this.player?.stop();
    this.echoUntil = Date.now() + 800;
    this.setData({ speakingId: "", narrating: false });
  },
  pauseForBackground() {
    this.cancelAssistant();
    this.cancelRecording();
    this.stopAudio();
    if (this.session && this.session.phase !== "completed")
      this.update(
        { ...this.session, phase: "paused", round: this.session.round + 1 },
        true,
      );
  },
  tapAction(event: TapEvent) {
    this.action(event.currentTarget.dataset.intent as Intent);
  },
  action(intent: Intent, round?: number, fromAgent = false) {
    const current = this.session;
    round ??= current?.round;
    if (!current || round === undefined || !this.visible) return false;
    if (!fromAgent) this.cancelAssistant();
    this.cancelRecording();
    if (intent === "explain") {
      if (current.settings.allowHints)
        void this.ask("请解释当前词语，并给出一个记忆方法和例句。");
      return false;
    }
    const next = transition(current, intent, round);
    if (next === current) return false;
    if (isPlaybackCommand(intent)) this.stopAudio();
    if (next.index !== current.index)
      this.setData({ revealed: false, turns: [], feedback: "" });
    this.update(next, ["paused", "waiting", "completed"].includes(next.phase));
    if (next.phase === "completed") void this.finish();
    else if (next.phase === "confirming") void this.confirmEnd();
    else if (next.phase === "preparing" && next.round !== current.round)
      void this.readCurrent();
    return true;
  },
  async confirmEnd() {
    const current = this.session;
    if (!current || current.phase !== "confirming") return;
    const accepted = await confirm(
      "结束这次听写？",
      `目前明确确认了 ${current.index} 项。尚未确认的项目会保留为待核查。`,
      "结束听写",
    );
    if (!this.visible || this.session?.round !== current.round) return;
    if (accepted) {
      this.update({
        ...current,
        phase: "completed",
        ended: Date.now(),
        confirmedCount: current.index,
        round: current.round + 1,
      });
      await this.finish();
    } else
      this.update(
        { ...current, phase: "paused", round: current.round + 1 },
        true,
      );
  },
  async readCurrent() {
    const session = this.session;
    if (!session || !this.visible) return;
    const round = session.round;
    try {
      await this.player!.playItem(
        session.items[session.index],
        session.settings,
        (state) => {
          if (
            !this.visible ||
            this.session?.round !== round ||
            state === "idle"
          )
            return;
          this.update({
            ...this.session,
            phase: state === "playing" ? "playing" : "preparing",
          });
        },
      );
      if (this.visible && this.session?.round === round) {
        this.echoUntil = Date.now() + 800;
        this.update({ ...this.session, phase: "waiting" }, true);
      }
    } catch (error) {
      if (
        !(error instanceof Cancelled) &&
        this.visible &&
        this.session?.round === round
      )
        this.update(
          {
            ...this.session,
            phase: "error",
            error:
              error instanceof Error ? error.message : "朗读失败，请重读当前项",
          },
          true,
        );
    }
  },
  reveal() {
    if (!this.session) return;
    this.setData({ revealed: !this.data.revealed });
    if (this.data.revealed)
      this.update(transition(this.session, "explain", this.session.round));
    this.render();
  },
  input(event: InputEvent) {
    this.setData({ input: event.detail.value });
  },
  send() {
    const text = this.data.input.trim();
    if (text) {
      this.setData({ input: "" });
      void this.ask(text);
    }
  },
  append(turn: Turn) {
    this.setData({ turns: [...this.data.turns, turn].slice(-12) });
  },
  async ask(text: string) {
    if (
      !this.session ||
      !this.visible ||
      ["completed", "confirming"].includes(this.session.phase)
    )
      return;
    this.cancelAssistant();
    this.cancelRecording();
    this.stopAudio();
    if (["playing", "preparing"].includes(this.session.phase))
      this.update(transition(this.session, "pause", this.session.round));
    const context = sessionContext(this.session),
      history = this.data.turns.slice(-8).map((turn) => ({
        role: turn.role,
        content: turn.text.slice(0, 30000),
      }));
    const scope = (this.assistantScope = new TaskScope());
    this.append({ id: recordId(), role: "user", text });
    this.setData({ assistantBusy: true, feedback: "听见正在理解你的想法…" });
    try {
      const reply = await ai<SessionAgentReply>(
        "session-agent",
        { text, context, history },
        scope,
      );
      scope.check();
      if (
        !this.visible ||
        !this.session ||
        !isCurrentSessionTurn(context, this.session)
      )
        return;
      if (reply.type === "control") {
        const applied = this.action(reply.command, context.round, true);
        this.setData({
          feedback: applied
            ? `已执行：${commandLabels[reply.command]}`
            : "当前还不能执行这个操作，进度保持不变。",
        });
        if (
          this.session.index === context.index &&
          this.session.phase !== "completed"
        )
          this.append({
            id: recordId(),
            role: "assistant",
            text: readableText(reply.message),
          });
      } else {
        if (reply.type === "explanation")
          this.update(transition(this.session, "explain", context.round));
        const turn: Turn = {
          id: recordId(),
          role: "assistant",
          text:
            reply.type === "explanation"
              ? explanationText(reply.explanation)
              : readableText(reply.message),
          ...(reply.type === "explanation"
            ? { explanation: reply.explanation }
            : {}),
        };
        this.append(turn);
        this.setData({ feedback: "" });
        if (this.data.autoSpeak) void this.speak(turn);
      }
    } catch (error) {
      if (!(error instanceof Cancelled)) {
        this.setData({
          feedback:
            error instanceof Error
              ? error.message
              : "助手暂时没能回答，听写进度已保留",
        });
      }
    } finally {
      if (this.assistantScope === scope) {
        this.assistantScope = null;
        this.setData({ assistantBusy: false });
      }
    }
  },
  autoSpeak(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ autoSpeak: event.detail.value });
    if (!event.detail.value) this.stopNarration();
  },
  speakTurn(event: TapEvent) {
    const turn = this.data.turns.find(
      (turn) => turn.id === event.currentTarget.dataset.id,
    );
    if (turn) void this.speak(turn);
  },
  async speak(turn: Turn) {
    if (
      !this.session ||
      !this.visible ||
      ["completed", "confirming"].includes(this.session.phase)
    )
      return;
    this.cancelRecording();
    this.stopAudio();
    if (["playing", "preparing"].includes(this.session.phase))
      this.update(transition(this.session, "pause", this.session.round));
    this.setData({ speakingId: turn.id, narrating: true });
    try {
      await this.player!.narrate(turn.text, this.session.settings, () => {});
    } catch (error) {
      if (!(error instanceof Cancelled))
        notify("文字讲解已保留，暂时无法朗读，可以稍后重听");
    } finally {
      if (this.data.speakingId === turn.id) {
        this.echoUntil = Date.now() + 800;
        this.setData({ speakingId: "", narrating: false });
      }
    }
  },
  stopNarration() {
    if (this.data.narrating) this.stopAudio();
  },
  async voice() {
    if (this.data.recording) {
      this.recorder?.stop();
      return;
    }
    if (this.data.recordBusy || !this.session) return;
    this.cancelAssistant();
    this.stopAudio();
    if (["playing", "preparing"].includes(this.session.phase))
      this.update(transition(this.session, "pause", this.session.round));
    const round = this.session.round,
      scope = (this.recordScope = new TaskScope());
    this.setData({ recordBusy: true, feedback: "准备录音…" });
    try {
      await scope.wait(Math.max(0, this.echoUntil - Date.now()));
      const path = await this.recorder!.capture(scope, () =>
        this.setData({
          recording: true,
          feedback: "正在听，最长 20 秒。说完后点击发送。",
        }),
      );
      scope.check();
      this.setData({ recording: false, feedback: "正在把你的语音转成文字…" });
      const bytes = await readBytes(path);
      scope.check();
      const transcript = await ai<{ text: string }>(
        "asr",
        { audio: wx.arrayBufferToBase64(bytes), mime: "audio/mpeg" },
        scope,
      );
      scope.check();
      if (this.session?.round !== round || !this.visible) return;
      this.recordScope = null;
      this.setData({ recordBusy: false });
      if (!transcript.text.trim()) notify("没有听清，请再说一次或直接打字");
      else await this.ask(transcript.text);
    } catch (error) {
      showError(error);
    } finally {
      if (this.recordScope === scope) {
        this.recordScope = null;
        this.setData({ recording: false, recordBusy: false });
      }
    }
  },
  async finish() {
    if (!this.session || this.finishing) return;
    this.finishing = true;
    this.cancelAssistant();
    this.cancelRecording();
    this.stopAudio();
    const session = this.session,
      key = `history:${session.id}`;
    try {
      const previous = await readDocument<HistoryDocument>(key);
      if (!previous)
        await saveDocument(key, {
          session,
          results: session.items.map(() => ({
            recognized: "",
            status: "待确认",
            reason: "尚未核查",
            confirmed: false,
          })),
        });
      await syncDocument("session");
      wx.redirectTo({
        url: `/pages/result/index?id=${encodeURIComponent(session.id)}`,
      });
    } catch (error) {
      this.setData({
        syncError:
          error instanceof Error ? error.message : "保存未完成，请重试",
      });
      this.finishing = false;
    }
  },
  finishRetry() {
    void this.finish();
  },
  backHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
