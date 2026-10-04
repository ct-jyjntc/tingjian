import type { TtsBackend } from "./voices";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: Record<string, unknown>,
  ) {
    super(message);
  }
}
export let access = "";
export function setAccess(v: string) {
  access = v;
  sessionStorage.setItem("access", v);
}
export async function api(
  action: string,
  data?: unknown,
  signal?: AbortSignal,
) {
  const r = await fetch(`/api/${action}`, {
    method: data ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access}`,
    },
    body: data ? JSON.stringify(data) : undefined,
    signal,
  });
  const revision = r.headers.get("X-AI-Config-Revision");
  if (revision) setAIConfigRevision(revision);
  if (!r.ok) {
    const d = await r.json();
    throw new ApiError(d.error || "请求失败", r.status, d);
  }
  return action === "tts" ? r.blob() : r.json();
}
const cache = new Map<string, Blob>();
let aiConfigRevision = "";
export function setAIConfigRevision(revision: string) {
  if (aiConfigRevision !== revision) {
    aiConfigRevision = revision;
    cache.clear();
  }
}
type PendingAudio = {
  promise: Promise<Blob>;
  controller: AbortController;
  users: number;
  done: boolean;
};
const pending = new Map<string, PendingAudio>();
export async function audioBlob(
  data: unknown,
  signal?: AbortSignal,
): Promise<Blob> {
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");
  // A small local request prevents cached audio from using a superseded model,
  // including when settings were saved from a different browser window.
  const configuration = await api("ai-settings-revision", undefined, signal);
  const revision = configuration.revision as string;
  const key = `${revision}:${JSON.stringify(data)}`;
  if (cache.has(key)) return cache.get(key)!;
  let entry = pending.get(key);
  if (!entry || entry.controller.signal.aborted) {
    const controller = new AbortController();
    entry = {
      controller,
      users: 0,
      done: false,
      promise: Promise.resolve(new Blob()),
    };
    const current = entry;
    current.promise = api("tts", data, controller.signal)
      .then((blob: Blob) => {
        if (revision === aiConfigRevision) cache.set(key, blob);
        if (cache.size > 30) cache.delete(cache.keys().next().value!);
        return blob;
      })
      .finally(() => {
        current.done = true;
        if (pending.get(key) === current) pending.delete(key);
      });
    pending.set(key, current);
  }
  const current = entry;
  current.users++;
  let cancel: () => void = () => {};
  try {
    if (!signal) return await current.promise;
    return await Promise.race([
      current.promise,
      new Promise<never>((_, reject) => {
        cancel = () => reject(new DOMException("已取消", "AbortError"));
        signal.addEventListener("abort", cancel, { once: true });
      }),
    ]);
  } finally {
    signal?.removeEventListener("abort", cancel);
    current.users--;
    if (!current.users && !current.done) current.controller.abort();
  }
}
let preview: HTMLAudioElement | undefined;
let previewUrl = "";
let generation = 0;
let previewAbort: AbortController | undefined;
export function stopPreview() {
  generation++;
  previewAbort?.abort();
  preview?.pause();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = "";
}
export async function previewText(
  text: string,
  voice = "Vivian",
  speed = 1,
  language = "Auto",
  pronunciation = "",
  backend: TtsBackend = "edge-tts",
) {
  stopPreview();
  const id = generation;
  previewAbort = new AbortController();
  const blob = await audioBlob(
    { text, voice, speed, language, pronunciation, backend },
    previewAbort.signal,
  );
  if (id !== generation) return;
  previewUrl = URL.createObjectURL(blob);
  preview = new Audio(previewUrl);
  await preview.play();
}
