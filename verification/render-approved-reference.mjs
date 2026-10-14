import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const { chromium } = createRequire("/tmp/local-retention-browser-harness/package.json")("playwright");
const browser = await chromium.launch({ executablePath: "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell", headless: true });
const page = await browser.newPage();
const out = path.resolve("verification/practice-workspace-render");
await fs.mkdir(out, { recursive: true });
await page.goto("file:///Users/eliam/Documents/Codex/2026-10-14/task-2/library-materialized/practice-tabs.html");
for (const name of ["Overview", "Sessions", "Team", "Money", "Growth", "Goals", "Long Term Goals", "Sandbox"]) {
  await page.locator(`aside button[data-go="${name}"]`).click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(out, `approved-${name.toLowerCase()}-${width}.png`), fullPage: true });
  }
}
console.log(JSON.stringify({ out }));
await browser.close();
