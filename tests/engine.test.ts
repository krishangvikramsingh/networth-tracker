import { describe, expect, it } from "vitest";
import { crore, formatCompact, formatINR, groupIndian, lakh, parseMoneyInput, pct, rupees, sum } from "../src/shared/money";
import { xirr } from "../src/shared/xirr";
import { classifyCashflow, classifyHolding, defaultMappings } from "../src/shared/classify";
import { computePortfolio, computeAllocation, toEffectiveLines } from "../src/shared/portfolio";
import { computeNetWorth, findComparableSnapshot } from "../src/shared/networth";
import { buildForecast, occurrences, summariseCashflow } from "../src/shared/cashflow";
import { evaluateClient } from "../src/shared/evaluate";
import { projectGoal } from "../src/shared/goals";
import { applyTrades } from "../src/shared/rebalance";
import { emiOf, buildCases, CASE_IDS } from "../src/shared/fixtures";
import { ASOF, blank, mkCashflow, mkHolding, mkLiability, ruleOf, setRule } from "./helpers";
import type { ClientData } from "../src/shared/types";

const eq = (name: string, v: number, extra: object = {}) => mkHolding("t", { name, instrumentType: "equity_mf", classOverride: "indian_equity", currentValue: rupees(v), valuationDate: "2026-10-15", ...extra });
const debt = (name: string, v: number, extra: object = {}) => mkHolding("t", { name, instrumentType: "fixed_deposit", currentValue: rupees(v), valuationDate: "2026-10-15", ...extra });

describe("money & formatting", () => {
  it("indian grouping", () => { expect(groupIndian("250000000")).toBe("25,00,00,000"); expect(formatINR(crore(2.5))).toBe("₹2,50,00,000"); });
  it("compact", () => { expect(formatCompact(crore(8.63))).toBe("₹8.63 Cr"); expect(formatCompact(lakh(20))).toBe("₹20.00 L"); expect(formatCompact(-lakh(2))).toBe("-₹2.00 L"); });
  it("exact integer sums (no float drift)", () => { expect(sum([rupees(0.1), rupees(0.2)])).toBe(rupees(0.3)); });
  it("parse inputs", () => { expect(parseMoneyInput("1.5cr")).toBe(crore(1.5)); expect(parseMoneyInput("₹ 20L")).toBe(lakh(20)); expect(parseMoneyInput("1,00,000")).toBe(lakh(1)); expect(parseMoneyInput("abc")).toBeNull(); });
  it("pct safe on zero", () => { expect(pct(5, 0)).toBeNull(); expect(pct(null, 5)).toBeNull(); });
});

describe("classification", () => {
  const m = defaultMappings();
  it("override wins", () => expect(classifyHolding({ name: "Gold", originalDescription: "Gold", instrumentType: "other", classOverride: "debt" }, m).assetClass).toBe("debt"));
  it("exact name", () => { const r = classifyHolding({ name: "Fixed deposits", originalDescription: "", instrumentType: "other", classOverride: null }, m); expect(r.method).toBe("exact_name"); expect(r.assetClass).toBe("debt"); });
  it("instrument type", () => expect(classifyHolding({ name: "x", originalDescription: "", instrumentType: "fixed_deposit", classOverride: null }, m).assetClass).toBe("debt"));
  it("keyword refines ambiguous types", () => { const r = classifyHolding({ name: "Nasdaq 100 FoF", originalDescription: "", instrumentType: "equity_mf", classOverride: null }, m); expect(r.assetClass).toBe("global_equity"); expect(r.status).toBe("provisional"); });
  it("unresolved goes to review queue", () => { const r = classifyHolding({ name: "Misc fund", originalDescription: "", instrumentType: "mutual_fund_aggregate", classOverride: null }, m); expect(r.assetClass).toBeNull(); expect(r.status).toBe("needs_review"); });
  it("AIF/PMS are provisional", () => { for (const t of ["aif", "pms"] as const) expect(classifyHolding({ name: "x", originalDescription: "", instrumentType: t, classOverride: null }, m).status).toBe("provisional"); });
  it("cashflow mapping respects income vs expense", () => {
    expect(classifyCashflow("Monthly salary", "income", m).category).toBe("salary");
    expect(classifyCashflow("Rent received", "income", m).category).toBe("rental");
    expect(classifyCashflow("House rent", "expense", m).category).toBe("household");
    expect(classifyCashflow("Hospital bill", "expense", m).category).toBe("medical");
    expect(classifyCashflow("Home loan EMI", "expense", m).category).toBe("loan_emi");
    expect(classifyCashflow("blah", "expense", m).category).toBeNull();
  });
});

describe("aggregates vs underlying (no double counting)", () => {
  const agg = mkHolding("t", { id: "mf", name: "MF", instrumentType: "mutual_fund_aggregate", currentValue: lakh(100), isAggregate: true });
  it("children replace aggregate; remainder stays unresolved", () => {
    const kid = eq("Flexi", 0, { parentId: "mf", currentValue: lakh(60) });
    const { lines, reconciliation } = toEffectiveLines([agg, kid]);
    expect(sum(lines.map((l) => l.value))).toBe(lakh(100));
    expect(lines).toHaveLength(2); expect(reconciliation[0].kind).toBe("unallocated_remainder"); expect(reconciliation[0].difference).toBe(lakh(40));
  });
  it("children equal aggregate => no remainder", () => {
    const kids = [eq("a", 0, { parentId: "mf", currentValue: lakh(60) }), debt("b", 0, { parentId: "mf", currentValue: lakh(40) })];
    const { lines, reconciliation } = toEffectiveLines([agg, ...kids]);
    expect(lines).toHaveLength(2); expect(reconciliation).toHaveLength(0);
  });
  it("children exceed aggregate => flagged, children total counted once", () => {
    const { lines, reconciliation } = toEffectiveLines([agg, eq("a", 0, { parentId: "mf", currentValue: lakh(130) })]);
    expect(sum(lines.map((l) => l.value))).toBe(lakh(130)); expect(reconciliation[0].kind).toBe("children_exceed_aggregate");
  });
  it("archived children ignored", () => {
    const { lines } = toEffectiveLines([agg, eq("a", 0, { parentId: "mf", currentValue: lakh(60), archived: true })]);
    expect(lines).toHaveLength(1); expect(lines[0].value).toBe(lakh(100));
  });
});

