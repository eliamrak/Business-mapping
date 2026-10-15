import fs from "node:fs/promises";
import { practiceScaleFixture } from "./practice-scale-fixture.ts";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const boundary = source.indexOf("await page.goto(new URL");
if (boundary < 0) throw new Error("Shared harness boundary changed");
const data = JSON.stringify(practiceScaleFixture());
const checksSource = `const scale = ${data};\n` + String.raw`
Object.assign(workspace, scale.workspace);
Object.assign(context, scale.context);
snapshots.splice(0, snapshots.length, ...scale.snapshots);
const original = JSON.stringify({ workspace, context, snapshots, declarations: scale.declarations });
const writes = [];
await page.addInitScript(() => {
  window.__scaleFinancialCalls = 0;
  window.__scaleLongTasks = [];
  new PerformanceObserver((list) => window.__scaleLongTasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration })))).observe({ type: "longtask", buffered: true });
});
await page.route("**/src/lib/practice-financial-range.ts*", async (route) => {
  const response = await route.fetch();
  const text = await response.text();
  const instrumented = text.replace(/(export function practiceFinancialRange\([^]*?\) \{)/, "$1\n globalThis.__scaleFinancialCalls = (globalThis.__scaleFinancialCalls ?? 0) + 1;");
  assert.notEqual(instrumented, text, "Financial report instrumentation must attach");
  await route.fulfill({ response, body: instrumented });
});
await page.route("**/api/**", async (route, request) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { writes.push(new URL(request.url()).pathname); return route.abort(); }
  return route.fallback();
});
await page.route("**/api/practice-imports", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ snapshots, packages, billingCodeMinutes: {}, sameDayVisitOverrides: {}, declarations: { revision: 1, data: scale.declarations, confirmedAt: today + "T00:00:00Z" } }) }));
const navigation = [];
try {
  const begin = performance.now();
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  await page.locator('nav[aria-label="Practice sections"]').waitFor();
  await page.waitForLoadState("networkidle");
  const initialReadyMs = Math.round(performance.now() - begin);
  const initialCalls = await page.evaluate(() => window.__scaleFinancialCalls);
  assert.ok(initialCalls > 0);
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => window.__scaleFinancialCalls), initialCalls, "Idle state must not loop through financial calculations");
  for (const label of ["Sessions", "Team", "Money", "Growth", "Goals", "Overview"]) {
    const start = performance.now();
    await clickSection(label);
    await page.locator("h1").innerText({ timeout: 3000 });
    navigation.push({ label, elapsedMs: Math.round(performance.now() - start) });
  }
  assert.equal(await page.evaluate(() => window.__scaleFinancialCalls), initialCalls, "Tab navigation must not rebuild unchanged financial reports");
  await capture("scale-overview-desktop", 1280, 900);
  await capture("scale-overview-mobile", 390, 900);
  await clickSection("Sessions");
  await page.getByText("Import details", { exact: true }).click();
  const details = await page.locator(".pw-session-import-details").innerText();
  assert.match(details, /0 partial-overlap/);
  assert.doesNotMatch(details, /full-window total remains unknown/);
  await capture("scale-sessions-desktop", 1280, 900);
  await capture("scale-sessions-mobile", 390, 900);
  await page.getByLabel("Shared reporting period", { exact: true }).selectOption("year");
  await page.waitForLoadState("networkidle");
  assert.ok(await page.evaluate(() => window.__scaleFinancialCalls) > initialCalls, "Period edits must invalidate financial reports");
  assert.ok(navigation.every((row) => row.elapsedMs < 3000), "Each navigation must remain responsive");
  assert.ok(checks.every((row) => row.scrollWidth <= row.clientWidth + 1));
  assert.deepEqual(writes, []);
  assert.equal(JSON.stringify({ workspace, context, snapshots, declarations: scale.declarations }), original);
  assert.deepEqual(browserErrors.filter((error) => !error.includes("Clerk: Failed to load Clerk JS")), []);
  const performanceState = await page.evaluate(() => ({ financialCalls: window.__scaleFinancialCalls, longTasks: window.__scaleLongTasks }));
  const result = { syntheticOnly: true, productionAccess: false, attendanceRows: 4300, billingRows: 3293, manualRecords: 107,
    initialReadyMs, initialFinancialCalls: initialCalls, navigation, ...performanceState, captures: checks.length, automaticWrites: writes.length, sourceFactsUnchanged: true, checks };
  await fs.writeFile(path.join(outDir, "scale-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ initialReadyMs, initialFinancialCalls: initialCalls, navigation, finalFinancialCalls: performanceState.financialCalls, captures: checks.length, automaticWrites: writes.length, outDir }));
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, boundary) + checksSource).toString("base64"));
