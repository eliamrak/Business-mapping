import fs from "node:fs/promises";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const boundary = source.indexOf("await page.goto(new URL");
if (boundary < 0) throw new Error("Shared harness setup boundary changed");
const checksSource = String.raw`
context.clinicians = [{ ...context.clinicians[0], sessionRate: 100 }]; context.sessions = []; context.staff = [];
workspace.clinicians = []; workspace.terms = []; workspace.staffTerms = [];
Object.assign(workspace.settings, { defaultInPersonPct: 0, familyW2ClinicianId: null });
const period = { start: "2026-10-08", end: "2026-10-21", complete: true };
const sourceFor = (kind, hash, rows) => ({ id: kind + "-" + hash, kind, sourceHash: hash, importedAt: "2026-10-22T00:00:00Z",
  reportCoverage: period, coverageStart: rows.map(row => row.serviceDate).sort()[0], coverageEnd: rows.map(row => row.serviceDate).sort().at(-1),
  rows: rows.map((row, index) => ({ ...row, clinician: "Elia", sourceRowHash: hash + "-" + index })) });
const visit = (clientId, serviceDate, status = "show") => ({ clientId, serviceDate, status, location: null });
const fee = (clientId, serviceDate, totalFeeCharged) => ({ clientId, serviceDate, totalFeeCharged, billingCode: "90837" });
snapshots.splice(0, snapshots.length,
  sourceFor("attendance", "aaaaaaaa", [visit("repeat", "2026-10-10")]),
  sourceFor("attendance", "bbbbbbbb", [visit("next", "2026-10-11"), visit("repeat", "2026-10-10")]),
  sourceFor("billing", "cccccccc", [fee("repeat", "2026-10-10", 100)]),
  sourceFor("billing", "dddddddd", [fee("next", "2026-10-11", 50), fee("repeat", "2026-10-10", 100)]),
);
const before = structuredClone(snapshots), writes = [];
await page.clock.setFixedTime(new Date("2026-10-22T16:00:00Z"));
await page.route("**/api/**", async (route, request) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { writes.push(request.method() + " " + new URL(request.url()).pathname); return route.abort(); }
  return route.fallback();
});
const imports = async () => { await clickSection("Overview"); await page.getByRole("button", { name: "Open Imports", exact: true }).click(); };
const selectRange = async () => { await page.getByLabel("Shared reporting period", { exact: true }).selectOption("custom"); await page.getByLabel("From", { exact: true }).fill(period.start); await page.getByLabel("Through", { exact: true }).fill(period.end); };
const chargedValue = () => page.getByText("Charged fees (all codes)", { exact: true }).locator("..").locator("strong");
try {
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  await clickSection("Sessions"); await selectRange();
  const identicalSessions = await page.locator("main").innerText();
  assert.match(identicalSessions, /2 eligible sessions · 14 complete-period calendar days/);
  await capture("october-identical-sessions-desktop", 1280, 900); await capture("october-identical-sessions-mobile", 390, 900);
  await imports();
  assert.equal(await chargedValue().innerText(), "$150.00");
  await capture("october-identical-imports-desktop", 1280, 900); await capture("october-identical-imports-mobile", 390, 900);
  snapshots.push(sourceFor("attendance", "eeeeeeee", [visit("next", "2026-10-11"), visit("repeat", "2026-10-10", "cancelled")]),
    sourceFor("billing", "ffffffff", [fee("repeat", "2026-10-10", 125)]));
  await page.reload(); await clickSection("Sessions"); await selectRange();
  await page.getByText("Import details", { exact: true }).click();
  const changedSessions = await page.locator("main").innerText();
  assert.match(changedSessions, /--? eligible sessions · 0 complete-period calendar days/);
  assert.match(changedSessions, /attendance status conflicts retained for reconciliation/);
  await capture("october-correction-sessions-desktop", 1280, 900); await capture("october-correction-sessions-mobile", 390, 900);
  await imports();
  assert.match(await page.locator("main").innerText(), /1 conflicting attendance status groups/);
  assert.doesNotMatch(await chargedValue().innerText(), /\$/);
  await page.getByText("Matching diagnostics", { exact: true }).click();
  assert.match(await page.locator("main").innerText(), /Conflicting attendance statuses/);
  await capture("october-correction-imports-desktop", 1280, 900); await capture("october-correction-imports-mobile", 390, 900);
  assert.deepEqual(snapshots.slice(0, 4), before, "Original source rows, fees, statuses, hashes and proof remain untouched");
  assert.deepEqual(writes, []); assert.deepEqual(browserErrors, []);
  assert.ok(checks.every(check => check.topNavigation && check.scrollWidth <= check.clientWidth + 1));
  const result = { syntheticOnly: true, productionAccess: false, captures: checks.length, identicalSessions, changedSessions, writes, browserErrors, sourceFactsUnchanged: true, checks };
  await fs.writeFile(path.join(outDir, "october-overlap-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ captures: checks.length, duplicateFees: 150, correctedFeesUnknown: true, correctedAttendanceUnknown: true, writes, browserErrors, sourceFactsUnchanged: true }));
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, boundary) + checksSource).toString("base64"));