describe("returns & XIRR", () => {
  it("absolute return and %", () => {
    const d = blank({ holdings: [eq("a", 120, { investedValue: rupees(100) })] });
    const p = computePortfolio(d, ASOF);
    expect(p.returns.absoluteReturn).toBe(rupees(20)); expect(p.returns.absoluteReturnPct).toBeCloseTo(20, 8);
  });
  it("unavailable when invested capital missing", () => {
    const p = computePortfolio(blank({ holdings: [eq("a", 120)] }), ASOF);
    expect(p.returns.absoluteReturn).toBeNull(); expect(p.returns.absoluteReturnPct).toBeNull();
  });
  it("partial coverage is disclosed", () => {
    const p = computePortfolio(blank({ holdings: [eq("a", 100, { investedValue: rupees(80) }), eq("b", 100)] }), ASOF);
    expect(p.returns.coveragePct).toBeCloseTo(50, 8); expect(p.returns.investedCapital).toBeNull(); expect(p.returns.note).toMatch(/Partial/);
  });
  it("XIRR 10% over exactly one year", () => {
    const r = xirr([{ date: "2021-01-01", amount: -1000 }, { date: "2022-01-01", amount: 1100 }]);
    expect(r.ok && Math.abs(r.rate - 0.1) < 1e-6).toBe(true);
  });
  it("XIRR with intermediate flows", () => {
    const r = xirr([{ date: "2020-01-01", amount: -1000 }, { date: "2020-07-01", amount: -1000 }, { date: "2021-01-01", amount: 2300 }]);
    expect(r.ok).toBe(true);
    if (r.ok) { // verify NPV ~ 0
      const t = (d: string) => (Date.parse(d) - Date.parse("2020-01-01")) / 86400000 / 365;
      const npv = -1000 + -1000 / Math.pow(1 + r.rate, t("2020-07-01")) + 2300 / Math.pow(1 + r.rate, t("2021-01-01"));
      expect(Math.abs(npv)).toBeLessThan(1e-4);
    }
  });
  it("XIRR negative return", () => { const r = xirr([{ date: "2021-01-01", amount: -1000 }, { date: "2022-01-01", amount: 900 }]); expect(r.ok && r.rate < 0 && Math.abs(r.rate + 0.1) < 1e-6).toBe(true); });
  it("XIRR invalid inputs", () => {
    expect(xirr([{ date: "2021-01-01", amount: -1000 }]).ok).toBe(false);
    expect(xirr([{ date: "2021-01-01", amount: -1000 }, { date: "2021-06-01", amount: -5 }]).ok).toBe(false);
    expect(xirr([{ date: "2021-01-01", amount: -1000 }, { date: "bad", amount: 1100 }]).ok).toBe(false);
    expect(xirr([{ date: "2021-01-01", amount: -1000 }, { date: "2021-01-01", amount: 1100 }]).ok).toBe(false);
    expect(xirr([{ date: "2021-01-01", amount: -1000 }, { date: "2021-01-10", amount: 1100 }]).ok).toBe(false);
    expect(xirr([{ date: "2021-01-01", amount: NaN }, { date: "2022-01-01", amount: 1100 }]).ok).toBe(false);
  });
  it("portfolio XIRR needs transactions, else 'insufficient history'", () => {
    const h = eq("a", 130, { id: "h1", investedValue: rupees(100) });
    expect(computePortfolio(blank({ holdings: [h] }), ASOF).xirr.ok).toBe(false);
    const d = blank({ holdings: [h], transactions: [{ id: "t1", clientId: "t", holdingId: "h1", date: "2025-10-20", type: "purchase", amount: rupees(100), quantity: null, notes: null }] });
    const x = computePortfolio(d, ASOF).xirr;
    expect(x.ok && Math.abs(x.rate - 0.3) < 0.01).toBe(true);
  });
  it("distributions are inflows", () => {
    const h = eq("a", 100, { id: "h1" });
    const d = blank({ holdings: [h], transactions: [
      { id: "1", clientId: "t", holdingId: "h1", date: "2025-10-20", type: "purchase", amount: rupees(100), quantity: null, notes: null },
      { id: "2", clientId: "t", holdingId: "h1", date: "2026-04-20", type: "dividend", amount: rupees(5), quantity: null, notes: null }] });
    const x = computePortfolio(d, ASOF).xirr; expect(x.ok && x.rate > 0.04).toBe(true);
  });
});

