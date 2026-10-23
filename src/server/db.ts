import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type DB = DatabaseSync;

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const MIGRATIONS_DIR = path.join(ROOT, "migrations");

export function openDb(file = process.env.DATABASE_PATH ?? path.join(ROOT, "data", "networth.db")): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

/** Ordered .sql migrations tracked in schema_migrations; each runs in a transaction. */
export function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set((db.prepare("SELECT name FROM schema_migrations").all() as Array<{ name: string }>).map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(f, new Date().toISOString());
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
}

/**
 * Run fn inside a transaction (all-or-nothing multi-record updates). Re-entrant: the outermost call is a real transaction,
 * nested calls are savepoints, so an inner failure that the caller catches rolls back only the inner work.
 * Nesting depth is tracked per connection. fn must be synchronous: SQLite transactions are connection-wide, so awaiting
 * inside one would let unrelated requests join it.
 */
const depths = new WeakMap<DB, number>();
export function tx<T>(db: DB, fn: () => T): T {
  const d = depths.get(db) ?? 0, sp = `sp_${d}`;
  db.exec(d === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
  depths.set(db, d + 1);
  try {
    const r = fn();
    if (r && typeof (r as { then?: unknown }).then === "function") throw new Error("tx() callbacks must be synchronous.");
    db.exec(d === 0 ? "COMMIT" : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    db.exec(d === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  } finally { depths.set(db, d); }
}

/** The tenant that owns the demo data and operates shared reference data (market prices). */
export const DEFAULT_TENANT = "default";
export const uid = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
export const nowISO = () => new Date().toISOString();
