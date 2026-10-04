import { openDB } from "idb";
const db = () =>
  openDB("quiet-dictation", 1, {
    upgrade(d) {
      d.createObjectStore("data");
    },
  });
export async function get<T>(key: string): Promise<T | undefined> {
  return (await db()).get("data", key);
}
export async function put(key: string, value: unknown) {
  return (await db()).put("data", value, key);
}
export async function clear() {
  return (await db()).clear("data");
}

export async function deleteHistory() {
  const d = await db();
  const tx = d.transaction("data", "readwrite");
  for (const key of await tx.store.getAllKeys()) {
    if (
      String(key).startsWith("grade:") ||
      String(key).startsWith("grade-raw:") ||
      key === "session" ||
      key === "history"
    )
      await tx.store.delete(key);
  }
  await tx.done;
}
