import type { Paise } from "./money";
import type { Holding, InsurancePolicy } from "./types";

/**
 * Nominee coverage. "Not recorded" means nothing has been entered; it is NOT a statement that no nominee exists
 * (unknown is not zero). Shares are basis points of one asset and must total 10,000 for a complete nomination.
 */
export interface Nominee { id: string; clientId: string; name: string; relationship: string; contact: string | null; notes: string | null }
export interface Nomination { id: string; clientId: string; entity: "holding" | "policy"; entityId: string; nomineeId: string; shareBps: number }
export type NominationStatus = "not_recorded" | "partial" | "complete" | "invalid";

export interface CoverageRow {
  entity: "holding" | "policy"; entityId: string; name: string; value: Paise | null; status: NominationStatus; totalBps: number;
  shares: Array<{ nomineeId: string; nomineeName: string; shareBps: number }>;
}
export interface Coverage {
  rows: CoverageRow[];
  counts: Record<NominationStatus, number>;
  /** Value of holdings recorded as fully nominated, and the total holding value; both exclude insurance cover. */
  completeValue: Paise; totalValue: Paise;
  /** Share of holding value that is fully nominated; null when there are no holdings to measure. */
  coveredPct: number | null;
}

export const statusOf = (totalBps: number): NominationStatus => (totalBps === 0 ? "not_recorded" : totalBps === 10000 ? "complete" : totalBps < 10000 ? "partial" : "invalid");

/**
 * Only top-level holdings are measured: underlying positions inside an aggregate (a PMS, a fund-of-funds) share the
 * account-level nomination, and counting them would double count.
 */
export function nominationCoverage(holdings: Holding[], policies: InsurancePolicy[], nominees: Nominee[], nominations: Nomination[]): Coverage {
  const nameOf = new Map(nominees.map((n) => [n.id, n.name]));
  const by = new Map<string, Nomination[]>();
  for (const n of nominations) { const k = `${n.entity}:${n.entityId}`; by.set(k, [...(by.get(k) ?? []), n]); }
  const mk = (entity: CoverageRow["entity"], id: string, name: string, value: Paise | null): CoverageRow => {
    const list = by.get(`${entity}:${id}`) ?? [];
    const totalBps = list.reduce((a, n) => a + n.shareBps, 0);
    return { entity, entityId: id, name, value, status: statusOf(totalBps), totalBps, shares: list.map((n) => ({ nomineeId: n.nomineeId, nomineeName: nameOf.get(n.nomineeId) ?? "Removed nominee", shareBps: n.shareBps })) };
  };
  const rows = [
    ...holdings.filter((h) => !h.archived && !h.parentId).map((h) => mk("holding", h.id, h.name, h.currentValue)),
    ...policies.filter((p) => !p.archived).map((p) => mk("policy", p.id, `${p.insurer ?? "Policy"}${p.policyNo ? ` ${p.policyNo}` : ""} (${p.type.replace(/_/g, " ")})`, p.sumAssured)),
  ];
  const counts: Coverage["counts"] = { not_recorded: 0, partial: 0, complete: 0, invalid: 0 };
  for (const r of rows) counts[r.status]++;
  const hs = rows.filter((r) => r.entity === "holding");
  const totalValue = hs.reduce((a, r) => a + (r.value ?? 0), 0);
  const completeValue = hs.filter((r) => r.status === "complete").reduce((a, r) => a + (r.value ?? 0), 0);
  return { rows, counts, completeValue, totalValue, coveredPct: totalValue > 0 ? (completeValue / totalValue) * 100 : null };
}
