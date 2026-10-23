import type { DB } from "../db";
import { nowISO, tx, uid } from "../db";
import { isValidISODate, daysBetween, todayISO } from "../../shared/dates";
import { PROVIDERS, DEMO_UNIVERSE } from "./providers";
import type { Observation } from "./types";

const CACHE_TTL_MS = Number(process.env.MARKET_CACHE_SECONDS ?? 900) * 1000;
const MIN_INTERVAL_MS = Number(process.env.MARKET_MIN_INTERVAL_SECONDS ?? 30) * 1000;
const lastCall = new Map<string, number>();
export const resetMarketThrottle = () => lastCall.clear();

export function validateObservation(o: Observation, prev: number | null): string | null {
  if (!o.symbol) return "missing symbol";
  if (!Number.isFinite(o.value) || o.value <= 0) return "non-positive or non-numeric value";
  if (!isValidISODate(o.asOf)) return "invalid as-of date";
  if (o.asOf > todayISO()) return "as-of date is in the future";
  if (prev != null && Math.abs(o.value / prev - 1) > 0.5) return `suspicious jump of >50% vs previous (${prev} → ${o.value})`;
  return null;
}

function latest(db: DB, symbol: string): number | null {
  const r = db.prepare("SELECT value FROM market_observations WHERE symbol = ? ORDER BY as_of DESC LIMIT 1").get(symbol) as { value: number } | undefined;
  return r?.value ?? null;
}

export function storeObservations(db: DB, obs: Observation[]): { stored: number; rejected: Array<{ symbol: string; reason: string }> } {
  const rejected: Array<{ symbol: string; reason: string }> = [];
  let stored = 0;
  tx(db, () => {
    for (const o of obs) {
      const bad = validateObservation(o, latest(db, o.symbol));
      if (bad) { rejected.push({ symbol: o.symbol, reason: bad }); continue; }
      const r = db.prepare(`INSERT INTO market_observations (id, symbol, kind, value, currency, as_of, fetched_at, source, is_demo) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(symbol, as_of, source) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`).run(uid("obs"), o.symbol, o.kind, o.value, o.currency, o.asOf, nowISO(), o.source, o.isDemo ? 1 : 0);
      stored += Number(r.changes);
      db.prepare("INSERT INTO instruments (symbol, name, kind, currency, provider) VALUES (?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET name = COALESCE(excluded.name, instruments.name)").run(o.symbol, o.name ?? o.symbol, o.kind, o.currency, o.source);
    }
  });
  return { stored, rejected };
}

/** Refresh via a provider: rate-limited, cached, validated. On failure the previous valid observations stay untouched. */
export async function refreshProvider(db: DB, providerId: string, symbols: string[] = []): Promise<{ ok: boolean; message: string; stored: number; rejected: Array<{ symbol: string; reason: string }>; cached?: boolean }> {
  const p = PROVIDERS[providerId];
  if (!p) return { ok: false, message: "Unknown provider.", stored: 0, rejected: [] };
  const now = Date.now(), last = lastCall.get(providerId) ?? 0;
  if (now - last < MIN_INTERVAL_MS) return { ok: true, cached: true, message: `Rate limit: last refresh was ${Math.round((now - last) / 1000)}s ago; serving cached observations.`, stored: 0, rejected: [] };
  lastCall.set(providerId, now);
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    const obs = await p.fetch(symbols, ctl.signal).finally(() => clearTimeout(t));
    const res = storeObservations(db, obs);
    db.prepare("INSERT INTO market_refresh_log (id, provider, at, ok, message, count) VALUES (?,?,?,?,?,?)").run(uid("mrl"), providerId, nowISO(), 1, `Stored ${res.stored}`, res.stored);
    return { ok: true, message: `Stored ${res.stored} observation(s)${res.rejected.length ? `, rejected ${res.rejected.length}` : ""}.`, ...res };
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    db.prepare("INSERT INTO market_refresh_log (id, provider, at, ok, message, count) VALUES (?,?,?,?,?,?)").run(uid("mrl"), providerId, nowISO(), 0, msg, 0);
    return { ok: false, message: `${msg} — previous valid values were kept.`, stored: 0, rejected: [] };
  }
}

