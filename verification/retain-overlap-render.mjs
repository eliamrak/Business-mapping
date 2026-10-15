import fs from "node:fs/promises";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const boundary = source.indexOf("await page.goto(new URL");
if (boundary < 0) throw new Error("Shared harness setup boundary changed");
const checksSource = String.raw`
const packageFor = (packageId, dates, fee = 100) => ({
  format: "emc-practice-local-import-package", version: 1, packageId, exportedAt: today + "T00:00:00Z",
  collections: Object.fromEntries(["attendance", "billing"].map(kind => [kind, { coverageStart: dates[0], coverageEnd: dates.at(-1), rowCount: dates.length,
    rows: dates.map(serviceDate => ({ clientId: "synthetic-overlap-client", clinician: "Elia", serviceDate,
      ...(kind === "attendance" ? { status: "show", location: null } : { totalFeeCharged: fee, billingCode: "90837" }) })) }])),
  billingCodeMinutes: { "90837": 999 },
});
let sequence = 0;
const snapshotsFor = input => Object.entries(input.collections).map(([kind, collection]) => {
  const hash = (++sequence).toString(16).padStart(8, "0");
  return { id: kind + "-" + hash, kind, sourceHash: hash, importedAt: today + "T00:00:00Z", reportCoverage: null,
    coverageStart: collection.coverageStart, coverageEnd: collection.coverageEnd,
    rows: collection.rows.map((row, index) => ({ ...row, sourceRowHash: hash + "-" + index })) };
});
snapshots.splice(0, snapshots.length, ...snapshotsFor(packageFor("original", ["2026-10-01", "2026-10-10"])));
const before = structuredClone(snapshots), writes = [], seen = new Set();
const upload = async input => page.locator('input[type="file"]').first().setInputFiles({ name: input.packageId + ".json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
await page.route("**/api/**", async (route, request) => {
  if (request.method() === "GET") return route.fallback();
  assert.equal(new URL(request.url()).pathname, "/api/practice-imports/package");
  const body = request.postDataJSON(); writes.push(structuredClone(body));
  assert.equal(body.replaceOverlaps, false, "Retain workflow never requests archival replacement");
  if (seen.has(body.package.packageId)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "duplicate", snapshots, packages, billingCodeMinutes: {}, sameDayVisitOverrides: {} }) });
  if (!body.retainOverlaps) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "OVERLAP_REVIEW_REQUIRED", error: "Synthetic overlap requires review", existing: snapshots, incoming: snapshotsFor(body.package) }) });
  seen.add(body.package.packageId);
  snapshots.push(...snapshotsFor(body.package));
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "retained", snapshots, packages, billingCodeMinutes: {}, sameDayVisitOverrides: {} }) });
});
try {
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  await page.getByRole("button", { name: "Open Imports", exact: true }).click();
  const partial = packageFor("partial-overlap", ["2026-10-10", "2026-10-14"]);
  assert.deepEqual(writes, []);
  await upload(partial);
  const retain = page.getByRole("button", { name: "Keep history and reconcile overlap", exact: true });
  await retain.waitFor();
  await page.getByText(/Replacing archives the entire overlapping snapshots/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Replace overlapping data", exact: true }).isVisible(), true);
  assert.equal(writes.length, 1); assert.deepEqual(snapshots, before);
  await capture("retain-overlap-review-desktop", 1280, 900);
  await capture("retain-overlap-review-mobile", 390, 900);
  await retain.click();
  await page.getByText(/Kept existing history and saved package partial-overlap/).waitFor();
  assert.equal(writes[1].retainOverlaps, true); assert.equal(writes[1].replaceOverlaps, false);
  assert.deepEqual(snapshots.slice(0, 2), before);
  assert.equal(snapshots[1].rows[1].totalFeeCharged, 100);
  await upload(partial);
  await page.getByText("Package partial-overlap is already loaded. Nothing was added.", { exact: true }).waitFor();
  assert.equal(snapshots.length, 4);
  const changed = packageFor("changed-fee-overlap", ["2026-10-10"], 125);
  await upload(changed); await retain.waitFor();
  assert.equal(snapshots.length, 4, "Review cannot silently overwrite prior fees");
  await retain.click();
  await page.getByText(/Kept existing history and saved package changed-fee-overlap/).waitFor();
  assert.deepEqual(snapshots.slice(0, 2), before);
  assert.equal(snapshots[1].rows[1].totalFeeCharged, 100);
  assert.equal(snapshots.at(-1).rows[0].totalFeeCharged, 125);
  await page.getByText(/Billing source review: 1 fee conflicts; 0 ambiguous fee encounters/).waitFor();
  await capture("retain-overlap-preserved-desktop", 1280, 900);
  await capture("retain-overlap-preserved-mobile", 390, 900);
  assert.ok(checks.every(check => check.scrollWidth <= check.clientWidth + 1));
  const localAuthErrors = browserErrors.filter(error => error.includes("Clerk: Failed to load Clerk JS") && error.includes("clerk.127.0.0.1"));
  assert.deepEqual(browserErrors.filter(error => !localAuthErrors.includes(error)), []);
  const result = { syntheticOnly: true, databaseAccess: false, captures: checks.length, writes, checks, sourceFactsUnchanged: true,
    note: "UI request/provenance contract only. Real route duplicate/changed-fee behavior is independently covered by mocked API tests; no metric dedup certification." };
  await fs.writeFile(path.join(outDir, "retain-overlap-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ captures: checks.length, reviewRequests: 2, explicitRetains: 2, duplicateRequests: 1, automaticWrites: 0, sourceFactsUnchanged: true, outDir }));
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, boundary) + checksSource).toString("base64"));
