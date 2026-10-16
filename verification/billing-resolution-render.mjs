import fs from "node:fs/promises";
const source = await fs.readFile(new URL("./render-practice-workspace.mjs", import.meta.url), "utf8");
const boundary = source.indexOf("await page.goto(new URL");
if (boundary < 0) throw new Error("Shared harness boundary changed");
const checksSource = String.raw`
const definitions = [
  ["Synthetic Alpha", "2025-11-19", [135, 150]], ["Synthetic Beta", "2026-08-10", [175, 175]],
  ["Synthetic Alpha", "2026-01-21", [150, 150]], ["Synthetic Alpha", "2026-07-23", [150, 150]],
];
const base = context.clinicians[0];
context.clinicians.splice(0, context.clinicians.length, ...["Synthetic Alpha", "Synthetic Beta"].map((label, i) => ({ ...base, label, id: i + 1, goalId: 1 })));
context.sessions.splice(0, context.sessions.length);
snapshots.splice(0, snapshots.length, { id: "billing-" + "1".repeat(16), kind: "billing", sourceHash: "1".repeat(16), importedAt: today + "T00:00:00Z", coverageStart: "2025-11-19", coverageEnd: "2026-08-10", rows: definitions.flatMap(([clinician, serviceDate, amounts], i) => amounts.map((totalFeeCharged, j) => ({ clinician, serviceDate, totalFeeCharged, billingCode: "90837", sourceRowHash: "PRIVATE_HASH_" + i + j, clientId: "PRIVATE_KEY_" + i }))) });
const original = structuredClone({ snapshots, roster: context.clinicians });
const declarations = { revision: 1, confirmedAt: today + "T00:00:00Z", data: { version: 1, mappings: context.clinicians.map(person => ({ sourceLabel: person.label, clinicianLabel: person.label, clinicianId: person.id, teamId: 1 })), sourceSets: [] } };
let journalRevision = 0, resolutions = [], rejectNext = true;
const writes = [];
const candidates = definitions.map(([clinicianLabel, serviceDate, amounts], i) => ({ caseToken: String(i + 1).repeat(64), clinicianLabel, serviceDate, amounts, billingCode: "90837", rawRowCount: 2, sourceCount: 1, canAccept: true, resolutionId: null, stale: false }));
await page.route("**/api/practice-imports", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ snapshots, packages, declarations, billingResolutions: resolutions, billingResolutionRevision: journalRevision, billingCodeMinutes: {}, sameDayVisitOverrides: {} }) }));
await page.route("**/api/practice-imports/billing-resolution-candidates", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ revision: journalRevision, candidates }) }));
await page.route("**/api/practice-imports/billing-resolutions", async (route, request) => {
  assert.equal(request.method(), "POST"); const payload = request.postDataJSON(); writes.push(payload);
  assert.equal(payload.expectedRevision, journalRevision); assert.equal(payload.confirmed, true); assert.ok(payload.approvalNote);
  if (rejectNext) { rejectNext = false; return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Synthetic stale case; reload and review." }) }); }
  const candidate = candidates.find(row => row.caseToken === payload.caseToken);
  assert.deepEqual(payload.amounts, candidate.amounts); assert.equal(payload.clinicianLabel, candidate.clinicianLabel); assert.equal(payload.serviceDate, candidate.serviceDate);
  candidate.canAccept = false; candidate.resolutionId = "00000000-0000-4000-8000-" + String(++journalRevision).padStart(12, "0");
  const index = candidates.indexOf(candidate);
  resolutions.push({ id: candidate.resolutionId, approvalToken: candidate.caseToken, clinicianId: index === 1 ? 2 : 1, clinicianLabel: candidate.clinicianLabel, serviceDate: candidate.serviceDate, billingCode: "90837", visitKind: "", clientId: "PRIVATE_KEY_" + index, charges: candidate.amounts.map((amount, j) => ({ amount, anchor: { snapshotId: snapshots[0].id, sourceRowHash: "PRIVATE_HASH_" + index + j } })), confirmedAt: today + "T00:00:00Z", approvalNote: payload.approvalNote });
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ billingResolutions: resolutions, billingResolutionRevision: journalRevision }) });
});
try {
  await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
  await page.getByRole("button", { name: "Open Imports", exact: true }).click();
  const panel = page.getByLabel("Billing charge exceptions", { exact: true });
  await panel.getByRole("button", { name: "Accept two charges", exact: true }).first().waitFor();
  assert.equal(writes.length, 0); assert.doesNotMatch(await panel.innerText(), /PRIVATE_KEY|PRIVATE_HASH|[1-4]{64}/);
  await capture("billing-unresolved-desktop", 1280, 900); await panel.screenshot({ path: path.join(outDir, "billing-panel-desktop.png") });
  await capture("billing-unresolved-mobile", 390, 900); await panel.screenshot({ path: path.join(outDir, "billing-panel-mobile.png") });
  for (const [i, candidate] of candidates.entries()) {
    let form = panel.getByRole("form", { name: "Billing case " + candidate.clinicianLabel + " " + candidate.serviceDate, exact: true });
    assert.equal(await form.getByRole("button", { name: "Accept two charges", exact: true }).isDisabled(), true);
    await form.getByLabel("Owner approval note", { exact: true }).fill("Synthetic explicit approval " + i);
    assert.equal(writes.length, i === 0 ? 0 : i + 1);
    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: "Accept two charges", exact: true }).click();
    if (i === 0) {
      await panel.getByRole("alert").waitFor(); assert.equal(journalRevision, 0);
      await capture("billing-stale-mobile", 390, 900);
      await panel.getByRole("button", { name: "Reload billing cases", exact: true }).click();
      form = panel.getByRole("form", { name: "Billing case " + candidate.clinicianLabel + " " + candidate.serviceDate, exact: true });
      await form.getByLabel("Owner approval note", { exact: true }).fill("Synthetic reviewed explicit approval");
      await form.getByRole("checkbox").check(); await form.getByRole("button", { name: "Accept two charges", exact: true }).click();
    }
    await panel.getByText("Approval journal revision " + (i + 1) + ". Source records and attendance counts are unchanged.", { exact: true }).waitFor();
  }
  assert.equal(await panel.getByRole("button", { name: "Accept two charges", exact: true }).count(), 0);
  await capture("billing-accepted-desktop", 1280, 900); await capture("billing-accepted-mobile", 390, 900);
  await page.reload(); await page.getByRole("button", { name: "Open Imports", exact: true }).click();
  await panel.getByText("Approval journal revision 4. Source records and attendance counts are unchanged.", { exact: true }).waitFor();
  assert.equal(writes.length, 5); assert.equal(journalRevision, 4); assert.equal(declarations.revision, 1);
  assert.deepEqual({ snapshots, roster: context.clinicians }, original);
  assert.ok(checks.every(row => row.scrollWidth <= row.clientWidth + 1));
  assert.deepEqual(browserErrors.filter(error => !error.includes("Clerk: Failed to load Clerk JS")), []);
  await fs.writeFile(path.join(outDir, "billing-resolution-results.json"), JSON.stringify({ syntheticOnly: true, productionAccess: false, captures: checks.length, explicitRequests: writes.length, approvals: journalRevision, automaticWrites: 0, sourceFactsUnchanged: true, declarationRevision: declarations.revision, checks }, null, 2));
  console.log(JSON.stringify({ captures: checks.length, explicitRequests: writes.length, approvals: journalRevision, automaticWrites: 0, sourceFactsUnchanged: true, outDir }));
} finally { await browser.close(); }
`;
await import("data:text/javascript;base64," + Buffer.from(source.slice(0, boundary) + checksSource).toString("base64"));
