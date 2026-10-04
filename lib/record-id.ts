// IDs identify learning records, never credentials. WeChat does not provide
// the browser Web Crypto global; server authentication uses node:crypto.
export function recordId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
