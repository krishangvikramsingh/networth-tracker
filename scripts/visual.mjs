// Visual regression: screenshot key pages at desktop and phone width and compare with the saved baselines.
//   BASE=http://127.0.0.1:8799 npm run test:visual            compare (exit 1 on a difference)
//   BASE=... npm run test:visual -- --update                  save the current screens as the new baselines
// Use a fresh throwaway database and APP_AS_OF=2026-10-20 so the screens are the same every run. Baselines come from macOS
// Chromium; another operating system draws text slightly differently, so this runs locally, not in CI.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { findChromium } from "./chromium.mjs";

const base = process.env.BASE ?? "http://127.0.0.1:8787";
const update = process.argv.includes("--update");
const dir = path.resolve("tests/visual"), baseDir = path.join(dir, "baseline"), diffDir = path.resolve(".visual-diff");
const PAGES = [["overview", "/"], ["assets", "/assets"], ["alerts", "/alerts"], ["rules", "/rules"], ["risk", "/risk"], ["clients", "/clients"], ["tasks", "/tasks"], ["portfolio", "/portfolio"]];
const SIZES = [["desktop", 1440, 900], ["phone", 390, 844]];
const TOLERANCE = 0.00002; // share of pixels allowed to differ; identical runs measure exactly 0, so this only forgives a stray pixel
fs.mkdirSync(baseDir, { recursive: true }); fs.mkdirSync(diffDir, { recursive: true });

const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
let failed = 0, checked = 0;
for (const [sizeName, w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "light", reducedMotion: "reduce", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(base); await page.fill("#em", "advisor@demo.local"); await page.fill("#pw", process.env.PW ?? "Demo@2026-Advisor"); await page.click("button.primary"); await page.waitForSelector(".topbar");
  for (const [name, route] of PAGES) {
    await page.goto(base + route); await page.waitForSelector(".page h1", { timeout: 10000 }); await page.waitForTimeout(700);
    await page.addStyleTag({ content: "*,*::before,*::after{caret-color:transparent!important;animation:none!important;transition:none!important}" });
    // times of day come from the clock, not the data: blank them so a re-run on a fresh database looks the same
    await page.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) n.textContent = n.textContent.replace(/\d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2}\s?[ap]m/gi, "00 Jan, 00:00 am"); });
    const shot = await page.screenshot({ fullPage: false });
    const file = path.join(baseDir, `${name}-${sizeName}.png`);
    if (update || !fs.existsSync(file)) { fs.writeFileSync(file, shot); console.log(`saved  ${name}-${sizeName}`); continue; }
    const a = PNG.sync.read(fs.readFileSync(file)), b = PNG.sync.read(shot); checked++;
    if (a.width !== b.width || a.height !== b.height) { failed++; console.error(`FAIL   ${name}-${sizeName}: size ${a.width}x${a.height} became ${b.width}x${b.height}`); fs.writeFileSync(path.join(diffDir, `${name}-${sizeName}.png`), shot); continue; }
    const diff = new PNG({ width: a.width, height: a.height });
    const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
    const ratio = n / (a.width * a.height);
    if (ratio > TOLERANCE) { failed++; fs.writeFileSync(path.join(diffDir, `${name}-${sizeName}.png`), PNG.sync.write(diff)); console.error(`FAIL   ${name}-${sizeName}: ${(ratio * 100).toFixed(2)}% of pixels differ (diff in .visual-diff/)`); }
    else console.log(`ok     ${name}-${sizeName} (${(ratio * 100).toFixed(3)}% differ)`);
  }
  await ctx.close();
}
await browser.close();
if (!update) console.log(`\n${checked - failed}/${checked} screens match their baselines`);
process.exitCode = failed ? 1 : 0;
