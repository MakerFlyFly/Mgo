import { createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { MgoError } from "../domain/errors";
import type { OrderJournal } from "../domain/orders";
import type { OrderAttempt, Session } from "../domain/types";

export class MemoryJournal implements OrderJournal {
  attempts = new Map<string, OrderAttempt>();
  async findAttempt(id: string) { return this.attempts.get(id) ?? null; }
  async reserveAttempt(attempt: OrderAttempt) { if (this.attempts.has(attempt.quoteId)) return false; this.attempts.set(attempt.quoteId, structuredClone(attempt)); return true; }
  async saveAttempt(attempt: OrderAttempt) { this.attempts.set(attempt.quoteId, structuredClone(attempt)); }
  async saveSession(_session: Session) {}
}
export class LiveRepository implements OrderJournal {
  private constructor(private db: DatabaseSync, private account: string) {}
  static async open(dataDir: string, accountToken: string) {
    const { DatabaseSync } = await import("node:sqlite");
    const dir = resolve(dataDir); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = resolve(dir, "mgo.db"), db = new DatabaseSync(file);
    try { chmodSync(file, 0o600); } catch { /* Windows permissions are inherited */ }
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, account TEXT NOT NULL, state TEXT NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS attempts (quote_id TEXT PRIMARY KEY, account TEXT NOT NULL, state TEXT NOT NULL);");
    return new LiveRepository(db, createHash("sha256").update(accountToken).digest("hex"));
  }
  getSession(id: string) {
    const row = this.db.prepare("SELECT state FROM sessions WHERE id=? AND account=?").get(id, this.account) as { state: string } | undefined;
    return row ? JSON.parse(row.state) as Session : null;
  }
  async saveSession(session: Session) {
    this.db.prepare("INSERT INTO sessions(id,account,state) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state WHERE account=excluded.account").run(session.id, this.account, JSON.stringify(session));
  }
  acquire(id: string) {
    const now = Date.now();
    const result = this.db.prepare("UPDATE sessions SET lease_until=? WHERE id=? AND account=? AND lease_until<?").run(now + 135000, id, this.account, now);
    if (!result.changes) throw new MgoError("SESSION_BUSY", "鲸鱼娘正在处理上一句话，请稍等。", 409);
  }
  release(id: string) { this.db.prepare("UPDATE sessions SET lease_until=0 WHERE id=? AND account=?").run(id, this.account); }
  async findAttempt(id: string) {
    const row = this.db.prepare("SELECT state FROM attempts WHERE quote_id=? AND account=?").get(id, this.account) as { state: string } | undefined;
    return row ? JSON.parse(row.state) as OrderAttempt : null;
  }
  async reserveAttempt(attempt: OrderAttempt) {
    const result = this.db.prepare("INSERT OR IGNORE INTO attempts(quote_id,account,state) VALUES(?,?,?)").run(attempt.quoteId, this.account, JSON.stringify(attempt));
    return !!result.changes;
  }
  async saveAttempt(attempt: OrderAttempt) { this.db.prepare("UPDATE attempts SET state=? WHERE quote_id=? AND account=?").run(JSON.stringify(attempt), attempt.quoteId, this.account); }
  close() { this.db.close(); }
}
