import { describe, expect, it } from "vitest";
import { crore, lakh } from "../src/shared/money";
import { evaluateClient } from "../src/shared/evaluate";
import { ASOF, buildPriya } from "./helpers";

describe("Priya initial reconciliation", () => {
  const e = evaluateClient(buildPriya(), ASOF);
  it("gross assets reconcile to ₹8.63 Cr", () => expect(e.portfolio.grossAssets).toBe(crore(8.63)));
  it("known monthly expenses ₹2 L and annual ₹24 L", () => {
    expect(e.cash.monthlyOutflows).toBe(lakh(2));
    expect(e.cash.monthlyOutflows * 12).toBe(lakh(24));
    expect(e.cash.essentialMonthly).toBe(lakh(2));
  });
  it("pension figures", () => {
    const c = buildPriya().commitments[0];
    expect(c.totalAmount).toBe(crore(1)); expect(c.paidAmount).toBe(lakh(80));
    expect(c.totalAmount - c.paidAmount).toBe(lakh(20)); expect(c.annualReceivable).toBe(lakh(5));
    expect(e.netWorth.commitmentsRemaining).toBe(lakh(20));
  });
  it("monthly-equivalent pension ₹41,666.67 but annual schedule kept", () => {
    expect(e.cash.monthlyIncome).toBe(Math.round(lakh(5) / 12));
    expect(e.cash.monthlyIncome / 100).toBeCloseTo(41666.67, 1);
    expect(e.forecast.unscheduled.some((u) => u.label.includes("pension") && u.kind === "inflow")).toBe(true);
  });
  it("liabilities not assessed => no net worth, upper bound only", () => {
    expect(e.netWorth.liabilitiesStatus).toBe("not_assessed");
    expect(e.netWorth.netWorth).toBeNull();
    expect(e.netWorth.upperBound).toBe(crore(8.63));
  });
  it("does not invent data", () => {
    const d = buildPriya();
    expect(d.liabilities).toHaveLength(0); expect(d.snapshots).toHaveLength(0); expect(d.transactions).toHaveLength(0);
    expect(e.portfolio.returns.absoluteReturn).toBeNull();
    expect(e.portfolio.xirr.ok).toBe(false);
    expect(e.netWorth.changeMonth.comparable).toBe(false);
    expect(d.holdings.some((h) => h.instrumentType === "bank_balance")).toBe(false);
  });
  it("mutual funds are unclassified and widen equity/debt to ranges", () => {
    expect(e.portfolio.unresolved.value).toBe(crore(1.83));
    const eq = e.equityBounds;
    expect(eq.min!).toBeCloseTo(((crore(1.5) + lakh(70)) / (crore(8.63) - crore(2.5))) * 100, 5);
    expect(eq.max!).toBeGreaterThan(60);
  });
  it("Rule 1 and 3 are 'possible' (data dependent), not definite", () => {
    expect(e.rules.find((r) => r.key === "equity_allocation_max")!.state).toBe("possible");
    expect(e.rules.find((r) => r.key === "debt_allocation_min")!.state).toBe("possible");
  });
  it("EMI, net-worth-decline, single-stock are not evaluable, never numeric alerts", () => {
    for (const k of ["emi_to_income_max", "net_worth_decline", "single_stock_max"] as const) expect(e.rules.find((r) => r.key === k)!.state).toBe("not_evaluable");
  });
  it("health score is provisional with partial coverage", () => {
    expect(e.health.provisional).toBe(true);
    expect(e.health.coverage).toBeLessThan(1);
    expect(e.health.components.find((c) => c.key === "debt")!.assessed).toBe(false);
    expect(e.health.components.find((c) => c.key === "insurance")!.assessed).toBe(false);
  });
  it("emergency coverage uses FD reserves over essential expenses", () => {
    expect(e.emergencyCoverageMonths).toBeCloseTo(30, 5);
  });
  it("data completeness is below 100%", () => expect(e.completeness.percent).toBeLessThan(60));
});
