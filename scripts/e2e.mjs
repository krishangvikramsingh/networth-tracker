// End-to-end smoke test: drives the real UI in Chromium against a running server (npm start).
import { chromium } from "playwright-core";
import fs from "node:fs";
const base = process.env.BASE ?? "http://127.0.0.1:8787";
const exe = process.env.CHROMIUM_PATH ?? fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-")).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = []; let passed = 0;
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/401/.test(m.text()) && errors.push(m.text()));
const ok = (c, msg) => { if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else { passed++; console.log("ok  -", msg); } };
const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ");

await page.goto(base);
await page.fill("#em", "advisor@demo.local"); await page.fill("#pw", "wrong"); await page.click("button.primary");
await page.waitForSelector("text=Incorrect email or password.", { timeout: 5000 }).catch(() => {});
ok(await page.locator("text=Incorrect email or password.").isVisible(), "bad login shows a generic error");
await page.fill("#pw", "Demo@2026-Advisor"); await page.click("button.primary"); await page.waitForSelector(".topbar");

await page.goto(base + "/");
await page.waitForSelector(".kpi");
ok((await text(".kpi")).includes("₹8.63 Cr"), "overview shows gross assets ₹8.63 Cr");
ok((await page.locator(".kpi", { hasText: "Calculated net worth" }).innerText()).includes("Awaiting data"), "net worth awaits liabilities (not zero)");
ok((await page.locator(".kpi", { hasText: "Confirmed liabilities" }).innerText()).includes("Not yet assessed"), "liabilities shown as not yet assessed");

// KPI drill-down
await page.locator(".kpi", { hasText: "Gross assets" }).click();
ok(await page.locator("[role=dialog] >> text=Residential property").first().isVisible(), "KPI click opens the underlying records");
await page.keyboard.press("Escape");
ok(!(await page.locator("[role=dialog]").count()), "Escape closes the drawer");

// add MF scheme under the aggregate -> equity alert becomes definite
await page.goto(base + "/assets");
await page.getByRole("button", { name: /Add holding/ }).click();
await page.fill("#entity-form input[type=text] >> nth=0", "Test Flexi Cap Fund");
await page.selectOption("#entity-form select >> nth=1", "h_priya_mf");
await page.locator("#entity-form .field", { hasText: "Current market value" }).locator("input").fill("1.5cr");
await page.waitForSelector("text=Automatic classification");
await page.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForSelector("text=Added holding");
await page.goto(base + "/alerts");
await page.waitForSelector(".alert-row");
ok((await page.locator(".alert-row", { hasText: "Equity allocation exceeds limit" }).first().innerText()).includes("Equity"), "equity alert present after adding scheme");
ok(!(await page.locator(".alert-row", { hasText: "Equity allocation exceeds limit" }).first().innerText()).includes("possible"), "equity alert is now a definite breach");
await page.locator(".alert-row", { hasText: "Equity allocation exceeds limit" }).first().click();
await page.waitForSelector("[role=dialog] >> text=Recommended action", { timeout: 5000 }).catch(() => {});
ok(await page.locator("[role=dialog] >> text=Recommended action").isVisible(), "alert drawer explains the recommended action");
await page.getByRole("button", { name: "Acknowledge" }).click();
await page.waitForSelector("text=Alert acknowledged");
await page.keyboard.press("Escape");

// threshold change resolves it
await page.goto(base + "/rules");
await page.getByRole("tab", { name: "Alert rules" }).click();
const card = page.locator("section.card", { hasText: "Equity allocation exceeds limit" }).first();
await card.locator("input[type=number]").first().fill("90");
await card.getByRole("button", { name: /Save/ }).click();
await page.waitForSelector("text=re-evaluated");
await page.goto(base + "/alerts?tab=resolved");
await page.waitForSelector(".alert-row", { timeout: 5000 }).catch(() => {});
ok(await page.locator(".alert-row", { hasText: "Equity allocation exceeds limit" }).count() > 0, "raising the threshold resolves the alert and keeps it in history");

// liability recalculates net worth
await page.goto(base + "/assets?tab=liabilities");
await page.getByRole("button", { name: /Add liability/ }).click();
await page.fill("#entity-form input[type=text] >> nth=0", "Test home loan");
await page.locator("#entity-form .field", { hasText: "Outstanding principal" }).locator("input").fill("40L");
await page.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForSelector("text=Added liability");
await page.goto(base + "/");
await page.waitForSelector(".kpi");
ok((await page.locator(".kpi", { hasText: "Calculated net worth" }).innerText()).includes("₹8.23 Cr"), "net worth recalculates to ₹8.23 Cr (provisional)");

// validation error
await page.goto(base + "/assets?tab=liabilities");
await page.getByRole("button", { name: /Add liability/ }).click();
await page.getByRole("button", { name: "Add", exact: true }).click();
ok(await page.locator("#entity-form .err").first().isVisible(), "empty form shows a validation error");
await page.keyboard.press("Escape");

// pages load without errors
for (const r of ["/portfolio", "/cashflow", "/health", "/goals", "/cases", "/data", "/market", "/reports", "/demo", "/methodology"]) {
  await page.goto(base + r); await page.waitForSelector(".page h1");
  ok(true, `page ${r} renders`);
}
// cases are isolated from Priya
await page.goto(base + "/cases"); await page.waitForSelector("text=Side-by-side comparison");
ok((await text("table.tbl")).includes("₹5.00 Cr"), "Case A net worth ₹5.00 Cr");

// demo reset restores Priya
await page.goto(base + "/demo");
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: "Reset demo data" }).click();
await page.waitForSelector("text=Demo data reset");
await page.goto(base + "/");
await page.waitForSelector(".kpi");
ok((await page.locator(".kpi", { hasText: "Confirmed liabilities" }).innerText()).includes("Not yet assessed"), "reset restores the original state");

// responsive: mobile has no horizontal page scroll
await page.setViewportSize({ width: 390, height: 800 });
for (const r of ["/", "/assets", "/rules"]) { await page.goto(base + r); await page.waitForSelector(".page h1"); const w = await page.evaluate(() => document.documentElement.scrollWidth); ok(w <= 392, `no horizontal page scroll at 390px on ${r} (scrollWidth ${w})`); }
ok(errors.length === 0, `no console/page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
console.log(`\n${passed} checks passed`);
await browser.close();
