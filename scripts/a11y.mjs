// Accessibility audit: runs axe-core (WCAG 2.1 A/AA) on every page in light and dark mode, desktop and phone width.
// Point BASE at a throwaway server (see docs/ARCHITECTURE.md) — it signs in as the demo advisor but never edits data.
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { findChromium } from "./chromium.mjs";
const axeSource = (await import("node:fs")).readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const base = process.env.BASE ?? "http://127.0.0.1:8787";
const pages = ["/", "/clients", "/assets", "/portfolio", "/cashflow", "/rules", "/alerts", "/health", "/goals", "/nominees", "/notifications", "/security", "/risk", "/cases", "/data", "/market", "/reports", "/demo", "/methodology"];
const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
let total = 0; const seen = new Map();
for (const scheme of ["light", "dark"]) for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme })).newPage();
  await page.goto(base); await page.fill("#em", "advisor@demo.local"); await page.fill("#pw", "Demo@2026-Advisor"); await page.click("button.primary"); await page.waitForSelector(".topbar");
  for (const p of pages) {
    await page.goto(base + p); await page.waitForSelector(".page h1", { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
    await page.evaluate(axeSource);
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }));
    for (const v of res.violations) for (const n of v.nodes) {
      const key = `${v.id} | ${n.target.join(" ")}`; total++;
      if (!seen.has(key)) seen.set(key, { id: v.id, impact: v.impact, help: v.help, where: `${p} ${scheme} ${w}`, html: n.html.slice(0, 140), why: (n.any[0] ?? n.all[0] ?? n.none[0])?.message ?? "" });
    }
  }
}
await browser.close();
for (const v of seen.values()) console.log(`[${v.impact}] ${v.id}: ${v.help}\n   at ${v.where}\n   ${v.html}\n   ${v.why}`);
console.log(`\n${seen.size} distinct violation(s), ${total} occurrence(s)`);
process.exitCode = seen.size ? 1 : 0;
