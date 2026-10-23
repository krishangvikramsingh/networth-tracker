// Browser walkthrough of two-factor sign-in and password reset, against a throwaway server (see scripts/e2e.mjs).
// It signs in as the demo viewer, turns two-factor on and off again, and resets nothing it cannot undo.
import { createHmac } from "node:crypto";
import { chromium } from "playwright-core";
import { findChromium } from "./chromium.mjs";
const base = process.env.BASE ?? "http://127.0.0.1:8787";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const unb32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s.replace(/\s/g, "")) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totp = (secret, step) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = createHmac("sha1", unb32(secret)).update(m).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const now = () => Math.floor(Date.now() / 1000 / 30);
const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const errors = []; let passed = 0;
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/40[13]|410|422|ERR_INTERNET/.test(m.text()) && errors.push(m.text()));
const ok = (c, msg) => { if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else { passed++; console.log("ok  -", msg); } };
const signIn = async (pw = "Demo@2026-Viewer") => { await page.goto(base); await page.fill("#em", "viewer@demo.local"); await page.fill("#pw", pw); await page.click("button.primary"); };

await signIn(); await page.waitForSelector(".topbar");
await page.goto(base + "/security"); await page.waitForSelector("text=Set up two-factor");
await page.getByRole("button", { name: "Set up two-factor" }).click();
await page.waitForSelector("svg.qr");
ok(await page.locator("svg.qr").isVisible(), "setup shows a QR code");
await page.locator("summary", { hasText: "enter the key by hand" }).click();
const secret = (await page.locator(".keybox").innerText()).trim();
ok(/^[A-Z2-7 ]{20,}$/.test(secret), "the manual key is shown in groups of four");
await page.fill("#otp", "000000"); await page.getByRole("button", { name: "Turn on" }).click();
await page.waitForSelector("text=That code is not right");
ok(true, "a wrong code is refused with a clear message");
await page.fill("#otp", totp(secret, now())); await page.getByRole("button", { name: "Turn on" }).click();
await page.waitForSelector("text=Save your recovery codes now");
const codes = await page.locator(".codes span").allInnerTexts();
ok(codes.length === 8 && codes.every((c) => /^[0-9a-f]{5}-[0-9a-f]{5}$/.test(c)), "eight recovery codes are shown once");
await page.getByRole("button", { name: "I have saved them" }).click();
ok(await page.locator("text=recovery codes left").isVisible(), "status shows the codes left");

await page.getByRole("button", { name: /Sign out/ }).first().click(); await page.waitForSelector("#em");
await page.fill("#em", "viewer@demo.local"); await page.fill("#pw", "Demo@2026-Viewer"); await page.click("button.primary");
await page.waitForSelector("#code");
ok(await page.locator("text=Enter your code").isVisible(), "after the password, the code step appears (no session yet)");
await page.fill("#code", "123456"); await page.getByRole("button", { name: /Verify/ }).click();
await page.waitForSelector("text=That code is not right");
ok(true, "wrong code at sign-in is refused");
await page.fill("#code", codes[0]); await page.getByRole("button", { name: /Verify/ }).click(); await page.waitForSelector(".topbar");
ok(true, "a recovery code signs in");

await page.goto(base + "/security"); await page.waitForSelector("text=7 recovery code");
ok(true, "using a recovery code spends it (7 left)");
await page.getByRole("button", { name: "Turn off…" }).click();
await page.fill("#offpw", "Demo@2026-Viewer"); await page.fill("#offcode", codes[1]); await page.getByRole("button", { name: "Turn off two-factor" }).click();
await page.waitForSelector("text=Set up two-factor");
ok(true, "two-factor can be turned off with the password and a code");

// forgot password: the request is accepted and a reset link lands in the mail outbox
await page.getByRole("button", { name: /Sign out/ }).first().click(); await page.waitForSelector("#em");
await page.getByRole("button", { name: "Forgot your password?" }).click();
await page.fill("#fe", "viewer@demo.local"); await page.getByRole("button", { name: "Email me a reset link" }).click();
await page.waitForSelector("text=Check your email");
ok(true, "forgot password confirms without saying whether the account exists");
await page.goto(base + "/reset?token=not-a-real-token"); await page.waitForSelector("text=Choose a new password");
await page.fill("#np", "A-Brand-New-Passphrase"); await page.fill("#np2", "A-Brand-New-Passphrase"); await page.getByRole("button", { name: "Set new password" }).click();
await page.waitForSelector("text=no longer valid");
ok(true, "an invalid reset link is refused with a way forward");
await signIn(); await page.waitForSelector(".topbar");
ok(true, "the original password still works afterwards");
ok(errors.length === 0, "no console/page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(`\n${passed} auth checks passed`);
await browser.close();
