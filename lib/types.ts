import type { TtsBackend } from "./voices";
import { recordId } from "./record-id";
export type Point = { x: number; y: number };
export type Region = { id: string; points: Point[] };
export type Picture = {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  regions: Region[];
};
export type Item = {
  id: string;
  original: string;
  spoken: string;
  answer: string;
  language: string;
  source: string;
  pronunciation: string;
  marked: boolean;
  hint: boolean;
  generated?: boolean;
  note?: string;
  materialId?: string;
  blockId?: string;
  unit?: "words" | "phrases" | "sentences";
  reviewReason?: string;
  reviewed?: boolean;
};
export type Settings = {
  ttsBackend: TtsBackend;
  voice: string;
  speed: number;
  repeats: number;
  gap: number;
  order: string;
  mode: string;
  showAnswer: boolean;
  voiceControl: boolean;
  allowHints: boolean;
};
export type Phase =
  | "idle"
  | "preparing"
  | "playing"
  | "waiting"
  | "paused"
  | "confirming"
  | "completed"
  | "error";
export type Session = {
  id: string;
  items: Item[];
  index: number;
  phase: Phase;
  round: number;
  settings: Settings;
  started: number;
  ended?: number;
  confirmedCount?: number;
  error?: string;
};
export const defaults: Settings = {
  ttsBackend: "edge-tts",
  voice: "Vivian",
  speed: 1,
  repeats: 1,
  gap: 1,
  order: "original",
  mode: "原文听写",
  showAnswer: false,
  voiceControl: false,
  allowHints: true,
};
export const newItem = (text: string, source = "手动输入"): Item => ({
  id: recordId(),
  original: text,
  spoken: text,
  answer: text,
  language: /[a-z]/i.test(text) ? "Auto" : "Chinese",
  source,
  pronunciation: "",
  marked: false,
  hint: false,
});