export function marketStatus(db: DB) {
  const latestObs = db.prepare(`SELECT o.symbol, o.kind, o.value, o.currency, o.as_of, o.fetched_at, o.source, o.is_demo, i.name FROM market_observations o
    LEFT JOIN instruments i ON i.symbol = o.symbol WHERE o.as_of = (SELECT MAX(as_of) FROM market_observations WHERE symbol = o.symbol) GROUP BY o.symbol ORDER BY o.symbol`).all() as any[];
  const today = todayISO();
  return {
    providers: Object.values(PROVIDERS).map((p) => p.info()),
    lastRefresh: db.prepare("SELECT provider, at, ok, message, count FROM market_refresh_log ORDER BY at DESC LIMIT 10").all(),
    observations: latestObs.map((o) => ({ symbol: o.symbol, name: o.name ?? o.symbol, kind: o.kind, value: o.value, currency: o.currency, asOf: o.as_of, fetchedAt: o.fetched_at, source: o.source, isDemo: o.is_demo === 1,
      stale: daysBetween(o.as_of, today) > 5, ageDays: daysBetween(o.as_of, today) })),
    disclaimer: "Rows marked 'demo' are simulated sample values, not market data. Stale = older than 5 days.",
  };
}

/** Manual CSV: symbol,date,value[,currency,kind] */
export function parseManualCsv(text: string): Observation[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = lines.shift()?.toLowerCase().split(",").map((s) => s.trim()) ?? [];
  const idx = (n: string) => head.indexOf(n);
  if (idx("symbol") < 0 || idx("date") < 0 || idx("value") < 0) throw new Error("CSV needs headers: symbol,date,value");
  return lines.map((l) => {
    const c = l.split(",").map((s) => s.trim());
    return { symbol: c[idx("symbol")], asOf: c[idx("date")], value: Number(c[idx("value")]), currency: (idx("currency") >= 0 ? c[idx("currency")] : "") || "INR", kind: ((idx("kind") >= 0 ? c[idx("kind")] : "") || "stock") as Observation["kind"], source: "manual", isDemo: false };
  });
}

export interface ApplyProposal { holdingId: string; name: string; symbol: string; quantity: number; price: number; priceAsOf: string; currency: string; fx: number | null; newValue: number | null; oldValue: number; skipped?: string }
/** Preview valuation updates (quantity × latest price). Manual valuations are protected unless explicitly included. */
export function proposeValuations(db: DB, clientId: string, includeManual = false): ApplyProposal[] {
  const hs = db.prepare("SELECT id, name, symbol, quantity, current_value, valuation_source FROM holdings WHERE client_id = ? AND archived = 0 AND symbol IS NOT NULL AND quantity IS NOT NULL").all(clientId) as any[];
  const fx = db.prepare("SELECT value FROM market_observations WHERE symbol = 'USDINR' ORDER BY as_of DESC LIMIT 1").get() as { value: number } | undefined;
  return hs.map((h) => {
    const o = db.prepare("SELECT value, currency, as_of, is_demo FROM market_observations WHERE symbol = ? ORDER BY as_of DESC LIMIT 1").get(h.symbol) as any;
    const base = { holdingId: h.id, name: h.name, symbol: h.symbol, quantity: h.quantity, oldValue: h.current_value };
    if (!o) return { ...base, price: 0, priceAsOf: "", currency: "", fx: null, newValue: null, skipped: "No price observation for this symbol." };
    if (h.valuation_source === "manual" && !includeManual) return { ...base, price: o.value, priceAsOf: o.as_of, currency: o.currency, fx: null, newValue: null, skipped: "Manual valuation is protected (tick 'include manual' to overwrite)." };
    let rate = 1;
    if (o.currency !== "INR") { if (!fx) return { ...base, price: o.value, priceAsOf: o.as_of, currency: o.currency, fx: null, newValue: null, skipped: "Needs a USDINR observation for currency conversion." }; rate = fx.value; }
    return { ...base, price: o.value, priceAsOf: o.as_of, currency: o.currency, fx: o.currency === "INR" ? null : rate, newValue: Math.round(h.quantity * o.value * rate * 100) };
  });
}
export { DEMO_UNIVERSE };
