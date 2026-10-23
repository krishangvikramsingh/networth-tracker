/**
 * Money handling. All monetary amounts are stored as INTEGER PAISE (1 rupee = 100 paise).
 * JS numbers represent integers exactly up to 9.007e15 paise (~ INR 9 x 10^13), far above any
 * personal-wealth value, so integer arithmetic here is exact. Ratios/percentages are derived
 * (floating point) only at the very end and are never stored as money.
 */
export type Paise = number;

export const PAISE_PER_RUPEE = 100;
export const LAKH = 100_000 * PAISE_PER_RUPEE;
export const CRORE = 10_000_000 * PAISE_PER_RUPEE;

export function rupees(r: number): Paise {
  return Math.round(r * PAISE_PER_RUPEE);
}
export const lakh = (n: number): Paise => Math.round(n * LAKH);
export const crore = (n: number): Paise => Math.round(n * CRORE);
export const toRupees = (p: Paise): number => p / PAISE_PER_RUPEE;

export function sum(values: Array<Paise | null | undefined>): Paise {
  let t = 0;
  for (const v of values) if (v != null) t += v;
  return t;
}

/** Division that returns null instead of Infinity/NaN. */
export function ratio(n: number | null | undefined, d: number | null | undefined): number | null {
  if (n == null || d == null || !Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}
/** Percentage (0-100 scale) or null if not meaningful. */
export function pct(n: number | null | undefined, d: number | null | undefined): number | null {
  const r = ratio(n, d);
  // round away binary float noise (55.00000000000001) so threshold comparisons at exactly the limit are stable
  return r == null ? null : Math.round(r * 100 * 1e9) / 1e9;
}

/** Indian digit grouping: 12,34,56,789 */
export function groupIndian(intStr: string): string {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  const rest = intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** Full rupee format e.g. "₹2,50,00,000" (paise shown only when non-zero). */
export function formatINR(p: Paise | null | undefined, opts: { paise?: boolean } = {}): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const neg = p < 0;
  const abs = Math.abs(Math.round(p));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let s = groupIndian(String(whole));
  if (frac !== 0 || opts.paise) s += "." + String(frac).padStart(2, "0");
  return `${neg ? "-" : ""}₹${s}`;
}

/** Compact lakh/crore format, e.g. ₹8.63 Cr, ₹20.00 L, ₹41,667 */
export function formatCompact(p: Paise | null | undefined, digits = 2): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const neg = p < 0;
  const abs = Math.abs(p);
  let out: string;
  if (abs >= CRORE) out = `₹${(abs / CRORE).toFixed(digits)} Cr`;
  else if (abs >= LAKH) out = `₹${(abs / LAKH).toFixed(digits)} L`;
  else out = formatINR(abs).replace(/^-/, "");
  return neg ? `-${out}` : out;
}

export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}
export function formatPP(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)} pp`;
}

/** Parse "1,00,000" / "₹ 5.5" / "20L" / "1.5cr" style user input to paise. Returns null on failure. */
export function parseMoneyInput(input: string): Paise | null {
  const s = input.trim().toLowerCase().replace(/[₹,\s]/g, "").replace(/^rs\.?/, "");
  if (!s) return null;
  const m = /^(-?\d+(?:\.\d+)?)(cr|crore|l|lac|lakh|lakhs|k)?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2];
  if (!unit) return rupees(n);
  if (unit === "k") return rupees(n * 1000);
  if (unit.startsWith("l")) return lakh(n);
  return crore(n);
}
