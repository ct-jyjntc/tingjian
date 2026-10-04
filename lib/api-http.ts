import "server-only";
import { ServiceError } from "./server";

let active = 0;
const owners = new Map<string, number>();
export function acquireAISlot(owner: string) {
  const count = owners.get(owner) || 0;
  if (active >= 8 || (owner !== "admin" && count >= 2))
    throw new ServiceError(429, "正在处理其他任务，请稍后再试");
  active++;
  owners.set(owner, count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
    const remaining = (owners.get(owner) || 1) - 1;
    if (remaining) owners.set(owner, remaining);
    else owners.delete(owner);
  };
}

export async function readJSON(
  request: Request,
  limit = 17_000_000,
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new ServiceError(413, "文件超过大小限制");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new ServiceError(413, "文件超过大小限制");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw Error("Expected object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ServiceError(400, "请求格式错误");
  }
}
