import { chromium } from "playwright-core";
import fs from "node:fs";
const out = process.argv[2];
const base = process.env.BASE ?? "http://127.0.0.1:8787";
const exe = fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-")).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(base);
await page.fill("#em", "advisor@demo.local"); await page.fill("#pw", "Demo@2026-Advisor"); await page.click("button.primary");
await page.waitForSelector(".topbar");
const routes = process.argv[3] ? process.argv[3].split(",") : ["/", "/assets", "/portfolio", "/cashflow", "/rules", "/alerts", "/health", "/goals", "/cases", "/data", "/market", "/reports", "/demo", "/methodology"];
for (const r of routes) {
  await page.goto(base + r); await page.waitForSelector(".page h1", { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${r === "/" ? "overview" : r.replace(/[^a-z]/g, "_")}.png`, fullPage: true });
}
console.log(errors.length ? errors.join("\n") : "no console errors");
await browser.close();