describe("asset allocation, drift & concentration", () => {
  const d = blank({ holdings: [eq("eq", 5600), debt("debt", 4400)], targets: [{ assetClass: "indian_equity", targetBps: 5000, bandBps: null }, { assetClass: "debt", targetBps: 5000, bandBps: null }] });
  const p = computePortfolio(d, ASOF);
  it("percentage-point drift, not relative", () => {
    const rows = computeAllocation(p, d, "investable", 5);
    expect(rows.find((r) => r.assetClass === "indian_equity")!.driftPp).toBeCloseTo(6, 8);
    expect(rows.find((r) => r.assetClass === "indian_equity")!.status).toBe("breach");
  });
  it("exactly at tolerance is not a breach (strict) but is when inclusive", () => {
    const d2 = blank({ holdings: [eq("eq", 5500), debt("debt", 4500)], targets: d.targets });
    const p2 = computePortfolio(d2, ASOF);
    expect(computeAllocation(p2, d2, "investable", 5, false).find((r) => r.assetClass === "indian_equity")!.status).toBe("within");
    expect(computeAllocation(p2, d2, "investable", 5, true).find((r) => r.assetClass === "indian_equity")!.status).toBe("breach");
  });
  it("denominators differ", () => {
    const d3 = blank({ holdings: [eq("eq", 500), mkHolding("t", { name: "Flat", instrumentType: "property_residential", currentValue: rupees(500) }), mkHolding("t", { name: "Bank", instrumentType: "bank_balance", currentValue: rupees(100) })] });
    const p3 = computePortfolio(d3, ASOF);
    expect(p3.denominators.gross.value).toBe(rupees(1100)); expect(p3.denominators.investable.value).toBe(rupees(600)); expect(p3.denominators.investments_ex_property.value).toBe(rupees(500));
  });
  it("direct property excluded from non-gross allocation", () => {
    const d3 = blank({ holdings: [eq("eq", 500), mkHolding("t", { name: "Flat", instrumentType: "property_residential", currentValue: rupees(500) })] });
    const row = computeAllocation(computePortfolio(d3, ASOF), d3, "investable", 5).find((r) => r.assetClass === "real_estate")!;
    expect(row.inDenominator).toBe(false);
  });
});

describe("Rule 1 equity > 60%", () => {
  const mk = (e: number) => blank({ holdings: [eq("eq", e), debt("d", 10000 - e)] });
  it("below", () => expect(ruleOf(mk(5999), "equity_allocation_max").state).toBe("ok"));
  it("at threshold (strict)", () => expect(ruleOf(mk(6000), "equity_allocation_max").state).toBe("ok"));
  it("above", () => { const r = ruleOf(mk(6001), "equity_allocation_max"); expect(r.state).toBe("triggered"); expect(r.findings[0].kind).toBe("breach"); });
  it("inclusive at threshold", () => expect(ruleOf(setRule(mk(6000), "equity_allocation_max", { params: { inclusive: true } }), "equity_allocation_max").state).toBe("triggered"));
  it("changed threshold", () => expect(ruleOf(setRule(mk(5500), "equity_allocation_max", { value: 50 }), "equity_allocation_max").state).toBe("triggered"));
  it("disabled", () => expect(ruleOf(setRule(mk(9000), "equity_allocation_max", { enabled: false }), "equity_allocation_max").state).toBe("disabled"));
  it("missing data", () => expect(ruleOf(blank(), "equity_allocation_max").state).toBe("not_evaluable"));
  it("resolved when value falls", () => { expect(ruleOf(mk(7000), "equity_allocation_max").state).toBe("triggered"); expect(ruleOf(mk(5000), "equity_allocation_max").state).toBe("ok"); });
  it("denominator matters (gross includes property)", () => {
    const d = blank({ holdings: [eq("eq", 5000), mkHolding("t", { name: "Flat", instrumentType: "property_residential", currentValue: rupees(5000) })] });
    expect(ruleOf(d, "equity_allocation_max").state).toBe("triggered"); // 100% of investable
    expect(ruleOf(setRule(d, "equity_allocation_max", { params: { denominator: "gross" } }), "equity_allocation_max").state).toBe("ok"); // 50% of gross
  });
});

describe("Rule 2 single stock > 10%", () => {
  const stock = (n: string, v: number, extra = {}) => mkHolding("t", { name: n, instrumentType: "direct_stock", currentValue: rupees(v), symbol: n, ...extra });
  const mk = (s: number) => blank({ holdings: [stock("INFY", s), debt("d", 10000 - s)] });
  it("below", () => expect(ruleOf(mk(999), "single_stock_max").state).toBe("ok"));
  it("at", () => expect(ruleOf(mk(1000), "single_stock_max").state).toBe("ok"));
  it("above lists the stock", () => { const r = ruleOf(mk(1001), "single_stock_max"); expect(r.state).toBe("triggered"); expect(r.findings[0].subject).toBe("INFY"); expect(r.findings[0].currentLabel).toMatch(/10\.0%/); });
  it("aggregate of stocks is never treated as one stock", () => {
    const d = blank({ holdings: [stock("Direct equity", 5000, { isAggregate: true }), debt("d", 5000)] });
    const r = ruleOf(d, "single_stock_max"); expect(r.state).toBe("not_evaluable"); expect(r.findings[0].kind).toBe("data_gap");
  });
  it("look-through via PMS child adds to the same stock", () => {
    const pms = mkHolding("t", { id: "pms", name: "PMS", instrumentType: "pms", currentValue: rupees(2000), isAggregate: true });
    const d = blank({ holdings: [stock("INFY", 600), stock("INFY", 600, { parentId: "pms" }), pms, debt("d", 7800)] });
    const p = computePortfolio(d, ASOF);
    expect(p.directStocks[0].value).toBe(rupees(1200)); expect(p.directStocks[0].direct).toBe(rupees(600)); expect(p.directStocks[0].lookThrough).toBe(rupees(600));
    expect(ruleOf(d, "single_stock_max").state).toBe("triggered");
  });
  it("changed threshold", () => expect(ruleOf(setRule(mk(600), "single_stock_max", { value: 5 }), "single_stock_max").state).toBe("triggered"));
  it("disabled", () => expect(ruleOf(setRule(mk(5000), "single_stock_max", { enabled: false }), "single_stock_max").state).toBe("disabled"));
});

