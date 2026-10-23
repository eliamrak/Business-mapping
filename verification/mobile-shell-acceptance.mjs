import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
// Run: node verification/mobile-shell-acceptance.mjs before|after [--preview|--interactions-only|--boundary-only].
// No dependencies are added: optionally set MOBILE_ACCEPTANCE_PLAYWRIGHT_PACKAGE to an existing
// package.json resolving Playwright and MOBILE_ACCEPTANCE_CHROMIUM to its Chromium executable.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const phase = process.argv[2] ?? "before";
if (!["before", "after"].includes(phase)) throw Error("Use before or after");
const evidence = "/tmp/practice-mobile-shell-acceptance";
const preview = process.argv.includes("--preview");
const interactionsOnly = process.argv.includes("--interactions-only");
const boundaryOnly = process.argv.includes("--boundary-only");
const out = path.join(evidence, preview ? "preview" : boundaryOnly ? "boundary" : interactionsOnly ? "interaction-recheck" : phase);
await fs.mkdir(out, { recursive: true });
const require = createRequire(path.join(root, "artifacts/api-server/package.json"));
const { build } = require("esbuild");
const { chromium } = createRequire(process.env.MOBILE_ACCEPTANCE_PLAYWRIGHT_PACKAGE ?? "/tmp/practice-oct20-render-deps/package.json")("playwright");
const fixture = JSON.parse(await fs.readFile(path.join(root, "verification/fixtures/tidal-workspace.json"), "utf8"));
for (const [index, label] of ["Alex Rivera", "Morgan Lee", "Jordan Patel", "Sam Taylor"].entries()) {
  fixture.context.clinicians.push({ ...fixture.context.clinicians[1], id: index + 3, label, sessionsPerWeek: 0 });
}
const originalFixture = JSON.stringify(fixture);
const fixtureHash = createHash("sha256").update(originalFixture).digest("hex");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

