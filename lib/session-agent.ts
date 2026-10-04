import { z } from "zod";
import type { Session } from "./types";
import type { Intent } from "./machine";
import type { Explanation } from "./explanation";

export const sessionCommands = [
  "next",
  "repeat",
  "slower",
  "faster",
  "pause",
  "resume",
  "previous",
  "mark",
  "end",
] as const;
export type SessionCommand = (typeof sessionCommands)[number];
export const sessionContextSchema = z
  .object({
    sessionId: z.string().max(120),
    round: z.number().int().nonnegative(),
    index: z.number().int().nonnegative(),
    count: z.number().int().min(1).max(300),
    phase: z.enum([
      "idle",
      "preparing",
      "playing",
      "waiting",
      "paused",
      "confirming",
      "completed",
      "error",
    ]),
    allowHints: z.boolean(),
    item: z.object({
      spoken: z.string().max(1000),
      answer: z.string().max(1000),
    }),
  })
  .refine((context) => context.index < context.count, "Invalid item index");
export type SessionContext = z.infer<typeof sessionContextSchema>;
export const sessionAgentInputSchema = z.object({
  text: z.string().trim().min(1).max(3000),
  context: sessionContextSchema,
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(30000),
      }),
    )
    .max(12)
    .default([]),
});
export type SessionAgentInput = z.infer<typeof sessionAgentInputSchema>;
export type SessionAgentReply =
  | { type: "control"; command: SessionCommand; message: string }
  | { type: "explanation"; explanation: Explanation; message: string }
  | { type: "reply"; message: string };

export const commandLabels: Record<SessionCommand, string> = {
  next: "下一项",
  repeat: "重读当前项",
  slower: "放慢朗读",
  faster: "加快朗读",
  pause: "暂停",
  resume: "继续听写",
  previous: "上一项",
  mark: "标记不会",
  end: "请求结束听写",
};
export function sessionContext(session: Session): SessionContext {
  return {
    sessionId: session.id,
    round: session.round,
    index: session.index,
    count: session.items.length,
    phase: session.phase,
    allowHints: session.settings.allowHints,
    item: {
      spoken: session.items[session.index].spoken,
      answer: session.items[session.index].answer,
    },
  };
}
export function isCurrentSessionTurn(
  context: SessionContext,
  session: Session,
) {
  return (
    context.sessionId === session.id &&
    context.round === session.round &&
    context.index === session.index &&
    session.phase !== "completed" &&
    session.phase !== "confirming"
  );
}
export function availableSessionCommands(
  context: Pick<SessionContext, "phase" | "index">,
): SessionCommand[] {
  if (["completed", "confirming"].includes(context.phase)) return [];
  return sessionCommands.filter((command) => {
    if (command === "next") return context.phase === "waiting";
    if (command === "previous") return context.index > 0;
    if (command === "resume")
      return ["paused", "idle", "error"].includes(context.phase);
    return true;
  });
}
export function isPlaybackCommand(intent: Intent) {
  return [
    "pause",
    "end",
    "repeat",
    "previous",
    "slower",
    "resume",
    "next",
  ].includes(intent);
}
