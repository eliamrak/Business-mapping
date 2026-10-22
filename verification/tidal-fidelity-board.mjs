import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const root = path.resolve(import.meta.dirname, "..");
const out = path.resolve(root, "../tidal-preview/integrated/evidence");
const require = createRequire("/tmp/practice-oct20-render-deps/package.json");
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, executablePath: "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
try {
  const image = async file => `data:image/png;base64,${(await fs.readFile(file)).toString("base64")}`;
  const page = await browser.newPage({ viewport: { width: 1800, height: 1300 }, deviceScaleFactor: 1 });
  const target = await image(path.resolve(root, "../tidal-preview/reference/practice-tidal-chromatics.png"));
  const before = await image(path.join(out, "owned-png-reference.png"));
  const after = await image(path.join(out, "overview-1440.png"));
  await page.setContent(`<html><head><style>body{margin:0;background:#fff;color:#123;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}section{min-width:0}h2{font-size:16px;height:50px}img{width:100%;display:block}</style></head><body><main><section><h2>Selected target — material reference (concept layout)</h2><img src="${target}"></section><section><h2>Owned source — PNG before encoding optimization</h2><img src="${before}"></section><section><h2>Owned source — optimized JPEG, same application layout</h2><img src="${after}"></section></main></body></html>`);
  await page.screenshot({ path: path.join(out, "material-comparison-board.png"), fullPage: true });
  await page.setViewportSize({ width: 1800, height: 700 });
  await page.setContent(`<html><head><style>body{margin:0;background:#fff;color:#123;font:16px sans-serif}main{display:flex;gap:20px}.crop{position:relative;overflow:hidden;width:700px;height:440px}.target{width:360px;height:400px}img{position:absolute;max-width:none}.target img{width:1487px;left:-65px;top:-289px}.actual img{width:1440px;left:-32px;top:-410px}</style></head><body><h2>Focused material and type — native-size source regions, not equal layouts</h2><main><section><h3>Selected concept card</h3><div class="crop target"><img src="${target}"></div></section><section><h3>Owned PNG surface before optimization</h3><div class="crop actual"><img src="${before}"></div></section><section><h3>Owned JPEG surface after optimization</h3><div class="crop actual"><img src="${after}"></div></section></main></body></html>`);
  await page.screenshot({ path: path.join(out, "focused-material-comparison.png"), fullPage: true });
  const mobile = await image(path.join(out, "overview-390.png"));
  await page.setContent(`<html><head><style>body{margin:0;background:#fff;color:#123;font:16px sans-serif}main{display:grid;grid-template-columns:1100px 390px;gap:20px}img{width:100%;display:block}</style></head><body><main><section><h2>Selected desktop reference — exact target</h2><img src="${target}"></section><section><h2>Owned responsive source — 390px, synthetic data</h2><img src="${mobile}"></section></main></body></html>`);
  await page.screenshot({ path: path.join(out, "responsive-comparison-board.png"), fullPage: true });
  console.log(JSON.stringify({ comparison: "material-comparison-board.png", responsive: "responsive-comparison-board.png", normalizedBy: "browser layout at native CSS pixel dimensions; no artwork editing" }));
} finally { await browser.close(); }
