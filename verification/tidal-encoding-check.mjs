import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire("/tmp/practice-oct20-render-deps/package.json");
const { chromium } = require("playwright");
const png = await fs.readFile(path.join(root, "artifacts/comp-dashboard/src/assets/practice-tidal-art.png"));
const jpeg = await fs.readFile(path.join(root, "artifacts/comp-dashboard/src/assets/practice-tidal-art.jpg"));
const browser = await chromium.launch({ headless: true, executablePath: "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
try {
  const page = await browser.newPage();
  const difference = await page.evaluate(async ({ a, b }) => {
    const read = async src => { const image = new Image(); image.src = src; await image.decode(); const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data }; };
    const original = await read(a), optimized = await read(b);
    let squared = 0, absolute = 0, count = 0;
    for (let i = 0; i < original.data.length; i++) if (i % 4 !== 3) { const delta = Math.abs(original.data[i] - optimized.data[i]); squared += delta * delta; absolute += delta; count++; }
    const mse = squared / count;
    return { width: original.width, height: original.height, dimensionsMatch: original.width === optimized.width && original.height === optimized.height, meanAbsoluteChannelDifference: absolute / count, psnrDb: 10 * Math.log10(255 * 255 / mse) };
  }, { a: `data:image/png;base64,${png.toString("base64")}`, b: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
  const result = { originalBytes: png.length, optimizedBytes: jpeg.length, savedPct: 100 * (1 - jpeg.length / png.length), ...difference, requiresRenderedFidelityReview: true };
  await fs.mkdir(path.resolve(root, "../tidal-preview/integrated/evidence"), { recursive: true });
  await fs.writeFile(path.resolve(root, "../tidal-preview/integrated/evidence/encoding.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
