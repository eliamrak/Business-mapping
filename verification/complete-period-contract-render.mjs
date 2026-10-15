import fs from "node:fs/promises";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const start = source.indexOf("await page.goto(new URL");
if (start < 0) throw new Error("Harness setup boundary changed");
const checksSource = String.raw`
Object.assign(workspace.settings, { processingPct: 0, processingFixedPerTransaction: 0, overheadFloorMonthly: 0, overheadFloorOverride: true, ownerPayrollMonthly: 0, ownerPayrollOverride: true, ownerPayrollBurdenPct: 0, defaultInPersonPct: 0, organicClientsPerMonth: 0, collectionDelayMonths: 0, collectionPct: 100, familyW2ClinicianId: null, taxPct: 0, reservePct: 0, distributionPct: 0 });
for (const key of ["budgets", "rooms", "terms", "staffTerms", "campaigns", "events", "allocations", "goals", "fundGoals", "proposals", "focusedPlanAdoptions"]) workspace[key] = [];
context.clinicians = [{ ...context.clinicians[0], label: "Synthetic", sessionRate: 100 }];
context.sessions = [];
context.staff = [];
workspace.clinicians = [];
const day = (date, offset) => new Date(Date.parse(date + "T12:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
const bill = (date, fee, suffix = "") => ({ clientId: "billed-" + date + suffix, clinician: "Synthetic", serviceDate: date, totalFeeCharged: fee, billingCode: "90837", sourceRowHash: "bill-" + date + suffix });
const completeVisits = Array.from({ length: 14 }, (_, i) => attendance("complete-" + i, "Synthetic", day("2026-09-24", i)));
const partialVisits = Array.from({ length: 7 }, (_, i) => Array.from({ length: 35 }, (_, j) => attendance("partial-" + i + "-" + j, "Synthetic", day("2026-10-08", i)))).flat();
snapshots.splice(0, snapshots.length,
  { id: "source-attendance", kind: "attendance", importedAt: today + "T00:00:00Z", sourceHash: "source-attendance", reportCoverage: { start: "2026-09-24", end: today, complete: true }, rows: [...completeVisits, ...partialVisits] },
  { id: "source-billing", kind: "billing", importedAt: today + "T00:00:00Z", sourceHash: "source-billing", reportCoverage: { start: "2026-09-24", end: today, complete: true }, rows: [...Array.from({ length: 14 }, (_, i) => bill(day("2026-09-24", i), 35)), ...Array.from({ length: 7 }, (_, i) => bill(day("2026-10-08", i), 10000))] },
);
const ledger = (suffix, from, through, revenue) => ({ id: uuid(suffix), name: "Synthetic complete report ledger", start: from, end: through, status: "finalized", archived: false, notes: "", sourceAttachmentId: null, revenue, earnedRevenue: revenue, clinicianPay: 0, employerBurden: 0, staffPay: 0, ownerPay: 0, expensesComplete: true });
workspace.periods = [ledger("9801", "2026-09-24", "2026-10-07", 490)];
const originalSources = structuredClone(snapshots);
const writes = [];
await page.route("**/api/**", async (route, request) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { writes.push(request.method() + " " + new URL(request.url()).pathname); return route.abort(); }
  return route.fallback();
});
const bridge = page.locator("section", { has: page.getByRole("heading", { name: "Selected period money bridge", exact: true }) });
const selectRange = async (from, through) => { await page.getByLabel("Shared reporting period", { exact: true }).selectOption("custom"); await page.getByLabel("From", { exact: true }).fill(from); await page.getByLabel("Through", { exact: true }).fill(through); };
const result = { syntheticOnly: true, productionAccess: false, cases: [] };
try {
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  await clickSection("Money"); await selectRange("2026-09-24", "2026-10-14");
  const initial = await bridge.innerText();
  assert.match(await page.locator("main").innerText(), /Forecast estimates begin 2026-10-08/);
  assert.equal(await bridge.locator(".pw-bridge-profit strong").innerText(), "$1,190", "490 complete billed actual plus seven forecast days at card fee 100");
  assert.doesNotMatch(initial, /70,000|35,000/);
  await capture("complete-period-initial-money-desktop", 1280, 900);
  await capture("complete-period-initial-money-mobile", 390, 900);
  await clickSection("Sessions");
  const initialSessions = await page.locator("main").innerText();
  assert.match(initialSessions, /14 eligible sessions · 14 complete-period calendar days/);
  assert.doesNotMatch(initialSessions, /259 eligible sessions/);
  await capture("complete-period-initial-sessions-desktop", 1280, 900);
  await capture("complete-period-initial-sessions-mobile", 390, 900);
  await clickSection("Overview"); await page.getByRole("button", { name: "Open Imports", exact: true }).click();
  const initialImports = await page.locator("main").innerText();
  assert.match(initialImports, /Data covers through[\s\S]*2026-10-07/);
  assert.match(initialImports, /2026-10-08[\s\S]*2026-10-21/);
  await capture("complete-period-initial-imports-desktop", 1280, 900);
  await capture("complete-period-initial-imports-mobile", 390, 900);
  result.cases.push({ name: "partial-current-period-excluded", money: initial, sessions: initialSessions, imports: initialImports });
  assert.deepEqual(snapshots, originalSources, "UI never mutates retained partial source rows");
  snapshots.push(
    { id: "replacement-attendance", kind: "attendance", importedAt: "2026-10-22T00:00:00Z", sourceHash: "replacement-attendance", reportCoverage: { start: "2026-10-08", end: "2026-10-21", complete: true }, rows: Array.from({ length: 14 }, (_, i) => attendance("replacement-" + i, "Synthetic", day("2026-10-08", i))) },
    { id: "replacement-billing", kind: "billing", importedAt: "2026-10-22T00:00:00Z", sourceHash: "replacement-billing", reportCoverage: { start: "2026-10-08", end: "2026-10-21", complete: true }, rows: Array.from({ length: 14 }, (_, i) => bill(day("2026-10-08", i), 50, "-replacement")) },
  );
  workspace.periods.push(ledger("9802", "2026-10-08", "2026-10-21", 700));
  await page.clock.setFixedTime(new Date("2026-10-22T16:00:00Z"));
  await page.reload(); await clickSection("Money"); await selectRange("2026-09-24", "2026-10-28");
  const replacement = await bridge.innerText();
  assert.match(await page.locator("main").innerText(), /Forecast estimates begin 2026-10-22/);
  assert.equal(await bridge.locator(".pw-bridge-profit strong").innerText(), "$1,890", "1190 billed actual plus seven future card-fee days");
  await capture("complete-period-replacement-money-desktop", 1280, 900);
  await capture("complete-period-replacement-money-mobile", 390, 900);
  await clickSection("Sessions");
  const replacementSessions = await page.locator("main").innerText();
  assert.match(replacementSessions, /28 eligible sessions · 28 complete-period calendar days/);
  assert.deepEqual(snapshots.slice(0, 2), originalSources, "full report replaces estimates without deleting original partial imports");
  result.cases.push({ name: "full-report-replaces-forecast", money: replacement, sessions: replacementSessions });
  const verifiedSources = structuredClone(snapshots);
  for (const snapshot of snapshots) delete snapshot.reportCoverage;
  await page.reload(); await clickSection("Overview"); await page.getByRole("button", { name: "Open Imports", exact: true }).click();
  const unverified = await page.locator("main").innerText();
  assert.match(unverified, /Data covers through[\s\S]*[Uu]nverified/);
  await capture("complete-period-unverified-imports-desktop", 1280, 900);
  await capture("complete-period-unverified-imports-mobile", 390, 900);
  result.cases.push({ name: "occupied-dates-not-proof", imports: unverified });
  snapshots.splice(0, snapshots.length, ...verifiedSources);
  context.clinicians.push({ ...context.clinicians[0], id: 2, label: " synthetic " });
  await page.reload(); await clickSection("Overview"); await page.getByRole("button", { name: "Open Imports", exact: true }).click();
  const ambiguous = await page.locator("main").innerText();
  assert.match(ambiguous, /Data covers through[\s\S]*[Uu]nverified/);
  await capture("complete-period-ambiguous-imports-desktop", 1280, 900);
  await capture("complete-period-ambiguous-imports-mobile", 390, 900);
  result.cases.push({ name: "ambiguous-provider-not-first-winner", imports: ambiguous });
  assert.deepEqual(writes, []); assert.deepEqual(browserErrors, []);
  assert.ok(checks.every((check) => check.topNavigation && check.scrollWidth <= check.clientWidth + 1));
  Object.assign(result, { writes, browserErrors, checks });
  await fs.writeFile(path.join(outDir, "complete-period-contract-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ cases: result.cases.map((item) => item.name), captures: checks.length, writes, browserErrors }));
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, start) + checksSource).toString("base64"));
