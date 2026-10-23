import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { evaluateClient } from "../src/shared/evaluate";
import { INSTRUMENT_TYPES, type InstrumentType } from "../src/shared/taxonomy";
import { ASOF, blank, mkHolding, mkLiability } from "./helpers";

// Instruments that classify on their own, so every rupee lands in a known class. (Others, such as a bare "ETF" or an aggregate,
// are correctly held as unresolved until a person decides; the engine reports those as ranges, which is tested elsewhere.)
const CLASSIFIED = INSTRUMENT_TYPES.filter((t) => mkHolding("t", { name: "Probe", instrumentType: t, currentValue: 100 }).assetClass != null) as InstrumentType[];
const money = fc.integer({ min: 100_00, max: 50_00_00_000 }); // ₹100 to ₹5 Cr, in paise
const holding = fc.record({ t: fc.constantFrom(...CLASSIFIED), v: money });
const portfolio = fc.array(holding, { minLength: 1, maxLength: 40 });
const build = (rows: Array<{ t: InstrumentType; v: number }>) => blank({ holdings: rows.map((r, i) => mkHolding("t", { id: `h${i}`, name: `Holding ${i}`, instrumentType: r.t, currentValue: r.v })) });
const opts = { numRuns: 200 };
it("the probe finds the self-classifying instrument types", () => { expect(CLASSIFIED.length).toBeGreaterThan(8); expect(CLASSIFIED).not.toContain("mutual_fund_aggregate"); });

describe("engine properties", () => {
  it("gross assets is the plain sum of the holdings, whatever their order", () => {
    fc.assert(fc.property(portfolio, fc.integer(), (rows, seed) => {
      const sum = rows.reduce((a, r) => a + r.v, 0);
      const shuffled = [...rows].sort((a, b) => ((a.v * 31 + seed) % 97) - ((b.v * 31 + seed) % 97));
      expect(evaluateClient(build(rows), ASOF).netWorth.grossAssets).toBe(sum);
      expect(evaluateClient(build(shuffled), ASOF).netWorth.grossAssets).toBe(sum);
    }), opts);
  });

  it("allocation shares sum to 100% of the gross denominator when everything is classified", () => {
    fc.assert(fc.property(portfolio, (rows) => {
      const ev = evaluateClient(build(rows), ASOF);
      const total = ev.allocation.gross.reduce((a, r) => a + (r.pct ?? 0), 0);
      expect(total).toBeGreaterThan(99.99);
      expect(total).toBeLessThan(100.01);
      expect(ev.allocation.gross.reduce((a, r) => a + r.value, 0)).toBe(ev.netWorth.grossAssets);
    }), opts);
  });

  it("splitting an aggregate into underlying records that sum to no more than it never changes gross assets", () => {
    fc.assert(fc.property(money, fc.array(fc.double({ min: 0.01, max: 1, noNaN: true }), { minLength: 1, maxLength: 8 }), (aggregate, weights) => {
      const total = weights.reduce((a, b) => a + b, 0);
      const children = weights.map((w) => Math.floor((w / total) * aggregate * 0.999)); // strictly under the aggregate
      const agg = mkHolding("t", { id: "agg", name: "MF holdings", instrumentType: "mutual_fund_aggregate", currentValue: aggregate, isAggregate: true });
      const before = blank({ holdings: [agg] });
      const after = blank({ holdings: [agg, ...children.map((v, i) => mkHolding("t", { id: `c${i}`, name: `Scheme ${i}`, instrumentType: "equity_mf", currentValue: Math.max(v, 1), parentId: "agg" }))] });
      expect(evaluateClient(after, ASOF).netWorth.grossAssets).toBe(evaluateClient(before, ASOF).netWorth.grossAssets);
    }), opts);
  });

  it("net worth is exactly gross assets minus liabilities once liabilities are complete", () => {
    fc.assert(fc.property(portfolio, fc.array(money, { maxLength: 6 }), (rows, debts) => {
      const d = build(rows);
      d.liabilities = debts.map((v, i) => mkLiability("t", { id: `l${i}`, name: `Loan ${i}`, type: "home_loan", outstanding: v }));
      const nw = evaluateClient(d, ASOF).netWorth;
      expect(nw.netWorth).toBe(nw.grossAssets - debts.reduce((a, b) => a + b, 0));
    }), opts);
  });

  it("net worth is never reported as zero or a number while liabilities are not assessed", () => {
    fc.assert(fc.property(portfolio, (rows) => {
      const d = build(rows); d.settings = { ...d.settings, liabilitiesStatus: "not_assessed" }; d.liabilities = [];
      expect(evaluateClient(d, ASOF).netWorth.netWorth).toBeNull();
    }), opts);
  });

  it("evaluating the same data twice gives identical results (no hidden state)", () => {
    fc.assert(fc.property(portfolio, (rows) => {
      const strip = (e: ReturnType<typeof evaluateClient>) => JSON.stringify({ ...e, computedAt: 0 });
      expect(strip(evaluateClient(build(rows), ASOF))).toBe(strip(evaluateClient(build(rows), ASOF)));
    }), opts);
  });
});
