import type {
  DocumentEnvelope,
  HistoryDocument,
  HistorySummary,
} from "../shared";
import { auth, request, APIError } from "./api";
import { Cancelled } from "./task";

type Cache<T> = DocumentEnvelope<T> & { dirty: boolean; edit: number };
const queues = new Map<string, Promise<void>>();
function owner() {
  const id = auth()?.user.id;
  if (!id) throw new APIError("请先微信登录", 401);
  return id;
}
const localKey = (id: string, key: string) => `tingjian:user:${id}:${key}`;
function cache<T>(id: string, key: string): Cache<T> | null {
  return wx.getStorageSync(localKey(id, key)) || null;
}
function store<T>(id: string, key: string, value: Cache<T>) {
  try {
    wx.setStorageSync(localKey(id, key), value);
  } catch {
    throw new APIError("本机存储空间不足，请清理后再试。当前页面内容仍保留");
  }
}
export function localDocument<T>(key: string): T | null {
  return cache<T>(owner(), key)?.value ?? null;
}
export function dirty(key: string) {
  return Boolean(cache(owner(), key)?.dirty);
}
export function dirtyCount() {
  const id = owner(),
    prefix = localKey(id, "");
  return wx
    .getStorageInfoSync()
    .keys.filter(
      (key) => key.startsWith(prefix) && wx.getStorageSync(key)?.dirty,
    ).length;
}
export function writeLocal<T>(key: string, value: T) {
  const id = owner(),
    previous = cache<T>(id, key);
  store(id, key, {
    key,
    revision: previous?.revision || 0,
    value,
    updatedAt: Date.now(),
    dirty: true,
    edit: (previous?.edit || 0) + 1,
  });
}
export async function readDocument<T>(
  key: string,
  discardLocal = false,
): Promise<T | null> {
  const id = owner(),
    previous = cache<T>(id, key);
  if (previous?.dirty && !discardLocal) return previous.value;
  try {
    const remote = await request<DocumentEnvelope<T>>(
      `data?key=${encodeURIComponent(key)}`,
    );
    if (auth()?.user.id !== id) throw new Cancelled();
    // A page can start editing while a refresh is in flight.
    const latest = cache<T>(id, key);
    if (latest?.dirty && !discardLocal) return latest.value;
    store(id, key, { ...remote, dirty: false, edit: 0 });
    return remote.value;
  } catch (error) {
    if (
      previous &&
      !discardLocal &&
      error instanceof APIError &&
      error.status === 0
    )
      return previous.value;
    throw error;
  }
}
export async function syncDocument(key: string): Promise<void> {
  const id = owner(),
    queueKey = localKey(id, key);
  const task = (queues.get(queueKey) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      if (auth()?.user.id !== id) throw new Cancelled();
      const snapshot = cache<unknown>(id, key);
      if (!snapshot?.dirty) return;
      const remote = await request<DocumentEnvelope<unknown>>("data", {
        data: { key, revision: snapshot.revision, value: snapshot.value },
      });
      if (auth()?.user.id !== id) throw new Cancelled();
      const latest = cache<unknown>(id, key);
      if (latest && latest.edit !== snapshot.edit)
        store(id, key, { ...latest, revision: remote.revision });
      else store(id, key, { ...remote, dirty: false, edit: snapshot.edit });
    });
  queues.set(queueKey, task);
  try {
    await task;
  } finally {
    if (queues.get(queueKey) === task) queues.delete(queueKey);
  }
}
export async function saveDocument<T>(key: string, value: T) {
  writeLocal(key, value);
  await syncDocument(key);
}
export async function syncAll() {
  const prefix = localKey(owner(), "");
  for (const key of wx.getStorageInfoSync().keys)
    if (key.startsWith(prefix) && wx.getStorageSync(key)?.dirty)
      await syncDocument(key.slice(prefix.length));
}
export async function listHistory(): Promise<HistorySummary[]> {
  const id = owner();
  let remote: HistorySummary[] = [];
  let online = false;
  try {
    remote = await request<HistorySummary[]>("data?list=history");
    online = true;
  } catch (error) {
    if (!(error instanceof APIError) || error.status !== 0) throw error;
  }
  if (auth()?.user.id !== id) throw new Cancelled();
  const records = new Map(remote.map((item) => [item.key, item]));
  const prefix = localKey(id, "history:");
  for (const stored of wx
    .getStorageInfoSync()
    .keys.filter((key) => key.startsWith(prefix))) {
    const document = wx.getStorageSync(stored) as Cache<HistoryDocument>;
    if (!document?.value || (!document.dirty && online)) continue;
    const session = document.value.session;
    records.set(document.key, {
      key: document.key,
      revision: document.revision,
      updatedAt: document.updatedAt,
      title: session.items[0]?.spoken || "听写练习",
      count: session.items.length,
      started: session.started,
      confirmedCount: session.confirmedCount ?? session.index,
    });
  }
  return [...records.values()].sort((a, b) => b.started - a.started);
}
export async function deleteDocument(key: string, revision: number) {
  const id = owner();
  if (revision > 0)
    await request(`data?key=${encodeURIComponent(key)}&revision=${revision}`, {
      method: "DELETE",
    });
  if (auth()?.user.id !== id) throw new Cancelled();
  wx.removeStorageSync(localKey(id, key));
}
