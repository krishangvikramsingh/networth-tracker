import { describe, expect, it } from "vitest";
import { nominationCoverage, statusOf, type Nomination, type Nominee } from "../src/shared/estate";
import type { InsurancePolicy } from "../src/shared/types";
import { crore, lakh } from "../src/shared/money";
import { mkHolding } from "./helpers";

const nominees: Nominee[] = [
  { id: "n1", clientId: "t", name: "Asha", relationship: "Spouse", contact: null, notes: null },
  { id: "n2", clientId: "t", name: "Ravi", relationship: "Son", contact: null, notes: null },
];
const nom = (entityId: string, nomineeId: string, shareBps: number, entity: "holding" | "policy" = "holding"): Nomination => ({ id: `${entityId}${nomineeId}`, clientId: "t", entity, entityId, nomineeId, shareBps });
const h = (id: string, value: number, over = {}) => mkHolding("t", { id, name: `Holding ${id}`, instrumentType: "bank_balance", currentValue: value, ...over });
const policy = (id: string, over: Partial<InsurancePolicy> = {}): InsurancePolicy => ({ id, clientId: "t", type: "term_life", insurer: "Acme", policyNo: "P1", sumAssured: crore(1), annualPremium: null, premiumFrequency: null, nextPremiumDate: null, renewalDate: null, maturityDate: null, expectedMaturityValue: null, dataStatus: "collected", archived: false, isIllustrative: false, ...over });

describe("nomination status", () => {
  it("below, at and above 100%", () => {
    expect(statusOf(0)).toBe("not_recorded"); expect(statusOf(9999)).toBe("partial"); expect(statusOf(10000)).toBe("complete"); expect(statusOf(10001)).toBe("invalid");
  });
});

describe("nomination coverage", () => {
  it("separates complete, partial and not-recorded, and reports value-weighted coverage", () => {
    const hs = [h("a", crore(1)), h("b", crore(1)), h("c", crore(2))];
    const ns = [nom("a", "n1", 10000), nom("b", "n1", 6000), nom("b", "n2", 2000)];
    const c = nominationCoverage(hs, [], nominees, ns);
    expect(c.rows.map((r) => r.status)).toEqual(["complete", "partial", "not_recorded"]);
    expect(c.counts).toEqual({ not_recorded: 1, partial: 1, complete: 1, invalid: 0 });
    expect(c.completeValue).toBe(crore(1)); expect(c.totalValue).toBe(crore(4)); expect(c.coveredPct).toBe(25);
    expect(c.rows[1].totalBps).toBe(8000);
  });
  it("splits one asset between two nominees to exactly 100%", () => {
    const c = nominationCoverage([h("a", lakh(10))], [], nominees, [nom("a", "n1", 6000), nom("a", "n2", 4000)]);
    expect(c.rows[0].status).toBe("complete"); expect(c.rows[0].shares.map((s) => s.nomineeName)).toEqual(["Asha", "Ravi"]);
  });
  it("flags shares above 100% as invalid and does not count them as covered", () => {
    const c = nominationCoverage([h("a", lakh(10))], [], nominees, [nom("a", "n1", 7000), nom("a", "n2", 4000)]);
    expect(c.rows[0].status).toBe("invalid"); expect(c.completeValue).toBe(0); expect(c.coveredPct).toBe(0);
  });
  it("measures only top-level, active holdings (no double counting of underlying positions)", () => {
    const hs = [h("agg", crore(1), { isAggregate: true }), h("kid", lakh(40), { parentId: "agg" }), h("gone", lakh(5), { archived: true })];
    const c = nominationCoverage(hs, [], nominees, []);
    expect(c.rows.map((r) => r.entityId)).toEqual(["agg"]); expect(c.totalValue).toBe(crore(1));
  });
  it("lists active policies separately and keeps their cover out of the asset total", () => {
    const c = nominationCoverage([h("a", lakh(10))], [policy("p1"), policy("p2", { archived: true }), policy("p3", { sumAssured: null, insurer: null, policyNo: null })], nominees, [nom("p1", "n1", 10000, "policy")]);
    expect(c.rows.filter((r) => r.entity === "policy").map((r) => [r.entityId, r.status, r.value])).toEqual([["p1", "complete", crore(1)], ["p3", "not_recorded", null]]);
    expect(c.totalValue).toBe(lakh(10));
  });
  it("coverage is null, not 0%, when there are no holdings to measure", () => {
    expect(nominationCoverage([], [], nominees, []).coveredPct).toBeNull();
  });
  it("a removed nominee is labelled rather than dropped", () => {
    const c = nominationCoverage([h("a", lakh(1))], [], [], [nom("a", "ghost", 10000)]);
    expect(c.rows[0].shares[0].nomineeName).toBe("Removed nominee");
  });
});
