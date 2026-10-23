// End-to-end smoke test: drives the real UI in Chromium against a running server (npm start).
import { chromium } from "playwright-core";
import { findChromium } from "./chromium.mjs";
const base = process.env.BASE ?? "http://127.0.0.1:8787";
const exe = findChromium();
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = []; let passed = 0;
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/401|ERR_INTERNET_DISCONNECTED/.test(m.text()) && errors.push(m.text()));
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

// risk profile: answer, save, apply as target allocation
await page.goto(base + "/risk"); await page.waitForSelector(".page h1");
ok((await text(".card:has-text('Your result')")).includes("Answer the questions"), "risk page starts with no profile (not a default one)");
for (const q of ["t_drop", "t_range", "t_exp"]) await page.locator(`input[name=${q}]`).nth(2).check();
ok((await text(".card:has-text('Your result')")).includes("Awaiting answers"), "partial answers show a range, not a profile");
ok(await page.getByRole("button", { name: "Save assessment" }).isDisabled(), "cannot save until every question is answered");
for (const q of ["t_goal", "c_horizon", "c_income", "c_reserve", "c_obligations"]) await page.locator(`input[name=${q}]`).nth(2).check();
ok((await text(".card:has-text('Your result')")).includes("Moderately aggressive"), "all-middle-high answers give Moderately aggressive");
await page.getByRole("button", { name: "Save assessment" }).click(); await page.waitForSelector("text=Risk profile saved");
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: "Apply as target allocation" }).click(); await page.waitForSelector("text=Target allocation updated");
await page.goto(base + "/rules"); await page.waitForSelector("input[aria-label='Indian equity target percent']");
ok((await page.inputValue("input[aria-label='Indian equity target percent']")) === "45", "applied model portfolio sets Indian equity target to 45%");
ok((await page.locator(".banner", { hasText: "Sample policy" }).first().innerText()).includes("illustrative Moderately aggressive model"), "policy banner names the model the targets came from");
await page.fill("input[aria-label='Indian equity target percent']", "44"); await page.fill("input[aria-label='Global equity target percent']", "21");
await page.getByRole("button", { name: "Save targets" }).click(); await page.waitForSelector("text=Targets saved");
ok(!(await page.locator(".banner", { hasText: "Sample policy" }).first().innerText()).includes("illustrative Moderately aggressive model"), "after editing the targets the banner no longer claims they are the model");

// nominees: add a nominee, record a full nomination
await page.goto(base + "/nominees"); await page.waitForSelector(".page h1");
ok((await page.locator(".kpi", { hasText: "Assets fully nominated" }).innerText()).includes("0%"), "nomination coverage starts at 0% and rows read Not recorded");
await page.getByRole("button", { name: "Add nominee" }).click();
await page.fill("#nominee-form input[type=text] >> nth=0", "Test Nominee");
await page.getByRole("button", { name: "Add", exact: true }).click(); await page.waitForSelector("text=Nominee added");
await page.getByRole("button", { name: "Record" }).first().click();
await page.getByRole("button", { name: "Save", exact: true }).click(); await page.waitForSelector("text=Nomination saved");
ok(await page.locator("text=Complete (100%)").first().isVisible(), "a 100% nomination shows as Complete");
ok(!(await page.locator(".kpi", { hasText: "Assets fully nominated" }).innerText()).includes("Awaiting data"), "coverage is a number once an asset is nominated");

// advisor overview and API reference
await page.goto(base + "/clients"); await page.waitForSelector(".page h1");
ok((await text("table.tbl")).includes("Priya Ramanathan"), "All clients lists the live client");
ok((await page.locator(".kpi", { hasText: "Total gross assets" }).innerText()).includes("₹8.63 Cr"), "All clients totals gross assets for real clients only");
ok(await page.locator("text=Attention queue").isVisible(), "attention queue is shown");
await page.locator("table.tbl tbody tr", { hasText: "Priya Ramanathan" }).first().click(); await page.waitForSelector(".kpi", { hasText: "Gross assets" });
ok(new URL(page.url()).pathname === "/", "clicking a client opens it");
const spec = await (await page.request.get(base + "/api/docs/openapi.json")).json();
ok(spec.openapi === "3.1.0" && !!spec.paths["/api/clients/{cid}/state"], "API reference is served and covers the state route");

// email notifications
// preferences belong to the user and survive "Reset demo data", so start from a known baseline to keep this script re-runnable
await page.request.put(base + "/api/notifications/prefs", { data: { emailEnabled: false, minSeverity: "high" }, headers: { "X-Requested-With": "networth" } });
await page.goto(base + "/notifications"); await page.waitForSelector(".page h1");
ok(await page.locator("text=No mail server is connected").isVisible(), "without SMTP the page says emails go to the outbox");
await page.getByLabel("Send email alerts").check(); await page.getByLabel("Lowest severity to email").selectOption("info");
await page.getByRole("button", { name: "Save", exact: true }).click(); await page.waitForSelector("text=Notification settings saved");
await page.getByRole("button", { name: "Send pending now" }).click(); await page.waitForSelector("text=/Nothing to send|email\\(s\\)/");
ok(true, "email preferences save and the dispatcher can be run on demand");

// PWA: manifest, service worker, no private data in caches, offline shell
const man = await (await page.request.get(base + "/manifest.webmanifest")).json();
ok(man.display === "standalone" && man.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"), "manifest is installable (standalone, maskable icon)");
ok((await page.request.get(base + "/sw.js")).headers()["cache-control"] === "no-cache", "service worker is always revalidated");
await page.goto(base + "/");
await page.waitForSelector(".kpi");
const swReady = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
ok(swReady, "service worker is active");
await page.reload(); await page.waitForSelector(".kpi");
const cached = await page.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; });
ok(cached.length > 0 && !cached.some((p) => p.startsWith("/api")), `caches hold the app shell only, never /api (${cached.length} entries)`);
await page.context().setOffline(true);
await page.reload(); await page.waitForSelector("text=Cannot reach the server");
ok(!(await page.locator("#em").count()), "opening offline shows a connection message, not the sign-in form");
await page.context().setOffline(false);
await page.getByRole("button", { name: "Try again" }).click(); await page.waitForSelector(".kpi");
ok(true, "retrying after reconnecting restores the session");

// pages load without errors
for (const r of ["/portfolio", "/cashflow", "/health", "/alerts", "/goals", "/cases", "/data", "/market", "/reports", "/demo", "/methodology"]) {
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
for (const r of ["/", "/assets", "/rules", "/risk", "/nominees", "/notifications", "/clients"]) { await page.goto(base + r); await page.waitForSelector(".page h1"); const w = await page.evaluate(() => document.documentElement.scrollWidth); ok(w <= 392, `no horizontal page scroll at 390px on ${r} (scrollWidth ${w})`); }
ok(errors.length === 0, `no console/page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
console.log(`\n${passed} checks passed`);
await browser.close();
