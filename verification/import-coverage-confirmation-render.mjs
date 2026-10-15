import fs from "node:fs/promises";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const boundary = source.indexOf("await page.goto(new URL");
if (boundary < 0) throw new Error("Shared harness setup boundary changed");
const checksSource = String.raw`
const proof = { start: "2026-01-01", end: "2026-01-14", complete: true };
const makeSource = (kind, hash, clinician, dates) => ({ id: kind + "-" + hash, kind, sourceHash: hash,
  importedAt: today + "T12:00:00Z", coverageStart: dates[0], coverageEnd: dates.at(-1), reportCoverage: null,
  rows: dates.map((serviceDate, index) => ({ clientId: "synthetic-" + hash + index, clinician, serviceDate,
    sourceRowHash: hash + index, ...(kind === "attendance" ? { location: null, status: "show" } : { totalFeeCharged: index ? 175 : 100, billingCode: "90837" }) })),
});
snapshots.splice(0, snapshots.length,
  makeSource("attendance", "aaaaaaaaaaaaaaaa", "Elia", ["2026-01-02", "2026-01-08"]),
  makeSource("billing", "bbbbbbbbbbbbbbbb", "Elia", ["2026-01-02", "2026-01-08"]),
  makeSource("attendance", "cccccccccccccccc", "Erin", ["2026-09-25", "2026-10-01"]),
  makeSource("billing", "dddddddddddddddd", "Erin", ["2026-09-25", "2026-10-01"]),
);
const before = structuredClone(snapshots);
const writes = [], audits = [];
let rejectNextSave = true;
await page.route("**/api/**", async (route, request) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.fallback();
  const pathname = new URL(request.url()).pathname;
  writes.push({ method: request.method(), pathname, body: request.postDataJSON() });
  assert.equal(pathname, "/api/practice-imports/report-coverage", "No unrelated writes are permitted");
  assert.equal(request.method(), "PUT");
  if (rejectNextSave) {
    rejectNextSave = false;
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "STALE_REPORT_COVERAGE", error: "Synthetic stale proof; reload before confirming." }) });
  }
  const body = request.postDataJSON();
  assert.deepEqual(Object.keys(body).sort(), ["confirmed", "expectedReportCoverage", "reportCoverage", "snapshotId", "sourceBasis"].sort());
  const target = snapshots.find((item) => item.id === body.snapshotId);
  assert.ok(target);
  assert.deepEqual(body.expectedReportCoverage, target.reportCoverage);
  audits.push({ snapshotId: target.id, before: structuredClone(target.reportCoverage), after: structuredClone(body.reportCoverage), sourceBasis: body.sourceBasis });
  target.reportCoverage = structuredClone(body.reportCoverage);
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ snapshots, packages, billingCodeMinutes: {}, sameDayVisitOverrides: {} }) });
});
const result = { syntheticOnly: true, databaseAccess: false, productionAccess: false };
try {
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  await page.getByRole("button", { name: "Open Imports", exact: true }).click();
  const section = page.getByLabel("Confirm individual import coverage", { exact: true });
  await section.waitFor();
  const forms = section.getByRole("form", { includeHidden: true });
  assert.equal(await forms.count(), 4);
  for (const form of await forms.all()) {
    assert.equal(await form.getByLabel("Report start", { exact: true }).inputValue(), "");
    assert.equal(await form.getByLabel("Report end", { exact: true }).inputValue(), "");
    assert.equal(await form.getByLabel("Confirmation basis", { exact: true }).inputValue(), "");
    assert.equal(await form.getByRole("checkbox", { includeHidden: true }).isChecked(), false);
    assert.equal(await form.getByRole("button", { name: "Save coverage", includeHidden: true }).isDisabled(), true);
  }
  assert.deepEqual(writes, [], "Opening history never saves inferred proof");
  await section.locator("details > summary").first().click();
  await capture("coverage-confirmation-blank-desktop", 1280, 900);
  await capture("coverage-confirmation-blank-mobile", 390, 900);
  const form = page.getByRole("form", { name: "Report coverage for attendance-aaaaaaaaaaaaaaaa", exact: true });
  await form.getByLabel("Report start", { exact: true }).fill(proof.start);
  await form.getByLabel("Report end", { exact: true }).fill(proof.end);
  await form.getByRole("checkbox").check();
  assert.equal(await form.getByRole("button", { name: "Save coverage", exact: true }).isDisabled(), true, "Missing source basis prevents a request");
  assert.deepEqual(writes, []);
  await form.getByLabel("Confirmation basis", { exact: true }).selectOption("source-report");
  assert.equal(await form.getByRole("button", { name: "Save coverage", exact: true }).isDisabled(), true, "Dates and basis alone cannot confirm completeness");
  const future = new Date(Date.parse(today + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
  await form.getByLabel("Report end", { exact: true }).fill(future);
  await form.getByRole("checkbox").check();
  assert.equal(await form.getByRole("button", { name: "Save coverage", exact: true }).isDisabled(), true, "Future coverage cannot be submitted");
  assert.deepEqual(writes, []);
  await form.getByLabel("Report end", { exact: true }).fill(proof.end);
  assert.equal(await form.getByRole("checkbox").isChecked(), false, "Revised dates require fresh explicit confirmation");
  assert.deepEqual(writes, [], "Editing fields cannot save automatically");
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Save coverage", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Synthetic stale proof; reload before confirming." }).waitFor();
  assert.deepEqual(snapshots, before, "A rejected save cannot optimistically alter source metadata");
  await capture("coverage-confirmation-stale-mobile", 390, 900);
  await form.getByRole("button", { name: "Save coverage", exact: true }).click();
  await page.getByText("Saved report coverage confirmation. Original rows, hashes and observed bounds are unchanged.", { exact: true }).waitFor();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, { snapshotId: snapshots[0].id, reportCoverage: proof, expectedReportCoverage: null, sourceBasis: "source-report", confirmed: true });
  assert.deepEqual(snapshots[0], { ...before[0], reportCoverage: proof });
  assert.deepEqual(snapshots.slice(1), before.slice(1), "Other imports are unchanged");
  assert.equal(audits.length, 1);
  const refreshed = page.getByRole("form", { name: "Report coverage for attendance-aaaaaaaaaaaaaaaa", exact: true, includeHidden: true });
  assert.equal(await refreshed.getByLabel("Report start", { exact: true }).inputValue(), "");
  assert.equal(await refreshed.getByRole("checkbox", { includeHidden: true }).isChecked(), false);
  await section.locator("details > summary").first().click();
  await capture("coverage-confirmation-saved-desktop", 1280, 900);
  await capture("coverage-confirmation-saved-mobile", 390, 900);
  await page.reload();
  await page.getByRole("button", { name: "Open Imports", exact: true }).click();
  await page.getByLabel("Confirm individual import coverage", { exact: true }).waitFor();
  assert.equal(writes.length, 2, "Reload cannot submit another confirmation");
  assert.deepEqual(snapshots[0].reportCoverage, proof);
  assert.ok(checks.every((check) => check.scrollWidth <= check.clientWidth + 1), "Confirmation forms fit desktop and mobile");
  const localAuthErrors = browserErrors.filter((error) => error.includes("Clerk: Failed to load Clerk JS") && error.includes("clerk.127.0.0.1"));
  assert.deepEqual(browserErrors.filter((error) => !localAuthErrors.includes(error)), []);
  Object.assign(result, { captures: checks.length, writes, audits, checks, localAuthErrors });
  await fs.writeFile(path.join(outDir, "coverage-confirmation-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ captures: checks.length, explicitSaveRequests: writes.length, successfulConfirmations: audits.length, automaticWrites: 0, sourceFactsUnchanged: true, outDir }));
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, boundary) + checksSource).toString("base64"));