describe("Rule 3 debt < 20%", () => {
  const mk = (dv: number) => blank({ holdings: [eq("eq", 10000 - dv), debt("d", dv)] });
  it("below", () => expect(ruleOf(mk(1999), "debt_allocation_min").state).toBe("triggered"));
  it("at (strict) is fine", () => expect(ruleOf(mk(2000), "debt_allocation_min").state).toBe("ok"));
  it("at (inclusive) triggers", () => expect(ruleOf(setRule(mk(2000), "debt_allocation_min", { params: { inclusive: true } }), "debt_allocation_min").state).toBe("triggered"));
  it("above", () => expect(ruleOf(mk(2001), "debt_allocation_min").state).toBe("ok"));
  it("missing", () => expect(ruleOf(blank(), "debt_allocation_min").state).toBe("not_evaluable"));
});

describe("Rule 4 net worth decline", () => {
  const base = (cur: number, prevNW: number | null, extra: Partial<ClientData> = {}) => blank({
    holdings: [eq("eq", cur)], snapshots: prevNW == null ? [] : [{ id: "s", clientId: "t", date: "2026-09-20", grossAssets: rupees(prevNW), liabilities: 0, netWorth: rupees(prevNW), liabilitiesComplete: true, source: "manual", note: null }], ...extra });
  it("no snapshot => not evaluable (no false alert)", () => expect(ruleOf(base(1000, null), "net_worth_decline").state).toBe("not_evaluable"));
  it("−4.9% ok", () => expect(ruleOf(base(951, 1000), "net_worth_decline").state).toBe("ok"));
  it("−5% exactly ok", () => expect(ruleOf(base(950, 1000), "net_worth_decline").state).toBe("ok"));
  it("−5.1% triggers with attribution", () => { const r = ruleOf(base(949, 1000), "net_worth_decline"); expect(r.state).toBe("triggered"); expect(r.findings[0].why).toMatch(/valuation/); });
  it("different liability completeness is incomparable", () => {
    const d = base(500, 1000); d.snapshots[0].liabilitiesComplete = false;
    expect(ruleOf(d, "net_worth_decline").state).toBe("not_evaluable");
  });
  it("snapshot too old is not 'previous month'", () => {
    const d = base(500, 1000); d.snapshots[0].date = "2026-06-01";
    expect(findComparableSnapshot(d.snapshots, ASOF, 1)).toBeNull();
  });
  it("increase never triggers; changed threshold", () => {
    expect(ruleOf(base(2000, 1000), "net_worth_decline").state).toBe("ok");
    expect(ruleOf(setRule(base(951, 1000), "net_worth_decline", { value: 4 }), "net_worth_decline").state).toBe("triggered");
  });
  it("new liability counts against net worth", () => {
    const d = base(1000, 1000, { liabilities: [mkLiability("t", { name: "Loan", type: "personal_loan", outstanding: rupees(100) })] });
    const nw = computeNetWorth(d, computePortfolio(d, ASOF), ASOF);
    expect(nw.changeMonth.percent).toBeCloseTo(-10, 8); expect(nw.changeMonth.attribution!.liabilityChange).toBe(rupees(100));
    expect(ruleOf(d, "net_worth_decline").state).toBe("triggered");
  });
  it("annual window", () => {
    const d = base(900, 1000); d.snapshots.push({ id: "y", clientId: "t", date: "2025-10-20", grossAssets: rupees(1000), liabilities: 0, netWorth: rupees(1000), liabilitiesComplete: true, source: "manual", note: null });
    d.snapshots.shift();
    expect(ruleOf(setRule(d, "net_worth_decline", { params: { window: "year" } }), "net_worth_decline").state).toBe("triggered");
  });
});

describe("Rule 5 EMI / income", () => {
  const mk = (emi: number, income: number | null, complete = true) => {
    const d = blank({ holdings: [eq("eq", 1000)], liabilities: emi ? [mkLiability("t", { name: "Loan", type: "home_loan", outstanding: rupees(100000), emi: rupees(emi) })] : [], cashflows: income ? [mkCashflow("t", { name: "Salary", kind: "income", category: "salary", amount: rupees(income) })] : [] });
    d.settings.liabilitiesStatus = complete ? "complete" : "not_assessed"; return d;
  };
  it("below", () => expect(ruleOf(mk(3999, 10000), "emi_to_income_max").state).toBe("ok"));
  it("at", () => expect(ruleOf(mk(4000, 10000), "emi_to_income_max").state).toBe("ok"));
  it("above", () => expect(ruleOf(mk(4001, 10000), "emi_to_income_max").state).toBe("triggered"));
  it("missing income => data warning, no number", () => { const r = ruleOf(mk(5000, null), "emi_to_income_max"); expect(r.state).toBe("not_evaluable"); expect(r.findings[0].kind).toBe("data_gap"); });
  it("unverified income is not used", () => { const d = mk(5000, 10000); d.cashflows[0].verified = false; expect(ruleOf(d, "emi_to_income_max").state).toBe("not_evaluable"); });
  it("EMIs not captured => not evaluable", () => expect(ruleOf(mk(0, 10000, false), "emi_to_income_max").state).toBe("not_evaluable"));
  it("credit cards excluded from EMIs", () => {
    const d = mk(0, 10000); d.liabilities = [mkLiability("t", { name: "Card", type: "credit_card", outstanding: rupees(50000), emi: rupees(9000) })];
    expect(summariseCashflow(d).emiMonthly).toBe(0);
  });
  it("EMI linked to a cashflow item is not double counted", () => {
    const d = mk(4000, 10000); d.cashflows.push(mkCashflow("t", { name: "Loan EMI", kind: "expense", category: "loan_emi", amount: rupees(4000), liabilityId: d.liabilities[0].id }));
    expect(summariseCashflow(d).emiMonthly).toBe(rupees(4000));
  });
  it("changed threshold", () => expect(ruleOf(setRule(mk(3000, 10000), "emi_to_income_max", { value: 25 }), "emi_to_income_max").state).toBe("triggered"));
});

