import "server-only";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ServiceError } from "./server";
import { validateStudyDocument } from "./mini-schema";
import type {
  DocumentEnvelope,
  HistoryDocument,
  HistorySummary,
} from "./study-data";

type MiniUser = { id: string; identity: string; created_at: number };
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const chinaDay = (now: number) =>
  new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);

// One persistent Node process / one local disk. Transactions protect account
// isolation, compare-and-swap saves, and quota consumption across requests.
export class MiniStore {
  readonly db: DatabaseSync;
  constructor(file: string) {
    if (file !== ":memory:")
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS mini_users (
        id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
        privacy_version TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mini_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES mini_users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mini_sessions_user ON mini_sessions(user_id);
      CREATE TABLE IF NOT EXISTS mini_documents (
        user_id TEXT NOT NULL REFERENCES mini_users(id) ON DELETE CASCADE,
        key TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL,
        bytes INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, key)
      );
      CREATE TABLE IF NOT EXISTS mini_budgets (
        identity TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL,
        PRIMARY KEY(identity, day)
      );
      CREATE TABLE IF NOT EXISTS mini_windows (
        key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, count INTEGER NOT NULL
      );
    `);
  }
  close() {
    this.db.close();
  }
  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  login(
    appId: string,
    openId: string,
    privacyVersion: string,
    now = Date.now(),
  ) {
    return this.transaction(() => {
      const identity = digest(`${appId}:${openId}`);
      const existing = this.db
        .prepare("SELECT * FROM mini_users WHERE identity=?")
        .get(identity);
      if (existing?.disabled)
        throw new ServiceError(403, "此账号暂时无法使用，请联系运营者");
      const id = existing ? String(existing.id) : randomUUID();
      this.db
        .prepare(
          `INSERT INTO mini_users(id,identity,created_at,privacy_version) VALUES(?,?,?,?)
        ON CONFLICT(identity) DO UPDATE SET privacy_version=excluded.privacy_version`,
        )
        .run(id, identity, now, privacyVersion);
      const token = `mini_${randomBytes(32).toString("base64url")}`;
      const expiresAt = now + 7 * 86_400_000;
      this.db
        .prepare("INSERT INTO mini_sessions VALUES(?,?,?,?)")
        .run(digest(token), id, expiresAt, now);
      this.db
        .prepare(
          `DELETE FROM mini_sessions WHERE user_id=? AND token_hash NOT IN
        (SELECT token_hash FROM mini_sessions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 5)`,
        )
        .run(id, id);
      this.db.prepare("DELETE FROM mini_sessions WHERE expires_at<=?").run(now);
      this.db.prepare("DELETE FROM mini_windows WHERE expires_at<=?").run(now);
      // Keep only today's and yesterday's unlinkable abuse counters. Account
      // deletion cannot be used to repeatedly reset a day's inference allowance.
      this.db
        .prepare("DELETE FROM mini_budgets WHERE day<?")
        .run(chinaDay(now - 86_400_000));
      return { token, expiresAt, user: { id } };
    });
  }
  authenticate(authorization: string | null, now = Date.now()): MiniUser {
    const token = authorization?.match(
      /^Bearer (mini_[A-Za-z0-9_-]{43})$/,
    )?.[1];
    if (!token) throw new ServiceError(401, "请先微信登录");
    const user = this.db
      .prepare(
        `SELECT u.id,u.identity,u.created_at FROM mini_users u
      JOIN mini_sessions s ON s.user_id=u.id
      WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`,
      )
      .get(digest(token), now);
    if (!user) throw new ServiceError(401, "登录已过期，请重新登录");
    return user as MiniUser;
  }
  logout(authorization: string | null) {
    const token = authorization?.slice(7) || "";
    this.db
      .prepare("DELETE FROM mini_sessions WHERE token_hash=?")
      .run(digest(token));
  }
  deleteAccount(userId: string) {
    this.db.prepare("DELETE FROM mini_users WHERE id=?").run(userId);
  }
  rateLimit(key: string, maximum: number, windowMs = 60_000, now = Date.now()) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM mini_windows WHERE expires_at<=?").run(now);
      const row = this.db
        .prepare("SELECT count,expires_at FROM mini_windows WHERE key=?")
        .get(key);
      if (row && Number(row.expires_at) > now && Number(row.count) >= maximum)
        throw new ServiceError(429, "操作过于频繁，请稍后重试");
      this.db
        .prepare(
          `INSERT INTO mini_windows VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET
        count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
        expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`,
        )
        .run(key, now + windowMs, now, now);
    });
  }
  quota(identity: string, limit: number, now = Date.now()) {
    const row = this.db
      .prepare("SELECT used FROM mini_budgets WHERE identity=? AND day=?")
      .get(identity, chinaDay(now));
    const used = Number(row?.used || 0);
    return {
      day: chinaDay(now),
      used,
      limit,
      remaining: Math.max(0, limit - used),
    };
  }
  consume(
    identity: string,
    cost: number,
    userLimit: number,
    globalLimit: number,
    now = Date.now(),
  ) {
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM mini_budgets WHERE day<?")
        .run(chinaDay(now - 86_400_000));
      for (const [key, limit] of [
        [identity, userLimit],
        ["global", globalLimit],
      ] as const) {
        if (this.quota(key, limit, now).remaining < cost)
          throw new ServiceError(
            429,
            key === "global"
              ? "今日服务额度已用完，明天再来练习吧"
              : "今日 AI 额度已用完，明天再来练习吧",
          );
        this.db
          .prepare(
            `INSERT INTO mini_budgets VALUES(?,?,?) ON CONFLICT(identity,day)
          DO UPDATE SET used=used+excluded.used`,
          )
          .run(key, chinaDay(now), cost);
      }
    });
  }
  read<T>(userId: string, key: string): DocumentEnvelope<T> {
    const row = this.db
      .prepare(
        "SELECT revision,value,updated_at FROM mini_documents WHERE user_id=? AND key=?",
      )
      .get(userId, key);
    return row
      ? {
          key,
          revision: Number(row.revision),
          value: JSON.parse(String(row.value)) as T,
          updatedAt: Number(row.updated_at),
        }
      : { key, revision: 0, value: null, updatedAt: 0 };
  }
  save(
    userId: string,
    key: string,
    revision: number,
    input: unknown,
    now = Date.now(),
  ) {
    let value: unknown;
    try {
      value = validateStudyDocument(key, input);
    } catch {
      throw new ServiceError(400, "学习记录格式不正确");
    }
    const json = JSON.stringify(value),
      bytes = Buffer.byteLength(json);
    if (bytes > 700_000)
      throw new ServiceError(413, "这份记录过大，请减少清单或图片识别材料");
    return this.transaction(() => {
      const current = this.read(userId, key);
      if (current.revision !== revision)
        throw new ServiceError(
          409,
          "另一台设备已更新这份记录，本机修改已保留，请先处理同步冲突",
        );
      const usage = this.db
        .prepare(
          "SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM mini_documents WHERE user_id=? AND key!=?",
        )
        .get(userId, key)!;
      if (
        Number(usage.count) >= 100 ||
        Number(usage.bytes) + bytes > 10_000_000
      )
        throw new ServiceError(413, "学习记录空间已满，请先删除部分历史");
      this.db
        .prepare(
          `INSERT INTO mini_documents VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,key)
        DO UPDATE SET revision=excluded.revision,value=excluded.value,bytes=excluded.bytes,updated_at=excluded.updated_at`,
        )
        .run(userId, key, revision + 1, json, bytes, now);
      return { key, revision: revision + 1, value, updatedAt: now };
    });
  }
  history(userId: string): HistorySummary[] {
    const rows = this.db
      .prepare(
        "SELECT key,revision,value,updated_at FROM mini_documents WHERE user_id=? AND key LIKE 'history:%' ORDER BY updated_at DESC",
      )
      .all(userId);
    return rows.map((row) => {
      const { session } = JSON.parse(String(row.value)) as HistoryDocument;
      return {
        key: String(row.key),
        revision: Number(row.revision),
        updatedAt: Number(row.updated_at),
        title: session.items[0]?.spoken.slice(0, 60) || "听写练习",
        count: session.items.length,
        started: session.started,
        confirmedCount: session.confirmedCount ?? session.index,
      };
    });
  }
  deleteDocument(userId: string, key: string, revision: number) {
    return this.transaction(() => {
      if (this.read(userId, key).revision !== revision)
        throw new ServiceError(409, "记录已更新，请刷新后再删除");
      this.db
        .prepare("DELETE FROM mini_documents WHERE user_id=? AND key=?")
        .run(userId, key);
    });
  }
}

const registry = globalThis as typeof globalThis & {
  __tingjianMiniStores?: Map<string, MiniStore>;
};
export function miniStore() {
  const file = path.resolve(
    /* turbopackIgnore: true */ process.env.MINI_DATABASE_FILE ||
      ".local/miniprogram.sqlite",
  );
  const stores = (registry.__tingjianMiniStores ||= new Map());
  if (!stores.has(file)) stores.set(file, new MiniStore(file));
  return stores.get(file)!;
}
