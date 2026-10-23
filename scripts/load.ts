// Load test for the pure evaluate path: how long does one full evaluation take as the book grows?
// Run: node --import tsx scripts/load.ts   (exit code 1 when the 5,000-holding p95 exceeds the 300 ms budget)
import { evaluateClient } from "../src/shared/evaluate";
import { INSTRUMENT_TYPES } from "../src/shared/taxonomy";
import { blank, mkHolding, mkLiability, ASOF } from "../tests/helpers";

const types = INSTRUMENT_TYPES.filter((t) => t !== "mutual_fund_aggregate");
const build = (n: number) => blank({
  holdings: Array.from({ length: n }, (_, i) => mkHolding("t", { id: `h${i}`, name: `Holding ${i}`, instrumentType: types[i % types.length], currentValue: 1_00_000_00 + (i * 7919) % 9_00_000_00, valuationDate: ASOF })),
  liabilities: Array.from({ length: Math.ceil(n / 50) }, (_, i) => mkLiability("t", { id: `l${i}`, name: `Loan ${i}`, type: "home_loan", outstanding: 10_00_000_00 })),
});
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];
let over = false;
for (const n of [100, 1000, 5000]) {
  const d = build(n); evaluateClient(d, ASOF); // warm up the JIT
  const ms: number[] = [];
  for (let i = 0; i < 30; i++) { const t = performance.now(); evaluateClient(d, ASOF); ms.push(performance.now() - t); }
  const med = [...ms].sort((a, b) => a - b)[15];
  console.log(`${String(n).padStart(5)} holdings  median ${med.toFixed(1)} ms  p95 ${p95(ms).toFixed(1)} ms`);
  if (n === 5000 && p95(ms) > 300) over = true;
}
if (over) { console.error("p95 for 5,000 holdings exceeds the 300 ms budget"); process.exit(1); }
