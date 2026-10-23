import { addMonths, daysBetween, type ISODate } from "./dates";
import { pct, sum, type Paise } from "./money";
import type { ClientData, Snapshot } from "./types";
import type { PortfolioResult } from "./portfolio";
import { txFlowSign } from "./portfolio";

export interface NetWorthChange {
  window: "month" | "year"; previous: Snapshot | null; comparable: boolean; reason: string;
  absolute: Paise | null; percent: number | null;
  attribution: null | { liabilityChange: Paise; netExternalWithdrawals: Paise; valuationAndOther: Paise };
}

export interface NetWorthResult {
  grossAssets: Paise;
  liabilities: Paise; // confirmed outstanding
  liabilitiesStatus: "not_assessed" | "partial" | "complete";
  netWorth: Paise | null; // null while liabilities not assessed at all
  provisional: boolean;
  upperBound: Paise; // gross assets: net worth cannot exceed this
  commitmentsRemaining: Paise;
  adjustedNetWorth: Paise | null; // net worth − remaining contractual commitments
  debtToNetWorthPct: number | null;
  note: string;
  changeMonth: NetWorthChange; changeYear: NetWorthChange;
}

/** Find the snapshot closest to (asOf − months) within a tolerance. */
export function findComparableSnapshot(snaps: Snapshot[], asOf: ISODate, months: number, toleranceDays = 20): Snapshot | null {
  const target = addMonths(asOf, -months);
  let best: Snapshot | null = null, bestD = Infinity;
  for (const s of snaps) {
    if (s.date > asOf) continue;
    const d = Math.abs(daysBetween(s.date, target));
    if (d <= toleranceDays && d < bestD) { best = s; bestD = d; }
  }
  return best;
}

function change(data: ClientData, window: "month" | "year", currentNW: Paise | null, currentLiab: Paise, liabComplete: boolean, asOf: ISODate): NetWorthChange {
  const prev = findComparableSnapshot(data.snapshots, asOf, window === "month" ? 1 : 12, window === "month" ? 20 : 45);
  const none = (reason: string): NetWorthChange => ({ window, previous: prev, comparable: false, reason, absolute: null, percent: null, attribution: null });
  if (!prev) return none(`No ${window === "month" ? "month-end" : "year-ago"} snapshot recorded.`);
  if (currentNW == null) return none("Current net worth cannot be calculated yet (liabilities not assessed).");
  if (prev.netWorth == null) return none("Previous snapshot has no net worth (liabilities were not assessed then).");
  if (prev.liabilitiesComplete !== liabComplete) return none("Snapshots use different liability completeness, so they are not comparable.");
  const abs = currentNW - prev.netWorth;
  const percent = prev.netWorth === 0 ? null : (abs / Math.abs(prev.netWorth)) * 100;
  const flows = data.transactions.filter((t) => t.date > prev.date && t.date <= asOf);
  const withdrawals = sum(flows.filter((t) => t.type === "withdrawal").map((t) => t.amount));
  const contributions = sum(flows.filter((t) => t.type === "contribution").map((t) => t.amount));
  const liabChange = currentLiab - (prev.liabilities ?? 0);
  const netExternal = withdrawals - contributions;
  // net worth Δ = −Δliabilities − withdrawals + contributions(from outside) + valuation/other
  const valuation = abs + liabChange + netExternal;
  return { window, previous: prev, comparable: true, reason: "", absolute: abs, percent, attribution: { liabilityChange: liabChange, netExternalWithdrawals: netExternal, valuationAndOther: valuation } };
}

export function computeNetWorth(data: ClientData, p: PortfolioResult, asOf: ISODate): NetWorthResult {
  const active = data.liabilities.filter((l) => !l.archived);
  const liabilities = sum(active.map((l) => l.outstanding));
  const declared = data.settings.liabilitiesStatus;
  // having recorded any liability lifts "not_assessed" to at least "partial"
  const status: NetWorthResult["liabilitiesStatus"] = declared === "complete" ? "complete" : active.length > 0 ? "partial" : "not_assessed";
  const netWorth = status === "not_assessed" ? null : p.grossAssets - liabilities;
  const commitments = sum(data.commitments.filter((c) => !c.archived).map((c) => Math.max(0, c.totalAmount - c.paidAmount)));
  const note = status === "complete" ? "Net worth = gross assets − confirmed outstanding liabilities."
    : status === "partial" ? "Provisional: only some liabilities have been recorded. Mark liabilities complete once every loan and card balance is entered."
    : "Liabilities have not been assessed yet, so net worth is not calculated. Gross assets are an upper bound.";
  const complete = status === "complete";
  return {
    grossAssets: p.grossAssets, liabilities, liabilitiesStatus: status, netWorth, provisional: status !== "complete", upperBound: p.grossAssets,
    commitmentsRemaining: commitments, adjustedNetWorth: netWorth == null ? null : netWorth - commitments,
    debtToNetWorthPct: netWorth != null && netWorth > 0 ? pct(liabilities, netWorth) : null,
    note, changeMonth: change(data, "month", netWorth, liabilities, complete, asOf), changeYear: change(data, "year", netWorth, liabilities, complete, asOf),
  };
}

export { txFlowSign };
