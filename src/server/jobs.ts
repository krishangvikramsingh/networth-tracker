import type { DB } from "./db";
import { nowISO } from "./db";
import { reconcileAll } from "./service";

let running = false;
/**
 * Periodically reconcile alerts for every client. Rules that depend on the calendar (stale valuations, maturity and
 * premium windows) change without anyone editing data, and reads no longer do this work.
 */
export function startReconciler(db: DB, everySeconds = Number(process.env.RECONCILE_INTERVAL_SECONDS ?? 300)): NodeJS.Timeout | null {
  if (!(everySeconds > 0)) return null;
  const t = setInterval(() => {
    if (running) return;
    running = true;
    try { reconcileAll(db); } catch (e) { console.error(JSON.stringify({ t: nowISO(), level: "error", scope: "reconcile", message: String((e as Error)?.message ?? e).slice(0, 300) })); } finally { running = false; }
  }, everySeconds * 1000);
  t.unref();
  return t;
}