describe("Rule 6 drift > 5pp", () => {
  const T = [{ assetClass: "indian_equity" as const, targetBps: 5000, bandBps: null }, { assetClass: "debt" as const, targetBps: 5000, bandBps: null }];
  const mk = (e: number) => blank({ holdings: [eq("eq", e), debt("d", 10000 - e)], targets: T });
  it("4.9pp", () => expect(ruleOf(mk(5490), "portfolio_drift_max").state).toBe("ok"));
  it("5.0pp exact", () => expect(ruleOf(mk(5500), "portfolio_drift_max").state).toBe("ok"));
  it("5.1pp flags both classes", () => { const r = ruleOf(mk(5510), "portfolio_drift_max"); expect(r.state).toBe("triggered"); expect(r.findings.map((f) => f.subject).sort()).toEqual(["Debt & fixed income", "Indian equity"]); });
  it("changed tolerance", () => expect(ruleOf(setRule(mk(5300), "portfolio_drift_max", { value: 2 }), "portfolio_drift_max").state).toBe("triggered"));
  it("no targets => not evaluable", () => expect(ruleOf({ ...mk(5000), targets: [] }, "portfolio_drift_max").state).toBe("not_evaluable"));
});

describe("Rule 7 idle cash", () => {
  const bank = (v: number, date: string, extra = {}) => mkHolding("t", { id: "bank", name: "Savings", instrumentType: "bank_balance", currentValue: rupees(v), valuationDate: date, ...extra });
  const mk = (cash: number, date = "2026-08-01", vals: ClientData["valuations"] = []) => {
    const d = blank({ holdings: [bank(cash, date), eq("eq", 1000000)], valuations: vals });
    d.rules = d.rules.map((r) => (r.key === "idle_cash" ? { ...r, params: { absoluteFloor: rupees(100000), minIdleDays: 30 }, value: 10 } : r));
    return d;
  };
  it("small cash => ok", () => expect(ruleOf(mk(50000), "idle_cash").state).toBe("ok"));
  it("no cash records => not evaluable", () => expect(ruleOf(blank({ holdings: [eq("eq", 100)] }), "idle_cash").state).toBe("not_evaluable"));
  it("large cash held 80 days => triggered", () => expect(ruleOf(mk(500000), "idle_cash").state).toBe("triggered"));
  it("large cash seen only 5 days => possible, not triggered", () => expect(ruleOf(mk(500000, "2026-10-15"), "idle_cash").state).toBe("possible"));
  it("emergency fund is reserved before cash is called idle", () => {
    const d = mk(500000); d.cashflows = [mkCashflow("t", { name: "Household", kind: "expense", category: "household", amount: rupees(70000), essential: true })];
    expect(ruleOf(d, "idle_cash").state).toBe("ok"); // 6 × 70k = 420k reserve; idle ≈ 80k < floor
  });
  it("upcoming obligations reserve cash", () => {
    const d = mk(500000); d.commitments = [{ id: "c", clientId: "t", name: "Premium", kind: "pension_premium", totalAmount: rupees(450000), paidAmount: 0, installmentAmount: rupees(450000), frequency: "once", nextDueDate: "2026-11-15", endDate: null, annualReceivable: null, dataStatus: "collected", notes: null, archived: false, isIllustrative: false }];
    expect(ruleOf(d, "idle_cash").state).toBe("ok");
  });
  it("duration comes from valuation history (balance recently jumped)", () => {
    const d = mk(500000, "2026-10-10", [{ id: "v1", holdingId: "bank", date: "2026-06-01", value: rupees(20000), source: "manual", note: null }, { id: "v2", holdingId: "bank", date: "2026-10-10", value: rupees(500000), source: "manual", note: null }]);
    expect(ruleOf(d, "idle_cash").state).toBe("possible");
  });
});

describe("Rule 8 maturities", () => {
  const fd = (date: string | null) => debt("FD", 100000, { instrumentType: "fixed_deposit", maturityDate: date });
  it("outside window", () => expect(ruleOf(blank({ holdings: [fd("2027-01-30")] }), "maturity_window").state).toBe("ok"));
  it("at window boundary (60 days)", () => expect(ruleOf(blank({ holdings: [fd("2026-12-19")] }), "maturity_window").state).toBe("triggered"));
  it("just beyond", () => expect(ruleOf(blank({ holdings: [fd("2026-12-20")] }), "maturity_window").state).toBe("ok"));
  it("overdue is flagged", () => { const r = ruleOf(blank({ holdings: [fd("2026-10-01")] }), "maturity_window"); expect(r.state).toBe("triggered"); expect(r.findings[0].currentLabel).toMatch(/overdue/); });
  it("missing maturity => data notice", () => { const r = ruleOf(blank({ holdings: [fd(null)] }), "maturity_window"); expect(r.state).toBe("not_evaluable"); });
  it("policy renewal", () => {
    const d = blank({ holdings: [eq("e", 100)], policies: [{ id: "p", clientId: "t", type: "health", insurer: "Acme", policyNo: null, sumAssured: lakh(10), annualPremium: rupees(20000), premiumFrequency: "annual", nextPremiumDate: null, renewalDate: "2026-11-10", maturityDate: null, expectedMaturityValue: null, dataStatus: "collected", archived: false, isIllustrative: false }] });
    expect(ruleOf(d, "maturity_window").state).toBe("triggered");
  });
  it("configurable lead time", () => expect(ruleOf(setRule(blank({ holdings: [fd("2027-01-15")] }), "maturity_window", { value: 120 }), "maturity_window").state).toBe("triggered"));
});

