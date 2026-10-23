// Locate a Playwright-installed Chromium on Linux (CI image) or macOS, or use CHROMIUM_PATH.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = ["/opt/pw-browsers", path.join(os.homedir(), "Library/Caches/ms-playwright"), path.join(os.homedir(), ".cache/ms-playwright")];
  const rel = ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root).filter((x) => x.startsWith("chromium-")).sort().reverse())
      for (const r of rel) { const p = path.join(root, d, r); if (fs.existsSync(p)) return p; }
  }
  throw new Error("No Chromium found. Run `npx playwright-core install chromium` or set CHROMIUM_PATH.");
}
