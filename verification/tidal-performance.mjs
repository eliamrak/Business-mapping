import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire("/tmp/practice-oct20-render-deps/package.json");
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, executablePath: "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
const results = [];
const percentile = (numbers, ratio) => [...numbers].sort((a, b) => a - b)[Math.floor((numbers.length - 1) * ratio)];
try {
  for (const mobile of [false, true]) for (const theme of ["baseline", "tidal"]) {
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: 960 }, isMobile: mobile, hasTouch: mobile });
    await context.addInitScript(() => {
      const D = Date; window.Date = class extends D { constructor(...args) { super(...(args.length ? args : ["2026-10-14T16:00:00Z"])); } static now() { return new D("2026-10-14T16:00:00Z").valueOf(); } };
      window.__longTasks = []; new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: "longtask", buffered: true });
    });
    const page = await context.newPage();
    // Standard diagnostics for this new synthetic-only browser, never an owner profile.
    const diagnostics = await context.newCDPSession(page);
    if (mobile) { await diagnostics.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await diagnostics.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 100000 }); }
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    const loads = [];
    for (const temperature of ["cold", "warm"]) {
      const start = performance.now();
      await page.goto("http://127.0.0.1:4183/" + (theme === "baseline" ? "baseline" : ""));
      await page.getByText("2 converted snapshots loaded", { exact: true }).waitFor();
      const usableMs = performance.now() - start;
      if (theme === "tidal") await page.locator(".pw-tidal-art").evaluate(async element => { const source = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]; const image = new Image(); image.src = source; await image.decode(); });
      const completeMs = performance.now() - start;
      const metrics = await page.evaluate(() => ({ paints: performance.getEntriesByType("paint").map(e => ({ name: e.name, ms: e.startTime })), resources: performance.getEntriesByType("resource").map(e => ({ name: new URL(e.name).pathname, transferred: e.transferSize, encoded: e.encodedBodySize, decoded: e.decodedBodySize })), longTasks: window.__longTasks }));
      loads.push({ temperature, usableMs, artworkCompleteMs: completeMs, ...metrics });
    }
    const frames = await page.evaluate(async () => { let last = performance.now(); const times = []; for (let i = 0; i < 90; i++) { await new Promise(requestAnimationFrame); const now = performance.now(); times.push(now - last); last = now; scrollBy(0, i < 45 ? 8 : -8); } return times; });
    const tabs = [];
    for (const name of ["Sessions", "Money", "Goals", "Overview"]) {
      const start = performance.now(); await page.getByRole("navigation", { name: "Practice sections", exact: true }).getByRole("button", { name: new RegExp(name + "$") }).click(); await page.getByRole("heading", { name, exact: true }).first().waitFor(); await page.evaluate(() => new Promise(requestAnimationFrame)); tabs.push({ name, ms: performance.now() - start });
    }
    await page.getByRole("navigation", { name: "Practice sections", exact: true }).getByRole("button", { name: /Money$/ }).click();
    const input = page.getByRole("spinbutton", { name: "Monthly billed revenue estimate", exact: true });
    const start = performance.now(); await input.fill("35000"); await input.blur(); await page.evaluate(() => new Promise(requestAnimationFrame));
    results.push({ theme, viewport: mobile ? 390 : 1440, simulatedMobile: mobile, cpuRate: mobile ? 4 : 1, latencyMs: mobile ? 150 : 0, bandwidthBytesPerSecond: mobile ? 200000 : null, loads, scroll: { frames: frames.length, p50: percentile(frames, .5), p95: percentile(frames, .95), max: Math.max(...frames), over50ms: frames.filter(n => n > 50).length }, tabs, inputUpdateMs: performance.now() - start, errors });
    await context.close();
  }
} finally {
  await browser.close(); const file = path.resolve(root, "../tidal-preview/integrated/evidence/performance.json"); await fs.writeFile(file, JSON.stringify({ syntheticOnly: true, realPhone: false, harnessGzip: true, warmCacheIsHarnessNotDeployment: true, results }, null, 2));
  console.log(JSON.stringify(results.map(({ theme, viewport, loads, scroll, tabs, inputUpdateMs, errors }) => ({ theme, viewport, loads: loads.map(({ temperature, usableMs, artworkCompleteMs, resources }) => ({ temperature, usableMs, artworkCompleteMs, transferredBytes: resources.reduce((sum, r) => sum + r.transferred, 0) })), scroll, tabs, inputUpdateMs, errors }))));
}