describe("additional rules", () => {
  it("negative cash flow is provisional until income complete", () => {
    const d = blank({ cashflows: [mkCashflow("t", { name: "H", kind: "expense", category: "household", amount: rupees(100) })] });
    d.settings.incomeStatus = "pending"; expect(ruleOf(d, "negative_cash_flow").state).toBe("possible");
    d.settings.incomeStatus = "complete"; expect(ruleOf(d, "negative_cash_flow").state).toBe("triggered");
  });
  it("emergency fund below/at/above target", () => {
    const mk = (r: number) => blank({ holdings: [debt("FD", r * 1000, { emergencyEligible: true })], cashflows: [mkCashflow("t", { name: "H", kind: "expense", category: "household", amount: rupees(1000), essential: true })] });
    expect(ruleOf(mk(5), "emergency_fund_min").state).toBe("triggered"); expect(ruleOf(mk(6), "emergency_fund_min").state).toBe("ok"); expect(ruleOf(mk(7), "emergency_fund_min").state).toBe("ok");
    expect(ruleOf(blank({ holdings: [debt("FD", 5)] }), "emergency_fund_min").state).toBe("not_evaluable");
  });
  it("credit card above threshold", () => {
    const mk = (v: number) => blank({ liabilities: [mkLiability("t", { name: "Card", type: "credit_card", outstanding: v })] });
    expect(ruleOf(mk(lakh(1)), "credit_card_balance").state).toBe("ok"); expect(ruleOf(mk(lakh(1) + 1), "credit_card_balance").state).toBe("triggered");
  });
  it("debt to net worth", () => {
    const mk = (l: number) => blank({ holdings: [eq("e", 1000)], liabilities: [mkLiability("t", { name: "L", type: "home_loan", outstanding: rupees(l) })] });
    expect(ruleOf(mk(300), "debt_to_net_worth").state).toBe("ok"); // 300/700=42.9%
    expect(ruleOf(mk(400), "debt_to_net_worth").state).toBe("triggered"); // 400/600=66.7%
    expect(ruleOf(mk(1000), "debt_to_net_worth").state).toBe("triggered"); // NW 0
  });
  it("unclassified, stale and missing valuation", () => {
    const d = blank({ holdings: [mkHolding("t", { name: "MF", instrumentType: "mutual_fund_aggregate", currentValue: lakh(1), valuationDate: "2026-01-01" })] });
    expect(ruleOf(d, "unclassified_holdings").state).toBe("triggered"); expect(ruleOf(d, "stale_data").state).toBe("triggered");
    const d2 = blank({ holdings: [mkHolding("t", { name: "MF", instrumentType: "debt_mf", currentValue: lakh(1) })] });
    expect(ruleOf(d2, "missing_valuation").state).toBe("triggered");
  });
  it("pension premium due and missing schedule", () => {
    const c = { id: "c", clientId: "t", name: "Pension", kind: "pension_premium" as const, totalAmount: lakh(10), paidAmount: lakh(2), installmentAmount: lakh(1), frequency: "monthly" as const, nextDueDate: "2026-10-25" as string | null, endDate: null, annualReceivable: null, dataStatus: "collected" as const, notes: null, archived: false, isIllustrative: false };
    expect(ruleOf(blank({ commitments: [c] }), "pension_premium_window").state).toBe("triggered");
    expect(ruleOf(blank({ commitments: [{ ...c, nextDueDate: null }] }), "pension_premium_window").state).toBe("not_evaluable");
    expect(ruleOf(blank({ commitments: [{ ...c, paidAmount: lakh(10) }] }), "pension_premium_window").state).toBe("ok");
  });
  it("goal shortfall", () => {
    const g = { id: "g", clientId: "t", name: "House", type: "property" as const, targetAmount: lakh(100), targetDate: "2028-10-20", earmarkedAmount: lakh(10), monthlyContribution: lakh(1), expectedReturnBps: null, notes: null, archived: false, isIllustrative: false };
    expect(ruleOf(blank({ goals: [g] }), "goal_shortfall").state).toBe("triggered");
    expect(ruleOf(blank({ goals: [{ ...g, monthlyContribution: lakh(4) }] }), "goal_shortfall").state).toBe("ok");
  });
  it("health score drop needs history", () => {
    const d = blank({ holdings: [eq("e", 1000)] });
    expect(ruleOf(d, "health_score_drop").state).toBe("not_evaluable");
    d.scoreHistory = [{ date: "2026-09-01", score: 99, coverage: 1 }];
    expect(ruleOf(d, "health_score_drop").state).toBe("triggered");
  });
});

