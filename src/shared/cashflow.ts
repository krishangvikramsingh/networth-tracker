import { addMonths, daysBetween, endOfMonth, monthKey, monthLabel, startOfMonth, toDate, type ISODate } from "./dates";
import { pct, sum, type Paise } from "./money";
import { CASHFLOW_LABEL, isIncomeCategory, type CashflowCategory } from "./taxonomy";
import type { CashflowItem, ClientData, Frequency, Commitment, Liability } from "./types";

export const FREQ_PER_YEAR: Record<Frequency, number> = { monthly: 12, quarterly: 4, half_yearly: 2, annual: 1, once: 0 };
const STEP_MONTHS: Record<Exclude<Frequency, "once">, number> = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };

/** Monthly-equivalent (analytical only; the dated forecast uses real schedules). One-off items have no recurring equivalent. */
export function monthlyEquivalent(amount: Paise, f: Frequency): number {
  return (amount * FREQ_PER_YEAR[f]) / 12;
}

/** Cashflow items with liability EMIs materialised (credit cards excluded: their balance is a liability, not an EMI). */
export function effectiveCashflows(data: ClientData): CashflowItem[] {
  const items = data.cashflows.filter((c) => !c.archived);
  const linked = new Set(items.map((c) => c.liabilityId).filter(Boolean));
  const derived: CashflowItem[] = data.liabilities
    .filter((l: Liability) => !l.archived && l.type !== "credit_card" && l.emi && l.emi > 0 && !linked.has(l.id))
    .map((l) => ({
      id: `emi_${l.id}`, clientId: l.clientId, kind: "expense", category: "loan_emi", name: `EMI — ${l.name}`, amount: l.emi!,
      frequency: "monthly", anchorDate: l.nextDueDate, endDate: null, verified: true, essential: true, commitmentId: null, liabilityId: l.id,
      dataStatus: "collected", notes: "Derived from liability record", archived: false, isIllustrative: l.isIllustrative,
    }));
  return [...items, ...derived];
}

/** Dates an item pays/receives on within [from, to]. Null anchor + non-monthly => unscheduled (returns null). */
export function occurrences(item: Pick<CashflowItem, "frequency" | "anchorDate" | "endDate">, from: ISODate, to: ISODate): ISODate[] | null {
  const { frequency: f, anchorDate: a, endDate } = item;
  const out: ISODate[] = [];
  const within = (d: ISODate) => d >= from && d <= to && (!endDate || d <= endDate);
  if (f === "once") { if (!a) return null; return within(a) ? [a] : []; }
  const step = STEP_MONTHS[f];
  if (!a) {
    if (f !== "monthly") return null;
    // undated monthly item: one occurrence per calendar month touching the window
    for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) {
      const d = m < from ? from : m;
      if (d <= to && (!endDate || d <= endDate)) out.push(d);
    }
    return out;
  }
  // walk from the anchor in whole steps (anchor based, so day-of-month clipping never drifts)
  const maxK = 600;
  for (let k = 0; k < maxK; k++) {
    const d = addMonths(a, k * step);
    if (d > to) break;
    if (within(d)) out.push(d);
  }
  return out;
}

export interface CategoryRow { category: CashflowCategory; label: string; kind: "income" | "expense"; monthly: Paise; annual: Paise; items: number; unverified: boolean }

export interface CashflowSummary {
  monthlyIncome: Paise; monthlyIncomeVerified: Paise; monthlyOutflows: Paise; monthlySurplus: Paise;
  annualIncome: Paise; annualOutflows: Paise; annualSurplus: Paise;
  savingsRate: number | null; savingsNote: string; spendingForSavings: Paise;
  essentialMonthly: Paise; emiMonthly: Paise; recurringMonthlyOutflow: Paise; oneOffOutflows: Paise;
  byCategory: CategoryRow[]; incomeAssessed: boolean; hasIncome: boolean; hasUnscheduledReceipts: boolean;
}

