// Renders the app logo to the PNG icons a PWA needs. Run: node scripts/make-icons.mjs
// Output: src/web/public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png and icon.svg
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { findChromium } from "./chromium.mjs";

const out = path.resolve(import.meta.dirname, "../src/web/public/icons");
fs.mkdirSync(out, { recursive: true });

const glyph = (g) => `<path d="M7 22l5-6 4 3 8-10" stroke="#62d0b4" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" ${g}/>`;
// "any" icon: rounded tile. "maskable": full-bleed square with the glyph kept inside the central 80% safe zone, because the OS crops the corners.
const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0f2a43"/>${glyph("")}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0f2a43"/>${glyph('transform="translate(3.2 3.2) scale(0.8)"')}</svg>`;
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0f2a43"/>${glyph('transform="translate(1.6 1.6) scale(0.9)"')}</svg>`; // iOS rounds the corners itself

fs.writeFileSync(path.join(out, "icon.svg"), any);
const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
for (const [file, svg, size] of [["icon-192.png", any, 192], ["icon-512.png", any, 512], ["maskable-512.png", maskable, 512], ["apple-touch-icon.png", apple, 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join(out, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log("wrote", file);
}
await browser.close();
