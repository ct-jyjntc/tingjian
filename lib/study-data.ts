import type { Item, Session } from "./types";
import type { Material } from "./materials";

export type DraftDocument = {
  title: string;
  items: Item[];
  materials: Material[];
};
export type Grading = {
  recognized: string;
  status: string;
  reason: string;
  confirmed: boolean;
};
export type HistoryDocument = { session: Session; results: Grading[] };
export type DocumentEnvelope<T> = {
  key: string;
  revision: number;
  value: T | null;
  updatedAt: number;
};
export type HistorySummary = {
  key: string;
  revision: number;
  updatedAt: number;
  title: string;
  count: number;
  started: number;
  confirmedCount: number;
};
