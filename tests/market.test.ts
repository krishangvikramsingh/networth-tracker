import { describe, expect, it } from "vitest";
import { parseAmfiNav } from "../src/server/market/providers";
import { parseManualCsv, validateObservation } from "../src/server/market/service";

const SAMPLE = `Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
Open Ended Schemes(Equity Scheme - Flexi Cap Fund)

Axis Mutual Fund
120503;INF846K01EW2;-;Axis Flexi Cap Fund - Growth;21.3456;16-Oct-2026
120504;INF846K01EX0;-;Axis Flexi Cap Fund - IDCW;N.A.;16-Oct-2026
100001;INF000A01011;-;Sample Debt Fund;-5;16-Oct-2026
`;
describe("AMFI NAV parser (documented file format)", () => {
  it("extracts wanted schemes by code or ISIN with ISO dates", () => {
    const r = parseAmfiNav(SAMPLE, ["120503", "INF000A01011"]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ symbol: "120503", value: 21.3456, asOf: "2026-10-16", source: "amfi", isDemo: false });
  });
  it("skips N.A. / non-positive NAVs rather than storing them", () => {
    expect(parseAmfiNav(SAMPLE, ["120504", "100001"])).toHaveLength(0);
  });
});
describe("observation validation", () => {
  const o = { symbol: "X", kind: "stock" as const, value: 100, currency: "INR", asOf: "2026-10-01", source: "manual", isDemo: false };
  it("accepts a sane value", () => expect(validateObservation(o, 100)).toBeNull());
  it("rejects negative, future and suspicious jumps", () => {
    expect(validateObservation({ ...o, value: -1 }, null)).toMatch(/non-positive/);
    expect(validateObservation({ ...o, asOf: "2999-01-01" }, null)).toMatch(/future/);
    expect(validateObservation({ ...o, value: 300 }, 100)).toMatch(/jump/);
  });
  it("manual CSV needs headers", () => { expect(() => parseManualCsv("a,b\n1,2")).toThrow(); expect(parseManualCsv("symbol,date,value\nX,2026-10-01,5")).toHaveLength(1); });
});
