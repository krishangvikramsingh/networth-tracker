import { daysBetween, type ISODate } from "./dates";

export interface DatedFlow { date: ISODate; amount: number } // investor perspective: negative = invested, positive = received

export type XirrResult =
  | { ok: true; rate: number; iterations: number }
  | { ok: false; reason: string };

/**
 * XIRR: the annual rate r such that  sum( CF_i / (1+r)^((d_i - d_0)/365) ) = 0.
 * Requires at least one negative and one positive flow on distinct-enough dates.
 * Solved with a bracketed hybrid Newton / bisection so it cannot diverge.
 */
export function xirr(flows: DatedFlow[]): XirrResult {
  const valid = flows.filter((f) => f && Number.isFinite(f.amount) && /^\d{4}-\d{2}-\d{2}$/.test(f.date));
  if (valid.length !== flows.length) return { ok: false, reason: "Cash-flow series contains missing dates or invalid amounts." };
  const nonZero = valid.filter((f) => f.amount !== 0);
  if (nonZero.length < 2) return { ok: false, reason: "Insufficient cash-flow history." };
  if (!nonZero.some((f) => f.amount < 0) || !nonZero.some((f) => f.amount > 0)) {
    return { ok: false, reason: "Need at least one outflow (investment) and one inflow (withdrawal / valuation)." };
  }
  const sorted = [...nonZero].sort((a, b) => a.date.localeCompare(b.date));
  const d0 = sorted[0].date;
  const span = daysBetween(d0, sorted[sorted.length - 1].date);
  if (span <= 0) return { ok: false, reason: "All cash flows fall on the same date." };
  if (span < 30) return { ok: false, reason: "Holding period under 30 days; annualised XIRR is not meaningful." };
  const t = sorted.map((f) => daysBetween(d0, f.date) / 365);
  const npv = (r: number) => sorted.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, t[i]), 0);
  const dnpv = (r: number) => sorted.reduce((s, f, i) => s - (t[i] * f.amount) / Math.pow(1 + r, t[i] + 1), 0);

  let lo = -0.999999, hi = 10;
  let fLo = npv(lo), fHi = npv(hi);
  // widen upper bracket if needed
  let guard = 0;
  while (fLo * fHi > 0 && guard++ < 40) { hi *= 2; fHi = npv(hi); }
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return { ok: false, reason: "XIRR did not converge (no sign change in NPV)." };

  let r = 0.1, it = 0;
  for (; it < 200; it++) {
    const f = npv(r);
    if (Math.abs(f) < 1e-7) return { ok: true, rate: r, iterations: it };
    if (fLo * f < 0) { hi = r; fHi = f; } else { lo = r; fLo = f; }
    const d = dnpv(r);
    let next = d !== 0 && Number.isFinite(d) ? r - f / d : NaN;
    if (!Number.isFinite(next) || next <= lo || next >= hi) next = (lo + hi) / 2;
    if (Math.abs(next - r) < 1e-12) { r = next; break; }
    r = next;
  }
  if (Math.abs(npv(r)) < 1e-3) return { ok: true, rate: r, iterations: it };
  return { ok: false, reason: "XIRR did not converge." };
}
