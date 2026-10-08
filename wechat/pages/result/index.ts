import {
  grade,
  type HistoryDocument,
  type Item,
  type Grading,
} from "../../shared";
import { ai } from "../../utils/api";
import {
  readDocument,
  writeLocal,
  syncDocument,
  dirty,
} from "../../utils/storage";
import { choosePhoto, photoData } from "../../utils/media";
import { prepareReview } from "../../utils/review";
import { TaskScope, Cancelled } from "../../utils/task";
import { formFocus } from "../../behaviors/form";
import {
  notify,
  showError,
  confirm,
  requireLogin,
  type InputEvent,
  type TapEvent,
} from "../../utils/ui";

type ResultView = Grading & {
  id: string;
  number: number;
  answer: string;
  spoken: string;
};
Page({
  behaviors: [formFocus],
  data: {
    loading: true,
    error: "",
    rows: [] as ResultView[],
    total: 0,
    written: 0,
    confirmed: 0,
    correct: 0,
    wrong: 0,
    accuracy: "—",
    photo: "",
    busy: false,
    pending: false,
    message: "",
    caseSensitive: false,
    punctuation: false,
    showRules: false,
    recognizing: false,
    saving: false,
    reviewFilter: "pending",
    remaining: 0,
    candidateCorrect: 0,
    editingIndex: -1,
    syncError: "",
    syncConflict: false,
    undoLabel: "",
    taskError: "",
  },
  record: null as HistoryDocument | null,
  key: "",
  scope: null as TaskScope | null,
  picking: false,
  lastAssessment: null as { index: number; result: Grading } | null,
  conflictKey: "",
  async onLoad(options: Record<string, string | undefined>) {
    if (
      !requireLogin(
        `/pages/result/index?id=${encodeURIComponent(options.id || "")}`,
      )
    )
      return;
    this.key = `history:${options.id || ""}`;
    try {
      this.record = await readDocument<HistoryDocument>(this.key);
      if (!this.record) throw new Error("没有找到这份听写记录");
      if (this.record.results.every((result) => result.confirmed))
        this.setData({ reviewFilter: "all" });
      this.render();
    } catch (error) {
      this.setData({
        error: error instanceof Error ? error.message : "记录读取失败",
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  onHide() {
    if (!this.picking) this.cancel();
  },
  onUnload() {
    this.cancel();
  },
  render(afterRender?: () => void) {
    if (!this.record) return;
    const { session, results } = this.record;
    const confirmed = results.filter(
      (result) =>
        result.confirmed && ["正确", "错误", "漏写"].includes(result.status),
    );
    const correct = confirmed.filter(
      (result) => result.status === "正确",
    ).length;
    this.setData(
      {
        rows: results
          .map((result, index) => ({
            ...result,
            id: session.items[index].id,
            number: index + 1,
            answer: session.items[index].answer,
            spoken: session.items[index].spoken,
          }))
          .filter(
            (result) =>
              result.number - 1 === this.data.editingIndex ||
              this.data.reviewFilter === "all" ||
              (this.data.reviewFilter === "pending"
                ? !result.confirmed
                : result.confirmed && ["错误", "漏写"].includes(result.status)),
          ),
        remaining: results.length - confirmed.length,
        candidateCorrect: results.filter(
          (result) =>
            !result.confirmed &&
            result.status === "正确" &&
            result.recognized.trim(),
        ).length,
        total: session.items.length,
        written: session.confirmedCount ?? session.index,
        confirmed: confirmed.length,
        correct,
        wrong: confirmed.length - correct,
        accuracy: confirmed.length
          ? `${Math.round((correct / confirmed.length) * 100)}%`
          : "—",
        pending: dirty(this.key) || dirty("wrong"),
      },
      afterRender,
    );
  },
  changed() {
    if (!this.record) return;
    try {
      writeLocal(this.key, this.record);
      this.render();
    } catch (error) {
      showError(error);
    }
  },
  async choose() {
    if (this.data.busy) return;
    this.picking = true;
    try {
      const photo = await choosePhoto();
      this.setData({ photo });
    } catch (error) {
      showError(error);
    } finally {
      this.picking = false;
    }
  },
  preview() {
    if (this.data.photo) wx.previewImage({ urls: [this.data.photo] });
  },
  toggleRules() {
    this.setData({ showRules: !this.data.showRules });
  },
  retryLoad() {
    wx.redirectTo({
      url: `/pages/result/index?id=${encodeURIComponent(this.key.slice(8))}`,
    });
  },
  cancel() {
    if (this.scope) {
      this.scope.cancel();
      this.scope = null;
      this.setData({ busy: false, recognizing: false });
    }
  },
  async recognize() {
    if (!this.record || !this.data.photo || this.data.busy) return;
    this.setData({ busy: true, taskError: "" });
    const scope = (this.scope = new TaskScope());
    try {
      if (
        this.record.results.some((result) => result.confirmed) &&
        !(await confirm(
          "重新识别答案？",
          "将替换识别文字与核查标记。取消则保留当前结果。",
          "重新识别",
        ))
      )
        return;
      scope.check();
      this.setData({ recognizing: true });
      const image = await photoData(this.data.photo);
      scope.check();
      const data = await ai<{
        results: {
          index: number;
          recognized: string;
          readable: boolean;
          aligned: boolean;
          reason: string;
        }[];
        warning?: string;
      }>(
        "grade",
        {
          image,
          answers: this.record.session.items.map((item) => item.answer),
        },
        scope,
      );
      scope.check();
      this.clearUndo();
      this.record.results = this.record.session.items.map((item, index) => {
        const matches = data.results.filter((result) => result.index === index),
          match = matches[0];
        if (matches.length !== 1)
          return {
            recognized: "",
            status: "待确认",
            confirmed: false,
            reason: "缺少唯一对应关系，请人工核查",
          };
        return {
          recognized: match.recognized,
          confirmed: false,
          reason: match.reason,
          status: !match.readable
            ? "无法辨认"
            : !match.aligned
              ? "待确认"
              : grade(
                  match.recognized,
                  item.answer,
                  true,
                  this.data.caseSensitive,
                  this.data.punctuation,
                ),
        };
      });
      this.changed();
      this.setData({
        message: data.warning || "请对照照片核查，识别不清的项目可以稍后处理。",
        reviewFilter: "pending",
        editingIndex: -1,
      });
      this.render();
      wx.pageScrollTo({ selector: "#review-list", duration: 200 });
    } catch (error) {
      if (error instanceof Cancelled) return;
      this.setData({
        taskError:
          error instanceof Error ? error.message : "识别未完成，请重试",
      });
      showError(error);
    } finally {
      if (this.scope === scope) {
        this.scope = null;
        this.setData({ busy: false, recognizing: false });
      }
    }
  },
  filter(event: TapEvent) {
    const reviewFilter = String(event.currentTarget.dataset.filter);
    if (!["all", "pending", "wrong"].includes(reviewFilter)) return;
    this.setData({ reviewFilter, editingIndex: -1 });
    this.render(() =>
      wx.pageScrollTo({ selector: "#review-list", duration: 200 }),
    );
  },
  editRow(event: TapEvent) {
    const index = Number(event.currentTarget.dataset.index);
    if (this.data.busy) return;
    this.setData({
      editingIndex: this.data.editingIndex === index ? -1 : index,
    });
    this.render();
  },
  assess(event: TapEvent) {
    if (!this.record || this.data.busy) return;
    const index = Number(event.currentTarget.dataset.index),
      action = event.currentTarget.dataset.status;
    const item = this.record.session.items[index],
      previous = this.record.results[index];
    if (
      !item ||
      !previous ||
      !["correct", "wrong", "missing", "reset"].includes(action)
    )
      return;
    this.lastAssessment = { index, result: { ...previous } };
    this.setData({
      undoLabel: `第 ${index + 1} 项${action === "reset" ? "已重新打开" : "已核对"}`,
    });
    if (action === "reset")
      this.record.results[index] = { ...previous, confirmed: false };
    else
      this.record.results[index] = {
        recognized:
          action === "correct"
            ? item.answer
            : action === "missing" || previous.recognized === item.answer
              ? ""
              : previous.recognized,
        status:
          action === "correct"
            ? "正确"
            : action === "missing"
              ? "漏写"
              : "错误",
        confirmed: true,
        reason:
          action === "correct"
            ? "已对照纸面，确认写对"
            : action === "missing"
              ? "已对照纸面，确认漏写"
              : "已对照纸面，确认写错",
      };
    this.setData({ editingIndex: -1 });
    this.changed();
  },
  clearUndo() {
    this.lastAssessment = null;
    this.setData({ undoLabel: "" });
  },
  undoAssessment() {
    if (!this.record || !this.lastAssessment || this.data.busy) return;
    const { index, result } = this.lastAssessment;
    this.record.results[index] = result;
    this.clearUndo();
    this.setData({
      reviewFilter: result.confirmed ? "all" : "pending",
      editingIndex: -1,
    });
    this.changed();
    wx.pageScrollTo({ selector: `#result-${index + 1}`, duration: 200 });
  },
  async confirmCorrect() {
    if (!this.record || this.data.busy || !this.data.candidateCorrect) return;
    this.setData({ busy: true });
    try {
      const count = this.data.candidateCorrect;
      if (
        !(await confirm(
          `确认这 ${count} 项都写对了？`,
          "请先逐项对照纸面与题号。只确认识别为正确的项目，错误和无法辨认的项目仍需单独核查。",
          "已核对无误",
        ))
      )
        return;
      this.clearUndo();
      this.record.results = this.record.results.map((result) =>
        !result.confirmed &&
        result.status === "正确" &&
        result.recognized.trim()
          ? { ...result, confirmed: true }
          : result,
      );
      this.changed();
    } finally {
      this.setData({ busy: false });
    }
  },
  async done() {
    if (!this.record || this.data.busy) return;
    if ((this.data.pending || this.data.syncError) && !(await this.save()))
      return;
    wx.switchTab({ url: "/pages/library/index" });
  },
  edit(event: InputEvent) {
    if (!this.record || this.data.busy) return;
    const index = Number(event.currentTarget.dataset.index),
      value = event.detail.value;
    if (!this.record.results[index]) return;
    this.clearUndo();
    this.record.results[index] = {
      ...this.record.results[index],
      recognized: value,
      confirmed: false,
      status: grade(
        value,
        this.record.session.items[index].answer,
        true,
        this.data.caseSensitive,
        this.data.punctuation,
      ),
      reason: "手动编辑后，请重新确认文字与题号",
    };
    this.changed();
  },
  check(event: WechatMiniprogram.CustomEvent<{ value: string[] }>) {
    if (!this.record || this.data.busy) return;
    const index = Number(event.currentTarget.dataset.index),
      result = this.record.results[index];
    if (!result) return;
    this.clearUndo();
    result.confirmed = event.detail.value.includes("confirmed");
    if (result.confirmed)
      result.status = grade(
        result.recognized,
        this.record.session.items[index].answer,
        true,
        this.data.caseSensitive,
        this.data.punctuation,
      );
    this.changed();
  },
  rules(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    if (!this.record || this.data.busy) return;
    const key = event.currentTarget.dataset.rule as
      "caseSensitive" | "punctuation";
    if (!["caseSensitive", "punctuation"].includes(key)) return;
    this.clearUndo();
    this.setData({ [key]: event.detail.value });
    this.record.results = this.record.results.map((result, index) =>
      result.confirmed &&
      [
        "已对照纸面，确认写对",
        "已对照纸面，确认写错",
        "已对照纸面，确认漏写",
      ].includes(result.reason)
        ? result
        : {
            ...result,
            confirmed: false,
            status: ["无法辨认", "待确认"].includes(result.status)
              ? result.status
              : grade(
                  result.recognized,
                  this.record!.session.items[index].answer,
                  true,
                  this.data.caseSensitive,
                  this.data.punctuation,
                ),
          },
    );
    this.changed();
  },
  async save() {
    if (!this.record || this.data.busy) return;
    this.setData({
      busy: true,
      saving: true,
      syncError: "",
      syncConflict: false,
    });
    try {
      const wrong = (await readDocument<Item[]>("wrong")) || [];
      const sessionIds = new Set(
        this.record.session.items
          .filter((_, index) => this.record!.results[index].confirmed)
          .map((item) => item.id),
      );
      const next = wrong.filter((item) => !sessionIds.has(item.id));
      this.record.results.forEach((result, index) => {
        if (result.confirmed && ["错误", "漏写"].includes(result.status))
          next.push(this.record!.session.items[index]);
      });
      if (next.length > 300)
        throw new Error("错词本已满 300 项，请先整理后再保存");
      writeLocal("wrong", next);
      writeLocal(this.key, this.record);
      this.conflictKey = this.key;
      await syncDocument(this.key);
      this.conflictKey = "wrong";
      await syncDocument("wrong");
      this.conflictKey = "";
      this.clearUndo();
      this.render();
      notify(
        this.data.remaining
          ? `已保存，还有 ${this.data.remaining} 项可稍后核查`
          : "核查完成，错词已整理",
      );
      return true;
    } catch (error) {
      this.setData({
        syncError:
          error instanceof Error ? error.message : "保存未完成，本机修改已保留",
        syncConflict: (error as { status?: number })?.status === 409,
      });
      return false;
    } finally {
      this.render();
      this.setData({ busy: false, saving: false });
    }
  },
  async reloadCloud() {
    if (this.data.busy) return;
    const wrongConflict = this.conflictKey === "wrong";
    this.setData({ busy: true });
    try {
      if (
        !(await confirm(
          wrongConflict ? "合并云端错词本？" : "载入云端记录？",
          wrongConflict
            ? "先载入最新错词本，再应用本次已核对的结果。其他词语和未核对项保留。"
            : "会放弃当前尚未同步的核查修改。",
          wrongConflict ? "载入并合并" : "载入云端",
        ))
      )
        return;
      if (wrongConflict) await readDocument<Item[]>("wrong", true);
      else {
        this.record = await readDocument<HistoryDocument>(this.key, true);
        this.clearUndo();
      }
      this.setData({ syncError: "", syncConflict: false });
      this.render();
    } catch (error) {
      showError(error);
      return;
    } finally {
      this.setData({ busy: false });
    }
    if (wrongConflict) await this.save();
  },
  async practiceAgain() {
    if (!this.record) return;
    const wrong = this.record.session.items.filter(
      (_, index) =>
        this.record!.results[index].confirmed &&
        ["错误", "漏写"].includes(this.record!.results[index].status),
    );
    if (!wrong.length) {
      notify("先核查答案，确认的错词才能再次练习");
      return;
    }
    if (this.data.busy) return;
    if ((this.data.pending || this.data.syncError) && !(await this.save()))
      return;
    this.setData({ busy: true });
    try {
      await prepareReview(wrong, "再练练这些词");
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  home() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
