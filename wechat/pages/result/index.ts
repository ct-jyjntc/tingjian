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
import { TaskScope } from "../../utils/task";
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
  },
  record: null as HistoryDocument | null,
  key: "",
  scope: null as TaskScope | null,
  picking: false,
  async onLoad(options: Record<string, string | undefined>) {
    if (!requireLogin()) return;
    this.key = `history:${options.id || ""}`;
    try {
      this.record = await readDocument<HistoryDocument>(this.key);
      if (!this.record) throw new Error("没有找到这份听写记录");
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
  render() {
    if (!this.record) return;
    const { session, results } = this.record;
    const confirmed = results.filter(
      (result) =>
        result.confirmed && ["正确", "错误", "漏写"].includes(result.status),
    );
    const correct = confirmed.filter(
      (result) => result.status === "正确",
    ).length;
    this.setData({
      rows: results.map((result, index) => ({
        ...result,
        id: session.items[index].id,
        number: index + 1,
        answer: session.items[index].answer,
        spoken: session.items[index].spoken,
      })),
      total: session.items.length,
      written: session.confirmedCount ?? session.index,
      confirmed: confirmed.length,
      correct,
      wrong: confirmed.length - correct,
      accuracy: confirmed.length
        ? `${Math.round((correct / confirmed.length) * 100)}%`
        : "—",
      pending: dirty(this.key),
    });
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
  cancel() {
    if (this.scope) {
      this.scope.cancel();
      this.scope = null;
      this.setData({ busy: false });
    }
  },
  async recognize() {
    if (!this.record || !this.data.photo || this.data.busy) return;
    if (
      this.record.results.some((result) => result.confirmed) &&
      !(await confirm(
        "重新识别这张答案？",
        "会替换当前的批改建议和核查勾选，请在识别后重新核对。",
        "重新识别",
      ))
    )
      return;
    const scope = (this.scope = new TaskScope());
    this.setData({ busy: true });
    try {
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
        message:
          data.warning || "批改建议已生成。请核对文字和题号，再逐项勾选确认。",
      });
    } catch (error) {
      showError(error);
    } finally {
      if (this.scope === scope) {
        this.scope = null;
        this.setData({ busy: false });
      }
    }
  },
  edit(event: InputEvent) {
    if (!this.record || this.data.busy) return;
    const index = Number(event.currentTarget.dataset.index),
      value = event.detail.value;
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
    this.setData({ [key]: event.detail.value });
    this.record.results = this.record.results.map((result, index) => ({
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
    }));
    this.changed();
  },
  async save() {
    if (!this.record || this.data.busy) return;
    this.setData({ busy: true });
    try {
      const wrong = (await readDocument<Item[]>("wrong")) || [];
      const sessionIds = new Set(
        this.record.session.items.map((item) => item.id),
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
      await syncDocument(this.key);
      await syncDocument("wrong");
      this.render();
      notify("核查结果和错词本已同步");
    } catch (error) {
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },
  async reloadCloud() {
    if (
      !(await confirm(
        "载入云端记录？",
        "会放弃当前尚未同步的批改修改。",
        "载入云端",
      ))
    )
      return;
    try {
      this.record = await readDocument<HistoryDocument>(this.key, true);
      this.render();
    } catch (error) {
      showError(error);
    }
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
    if (
      !(await confirm(
        "准备一份错词练习？",
        "会用这次确认的错词替换当前编辑草稿。听写历史保留。",
        "准备练习",
      ))
    )
      return;
    try {
      await readDocument("draft");
      writeLocal("draft", {
        title: "再练练这些词",
        items: wrong.map((item) => ({ ...item, marked: false, hint: false })),
        materials: [],
      });
      await syncDocument("draft");
      wx.navigateTo({ url: "/pages/editor/index" });
    } catch (error) {
      showError(error);
    }
  },
  home() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
