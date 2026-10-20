// Run only after the author declares the candidate ready. This never uses a deployed URL.
// Optional final rerun: node verification/october19-requirements-render.mjs --candidate-commit=<sha>
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expectedCommit = process.argv.find((arg) => arg.startsWith("--candidate-commit="))?.split("=")[1];
const commit = git("rev-parse", "HEAD").trim();
if (expectedCommit) assert.equal(commit, git("rev-parse", expectedCommit).trim(), "rerun must use the author's exact candidate HEAD");
process.env.PRACTICE_PLAYWRIGHT_PACKAGE ??= "/tmp/practice-oct20-render-deps/package.json";
process.env.PRACTICE_CHROMIUM_PATH ??= "/Users/eliam/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
process.env.PRACTICE_RENDER_OUTPUT ??= await fs.mkdtemp("/tmp/october19-requirements-");
const outDir = path.resolve(process.env.PRACTICE_RENDER_OUTPUT);
await fs.mkdir(outDir, { recursive: true });
const setupFile = path.join(root, "verification/render-practice-workspace.mjs");
const setup = await fs.readFile(setupFile, "utf8");
const setupBoundary = setup.indexOf("await page.goto(new URL");
assert.ok(setupBoundary > 0, "fixture setup boundary exists; old historical assertions must not run");
const workspaceSource = await fs.readFile(path.join(root, "artifacts/comp-dashboard/src/pages/practice-workspace.tsx"), "utf8");
const sourceRequirements = [
  { requirement: "Historical period selection state is removed", forbidden: /\[\s*historicalPeriod\s*,|\bsetHistoricalPeriod\b/ },
  { requirement: "Historical range selector is removed", forbidden: /aria-label=["']Historical performance range["']/ },
  { requirement: "Consultation has no independent contributor controls", forbidden: /aria-label=["']Consult contributor["']/ },
];
for (const check of sourceRequirements) assert.doesNotMatch(workspaceSource, check.forbidden, check.requirement);
const diff = git("diff", "--binary", "HEAD", "--", "artifacts", "lib");
await fs.writeFile(path.join(outDir, "runtime-working-tree.diff"), diff);
const runtimeSources = new Map();
const { build } = createRequire(path.join(root, "artifacts/api-server/package.json"))("esbuild");
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {TooltipProvider} from '@/components/ui/tooltip';import PracticeWorkspace from '@/pages/practice-workspace';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><TooltipProvider><PracticeWorkspace/></TooltipProvider></QueryClientProvider>);`,
    loader: "tsx", resolveDir: path.join(root, "artifacts/comp-dashboard"),
  },
  bundle: true, write: false, metafile: true, platform: "browser", format: "esm", jsx: "automatic",
  alias: { "@": path.join(root, "artifacts/comp-dashboard/src") },
  define: { "process.env.NODE_ENV": '"test"', "import.meta.env": '{"BASE_URL":"/"}' },
  outdir: path.join(outDir, "bundle"),
  plugins: [{ name: "record-current-runtime-source", setup(builder) {
    builder.onLoad({ filter: /\.(?:[cm]?[jt]sx?|css|json)$/ }, async (args) => {
      if (!args.path.startsWith(root + "/artifacts/") && !args.path.startsWith(root + "/lib/")) return;
      if (args.path.includes("/node_modules/")) return;
      const contents = await fs.readFile(args.path);
      runtimeSources.set(path.relative(root, args.path), sha256(contents));
      const extension = path.extname(args.path).slice(1);
      return { contents, loader: { mjs: "js", cjs: "js", mts: "ts", cts: "ts" }[extension] ?? extension, resolveDir: path.dirname(args.path) };
    });
  } }],
});
const javascript = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.contents;
assert.ok(javascript?.length, "candidate JavaScript was built");
// Preserve scaffold utility styles, then overlay current component/page CSS from this build.
const assetDir = path.join(root, "artifacts/comp-dashboard/dist/public/assets");
const builtIndexPath = path.join(root, "artifacts/comp-dashboard/dist/public/index.html");
const builtIndex = await fs.readFile(builtIndexPath, "utf8");
const baseCssReferences = [...builtIndex.matchAll(/href=["'](?:[^"']*\/)?assets\/(index-[^"'/]+\.css)["']/g)].map((match) => match[1]);
assert.equal(baseCssReferences.length, 1, "built index must reference exactly one scaffold utility stylesheet");
const baseCssPath = path.join(assetDir, baseCssReferences[0]);
const baseCss = await fs.readFile(baseCssPath);
const currentCss = bundle.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => Buffer.from(file.contents));
const css = Buffer.concat([baseCss, Buffer.from("\n/* Current candidate component styles */\n"), ...currentCss]);
await fs.writeFile(path.join(outDir, "candidate-bundle.js"), javascript);
await fs.writeFile(path.join(outDir, "candidate-styles.css"), css);
await fs.writeFile(path.join(outDir, "bundle-metafile.json"), JSON.stringify(bundle.metafile, null, 2));
const provenance = {
  commit, tree: git("rev-parse", "HEAD^{tree}").trim(), expectedCommit: expectedCommit ?? null,
  status: git("status", "--short"), runtimeDiffSha256: sha256(diff),
  untrackedRuntimeFiles: git("ls-files", "--others", "--exclude-standard", "--", "artifacts", "lib").trim().split("\n").filter(Boolean),
  runtimeDiffFile: "runtime-working-tree.diff", fixtureSetupSha256: sha256(setup),
  harnessSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
  browserPath: process.env.PRACTICE_CHROMIUM_PATH, playwrightPackage: process.env.PRACTICE_PLAYWRIGHT_PACKAGE,
  javascriptSha256: sha256(javascript), servedCssSha256: sha256(css),
  scaffoldUtilityCss: { path: path.relative(root, baseCssPath), sha256: sha256(baseCss) },
  scaffoldBuiltIndexSha256: sha256(builtIndex),
  currentComponentCss: true, runtimeSources: Object.fromEntries([...runtimeSources].sort()),
  sourceRequirements: sourceRequirements.map(({ requirement }) => ({ requirement, passed: true })),
  acceptanceBasis: "Captured working-tree sources and served bundle; HEAD alone is not candidate certification",
};
await fs.writeFile(path.join(outDir, "runtime-hash-manifest.json"), JSON.stringify(provenance, null, 2));
const server = http.createServer((req, res) => {
  if (req.method !== "GET") { res.writeHead(405); return res.end(); }
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(javascript); }
  if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
  if (req.url !== "/workspace" && req.url !== "/") { res.writeHead(404); return res.end(); }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/workspace`;

const requirements = String.raw`
const requests = [], blockedExternal = [], attemptedWrites = [], screenshots = [], requirements = [], helpChecks = [], teamBounds = [];
const requireCheck = (requirement, evidence) => requirements.push({ requirement, evidence });
page.setDefaultTimeout(15000);
await page.route('**/*', async (route) => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== new URL(FIXTURE_URL).origin) { blockedExternal.push(url.origin); return route.abort(); }
  requests.push({ method: request.method(), path: url.pathname });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { attemptedWrites.push(request.method() + ' ' + url.pathname); return route.abort(); }
  return route.fallback();
});
const frozenSource = { context: structuredClone(context), workspace: structuredClone(workspace) };
// Distinguishable synthetic closer cohorts prove scope follows the Sessions control.
snapshots[0].rows.push(
  attendance('oct19-elia-close', 'Elia', '2026-07-03', true),
  attendance('oct19-elia-close', 'Elia', '2026-07-10'),
  attendance('oct19-elia-close', 'Elia', '2026-07-17'),
  attendance('oct19-elia-close', 'Elia', '2026-07-24'),
  attendance('oct19-erin-close', 'Erin', '2026-08-03', true),
  attendance('oct19-erin-close', 'Erin', '2026-08-10'),
  attendance('oct19-erin-close', 'Erin', '2026-08-17'),
  attendance('oct19-erin-close', 'Erin', '2026-08-24'),
  attendance('oct19-erin-miss', 'Erin', '2026-08-04', true),
  attendance('oct19-pending', 'Elia', '2026-10-12', true),
);
const sourceSnapshots = structuredClone(snapshots);
const expectedRanges = {
  '3mo': { start: '2026-07-01', end: '2026-09-30', label: 'Trailing 3 months' },
  year: { start: '2025-10-01', end: '2026-09-30', label: 'Trailing year' },
};
async function noHistorySelector(scope) {
  assert.equal(await scope.getByRole('button', { name: /^Trailing (?:3 months|year)$/ }).count(), 0, 'historical periods are simultaneous, not buttons');
  assert.equal(await scope.getByLabel('Historical performance range', { exact: true }).count(), 0, 'removed historical selector stays absent');
  assert.equal(await scope.locator('select').evaluateAll(nodes => nodes.filter(node => [...node.options].some(option => /^Trailing (3 months|year)$/.test(option.textContent.trim()))).length), 0, 'no historical period dropdown');
}
async function pairedHistory(scope, name) {
  const group = scope.locator('.pw-historical-period-values');
  assert.equal(await group.count(), 1, name + ': one paired history belongs to this metric');
  for (const [period, range] of Object.entries(expectedRanges)) {
    const column = group.locator(':scope > [data-period="' + period + '"]');
    assert.equal(await column.count(), 1, name + ': unique ' + period + ' column');
    assert.ok(await column.isVisible(), name + ': ' + period + ' is visible without a toggle');
    await column.getByRole('heading', { name: range.label, exact: true }).waitFor();
    assert.deepEqual(await column.locator('.pw-historical-period-dates time').evaluateAll(nodes => nodes.map(node => ({ date: node.dateTime, text: node.textContent }))), [{ date: range.start, text: range.start }, { date: range.end, text: range.end }], name + ': exact calendar dates');
    assert.ok((await column.locator('.pw-historical-period-main').innerText()).trim(), name + ': value or explicit unknown');
  }
  const layout = await group.locator(':scope > [data-period]').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom }; }));
  assert.ok(layout.every(box => box.right > box.x && box.bottom > box.y), name + ': both columns have area');
  assert.ok(layout[0].right <= layout[1].x + 1 || layout[0].bottom <= layout[1].y + 1, name + ': periods do not overlap');
  await noHistorySelector(scope);
  return await group.innerText();
}
async function captureRequirements(name, width, targets = []) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(name, width, 900);
  const check = checks.at(-1);
  assert.ok(check.topNavigation, name + ': navigation is within viewport without overlapping content');
  assert.ok(check.scrollWidth <= check.clientWidth + 1, name + ': no horizontal overflow');
  const image = await fs.readFile(path.join(outDir, name + '-' + width + '.png'));
  const pixels = await page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 80;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 80, 80);
    const data = context.getImageData(0, 0, 80, 80).data, colors = new Map();
    for (let i = 0; i < data.length; i += 4) { const key = [data[i], data[i + 1], data[i + 2]].map(n => Math.floor(n / 16)).join(','); colors.set(key, (colors.get(key) ?? 0) + 1); }
    return { sampledPixels: 6400, quantizedColors: colors.size, dominantColorFraction: Math.max(...colors.values()) / 6400 };
  }, image.toString('base64'));
  assert.ok(pixels.quantizedColors > 16 && pixels.dominantColorFraction < 0.995, name + ': screenshot pixels are nonblank');
  screenshots.push({ file: name + '-' + width + '.png', pixels });
  for (const [targetName, locator] of targets) {
    await locator.screenshot({ path: path.join(outDir, name + '-' + targetName + '-' + width + '.png') });
  }
}
function consultation() { return page.locator('section.pw-metric-panel').filter({ has: page.getByRole('heading', { name: 'Close rate', exact: true }) }); }
async function assertConsultScope(name) {
  const panel = consultation();
  assert.equal(await panel.count(), 1, 'one consultation panel');
  assert.match(await panel.innerText(), new RegExp(name + '.*(?:Selected activity dates:|Overall recorded activity through)'));
  assert.doesNotMatch(await panel.innerText(), /0000-01-01|9999-12-31/, 'primary consultation caption never exposes open-bound sentinels');
  assert.equal(await page.getByRole('group', { name: 'Consult contributor', exact: true }).count(), 0, 'no independent Consult contributor group');
  assert.equal(await panel.getByRole('button', { name: /Whole Practice|Compare|Elia|Erin/ }).count(), 0, 'no duplicate contributor or Compare buttons below scroll');
  assert.equal(await panel.locator('.pw-metric-hero').count(), 0, 'consultation has no oversized hero');
  for (const label of ['Consultations', 'Close rate']) assert.ok(await panel.locator('dt').filter({ hasText: new RegExp('^' + label + '$') }).isVisible());
  assert.match(await panel.locator(':scope > p.pw-note').first().innerText(), /pending/);
  const help = panel.locator('details').filter({ has: page.locator('summary', { hasText: /^How these numbers are calculated$/ }) });
  assert.equal(await help.getAttribute('open'), null, 'methodology starts collapsed');
  return panel;
}
async function clickWithoutJump(button) {
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  const before = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await button.click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  assert.ok(Math.abs(before.x - after.x) <= 1 && Math.abs(before.y - after.y) <= 2, 'top contributor/Compare action must not jump scroll');
}
async function reviewRows(panel) {
  const disclosure = panel.locator('details.pw-consult-resolution');
  await disclosure.locator(':scope > summary').click();
  const rows = await disclosure.locator('.pw-consult-resolution-row > div:first-child > strong').allTextContents();
  await disclosure.locator(':scope > summary').click();
  return rows;
}
async function assertHelpInteractions(section, width) {
  const help = page.locator('.pw-heading-help, details').filter({ has: page.locator(':scope > summary[aria-label^="About "], :scope > summary[aria-label="Reporting period help"]') });
  for (const disclosure of await help.all()) {
    const summary = disclosure.locator(':scope > summary');
    if (!await summary.isVisible()) continue;
    const label = await summary.getAttribute('aria-label');
    assert.equal(await disclosure.getAttribute('open'), null, label + ': help is collapsed by default');
    assert.ok((await summary.getAttribute('title'))?.trim(), label + ': hover has short help');
    assert.equal(await disclosure.locator(':scope > p').isVisible(), false, label + ': description is not always visible');
    await summary.focus(); await page.keyboard.press('Enter');
    assert.equal(await disclosure.getAttribute('open'), '', label + ': Enter opens help');
    assert.ok(await disclosure.locator(':scope > p').isVisible(), label + ': keyboard reveals description');
    await page.keyboard.press('Space');
    assert.equal(await disclosure.getAttribute('open'), null, label + ': Space closes help');
    if (width === 390) { await summary.tap(); assert.equal(await disclosure.getAttribute('open'), '', label + ': mobile tap opens help'); await summary.tap(); }
    else { await summary.click(); assert.equal(await disclosure.getAttribute('open'), '', label + ': click opens help'); await summary.click(); }
    assert.equal(await disclosure.getAttribute('open'), null, label + ': pointer closes help');
    helpChecks.push({ section, width, label, keyboard: true, pointer: width === 390 ? 'tap' : 'click', defaultCollapsed: true });
  }
}
export let evidence;
try {
  await page.goto(FIXTURE_URL);
  await clickSection('Sessions');
  await noHistorySelector(page.locator('.pw-main'));
  const retention = page.getByLabel('Retention card', { exact: true });
  const attrition = page.getByLabel('Attrition card', { exact: true });
  const contributor = page.getByRole('group', { name: 'Sessions contributor', exact: true });
  const historiesBefore = [await pairedHistory(retention, 'Sessions retention'), await pairedHistory(attrition, 'Sessions attrition')];
  for (const period of ['year', '30d']) {
    await page.getByLabel('Shared reporting period', { exact: true }).selectOption(period);
    assert.deepEqual([await pairedHistory(retention, 'Sessions retention'), await pairedHistory(attrition, 'Sessions attrition')], historiesBefore, 'activity period must not change either historical calendar or metrics');
  }
  await page.getByLabel('Shared reporting period', { exact: true }).selectOption('overall');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await clickWithoutJump(contributor.getByRole('button', { name: 'Elia', exact: true }));
    const elia = await assertConsultScope('Elia');
    const eliaCounts = await elia.locator('dl').innerText();
    const eliaRows = await reviewRows(elia);
    assert.ok(eliaRows.includes('oct19-elia-close') && !eliaRows.includes('oct19-erin-close'), 'Elia review table includes relevant evidence and excludes Erin-only evidence');
    await clickWithoutJump(contributor.getByRole('button', { name: 'Erin', exact: true }));
    const erin = await assertConsultScope('Erin');
    const erinRows = await reviewRows(erin);
    assert.ok(erinRows.includes('oct19-erin-close') && !erinRows.includes('oct19-elia-close'), 'Erin review table includes relevant evidence and excludes Elia-only evidence');
    assert.ok(erinRows.includes('converted'), 'candidate treatment clinician retains actionable evidence from a different consult clinician');
    assert.notEqual(await erin.locator('dl').innerText(), eliaCounts, 'synthetic consultations change with top contributor');
    await clickWithoutJump(contributor.getByRole('button', { name: 'Compare', exact: true }));
    await erin.getByLabel('Consult metric comparison', { exact: true }).waitFor();
    const comparedRows = await reviewRows(erin);
    assert.ok(comparedRows.includes('oct19-elia-close') && comparedRows.includes('oct19-erin-close'), 'Compare retains all practice attribution evidence');
    await pairedHistory(retention, 'Sessions retention comparison');
    await pairedHistory(attrition, 'Sessions attrition comparison');
    await captureRequirements('sessions-compared', width, [['consultation', erin], ['retention', retention], ['attrition', attrition]]);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    assert.equal(await page.getByRole('group', { name: 'Consult contributor', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Compare with Whole Practice', exact: true }).count(), 0);
    await clickWithoutJump(contributor.getByRole('button', { name: 'Compare', exact: true }));
    const help = erin.locator('details').filter({ has: page.locator('summary', { hasText: /^How these numbers are calculated$/ }) });
    await help.locator('summary').focus(); await page.keyboard.press('Enter');
    assert.equal(await help.getAttribute('open'), '', 'calculation help works by keyboard');
    await help.locator('summary').click();
    assert.equal(await help.getAttribute('open'), null, 'calculation help also works by pointer/tap');
    await captureRequirements('sessions-individual', width, [['consultation', erin]]);
    await clickWithoutJump(contributor.getByRole('button', { name: 'Whole Practice', exact: true }));
    const practiceRows = await reviewRows(await assertConsultScope('Whole Practice'));
    assert.ok(practiceRows.includes('oct19-elia-close') && practiceRows.includes('oct19-erin-close'), 'Whole Practice retains all attribution evidence');
  }
  requireCheck('6, 7, 8, 10, 11: Sessions simultaneous histories, shared consultation scope, compact summary and disclosure', { historiesBefore, activityScopeIndependent: true, duplicateConsultControls: false, scrollStable: true });

  await clickSection('Team');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['Elia', 'Erin']) {
      const person = page.locator('article.pw-person').filter({ has: page.getByRole('heading', { name, exact: true }) });
      assert.equal(await person.count(), 1, name + ': existing clinician card remains available');
      for (const label of ['Retention', 'Average monthly attrition', 'Confirmed close']) {
        const metric = person.locator('.pw-person-kpis > div').filter({ has: page.locator(':scope > span', { hasText: new RegExp('^' + label + '$') }) });
        await pairedHistory(metric, 'Team ' + name + ' ' + label);
      }
    }
    await noHistorySelector(page.locator('.pw-main'));
    const bounds = await page.locator('article.pw-person .pw-percentage-kpi').evaluateAll(figures => figures.map(figure => {
      const rectangle = node => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; };
      const region = figure.closest('.pw-historical-period-value');
      const ring = figure.querySelector('.pw-percentage-kpi-ring');
      const label = figure.querySelector('.pw-percentage-kpi-label');
      const value = figure.querySelector('.pw-percentage-kpi-value');
      const range = document.createRange(); range.selectNodeContents(value);
      const text = range.getBoundingClientRect();
      const legend = figure.querySelector('.pw-percentage-kpi-legend strong');
      return { clinician: figure.closest('article').querySelector('h3').textContent, period: region.dataset.period,
        label: label.textContent, region: rectangle(region), ring: rectangle(ring), caption: rectangle(label),
        valueText: { left: text.left, right: text.right, top: text.top, bottom: text.bottom, width: text.width },
        legendFontSize: legend ? Number.parseFloat(getComputedStyle(legend).fontSize) : null };
    }));
    await fs.writeFile(path.join(outDir, 'team-bounds-' + width + '.json'), JSON.stringify(bounds, null, 2));
    await captureRequirements('team-histories', width);
    for (const bound of bounds) {
      assert.ok(bound.ring.left >= bound.region.left - 1 && bound.ring.right <= bound.region.right + 1, 'Team circle fits its own period region');
      assert.ok(bound.caption.bottom <= bound.ring.top + 1, 'Team caption does not overlap its circle');
      assert.ok(bound.valueText.left >= bound.ring.left - 1 && bound.valueText.right <= bound.ring.right + 1 && bound.valueText.top >= bound.ring.top - 1 && bound.valueText.bottom <= bound.ring.bottom + 1, 'Team percentage text fits within its circle');
      assert.ok(bound.legendFontSize === null || bound.legendFontSize <= 12, 'Team benchmark legend retains compact font size');
    }
    teamBounds.push({ width, figures: bounds });
  }
  requireCheck('14: each Team historical metric has its own simultaneous 3-month/year values', { clinicians: ['Elia', 'Erin'], metrics: ['Retention', 'Average monthly attrition', 'Confirmed close'], expectedRanges });

  await clickSection('Overview');
  const overviewContributor = page.getByRole('group', { name: 'Overview contributor', exact: true });
  await overviewContributor.getByRole('button', { name: 'Whole Practice', exact: true }).click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const label of ['Overview initial retention', 'Overview consult conversion', 'Overview average monthly attrition']) await pairedHistory(page.getByLabel(label, { exact: true }), label);
    await noHistorySelector(page.locator('.pw-main'));
    for (const label of ['Overview financial summary', 'Overview combined funding progress']) assert.equal(await page.getByLabel(label, { exact: true }).count(), 0, label + ': removed Overview card does not return');
    for (const name of ['Current team financial estimate', 'Named goal status']) assert.equal(await page.getByRole('heading', { name, exact: true }).count(), 0, name + ': removed heading does not return');
    const surplus = page.getByLabel('Overview monthly surplus', { exact: true });
    assert.ok(await surplus.isVisible(), 'simple monthly surplus remains');
    assert.match(await surplus.innerText(), /monthly surplus|Surplus before unconfigured marketing/i);
    const funnel = page.getByLabel('Overview consult conversion', { exact: true });
    for (const period of Object.keys(expectedRanges)) {
      const column = funnel.locator('[data-period="' + period + '"]');
      assert.match(await column.innerText(), /consultations\s*→\s*\d[\d,]* started treatment/, 'funnel names consultation-to-attended-treatment evidence');
      await column.locator('summary').click();
      assert.match(await column.innerText(), /attended qualifying treatment visit.*not completed onboarding or a booking/, 'definition distinguishes attended treatment from booking/onboarding');
      await column.locator('summary').click();
    }
    const ending = page.getByLabel('Overview average monthly attrition', { exact: true });
    assert.match(await ending.innerText(), /clients/);
    for (const period of Object.keys(expectedRanges)) {
      const column = ending.locator('[data-period="' + period + '"]');
      assert.match((await column.locator('.pw-historical-period-main > span').innerText()).trim(), /^(?:--%?|Unknown)$/, 'immature whole-window fixture must stay unknown');
      assert.match(await column.locator('.pw-historical-period-main > strong').innerText(), /-- clients/, 'mature-month subset must not masquerade as the whole-window count');
      await column.locator('summary').click();
      assert.match(await column.innerText(), /unique observed established clients|full window has not reached 90 days/);
      await column.locator('summary').click();
    }
    const capacity = page.getByLabel('Overview desired session utilization', { exact: true });
    await pairedHistory(capacity, 'Overview desired caseload');
    for (const period of Object.keys(expectedRanges)) {
      const column = capacity.locator('[data-period="' + period + '"]');
      const actualDesired = await column.locator('.pw-historical-period-detail > span').innerText();
      const match = actualDesired.match(/^([\d,.]+|--) actual \/ ([\d,.]+|--) desired sessions per week$/);
      assert.ok(match, 'capacity compares actual weekly sessions with desired weekly sessions');
      const utilization = await column.locator('.pw-historical-period-main').innerText();
      assert.match(utilization, /full$/, 'desired utilization is labeled percent full');
      if (match[1] === '--' || match[2] === '--' || Number(match[2].replaceAll(',', '')) === 0) assert.match(utilization, /^--%? full$/, 'unknown or zero desired denominator cannot manufacture percent full');
      else {
        const displayedRate = Number(utilization.replace('% full', '').replaceAll(',', ''));
        const approximateRate = Number(match[1].replaceAll(',', '')) / Number(match[2].replaceAll(',', '')) * 100;
        assert.ok(Math.abs(displayedRate - approximateRate) < 1, 'displayed percent full agrees with displayed weekly values within rounding');
      }
      assert.match(await column.locator('.pw-historical-period-detail > small').innerText(), /Desired caseload unknown|Current desired-caseload assumption|Dated desired-caseload assumptions/, 'desired capacity basis is disclosed');
      assert.equal(await column.locator('details').getAttribute('open'), null, 'capacity methodology starts collapsed');
      await column.locator('summary').click();
      assert.ok((await column.locator('details').innerText()).includes('assumption') || (await column.locator('details').innerText()).includes('unknown'), 'capacity coverage and historical assumptions remain available');
      await column.locator('summary').click();
    }
    await captureRequirements('overview-histories', width, [['funnel', funnel], ['surplus', surplus], ['capacity', capacity]]);
  }
  requireCheck('15, 16, 17, 18: Overview histories, honest attrition units, explicit consult funnel and simple surplus', { removedFinancialAndNamedGoalCards: true, noProductionNumberExplanation: true });
  requireCheck('20, 21: desired-caseload comparison uses both calendar histories, actual/desired weekly sessions, percent full and disclosed assumptions', { expectedRanges, unsupportedRatesStayUnknown: true });

  // Exercise the established top destinations at both viewport widths, not only desktop helper navigation.
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const navigation = page.getByRole('navigation', { name: 'Practice sections', exact: true });
    for (const name of ['Sessions', 'Team', 'Money', 'Growth', 'Goals', 'Overview']) {
      await navigation.getByRole('button', { name: new RegExp('\\b' + name + '$') }).click();
      await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
      await assertHelpInteractions(name, width);
      if (name === 'Money') {
        const targetTitle = page.getByText('Targets and fund balances', { exact: true });
        await targetTitle.waitFor();
        const targets = targetTitle.locator('xpath=ancestor::*[self::section or self::details][1]');
        if (await targets.evaluate(node => node.tagName === 'DETAILS' && !node.open)) await targets.locator(':scope > summary').click();
        assert.equal(await targets.locator('.pw-goal-editor').count(), 1, 'Money colocates the named goal editor under targets and fund balances');
        await captureRequirements('money-targets-and-help', width);
      }
      if (name === 'Goals') await captureRequirements('goals-overflow-and-help', width);
    }
    await captureRequirements('overview-after-navigation', width);
  }
  assert.deepEqual(context, frozenSource.context, 'fixture clinician/context facts unchanged');
  assert.deepEqual(workspace, frozenSource.workspace, 'read-only UI checks do not change fixture goals/settings');
  assert.deepEqual(snapshots, sourceSnapshots, 'source evidence is never mutated by the UI');
  assert.deepEqual(attemptedWrites, [], 'no API writes are allowed');
  for (const width of [1280, 390]) assert.ok(helpChecks.some(check => check.width === width && check.label.startsWith('About ')), 'generic heading descriptions have tested keyboard and pointer help at each size');
  const allowedAuthErrors = browserErrors.filter(error => error.includes('Clerk: Failed to load Clerk JS') && error.includes('clerk.127.0.0.1'));
  assert.deepEqual(browserErrors.filter(error => !allowedAuthErrors.includes(error)), [], 'no application exceptions');
  evidence = { syntheticOnly: true, productionAccess: false, requirements, expectedRanges, requests, blockedExternal, attemptedWrites, browserErrors, allowedAuthErrors, screenshots, checks, helpChecks, teamBounds, sourceFactsUnchanged: true,
    verifiedDisplayOnly: ['Recent whole-window attrition is unknown in this immature fixture; separate numerical and SSR fixtures cover mature unique-client count/percentage capability'],
    pendingAcceptance: [
      'Actual whole-window attrition needs matching observation coverage and the explicit observed-established cohort; recent immature windows remain unknown',
      'Actual protected-payroll recipient and mapping require a read-only production investigation',
      'Installed and running macOS application acceptance remains unverified; isolated browser checks do not establish native acceptance',
      'Actual repeated-4 / 43 records require a source trace; synthetic fixtures do not explain those production numbers',
    ] };
} finally { await browser.close(); }
`;

try {
  const pageSetup = 'const page = await browser.newPage({ viewport:';
  assert.ok(setup.slice(0, setupBoundary).includes(pageSetup), 'fixture page setup must support isolated touch testing');
  const fixtureSetup = setup.slice(0, setupBoundary).replace(pageSetup, 'const page = await browser.newPage({ hasTouch: true, viewport:');
  const moduleSource = fixtureSetup + "\nconst FIXTURE_URL = " + JSON.stringify(fixtureUrl) + ";\n" + requirements;
  const { evidence } = await import("data:text/javascript;base64," + Buffer.from(moduleSource).toString("base64"));
  await fs.writeFile(path.join(outDir, "browser-results.json"), JSON.stringify({ provenance, ...evidence, runtimeStabilityPending: true }, null, 2));
  for (const [file, hash] of runtimeSources) assert.equal(sha256(await fs.readFile(path.join(root, file))), hash, file + ": runtime changed during verification; rerun the final candidate");
  assert.equal(git("rev-parse", "HEAD").trim(), commit, "HEAD changed during verification; rerun the author's final candidate");
  assert.equal(sha256(await fs.readFile(setupFile)), provenance.fixtureSetupSha256, "fixture scaffold changed during verification");
  assert.equal(sha256(await fs.readFile(baseCssPath)), provenance.scaffoldUtilityCss.sha256, "scaffold utility CSS changed during verification");
  assert.equal(sha256(await fs.readFile(builtIndexPath)), provenance.scaffoldBuiltIndexSha256, "scaffold built index changed during verification");
  assert.equal(sha256(await fs.readFile(fileURLToPath(import.meta.url))), provenance.harnessSha256, "verification harness changed during execution");
  assert.equal(git("diff", "--binary", "HEAD", "--", "artifacts", "lib"), diff, "runtime diff changed during verification");
  const screenshotHashes = Object.fromEntries(await Promise.all((await fs.readdir(outDir)).filter((file) => file.endsWith(".png")).sort().map(async (file) => [file, sha256(await fs.readFile(path.join(outDir, file)))])));
  const result = { provenance, ...evidence, screenshotHashes, runtimeStableDuringRun: true, finalCommittedCandidate: Boolean(expectedCommit) && diff === "" && provenance.untrackedRuntimeFiles.length === 0, fullOctober19Acceptance: false };
  await fs.writeFile(path.join(outDir, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ outDir, passed: true, requirements: evidence.requirements, screenshots: evidence.screenshots.length, finalCommittedCandidate: result.finalCommittedCandidate, pendingAcceptance: evidence.pendingAcceptance }, null, 2));
} catch (error) {
  const failure = { provenance, passed: false, error: String(error.stack ?? error).split("data:text/javascript")[0] };
  await fs.writeFile(path.join(outDir, "failure.json"), JSON.stringify(failure, null, 2));
  console.error(JSON.stringify({ outDir, passed: false, error: failure.error }, null, 2));
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