// Retain the released CSS before a candidate build overwrites ignored dist files.
const baselineCss = process.env.MOBILE_ACCEPTANCE_BASELINE_CSS ?? path.join(evidence, "baseline.css");
let compiledCss;
try { compiledCss = await fs.readFile(baselineCss); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  const index = await fs.readFile(path.join(root, "artifacts/comp-dashboard/dist/public/index.html"), "utf8");
  const cssRef = index.match(/href="(\/assets\/index-[^"]+\.css)"/)[1];
  compiledCss = await fs.readFile(path.join(root, "artifacts/comp-dashboard/dist/public", cssRef));
}
if (createHash("sha256").update(compiledCss).digest("hex") !== "3cf76297b1569d37d39d0cf8b1b186638ce4d1535bed48c97bc78f1e8819cf3d") throw Error("CSS does not match reviewed live style");
await fs.writeFile(baselineCss, compiledCss);
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{TooltipProvider}from'@/components/ui/tooltip';import PracticeWorkspace from'@/pages/practice-workspace';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><TooltipProvider><PracticeWorkspace/></TooltipProvider></QueryClientProvider>);`;
const snapshot = path.join(evidence, "baseline-inputs.json");
if (phase === "before") {
  try { await fs.access(snapshot); throw Error("Baseline already exists; refusing overwrite"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const bundle = await build({ stdin: { contents: entry, loader: "tsx", resolveDir: path.join(root, "artifacts/comp-dashboard") }, bundle: true,
  plugins: [{ name: "synthetic-identity-hooks", setup(builder) {
    builder.onResolve({ filter: /^@clerk\/react$/ }, () => ({ path: "clerk", namespace: "identity-fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "identity-fixture" }, () => ({ contents: "export const useAuth=()=>({isLoaded:true,isSignedIn:true});export const useUser=()=>({user:{primaryEmailAddress:{emailAddress:'owner@example.test'}}});export const useClerk=()=>({signOut:async()=>{throw Error('Sign out is outside acceptance scope')}});", loader: "js" }));
  } }],
  write: false, minify: true, platform: "browser", format: "esm", jsx: "automatic", loader: { ".png": "file", ".jpg": "file" },
  alias: { "@": path.join(root, "artifacts/comp-dashboard/src") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"BASE_URL":"/"}' }, outdir: out });
const assets = new Map(bundle.outputFiles.map(file => ["/" + path.basename(file.path), file.contents]));
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).contents;
const css = Buffer.concat([compiledCss, ...bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.contents)]);
const cssHash = createHash("sha256").update(css).digest("hex");
const jsHash = createHash("sha256").update(js).digest("hex");
if (phase === "before") await fs.writeFile(snapshot, JSON.stringify({ head, fixtureHash, cssHash, jsHash, clock: "2026-10-22T12:00:00Z", roster: fixture.context.clinicians.map(p => p.label) }, null, 2));
else assert.equal(fixtureHash, JSON.parse(await fs.readFile(snapshot, "utf8")).fixtureHash);
const errors = [], requests = [], captures = [];
const server = http.createServer((req, res) => {
  if (req.method !== "GET") { errors.push("Blocked write " + req.method + " " + req.url); res.writeHead(405); return res.end(); }
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    requests.push(url.pathname);
    const value = url.pathname === "/api/hub" ? { revision: 1, data: fixture.workspace, updatedAt: "2026-10-22T00:00:00Z" }
      : url.pathname === "/api/hub/context" ? fixture.context
      : url.pathname === "/api/practice-imports" ? { snapshots: fixture.snapshots, packages: fixture.packages, declarations: null, billingResolutions: [], billingResolutionRevision: 0, billingCodeMinutes: {}, sameDayVisitOverrides: {} }
      : /\/billing-(code|resolution)-candidates$/.test(url.pathname) ? { revision: 0, candidates: [] }
      : url.pathname === "/api/business-goals" ? fixture.goals
      : url.pathname === "/api/practice-imports/capabilities" ? {} : [];
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); return res.end(JSON.stringify(value));
  }
  if (url.pathname === "/app.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(js); }
  if (url.pathname === "/style.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
  if (assets.has(url.pathname)) { res.setHeader("Content-Type", /\.jpg$/.test(url.pathname) ? "image/jpeg" : "image/png"); return res.end(assets.get(url.pathname)); }
  res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.MOBILE_ACCEPTANCE_CHROMIUM ?? "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: "reduce", timezoneId: "UTC", locale: "en-US" });
await context.addInitScript(() => { const D = Date; window.Date = class extends D { constructor(...args) { super(...(args.length ? args : ["2026-10-22T12:00:00Z"])); } static now() { return new D("2026-10-22T12:00:00Z").valueOf(); } }; });
await context.route("**/*", route => new URL(route.request().url()).origin === origin && route.request().method() === "GET" ? route.continue() : (errors.push("Blocked external request"), route.abort()));
const page = await context.newPage(); page.setDefaultTimeout(10000);
page.on("pageerror", error => errors.push(error.message));
await page.goto(origin); await page.locator('nav[aria-label="Practice sections"]').first().waitFor({ state: "attached" });
const sections = new Set(["Overview", "Sessions", "Team", "Money", "Growth", "Goals", "Budget", "Data"]);
async function navigateSection(section, width) {
  const mobile = phase === "after" && width < 761;
  if (mobile) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  if (section === "Data") await (mobile ? page.getByRole("navigation", { name: "Mobile utilities" }) : page).getByRole("button", { name: "Data & imports", exact: true }).click();
  else {
    const label = section === "Budget" ? "Money" : section;
    await page.getByRole("navigation", { name: mobile ? "Mobile practice sections" : "Practice sections", exact: true }).getByRole("button", { name: new RegExp(label + "$") }).click();
    if (section === "Budget") {
      await page.getByRole("button", { name: "Budget", exact: true }).click();
    }
  }
}
async function capture(section, width, position = "top") {
  if (!sections.has(section) || ![320,390,430,1024,1440].includes(width) || !["top", "content", "middle"].includes(position)) throw Error("Invalid capture step");
  await page.setViewportSize({ width, height: width === 430 ? 932 : width >= 1024 ? 1000 : 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await navigateSection(section, width);
  await page.waitForTimeout(600); await page.evaluate(() => document.fonts.ready);
  if (position !== "top") await page.evaluate(position => {
    const section = document.querySelector(".pw-main .pw-section");
    window.scrollTo(0, position === "middle" ? 650 : Math.max(0, (section?.getBoundingClientRect().top ?? 0) + window.scrollY - 8));
  }, position);
  await page.waitForTimeout(300);
  const name = `${String(captures.length + 1).padStart(2, "0")}-${section.toLowerCase()}-${width}-${position}.png`;
  const file = path.join(out, name); await page.screenshot({ path: file, fullPage: false });
  const geometry = await page.evaluate(() => {
    const describe = selector => { const node = document.querySelector(selector); if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { viewport: { width: innerWidth, height: innerHeight }, scrollY, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
      nav: describe(".pw-top-navigation"), main: describe(".pw-main"), header: describe(".pw-header"),
      firstMetric: describe(".pw-historical-metric, .pw-metric-card, .pw-overview-card, .pw-content article"),
      overflow: [...document.querySelectorAll("main section,main table,main input,main select,main button")].map(node => ({ node, r: node.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && (r.left < -1 || r.right > innerWidth + 1)).slice(0, 20).map(({ node,r }) => ({ tag: node.tagName, label: node.getAttribute("aria-label") || node.textContent.trim().slice(0,65), x:r.x,width:r.width })),
      text: document.body.innerText.slice(0, 8000), tableSizes: [...document.querySelectorAll("table")].map(node => ({ width:node.getBoundingClientRect().width,scrollWidth:node.scrollWidth })) };
  });
  captures.push({ section, width, position, file, ...geometry });
  if (JSON.stringify(fixture) !== originalFixture) throw Error("Synthetic fixture changed unexpectedly");
  await fs.writeFile(path.join(out, "captures.json"), JSON.stringify({ source: head, fixtureHash, cssHash, jsHash, phase, syntheticOnly: true, isRealPhone: false, captureBrowser: "isolated Chromium mobile viewport", requests, errors, captures }, null, 2));
  console.log(JSON.stringify({ file, section, width, position, documentWidth: geometry.documentWidth, documentHeight: geometry.documentHeight, errors }));
}

const checks = [];
async function check(name, fn) {
  try { const detail = await fn(); checks.push({ name, pass: true, detail }); }
  catch (error) { checks.push({ name, pass: false, error: error.message }); }
  await fs.writeFile(path.join(out, "checks.json"), JSON.stringify({ syntheticOnly: true, realPhone: false, checks, errors }, null, 2));
}
async function desktopParity() {
  for (const capture of captures.filter(item => item.width >= 1024)) await check(`desktop pixel parity ${path.basename(capture.file)}`, async () => {
    const before = await fs.readFile(path.join(evidence, "before", path.basename(capture.file)));
    const after = await fs.readFile(capture.file);
    const diff = await page.evaluate(async ({ before, after }) => {
      async function decode(data) {
        const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
        return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
      }
      const a = await decode(before), b = await decode(after);
      let changedPixels = 0, nonblankPixels = 0;
      for (let i = 0; i < a.pixels.length; i += 4) {
        if (a.pixels[i] !== b.pixels[i] || a.pixels[i+1] !== b.pixels[i+1] || a.pixels[i+2] !== b.pixels[i+2] || a.pixels[i+3] !== b.pixels[i+3]) changedPixels++;
        if (b.pixels[i] !== 255 || b.pixels[i+1] !== 255 || b.pixels[i+2] !== 255) nonblankPixels++;
      }
      return { changedPixels, nonblankPixels, width: b.width, height: b.height, sameDimensions: a.width === b.width && a.height === b.height };
    }, { before: before.toString("base64"), after: after.toString("base64") });
    assert.equal(diff.sameDimensions, true); assert.equal(diff.changedPixels, 0, JSON.stringify(diff));
    assert.ok(diff.nonblankPixels > 1000); return diff;
  });
}
async function mobileChecks(width) {
  await page.setViewportSize({ width, height: width === 430 ? 932 : 844 });
  await page.reload(); await page.getByRole("button", { name: "Open navigation" }).waitFor();
  const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
  await check(`${width} Sheet Escape, focus trap and return`, async () => {
    await trigger.click(); const dialog = page.getByRole("dialog", { name: "Navigation", exact: true }); await dialog.waitFor();
    for (let i = 0; i < 22; i++) {
      await page.keyboard.press("Tab"); assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)), "Focus escaped Sheet");
    }
    await page.screenshot({ path: path.join(out, `sheet-${width}.png`) });
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open navigation");
  });
  for (const section of ["Overview", "Sessions", "Team", "Money", "Growth", "Goals"]) await check(`${width} destination and selected state ${section}`, async () => {
    await navigateSection(section, width); await page.getByRole("heading", { level: 1, name: section, exact: true }).waitFor();
    await trigger.click(); const selected = page.getByRole("navigation", { name: "Mobile practice sections" }).getByRole("button", { name: section, exact: true });
    assert.equal(await selected.getAttribute("aria-current"), "page"); await page.keyboard.press("Escape");
  });
  for (const mode of ["Long Term Goals", "Sandbox", "Today"]) await check(`${width} workspace ${mode}`, async () => {
    await trigger.click(); const nav = page.getByRole("navigation", { name: "Mobile workspaces" });
    await nav.getByRole("button", { name: new RegExp(`^${mode}`) }).click();
    if (mode !== "Today") await page.getByRole("heading", { level: 1, name: mode, exact: true }).waitFor();
    await trigger.click(); assert.equal(await nav.getByRole("button", { name: new RegExp(`^${mode}`) }).getAttribute("aria-current"), "page");
    await page.keyboard.press("Escape");
  });
  for (const name of ["Data & imports", "Settings"]) await check(`${width} utility ${name}`, async () => {
    await trigger.click(); await page.getByRole("navigation", { name: "Mobile utilities" }).getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { level: 1, name, exact: true }).waitFor();
  });
  await check(`${width} reference link`, async () => {
    await trigger.click(); const link = page.getByRole("navigation", { name: "Mobile utilities" }).getByRole("link", { name: /Reference layout/ });
    assert.equal(await link.getAttribute("href"), "/reference"); assert.equal(await link.getAttribute("target"), "_blank");
    await page.keyboard.press("Escape");
  });
  await navigateSection("Overview", width);
  await check(`${width} actions disclosure Escape and focus return`, async () => {
    const actions = page.getByRole("button", { name: "Open page actions", exact: true });
    assert.equal(await actions.getAttribute("aria-expanded"), "false");
    await actions.click(); assert.equal(await actions.getAttribute("aria-expanded"), "true");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.getByRole("button", { name: "Reports", exact: true }).waitFor();
    await page.getByRole("combobox", { name: "Page view", exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, `actions-${width}.png`) });
    await page.keyboard.press("Tab"); await page.keyboard.press("Escape");
    assert.equal(await actions.getAttribute("aria-expanded"), "false");
    assert.ok(await actions.evaluate(node => node === document.activeElement));
  });
  for (const section of ["Overview", "Sessions"]) await check(`${width} ${section} native clinician select`, async () => {
    await navigateSection(section, width); const select = page.getByRole("combobox", { name: `${section} clinician`, exact: true });
    assert.equal(await select.evaluate(node => node.tagName), "SELECT");
    const names = ["Whole Practice", ...fixture.context.clinicians.map(person => person.label)];
    for (const name of names) { await select.selectOption({ label: name }); assert.equal(await select.inputValue(), name); }
    if (section === "Sessions") {
      await select.selectOption({ label: "Compare clinicians" }); assert.equal(await select.inputValue(), "__compare__");
      await page.screenshot({ path: path.join(out, `compare-${width}.png`) });
    }
    await select.selectOption({ label: "Whole Practice" });
  });
  for (const section of ["Overview", "Sessions"]) await check(`${width} ${section} 200 percent text`, async () => {
    await page.reload(); await trigger.waitFor(); await navigateSection(section, width);
    await enlargeText();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, `text200-${section.toLowerCase()}-${width}.png`) });
    const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(size.document <= size.viewport + 1, JSON.stringify(size));
    await trigger.click(); await page.getByRole("dialog", { name: "Navigation", exact: true }).waitFor();
    await enlargeText();
    await page.screenshot({ path: path.join(out, `text200-sheet-${section.toLowerCase()}-${width}.png`) });
    await page.keyboard.press("Escape"); return { ...size, method: "Double computed text font sizes and numeric line heights; synthetic text enlargement, not browser zoom" };
  });
}

async function enlargeText() {
  await page.evaluate(() => {
    const values = [...document.body.querySelectorAll("*")].filter(node => !node.hasAttribute("data-acceptance-enlarged") && node.tagName !== "OPTION" && (node.matches("select,input,textarea") || [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()))).map(node => ({ node, size: parseFloat(getComputedStyle(node).fontSize), line: parseFloat(getComputedStyle(node).lineHeight) }));
    for (const { node, size, line } of values) { node.setAttribute("data-acceptance-enlarged", "true"); node.style.fontSize = `${size * 2}px`; if (Number.isFinite(line)) node.style.lineHeight = `${line * 2}px`; }
  });
}

async function boundaryCheck() {
  await check("760 to 761 closes drawer and clears modal state", async () => {
    await page.setViewportSize({ width: 760, height: 1000 }); await page.reload();
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("dialog", { name: "Navigation", exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, "drawer-760.png") });
    await page.setViewportSize({ width: 761, height: 1000 });
    await page.getByRole("dialog", { name: "Navigation", exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("navigation", { name: "Practice sections", exact: true }).waitFor();
    await page.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== "none" && !document.querySelector('[data-scroll-locked]'));
    await page.screenshot({ path: path.join(out, "desktop-761.png") });
    await page.setViewportSize({ width: 760, height: 1000 });
    assert.equal(await page.getByRole("dialog").count(), 0);
  });
}

try {
  if (preview) {
    for (const width of [390,430]) await capture("Overview", width);
  } else if (boundaryOnly) {
    await boundaryCheck();
  } else if (interactionsOnly) {
    for (const width of [320,390,430]) await mobileChecks(width);
    await boundaryCheck();
  } else {
  for (const width of [1024,1440,320,390,430]) {
    for (const section of ["Overview","Sessions","Team","Money","Growth","Goals","Budget","Data"]) await capture(section,width);
  }
  if (phase === "after") {
    await desktopParity();
    for (const width of [320,390,430]) await mobileChecks(width);
    await boundaryCheck();
  }
  }
  assert.deepEqual(errors, []);
  assert.equal(checks.filter(item => !item.pass).length, 0, JSON.stringify(checks.filter(item => !item.pass)));
  console.log(JSON.stringify({ complete: phase, output: out, captures: captures.length }));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