export function summariseCashflow(data: ClientData): CashflowSummary {
  const items = effectiveCashflows(data);
  const inc = items.filter((i) => i.kind === "income" && i.frequency !== "once");
  const exp = items.filter((i) => i.kind === "expense" && i.frequency !== "once");
  const oneOff = items.filter((i) => i.kind === "expense" && i.frequency === "once");
  const meq = (i: CashflowItem) => monthlyEquivalent(i.amount, i.frequency);
  const monthlyIncome = Math.round(sum(inc.map(meq)));
  const monthlyIncomeVerified = Math.round(sum(inc.filter((i) => i.verified).map(meq)));
  const monthlyOutflows = Math.round(sum(exp.map(meq)));
  const excluded = new Set<CashflowCategory>(data.settings.savingsExcludedCategories);
  const spending = Math.round(sum(exp.filter((i) => !excluded.has(i.category)).map(meq)));
  const sr = monthlyIncome > 0 ? pct(monthlyIncome - spending, monthlyIncome) : null;
  const byCat = new Map<string, CategoryRow>();
  for (const i of [...inc, ...exp]) {
    const k = `${i.kind}:${i.category}`;
    const r = byCat.get(k) ?? { category: i.category, label: CASHFLOW_LABEL[i.category], kind: i.kind, monthly: 0, annual: 0, items: 0, unverified: false };
    r.monthly += meq(i); r.annual += meq(i) * 12; r.items++; r.unverified ||= !i.verified && i.kind === "income";
    byCat.set(k, r);
  }
  const hasUnscheduledReceipts = inc.some((i) => i.frequency !== "monthly" && !i.anchorDate);
  return {
    monthlyIncome, monthlyIncomeVerified, monthlyOutflows, monthlySurplus: monthlyIncome - monthlyOutflows,
    annualIncome: monthlyIncome * 12, annualOutflows: monthlyOutflows * 12 + sum(oneOff.map((o) => o.amount)), annualSurplus: monthlyIncome * 12 - monthlyOutflows * 12 - sum(oneOff.map((o) => o.amount)),
    savingsRate: sr,
    savingsNote: monthlyIncome <= 0 ? "No income recorded — savings rate cannot be calculated."
      : `(Income − spending) ÷ income, where spending excludes ${[...excluded].map((c) => CASHFLOW_LABEL[c]).join(", ") || "nothing"}.`,
    spendingForSavings: spending,
    essentialMonthly: Math.round(sum(exp.filter((i) => i.essential).map(meq))),
    emiMonthly: Math.round(sum(exp.filter((i) => i.category === "loan_emi").map(meq))),
    recurringMonthlyOutflow: monthlyOutflows, oneOffOutflows: sum(oneOff.map((o) => o.amount)),
    byCategory: [...byCat.values()].map((r) => ({ ...r, monthly: Math.round(r.monthly), annual: Math.round(r.annual) })).sort((a, b) => b.annual - a.annual),
    incomeAssessed: data.settings.incomeStatus === "complete", hasIncome: monthlyIncome > 0, hasUnscheduledReceipts,
  };
}

export interface ForecastEvent { date: ISODate; label: string; amount: Paise | null; kind: "inflow" | "outflow"; source: "cashflow" | "commitment" | "maturity" | "policy"; estimated?: boolean }
export interface ForecastMonth {
  month: string; label: string; inflow: Paise; outflow: Paise; net: Paise; balance: Paise | null; events: ForecastEvent[];
}
export interface Forecast {
  months: ForecastMonth[]; openingBalance: Paise | null; unscheduled: Array<{ label: string; amount: Paise; kind: "inflow" | "outflow"; reason: string }>;
  totalInflow: Paise; totalOutflow: Paise; unscheduledCommitments: Paise; scheduledCommitments: Paise;
  commitmentCoverage: number | null; maturityEventsWithoutValue: number; horizonMonths: number;
}

function commitmentSchedule(c: Commitment, from: ISODate, to: ISODate): { events: ForecastEvent[]; unscheduledRemaining: Paise } {
  const remaining = Math.max(0, c.totalAmount - c.paidAmount);
  if (remaining === 0) return { events: [], unscheduledRemaining: 0 };
  if (!c.nextDueDate || !c.installmentAmount || !c.frequency || c.frequency === "once") {
    if (c.frequency === "once" && c.nextDueDate && c.nextDueDate >= from && c.nextDueDate <= to) {
      return { events: [{ date: c.nextDueDate, label: c.name, amount: remaining, kind: "outflow", source: "commitment" }], unscheduledRemaining: 0 };
    }
    return { events: [], unscheduledRemaining: remaining };
  }
  const step = STEP_MONTHS[c.frequency as Exclude<Frequency, "once">];
  const events: ForecastEvent[] = [];
  let left = remaining;
  for (let k = 0; left > 0 && k < 600; k++) {
    const d = addMonths(c.nextDueDate, k * step);
    if (c.endDate && d > c.endDate) break;
    const amt = Math.min(c.installmentAmount, left);
    left -= amt;
    if (d > to) break;
    if (d >= from) events.push({ date: d, label: `${c.name} (instalment)`, amount: amt, kind: "outflow", source: "commitment" });
  }
  // anything beyond the horizon is still scheduled, not "unscheduled"
  return { events, unscheduledRemaining: 0 };
}