describe("cash flow", () => {
  it("savings rate with default exclusions", () => {
    const d = blank({ cashflows: [mkCashflow("t", { name: "Salary", kind: "income", category: "salary", amount: rupees(100000) }), mkCashflow("t", { name: "HH", kind: "expense", category: "household", amount: rupees(60000) }), mkCashflow("t", { name: "SIP", kind: "expense", category: "investment_contribution", amount: rupees(20000) })] });
    const s = summariseCashflow(d);
    expect(s.savingsRate).toBeCloseTo(40, 8); expect(s.monthlySurplus).toBe(rupees(20000));
  });
  it("savings rate safe with no income", () => expect(summariseCashflow(blank({ cashflows: [mkCashflow("t", { name: "HH", kind: "expense", category: "household", amount: 100 })] })).savingsRate).toBeNull());
  it("frequencies convert to monthly equivalent", () => {
    const d = blank({ cashflows: [mkCashflow("t", { name: "Q", kind: "expense", category: "personal", amount: rupees(3000), frequency: "quarterly" }), mkCashflow("t", { name: "A", kind: "expense", category: "personal", amount: rupees(12000), frequency: "annual" })] });
    expect(summariseCashflow(d).monthlyOutflows).toBe(rupees(2000));
  });
  it("one-off items are not recurring", () => {
    const d = blank({ cashflows: [mkCashflow("t", { name: "Trip", kind: "expense", category: "personal", amount: rupees(50000), frequency: "once", anchorDate: "2026-12-01" })] });
    const s = summariseCashflow(d); expect(s.monthlyOutflows).toBe(0); expect(s.oneOffOutflows).toBe(rupees(50000));
  });
  it("occurrences: anchor, month-end clipping, end date", () => {
    expect(occurrences({ frequency: "monthly", anchorDate: "2026-01-31", endDate: null }, "2026-01-01", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(occurrences({ frequency: "annual", anchorDate: "2026-03-15", endDate: null }, "2026-10-20", "2028-12-31")).toEqual(["2027-03-15", "2028-03-15"]);
    expect(occurrences({ frequency: "monthly", anchorDate: "2026-10-05", endDate: "2026-12-31" }, "2026-10-20", "2027-03-31")).toEqual(["2026-11-05", "2026-12-05"]);
    expect(occurrences({ frequency: "annual", anchorDate: null, endDate: null }, "2026-01-01", "2026-12-31")).toBeNull();
  });
  it("forecast places dated premiums and pension receipts in the right months, not ×12", () => {
    const d = blank({ cashflows: [mkCashflow("t", { name: "Pension", kind: "income", category: "pension", amount: lakh(5), frequency: "annual", anchorDate: "2027-03-31" })],
      commitments: [{ id: "c", clientId: "t", name: "Pension premium", kind: "pension_premium", totalAmount: lakh(10), paidAmount: 0, installmentAmount: lakh(4), frequency: "quarterly", nextDueDate: "2026-12-10", endDate: null, annualReceivable: null, dataStatus: "collected", notes: null, archived: false, isIllustrative: false }] });
    const f = buildForecast(d, ASOF, 12);
    const m = (k: string) => f.months.find((x) => x.month === k)!;
    expect(m("2026-12").outflow).toBe(lakh(4)); expect(m("2027-03").outflow).toBe(lakh(4)); expect(m("2027-03").inflow).toBe(lakh(5));
    expect(m("2027-06").outflow).toBe(lakh(2)); // last instalment trimmed to remaining
    expect(m("2026-11").outflow).toBe(0);
    expect(f.unscheduledCommitments).toBe(0);
  });
  it("forecast balance only with a known opening balance", () => {
    expect(buildForecast(blank(), ASOF, 3).months[0].balance).toBeNull();
    const d = blank({ holdings: [mkHolding("t", { name: "Bank", instrumentType: "bank_balance", currentValue: rupees(1000) })], cashflows: [mkCashflow("t", { name: "HH", kind: "expense", category: "household", amount: rupees(100) })] });
    const f = buildForecast(d, ASOF, 3); expect(f.openingBalance).toBe(rupees(1000)); expect(f.months[2].balance).toBe(rupees(700));
  });
  it("maturity without expected value is an event, not an assumed inflow", () => {
    const d = blank({ holdings: [debt("FD", 1000, { maturityDate: "2026-12-01" })] });
    const f = buildForecast(d, ASOF, 3); expect(f.maturityEventsWithoutValue).toBe(1); expect(f.months[2].inflow).toBe(0);
  });
});

describe("net worth", () => {
  it("assets − liabilities with complete status", () => {
    const d = blank({ holdings: [eq("e", 1000)], liabilities: [mkLiability("t", { name: "L", type: "home_loan", outstanding: rupees(300) })] });
    const n = computeNetWorth(d, computePortfolio(d, ASOF), ASOF); expect(n.netWorth).toBe(rupees(700)); expect(n.provisional).toBe(false);
  });
  it("partial liabilities are provisional", () => {
    const d = blank({ holdings: [eq("e", 1000)], liabilities: [mkLiability("t", { name: "L", type: "home_loan", outstanding: rupees(300) })] }); d.settings.liabilitiesStatus = "not_assessed";
    const n = computeNetWorth(d, computePortfolio(d, ASOF), ASOF); expect(n.provisional).toBe(true); expect(n.liabilitiesStatus).toBe("partial");
  });
  it("commitments reported separately and adjusted NW", () => {
    const d = blank({ holdings: [eq("e", 1000)], commitments: [{ id: "c", clientId: "t", name: "P", kind: "pension_premium", totalAmount: rupees(300), paidAmount: rupees(100), installmentAmount: null, frequency: null, nextDueDate: null, endDate: null, annualReceivable: null, dataStatus: "pending", notes: null, archived: false, isIllustrative: false }] });
    const n = computeNetWorth(d, computePortfolio(d, ASOF), ASOF); expect(n.netWorth).toBe(rupees(1000)); expect(n.commitmentsRemaining).toBe(rupees(200)); expect(n.adjustedNetWorth).toBe(rupees(800));
  });
  it("debt-to-net-worth only when NW positive", () => {
    const d = blank({ holdings: [eq("e", 100)], liabilities: [mkLiability("t", { name: "L", type: "home_loan", outstanding: rupees(200) })] });
    expect(computeNetWorth(d, computePortfolio(d, ASOF), ASOF).debtToNetWorthPct).toBeNull();
  });
});

describe("health score", () => {
  it("is transparent: weights re-normalised over assessed components", () => {
    const e = evaluateClient(blank({ holdings: [eq("e", 100000), debt("FD", 100000, { emergencyEligible: true })], cashflows: [mkCashflow("t", { name: "H", kind: "expense", category: "household", amount: rupees(1000), essential: true })] }), ASOF);
    const assessed = e.health.components.filter((c) => c.assessed);
    const expected = assessed.reduce((s, c) => s + c.score! * c.weight, 0) / assessed.reduce((s, c) => s + c.weight, 0);
    expect(e.health.overall).toBeCloseTo(expected, 8);
    expect(e.health.components.find((c) => c.key === "insurance")!.assessed).toBe(false);
  });
  it("custom weights change the result", () => {
    const d = blank({ holdings: [eq("e", 100000), debt("FD", 100000, { emergencyEligible: true })], cashflows: [mkCashflow("t", { name: "H", kind: "expense", category: "household", amount: rupees(1000), essential: true })] });
    const a = evaluateClient(d, ASOF).health.overall!;
    d.settings.healthWeights = { ...d.settings.healthWeights, emergency: 100, diversification: 1 };
    expect(evaluateClient(d, ASOF).health.overall).not.toBeCloseTo(a, 3);
  });
  it("no data => no score, not a fake 100", () => { const d = blank(); d.settings.liabilitiesStatus = "not_assessed"; expect(evaluateClient(d, ASOF).health.overall).toBeNull(); });
});

describe("goals", () => {
  const g = { id: "g", clientId: "t", name: "G", type: "wealth" as const, targetAmount: lakh(12), targetDate: "2027-10-20", earmarkedAmount: 0, monthlyContribution: lakh(1), expectedReturnBps: null, notes: null, archived: false, isIllustrative: false };
  it("0% return projection and required monthly", () => {
    const p = projectGoal(g, ASOF); expect(p.monthsLeft).toBe(12); expect(p.projectedValue).toBe(lakh(12)); expect(p.onTrack).toBe(true); expect(p.requiredMonthly).toBe(lakh(1));
  });
  it("shortfall", () => { const p = projectGoal({ ...g, monthlyContribution: lakh(0.5) }, ASOF); expect(p.onTrack).toBe(false); expect(p.projectedGap).toBe(lakh(6)); });
  it("return assumption is explicit", () => expect(projectGoal({ ...g, expectedReturnBps: 800 }, ASOF).assumption).toMatch(/8\.0%/));
});

describe("rebalancing & simulation", () => {
  const d = blank({ holdings: [eq("eq", 7000), debt("fd", 3000)], targets: [{ assetClass: "indian_equity", targetBps: 5000, bandBps: null }, { assetClass: "debt", targetBps: 5000, bandBps: null }] });
  it("plan gap sizes", () => {
    const e = evaluateClient(d, ASOF);
    const eqItem = e.rebalance.items.find((i) => i.assetClass === "indian_equity")!; expect(eqItem.direction).toBe("reduce"); expect(eqItem.gapValue).toBe(rupees(-2000));
    expect(e.rebalance.items.find((i) => i.assetClass === "debt")!.direction).toBe("add");
  });
  it("illiquid assets are not suggested for sale", () => {
    const d2 = blank({ holdings: [eq("eq", 7000, { liquidityTier: 4 }), debt("fd", 3000)], targets: d.targets });
    const item = evaluateClient(d2, ASOF).rebalance.items.find((i) => i.assetClass === "indian_equity")!; expect(item.suggestedAmount).toBe(0); expect(item.mathOnly).toBe(true);
  });
  it("simulated sale/buy recalculates allocation", () => {
    const { data } = applyTrades(d, [{ assetClass: "indian_equity", amount: -rupees(2000) }, { assetClass: "debt", amount: rupees(2000) }]);
    const e = evaluateClient(data, ASOF);
    expect(e.allocation.investable.find((r) => r.assetClass === "indian_equity")!.pct).toBeCloseTo(50, 8);
    expect(e.portfolio.grossAssets).toBe(rupees(10000));
  });
  it("selling more than sellable warns", () => expect(applyTrades(d, [{ assetClass: "debt", amount: -rupees(99999) }]).warnings.length).toBeGreaterThan(0));
  it("original data untouched by simulation", () => { applyTrades(d, [{ assetClass: "indian_equity", amount: -rupees(500) }]); expect(d.holdings[0].currentValue).toBe(rupees(7000)); });
});

describe("case studies", () => {
  const [a, b, c] = buildCases();
  it("Case A reconciles: ₹10 Cr assets, ₹5 Cr liabilities, ₹5 Cr NW", () => {
    const e = evaluateClient(a, ASOF);
    expect(e.portfolio.grossAssets).toBe(crore(10)); expect(e.netWorth.liabilities).toBe(crore(5)); expect(e.netWorth.netWorth).toBe(crore(5));
    expect(e.netWorth.debtToNetWorthPct).toBeCloseTo(100, 8);
    expect(e.rules.find((r) => r.key === "equity_allocation_max")!.state).toBe("triggered"); // 5 / 8 = 62.5% of investable
  });
  it("Case B/C growth:defensive ratios", () => {
    expect(evaluateClient(b, ASOF).growthDefensive.growthPct).toBeCloseTo(50, 6);
    expect(evaluateClient(c, ASOF).growthDefensive.growthPct).toBeCloseTo(70, 6);
  });
  it("cases are illustrative and distinct from Priya", () => {
    for (const x of [a, b, c]) { expect(x.client.kind).toBe("case"); expect(x.holdings.every((h) => h.isIllustrative)).toBe(true); expect(x.client.id).not.toBe("client_priya"); }
    expect([CASE_IDS.A, CASE_IDS.B, CASE_IDS.C]).toHaveLength(3);
  });
  it("emi formula", () => expect(emiOf(rupees(1000000), 12, 12)).toBe(rupees(88848.79)));
});
