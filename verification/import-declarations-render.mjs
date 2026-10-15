import fs from "node:fs/promises";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const boundary = source.indexOf("await page.goto(new URL");
if (boundary < 0) throw new Error("Shared harness boundary changed");
const checksSource = String.raw`
const names = ["Synthetic Alpha", "Synthetic Beta", "Synthetic Gamma", "Synthetic Delta", "Synthetic Epsilon", "Synthetic Zeta"];
const base = context.clinicians[0];
context.clinicians.splice(0, context.clinicians.length, ...names.flatMap((label, i) => [
  { ...base, id: i + 1, label, goalId: 1 }, { ...base, id: i + 101, label, goalId: 4 },
]));
context.sessions.splice(0, context.sessions.length);
snapshots.splice(0, snapshots.length, ...["attendance", "billing"].flatMap((kind, k) => [2, 9].map((day, i) => ({
  id: kind + "-" + String(k * 2 + i + 1).repeat(16), kind, sourceHash: String(k * 2 + i + 1).repeat(16), importedAt: today + "T00:00:00Z",
  coverageStart: "2026-01-0" + day, coverageEnd: "2026-01-0" + day, reportCoverage: null,
  rows: names.map((clinician, index) => ({ clientId: "synthetic-" + index, clinician, serviceDate: "2026-01-0" + day,
    sourceRowHash: kind + day + index, ...(kind === "attendance" ? { status: "show", location: null } : { billingCode: "90837", totalFeeCharged: 50 }) })),
}))));
const before = structuredClone(snapshots), originalRoster = structuredClone(context.clinicians);
let declarations = null, rejectNext = true;
const writes = [];
await page.route("**/api/practice-imports", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ snapshots, packages, declarations, billingCodeMinutes: {}, sameDayVisitOverrides: {} }) }));
await page.route("**/api/practice-imports/declarations", async (route, request) => {
  assert.equal(request.method(), "PUT");
  const payload = request.postDataJSON(); writes.push(payload);
  if (rejectNext) { rejectNext = false; return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Synthetic stale declaration; reload before confirming." }) }); }
  assert.equal(payload.expectedRevision, 0); assert.equal(payload.confirmed, true);
  assert.deepEqual(payload.data.mappings.map((row) => row.clinicianId), [1, 2, 4, 5, 3, 6]);
  assert.ok(payload.data.mappings.every((row) => row.teamId === 1));
  assert.ok(payload.data.sourceSets.every((set) => set.start === "2026-01-01" && set.end === "2026-01-14" && set.snapshotIds.length === 2 && set.clinicianIds.length === 6));
  declarations = { revision: 1, confirmedAt: today + "T00:00:00Z", data: payload.data };
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ snapshots, packages, declarations, billingCodeMinutes: {}, sameDayVisitOverrides: {} }) });
});
try {
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  await page.getByRole("button", { name: "Open Imports", exact: true }).click();
  const panel = page.getByLabel("Provider mappings and source-set coverage", { exact: true });
  await panel.waitFor();
  for (const label of names) assert.equal(await panel.getByLabel("Map " + label, { exact: true }).inputValue(), "");
  assert.equal(await panel.getByRole("checkbox", { checked: true }).count(), 0);
  assert.equal(await panel.getByLabel("attendance source-set start", { exact: true }).inputValue(), "");
  assert.deepEqual(writes, []);
  await capture("declarations-unconfirmed-desktop", 1280, 900);
  await capture("declarations-unconfirmed-mobile", 390, 900);
  for (const [i, label] of names.entries()) await panel.getByLabel("Map " + label, { exact: true }).selectOption(String(i + 1));
  for (const kind of ["attendance", "billing"]) {
    for (const checkbox of await panel.getByRole("checkbox").filter({ visible: true }).all()) {
      const text = await checkbox.locator("..").innerText();
      if (text.startsWith(kind + "-")) await checkbox.check();
    }
    await panel.getByLabel(kind + " source-set start", { exact: true }).fill("2026-01-01");
    await panel.getByLabel(kind + " source-set end", { exact: true }).fill("2026-01-14");
  }
  assert.deepEqual(writes, [], "Editing choices and source sets never saves automatically");
  await panel.getByRole("checkbox").last().check();
  await capture("declarations-review-mobile", 390, 900);
  await panel.getByRole("button", { name: "Save confirmed declarations", exact: true }).click();
  await panel.getByRole("alert").waitFor();
  assert.equal(declarations, null);
  assert.deepEqual(snapshots, before);
  await panel.getByRole("button", { name: "Save confirmed declarations", exact: true }).click();
  await panel.getByText("Configuration 1 · confirmed revision 1", { exact: true }).waitFor();
  await page.getByText("Data covers through 2026-01-14", { exact: true }).waitFor();
  await capture("declarations-confirmed-desktop", 1280, 900);
  await panel.screenshot({ path: path.join(outDir, "declarations-panel-desktop.png") });
  await capture("declarations-confirmed-mobile", 390, 900);
  await panel.screenshot({ path: path.join(outDir, "declarations-panel-mobile.png") });
  await page.reload();
  await page.getByRole("button", { name: "Open Imports", exact: true }).click();
  await page.getByText("Configuration 1 · confirmed revision 1", { exact: true }).waitFor();
  assert.equal(writes.length, 2, "Reload never writes confirmation again");
  assert.deepEqual(snapshots, before); assert.deepEqual(context.clinicians, originalRoster);
  assert.ok(checks.every((row) => row.scrollWidth <= row.clientWidth + 1));
  assert.deepEqual(browserErrors.filter((error) => !error.includes("Clerk: Failed to load Clerk JS")), []);
  await fs.writeFile(path.join(outDir, "import-declarations-results.json"), JSON.stringify({ syntheticOnly: true, productionAccess: false, databaseAccess: false, captures: checks.length, explicitSaveRequests: writes.length, automaticWrites: 0, sourceFactsUnchanged: true, checks }, null, 2));
  console.log(JSON.stringify({ captures: checks.length, explicitSaveRequests: writes.length, automaticWrites: 0, sourceFactsUnchanged: true, outDir }));
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, boundary) + checksSource).toString("base64"));
