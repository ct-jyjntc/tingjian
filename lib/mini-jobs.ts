import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { acquireAISlot } from "./api-http";
import { ServiceError } from "./server";
import { runAIAction } from "./ai-actions-server";
import { withAISettings } from "./ai-settings-server";

export const aiCosts = {
  ocr: 5,
  agent: 10,
  tts: 1,
  asr: 2,
  "session-agent": 5,
  explain: 5,
  grade: 10,
} as const;
export type MiniAction = keyof typeof aiCosts;
type Job = {
  id: string;
  userId: string;
  requestId: string;
  action: MiniAction;
  state: "pending" | "running" | "done" | "failed" | "cancelled";
  createdAt: number;
  finishedAt?: number;
  controller: AbortController;
  result?: unknown;
  audio?: Uint8Array;
  error?: string;
  status?: number;
  run: () => Promise<void>;
};
type Execute = (
  action: MiniAction,
  payload: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<Response>;

// Pollable jobs avoid WeChat request timeouts while the model thinks. Jobs are
// private, temporary memory; durable learning records are stored separately.
export class MiniJobs {
  private entries = new Map<string, Job>();
  constructor(
    private execute: Execute = (action, payload, signal) =>
      withAISettings(() => runAIAction(action, payload, signal)),
  ) {}
  create(
    userId: string,
    requestId: string,
    action: MiniAction,
    payload: Record<string, unknown>,
    reserve: () => void,
  ) {
    const now = Date.now();
    for (const [id, job] of this.entries)
      if (job.finishedAt && now - job.finishedAt > 5 * 60_000)
        this.entries.delete(id);
    const previous = [...this.entries.values()].find(
      (j) => j.userId === userId && j.requestId === requestId,
    );
    if (previous) return { id: previous.id, run: async () => {} };
    const owned = [...this.entries.values()].filter((j) => j.userId === userId);
    if (owned.filter((j) => !j.finishedAt).length >= 2)
      throw new ServiceError(429, "请先等待或取消当前任务");
    for (const old of owned
      .filter((j) => j.finishedAt)
      .slice(0, Math.max(0, owned.length - 3)))
      this.entries.delete(old.id);
    if (this.entries.size >= 64) {
      const completed = [...this.entries.values()]
        .filter((j) => j.finishedAt)
        .sort((a, b) => a.finishedAt! - b.finishedAt!)[0];
      if (completed) this.entries.delete(completed.id);
      else throw new ServiceError(429, "服务繁忙，请稍后重试");
    }
    const release = acquireAISlot(userId);
    try {
      reserve();
    } catch (error) {
      release();
      throw error;
    }
    const controller = new AbortController();
    const job: Job = {
      id: randomUUID(),
      userId,
      requestId,
      action,
      state: "pending",
      createdAt: now,
      controller,
      run: async () => {
        if (job.state !== "pending" && job.state !== "cancelled") return;
        try {
          if (controller.signal.aborted) return;
          job.state = "running";
          const signal = AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(180_000),
          ]);
          const response = await this.execute(action, payload, signal);
          if (signal.aborted) {
            if (!controller.signal.aborted)
              throw new ServiceError(504, "任务超时，请稍后重试");
            return;
          }
          if (!response.ok) throw new ServiceError(502, "AI 服务暂时不可用");
          if (action === "tts")
            job.audio = new Uint8Array(await response.arrayBuffer());
          else job.result = await response.json();
          if (
            (job.audio?.byteLength || JSON.stringify(job.result || {}).length) >
            8_000_000
          )
            throw new ServiceError(
              413,
              "服务返回内容过大，请缩小这次练习的范围",
            );
          this.trimMemory(job.id);
          if (!controller.signal.aborted) job.state = "done";
          else {
            job.audio = undefined;
            job.result = undefined;
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            job.state = "failed";
            job.status =
              error instanceof ServiceError
                ? error.status
                : error instanceof z.ZodError
                  ? 400
                  : 502;
            job.error =
              error instanceof ServiceError
                ? error.message
                : error instanceof z.ZodError
                  ? "输入或模型结果不符合要求"
                  : "服务未完成，请稍后重试";
          }
          job.audio = undefined;
          job.result = undefined;
        } finally {
          payload = {};
          job.finishedAt = Date.now();
          const timer = setTimeout(
            () => this.entries.delete(job.id),
            5 * 60_000,
          );
          timer.unref();
          release();
        }
      },
    };
    this.entries.set(job.id, job);
    return { id: job.id, run: job.run };
  }
  private trimMemory(currentId: string) {
    const size = () =>
      [...this.entries.values()].reduce(
        (total, job) =>
          total +
          (job.audio?.byteLength ||
            JSON.stringify(job.result || {}).length * 2),
        0,
      );
    for (const job of [...this.entries.values()]
      .filter((job) => job.id !== currentId && job.finishedAt)
      .sort((a, b) => a.finishedAt! - b.finishedAt!)) {
      if (size() <= 64 * 1024 * 1024) return;
      this.entries.delete(job.id);
    }
    if (size() > 64 * 1024 * 1024)
      throw new ServiceError(503, "服务结果缓存已满，请稍后重试");
  }
  private owned(userId: string, id: string) {
    const job = this.entries.get(id);
    if (
      !job ||
      job.userId !== userId ||
      (job.finishedAt && Date.now() - job.finishedAt > 5 * 60_000)
    )
      throw new ServiceError(404, "任务已失效，请重新发起");
    return job;
  }
  read(userId: string, id: string) {
    const job = this.owned(userId, id);
    return {
      id,
      state: job.state,
      result: job.result,
      audio: Boolean(job.audio),
      error: job.error,
      status: job.status,
    };
  }
  audio(userId: string, id: string) {
    const job = this.owned(userId, id);
    if (job.state !== "done" || !job.audio)
      throw new ServiceError(409, "音频尚未生成");
    return job.audio;
  }
  cancel(userId: string, id: string) {
    const job = this.owned(userId, id);
    job.controller.abort();
    job.state = "cancelled";
    job.result = undefined;
    job.audio = undefined;
    if (!job.finishedAt) job.finishedAt = Date.now();
  }
  deleteUser(userId: string) {
    for (const [id, job] of this.entries)
      if (job.userId === userId) {
        this.cancel(userId, id);
        this.entries.delete(id);
      }
  }
}
const registry = globalThis as typeof globalThis & {
  __tingjianMiniJobs?: MiniJobs;
};
export const miniJobs = () => (registry.__tingjianMiniJobs ||= new MiniJobs());