export function buildForecast(data: ClientData, asOf: ISODate, horizonMonths = 12, openingOverride?: Paise | null): Forecast {
  const from = asOf, to = endOfMonth(addMonths(asOf, horizonMonths - 1));
  const events: ForecastEvent[] = [];
  const unscheduled: Forecast["unscheduled"] = [];
  for (const i of effectiveCashflows(data)) {
    const occ = occurrences(i, from, to);
    if (occ === null) {
      if (i.frequency !== "once") unscheduled.push({ label: i.name, amount: i.amount, kind: i.kind === "income" ? "inflow" : "outflow", reason: `${i.frequency.replace("_", "-")} payment date not recorded` });
      continue;
    }
    for (const d of occ) events.push({ date: d, label: i.name, amount: i.amount, kind: i.kind === "income" ? "inflow" : "outflow", source: "cashflow" });
  }
  let unscheduledCommitments = 0, scheduledCommitments = 0;
  for (const c of data.commitments.filter((c) => !c.archived)) {
    const s = commitmentSchedule(c, from, to);
    events.push(...s.events);
    scheduledCommitments += sum(s.events.map((e) => e.amount));
    if (s.unscheduledRemaining > 0) {
      unscheduledCommitments += s.unscheduledRemaining;
      unscheduled.push({ label: `${c.name} — remaining commitment`, amount: s.unscheduledRemaining, kind: "outflow", reason: "payment schedule not recorded" });
    }
  }
  let maturityNoValue = 0;
  const addMaturity = (date: ISODate | null, label: string, expected: Paise | null) => {
    if (!date || date < from || date > to) return;
    if (expected == null) maturityNoValue++;
    events.push({ date, label: `${label} matures`, amount: expected, kind: "inflow", source: "maturity", estimated: expected == null });
  };
  for (const h of data.holdings.filter((h) => !h.archived)) addMaturity(h.maturityDate, h.name, h.expectedMaturityValue);
  for (const p of data.policies.filter((p) => !p.archived)) addMaturity(p.maturityDate, `${p.insurer ?? "Policy"} ${p.type}`, p.expectedMaturityValue);
  for (const p of data.policies.filter((p) => !p.archived && p.annualPremium && p.nextPremiumDate)) {
    // premiums that are not already modelled as an explicit cashflow item
    const modelled = data.cashflows.some((c) => !c.archived && c.category === "insurance_premium" && c.name.toLowerCase().includes((p.insurer ?? "~").toLowerCase()));
    if (modelled) continue;
    const per = FREQ_PER_YEAR[p.premiumFrequency ?? "annual"] || 1;
    const amt = Math.round(p.annualPremium! / per);
    const occ = occurrences({ frequency: p.premiumFrequency ?? "annual", anchorDate: p.nextPremiumDate, endDate: p.maturityDate }, from, to) ?? [];
    for (const d of occ) events.push({ date: d, label: `Premium — ${p.insurer ?? p.type}`, amount: amt, kind: "outflow", source: "policy" });
  }

  const bankBalances = data.holdings.filter((h) => !h.archived && (h.instrumentType === "bank_balance" || h.instrumentType === "cash"));
  const opening = openingOverride !== undefined ? openingOverride : bankBalances.length ? sum(bankBalances.map((b) => b.currentValue)) : null;

  const months: ForecastMonth[] = [];
  let bal = opening;
  for (let m = 0; m < horizonMonths; m++) {
    const ms = startOfMonth(addMonths(asOf, m)); const key = monthKey(ms);
    const ev = events.filter((e) => monthKey(e.date) === key).sort((a, b) => a.date.localeCompare(b.date));
    const inflow = sum(ev.filter((e) => e.kind === "inflow").map((e) => e.amount));
    const outflow = sum(ev.filter((e) => e.kind === "outflow").map((e) => e.amount));
    if (bal != null) bal += inflow - outflow;
    months.push({ month: key, label: monthLabel(key), inflow, outflow, net: inflow - outflow, balance: bal, events: ev });
  }
  const remainingCommit = sum(data.commitments.filter((c) => !c.archived).map((c) => Math.max(0, c.totalAmount - c.paidAmount)));
  const reserves = sum(data.holdings.filter((h) => !h.archived && h.emergencyEligible && !h.parentId).map((h) => h.currentValue));
  return {
    months, openingBalance: opening, unscheduled, totalInflow: sum(months.map((m) => m.inflow)), totalOutflow: sum(months.map((m) => m.outflow)),
    unscheduledCommitments, scheduledCommitments, commitmentCoverage: remainingCommit > 0 ? reserves / remainingCommit : null,
    maturityEventsWithoutValue: maturityNoValue, horizonMonths,
  };
}

/** Totals of dated occurrences inside an arbitrary window (monthly / quarterly / annual / custom views). */
export function periodTotals(data: ClientData, from: ISODate, to: ISODate): { inflow: Paise; outflow: Paise; net: Paise; unscheduled: number } {
  let inflow = 0, outflow = 0, unsched = 0;
  for (const i of effectiveCashflows(data)) {
    const occ = occurrences(i, from, to);
    if (occ === null) { unsched++; continue; }
    const t = occ.length * i.amount;
    if (i.kind === "income") inflow += t; else outflow += t;
  }
  return { inflow, outflow, net: inflow - outflow, unscheduled: unsched };
}

export function isRecurring(i: Pick<CashflowItem, "frequency">): boolean { return i.frequency !== "once"; }
export { isIncomeCategory, daysBetween, toDate };
