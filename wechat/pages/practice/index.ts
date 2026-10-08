import {
  transition,
  isPlaybackCommand,
  sessionContext,
  isCurrentSessionTurn,
  commandLabels,
  type Session,
  type Intent,
  type HistoryDocument,
  type SessionAgentReply,
  type SessionContext,
} from "../../shared";
import { ai } from "../../utils/api";
import {
  readDocument,
  writeLocal,
  syncDocument,
  saveDocument,
} from "../../utils/storage";
import { AudioPlayer } from "../../utils/audio";
import { ContinuousRecorder, SpeechTurns } from "../../utils/listening";
import { dictationCommand } from "../../utils/commands";
import { readWork, saveWork } from "../../utils/workspace";
import { TaskScope, Cancelled } from "../../utils/task";
import {
  confirm,
  showError,
  requireLogin,
  type TapEvent,
} from "../../utils/ui";

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
  data: {
    loading: true,
    error: "",
    phase: "idle",
    label: "准备好就开始",
    index: 1,
    total: 0,
    progress: 0,
    answer: "",
    marked: false,
    speed: 1,
    syncError: "",
    finishing: false,
    voiceEnabled: true,
    micState: "off",
    voiceError: "",
    heard: "",
    voiceFeedback: "",
    showVoiceHelp: false,
  },
  session: null as Session | null,
  player: null as AudioPlayer | null,
  recorder: null as ContinuousRecorder | null,
  vad: new SpeechTurns<SessionContext>(),
  listenScope: null as TaskScope | null,
  voiceScope: null as TaskScope | null,
  micLive: false,
  visible: true,
  finishing: false,
  echoUntil: 0,
  beforeEnd: "paused" as Session["phase"],
  interrupt: null as (() => void) | null,
  async onLoad(options: Record<string, string | undefined>) {
    if (!requireLogin("/pages/practice/index")) return;
    this.player = new AudioPlayer();
    this.recorder = new ContinuousRecorder();
    this.setData({ voiceEnabled: readWork<boolean>("voice-enabled") ?? true });
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
      this.session = {
        ...session,
        phase: ["playing", "preparing", "confirming"].includes(session.phase)
          ? "paused"
          : session.phase,
        round: session.round + 1,
      };
      this.render();
      this.setData({ loading: false });
      wx.setKeepScreenOn?.({ keepScreenOn: this.visible });
      if (this.data.voiceEnabled && this.visible) await this.startListening();
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
    if (this.session) {
      wx.setKeepScreenOn?.({ keepScreenOn: true });
      if (this.data.voiceEnabled) void this.startListening();
    }
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
      answer: session.settings.showAnswer ? item.answer : "",
      marked: item.marked,
      speed: Math.round(session.settings.speed * 10) / 10,
      error: session.error || "",
    });
    this.refreshMicState();
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
  cancelVoiceRequest() {
    this.voiceScope?.cancel();
    this.voiceScope = null;
    this.vad.reset();
    this.refreshMicState();
  },
  stopListening() {
    this.listenScope?.cancel();
    this.listenScope = null;
    this.micLive = false;
    this.cancelVoiceRequest();
    this.refreshMicState();
  },
  stopAudio() {
    this.player?.stop();
    this.echoUntil = Date.now() + 750;
    this.vad.reset();
  },
  pauseForBackground() {
    wx.setKeepScreenOn?.({ keepScreenOn: false });
    this.stopListening();
    this.stopAudio();
    if (this.session && this.session.phase !== "completed")
      this.update(
        {
          ...this.session,
          phase: ["playing", "preparing", "confirming"].includes(
            this.session.phase,
          )
            ? "paused"
            : this.session.phase,
          round: this.session.round + 1,
        },
        true,
      );
  },
  togglePlayback() {
    this.action(
      ["playing", "preparing"].includes(this.data.phase)
        ? "pause"
        : this.data.phase === "waiting"
          ? "repeat"
          : "resume",
    );
  },
  tapAction(event: TapEvent) {
    this.action(event.currentTarget.dataset.intent as Intent);
  },
  action(intent: Intent, round?: number, fromVoice = false) {
    const current = this.session;
    round ??= current?.round;
    if (
      !current ||
      round !== current.round ||
      !this.visible ||
      ["completed", "confirming"].includes(current.phase)
    )
      return false;
    if (intent === "explain" || intent === "unknown") return false;
    if (!fromVoice) this.cancelVoiceRequest();
    this.vad.reset();
    // Already waiting for handwriting: "等一下" must not force another playback.
    if (intent === "pause" && current.phase === "waiting") return true;
    if (intent === "end")
      this.beforeEnd = ["playing", "preparing", "confirming"].includes(
        current.phase,
      )
        ? "paused"
        : current.phase;
    const next =
      !fromVoice && intent === "mark" && current.items[current.index].marked
        ? {
            ...current,
            items: current.items.map((item, index) =>
              index === current.index ? { ...item, marked: false } : item,
            ),
          }
        : transition(current, intent, round);
    if (next === current) return false;
    if (isPlaybackCommand(intent)) this.stopAudio();
    if (next.index !== current.index)
      this.setData({ heard: "", voiceFeedback: "" });
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
        { ...current, phase: this.beforeEnd, round: current.round + 1 },
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
        this.echoUntil = Date.now() + 750;
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
  refreshMicState() {
    let micState = "off";
    if (
      this.data.voiceEnabled &&
      this.visible &&
      this.session?.phase !== "completed"
    ) {
      micState = this.data.voiceError
        ? "error"
        : !this.listenScope
          ? "off"
          : !this.micLive
            ? "starting"
            : this.voiceScope
              ? "processing"
              : !this.canHear()
                ? "muted"
                : this.vad.speaking
                  ? "speech"
                  : "listening";
    }
    if (micState !== this.data.micState) this.setData({ micState });
  },
  canHear() {
    return Boolean(
      this.visible &&
      this.data.voiceEnabled &&
      this.micLive &&
      this.session &&
      ["waiting", "idle", "paused", "error"].includes(this.session.phase) &&
      Date.now() >= this.echoUntil,
    );
  },
  async startListening() {
    if (
      this.listenScope ||
      !this.session ||
      !this.visible ||
      !this.data.voiceEnabled ||
      ["completed", "confirming"].includes(this.session.phase)
    )
      return;
    const scope = (this.listenScope = new TaskScope());
    this.setData({ voiceError: "" });
    this.refreshMicState();
    try {
      this.recorder ||= new ContinuousRecorder();
      await this.recorder.start(
        scope,
        (frame) => this.hearFrame(frame),
        (error) => {
          if (this.listenScope === scope) this.microphoneFailed(error);
        },
      );
      scope.check();
      this.micLive = true;
      this.refreshMicState();
    } catch (error) {
      if (!(error instanceof Cancelled) && this.listenScope === scope)
        this.microphoneFailed(error);
    }
  },
  microphoneFailed(error: unknown) {
    this.stopListening();
    this.setData({
      voiceError:
        error instanceof Error ? error.message : "语音控制暂不可用，请重试",
    });
    this.refreshMicState();
  },
  hearFrame(frame: ArrayBuffer) {
    if (!this.canHear() || this.voiceScope || !this.session) {
      this.vad.reset();
      this.refreshMicState();
      return;
    }
    const turn = this.vad.push(frame, sessionContext(this.session));
    this.refreshMicState();
    if (turn) void this.voiceCommand(turn.wave, turn.context);
  },
  async voiceCommand(wave: ArrayBuffer, context: SessionContext) {
    if (
      !this.session ||
      !this.canHear() ||
      this.voiceScope ||
      !isCurrentSessionTurn(context, this.session)
    )
      return;
    const scope = (this.voiceScope = new TaskScope());
    const timeout = setTimeout(() => {
      if (this.voiceScope === scope)
        this.microphoneFailed(
          new Error("语音识别等待较久，请检查网络后重新开启"),
        );
    }, 20000);
    this.refreshMicState();
    try {
      const transcript = await ai<{ text: string; final: boolean }>(
        "asr",
        { audio: wx.arrayBufferToBase64(wave), mime: "audio/wav" },
        scope,
      );
      scope.check();
      if (
        !this.session ||
        !this.visible ||
        !this.data.voiceEnabled ||
        !isCurrentSessionTurn(context, this.session)
      )
        return;
      if (transcript.final !== true || !transcript.text.trim()) return;
      const text = transcript.text.trim();
      this.setData({ heard: text, voiceFeedback: "" });
      const parsed = dictationCommand(text, context.phase);
      let intent = parsed.intent;
      if (parsed.infer) {
        const reply = await ai<SessionAgentReply>(
          "session-agent",
          {
            text,
            context: { ...context, allowHints: false },
            history: [],
          },
          scope,
        );
        scope.check();
        // This page only accepts controls. Explanations and chat never render or play.
        intent = reply.type === "control" ? reply.command : "unknown";
      }
      if (
        !this.session ||
        !this.visible ||
        !this.data.voiceEnabled ||
        !isCurrentSessionTurn(context, this.session)
      )
        return;
      const applied = this.action(intent, context.round, true);
      this.setData({
        heard: text,
        voiceFeedback: applied
          ? intent === "pause" && context.phase === "waiting"
            ? "好，我等你写好"
            : `已执行：${commandLabels[intent as keyof typeof commandLabels]}`
          : "没有切换题目。可以说“再读一遍”“写好了”或“等一下”。",
      });
    } catch (error) {
      if (!(error instanceof Cancelled) && this.voiceScope === scope)
        this.microphoneFailed(error);
    } finally {
      clearTimeout(timeout);
      if (this.voiceScope === scope) {
        this.voiceScope = null;
        this.refreshMicState();
      }
    }
  },
  voiceToggle(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const enabled = event.detail.value;
    this.setData({
      voiceEnabled: enabled,
      voiceError: "",
      heard: "",
      voiceFeedback: "",
    });
    try {
      saveWork("voice-enabled", enabled);
    } catch (error) {
      showError(error);
    }
    if (enabled) void this.startListening();
    else this.stopListening();
  },
  retryListening() {
    void this.startListening();
  },
  voiceHelp() {
    this.setData({ showVoiceHelp: !this.data.showVoiceHelp });
  },
  permissions() {
    wx.openSetting({});
  },
  async finish() {
    if (!this.session || this.finishing) return;
    this.finishing = true;
    this.setData({ finishing: true });
    this.stopListening();
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
      else await syncDocument(key);
      await syncDocument("session");
      wx.redirectTo({
        url: `/pages/result/index?id=${encodeURIComponent(session.id)}`,
        fail: () => {
          this.finishing = false;
          this.setData({
            finishing: false,
            syncError: "结果页面未打开，点击下方按钮重试",
          });
        },
      });
    } catch (error) {
      this.setData({
        syncError:
          error instanceof Error ? error.message : "保存未完成，请重试",
      });
      this.finishing = false;
      this.setData({ finishing: false });
    }
  },
  finishRetry() {
    void this.finish();
  },
});
