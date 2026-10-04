import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, rename, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  aiKeys,
  secretKeys,
  aiPatchSchema,
  inheritedAIValues,
  differentOrigin,
  endpointSecrets,
  type AIKey,
  type AIPatch,
  type AIValues,
  type PublicAISettings,
} from "./ai-settings";

export class AISettingsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const documentSchema = z
  .object({
    version: z.literal(1),
    revision: z.string().min(1),
    values: aiPatchSchema,
  })
  .strict();
type Snapshot = {
  values: AIValues;
  inherited: AIValues;
  overrides: AIPatch;
  revision: string;
};

export class AISettingsStore {
  constructor(
    readonly file: string,
    private environment: () => Record<string, string | undefined> = () =>
      process.env,
  ) {}
  read(): Snapshot {
    const inherited = inheritedAIValues(this.environment());
    let overrides: AIPatch = {},
      revision = "environment";
    try {
      const raw = readFileSync(this.file, "utf8");
      const saved = documentSchema.parse(JSON.parse(raw));
      overrides = saved.values as AIPatch;
      revision = saved.revision;
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw new AISettingsError(
          500,
          "无法读取服务器 AI 配置，请检查配置文件或目录权限",
        );
    }
    const values = { ...inherited };
    for (const key of aiKeys)
      if (typeof overrides[key] === "string") values[key] = overrides[key];
    return { values, inherited, overrides, revision };
  }
  public(snapshot = this.read()): PublicAISettings {
    const result: PublicAISettings = {
      revision: snapshot.revision,
      values: {},
      inheritedValues: {},
      secrets: {},
      inheritedSecrets: {},
      overridden: [],
    };
    for (const key of aiKeys) {
      if (secretKeys.includes(key)) {
        result.secrets[key] = Boolean(snapshot.values[key]);
        result.inheritedSecrets[key] = Boolean(snapshot.inherited[key]);
      } else {
        result.values[key] = snapshot.values[key];
        result.inheritedValues[key] = snapshot.inherited[key];
      }
      if (Object.hasOwn(snapshot.overrides, key)) result.overridden.push(key);
    }
    return result;
  }
  async save(revision: string, input: AIPatch, reuseSecrets: AIKey[] = []) {
    const changes = aiPatchSchema.parse(input) as AIPatch;
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const lockPath = `${this.file}.lock`;
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        const info = await stat(lockPath).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 30000) {
          await unlink(lockPath).catch(() => {});
          try {
            lock = await open(lockPath, "wx", 0o600);
          } catch {
            /* Another writer acquired the lock. */
          }
        }
        if (!lock)
          throw new AISettingsError(409, "另一处正在保存配置，请稍后重新载入");
      } else throw new AISettingsError(500, "无法写入服务器 AI 配置目录");
    }
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      const current = this.read();
      if (revision !== current.revision)
        throw new AISettingsError(
          409,
          "配置已在其他页面更新，请重新载入后再保存",
        );
      const overrides = { ...current.overrides };
      for (const key of aiKeys) {
        if (!Object.hasOwn(changes, key)) continue;
        if (changes[key] === null) delete overrides[key];
        else overrides[key] = changes[key];
      }
      const next = { ...current.inherited };
      for (const key of aiKeys)
        if (typeof overrides[key] === "string") next[key] = overrides[key];
      for (const [baseKey, secretKey] of Object.entries(endpointSecrets) as [
        keyof typeof endpointSecrets,
        AIKey,
      ][]) {
        if (
          differentOrigin(current.values[baseKey], next[baseKey]) &&
          next[secretKey] &&
          next[secretKey] === current.values[secretKey] &&
          !(changes[baseKey] === null && changes[secretKey] === null) &&
          !(typeof changes[secretKey] === "string" && changes[secretKey]) &&
          !reuseSecrets.includes(secretKey)
        )
          throw new AISettingsError(
            400,
            "服务地址已更换，请填写新密钥，或明确选择将已保存密钥用于新地址",
          );
      }
      const nextRevision = randomUUID();
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(
          JSON.stringify(
            { version: 1, revision: nextRevision, values: overrides },
            null,
            2,
          ) + "\n",
        );
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, this.file);
      return this.public({
        values: next,
        inherited: current.inherited,
        overrides,
        revision: nextRevision,
      });
    } catch (error) {
      if (error instanceof AISettingsError || error instanceof z.ZodError)
        throw error;
      throw new AISettingsError(
        500,
        "保存失败，原配置未修改，请检查服务器目录权限",
      );
    } finally {
      await unlink(temp).catch(() => {});
      await lock?.close();
      await unlink(lockPath).catch(() => {});
    }
  }
}
const context = new AsyncLocalStorage<Snapshot>();
export function aiSettingsStore() {
  return new AISettingsStore(
    process.env.AI_SETTINGS_FILE ||
      path.join(process.cwd(), ".local", "ai-settings.json"),
  );
}
export function withAISettings<T>(callback: () => T): T {
  return context.run(aiSettingsStore().read(), callback);
}
export function getAISetting(key: string): string {
  const value =
    (context.getStore() || aiSettingsStore().read()).values[key as AIKey] || "";
  return key.endsWith("_BASE_URL") ? value.replace(/\/+$/, "") : value;
}
export function aiSettingsRevision() {
  return (context.getStore() || aiSettingsStore().read()).revision;
}
export function publicAISettings() {
  return aiSettingsStore().public(
    context.getStore() || aiSettingsStore().read(),
  );
}
export function aiSettingsFingerprint(keys: readonly string[] = aiKeys) {
  return createHash("sha256")
    .update(JSON.stringify(keys.map((key) => getAISetting(key))))
    .digest("hex");
}
