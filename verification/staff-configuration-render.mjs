import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const source = await fs.readFile(repo + "/verification/render-practice-workspace.mjs", "utf8");
const start = source.indexOf("await page.goto(new URL");
if (start < 0) throw new Error("Candidate harness setup boundary changed");

const verification = String.raw`
page.on("dialog", (dialog) => dialog.accept());
const inventory = [
  { id: 101, name: "Year 1 Baseline", clinical: 6, support: 1, target: 6 },
  { id: 102, name: "Step 2", clinical: 8, support: 1, target: 8 },
  { id: 103, name: "3-Year Growth", clinical: 7, support: 0, target: 7 },
  { id: 104, name: "5-Year Expansion", clinical: 9, support: 0, target: 10 },
];
const firstNames = ["Elia", "Erin", "Natalie", "Michele", "Jessica Cockrum", "Jessica Yates"];
const template = structuredClone(context.clinicians[0]);
context.clinicians = inventory.flatMap((team) => Array.from({ length: team.clinical }, (_, index) => ({
  ...template, id: team.id * 100 + index, goalId: team.id,
  label: team.id === 101 ? firstNames[index] : "Synthetic clinician " + team.id + "-" + (index + 1),
  sessionRate: 0, sessionsPerWeek: 0, weeksWorkedPerYear: 0,
})));
context.clinicians.push(...Array.from({ length: 6 }, (_, index) => ({ ...template, id: 20000 + index, goalId: null, label: "Synthetic unassigned clinician " + (index + 1), sessionRate: 0, sessionsPerWeek: 0, weeksWorkedPerYear: 0 })));
// Year 1 terms were supplied explicitly; Step 2 stays independent and unknown here.
context.staff = [101, 102].map((goalId) => ({ id: goalId * 100, goalId, label: "Grace", roleType: "admin", classification: "w2", annualSalary: null, hourlyRate: null, hoursPerWeek: null, weeksPerYear: 0, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }));
Object.assign(context.staff[0], { hourlyRate: 18, hoursPerWeek: 10, weeksPerYear: 48, w2EmployerFicaPct: 7.65, futaSutaPct: 1, workersCompPct: 0.5 });
context.sessions = [];
snapshots.splice(0);
workspace.settings.teamId = 101;
workspace.settings.practiceName = "Inventory-shaped compatibility fixture";
workspace.clinicians = [];
workspace.proposals = [];
workspace.settings.ownerPayrollMonthly = 0;
workspace.settings.targetProfitMonthly = 0;
workspace.settings.ownerPayrollOverride = false;
workspace.settings.familyW2ClinicianId = null;
const goals = inventory.map((team) => ({ id: team.id, name: team.name, desiredCliniciansCount: team.target, ownerPayGoal: 0, secondOwnerPayGoal: 0, annualOverheadGoal: 0, businessProfitGoal: 0, buildingFundGoal: 0, emergencyReserveGoal: 0, growthFundGoal: 0 }));
goals[0].ownerPayGoal = 120000;
goals[0].businessProfitGoal = 12000;
const originalRows = structuredClone({ clinicians: context.clinicians, staff: context.staff });
const writes = [];
page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push({ method: request.method(), path: new URL(request.url()).pathname }); });
await page.route("**/api/business-goals", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(goals) }));
await page.route("**/api/scenarios", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
await page.route("**/api/staff**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(context.staff) }));
await page.route("**/api/clinicians**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(context.clinicians) }));
await page.goto(new URL("/workspace", process.env.PRACTICE_PREVIEW_URL ?? "http://127.0.0.1:4318").href);
await clickSection("Team");
const results = [];
for (const team of inventory) {
  await page.getByLabel("Practice team", { exact: true }).selectOption(String(team.id));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction((expected) => document.querySelectorAll(".pw-clinicians .pw-person > header h3").length === expected, team.clinical);
  const clinical = await page.locator(".pw-clinicians .pw-person > header h3").allTextContents();
  const support = await page.getByLabel("Nonclinical staff", { exact: true }).locator(".pw-modeled-staff-row > strong").allTextContents();
  assert.equal(clinical.length, team.clinical, "configuration roster is preserved with zero sessions: " + team.name);
  assert.equal(support.length, team.support, "configuration-specific support count: " + team.name);
  assert.deepEqual(support, team.support ? ["Grace"] : [], "Grace is not merged or injected into another configuration");
  assert.equal(workspace.settings.ownerPayrollMonthly, 0, "configuration selection cannot persist inherited owner payroll");
  assert.equal(workspace.settings.targetProfitMonthly, 0, "configuration selection cannot persist inherited profit goals");
  assert.ok(await page.evaluate(() => document.querySelector(".pw-clinicians").nextElementSibling?.getAttribute("aria-label") === "Nonclinical staff"));
  const supportText = await page.getByLabel("Nonclinical staff", { exact: true }).innerText();
  if (team.id === 101) assert.match(supportText, /Grace.*Hourly.*\$786 monthly practice cost/s, "provided Year 1 compatibility terms render rounded monthly total");
  if (team.id === 102) assert.match(supportText, /Grace.*Pay unavailable.*Unknown monthly practice cost/s, "Step 2 never borrows Year 1 economics");
  results.push({ name: team.name, clinical: clinical.length, support, noSessionRows: context.sessions.length, payMath: team.id === 101 ? "Provided compatibility inputs: base8640, burden790.56, annual9430.56, monthly785.88" : "No production pay verification implied" });
  await capture("inventory-team-" + team.id + "-desktop", 1280, 900);
  await capture("inventory-team-" + team.id + "-mobile", 390, 900);
}
assert.deepEqual({ clinicians: context.clinicians, staff: context.staff }, originalRows, "configuration selection never changes source roster rows");
await page.getByLabel("Practice team", { exact: true }).selectOption("unassigned");
await page.waitForLoadState("networkidle");
await page.waitForFunction(() => document.querySelector('select[aria-label="Practice team"]')?.value === "unassigned" && document.querySelectorAll(".pw-clinicians .pw-person").length === 6);
assert.equal(await page.locator(".pw-clinicians .pw-person").count(), 6, "six unassigned clinicians are accessible without being moved into a configuration");
assert.equal(await page.getByLabel("Nonclinical staff", { exact: true }).locator(".pw-modeled-staff-row").count(), 0);
assert.equal(workspace.settings.teamId, null);
assert.equal(workspace.settings.teamSelectionExplicit, true);
assert.equal(workspace.settings.ownerPayrollMonthly, 0);
assert.equal(workspace.settings.targetProfitMonthly, 0);
await page.reload(); await clickSection("Team");
assert.equal(await page.getByLabel("Practice team", { exact: true }).inputValue(), "unassigned");
assert.equal(await page.locator(".pw-clinicians .pw-person").count(), 6, "explicit Unassigned preference survives reload");
assert.deepEqual({ clinicians: context.clinicians, staff: context.staff }, originalRows);
await capture("inventory-unassigned-desktop", 1280, 900);
await capture("inventory-unassigned-mobile", 390, 900);
const findings = [];
await page.getByLabel("Practice team", { exact: true }).selectOption("101");
await page.waitForLoadState("networkidle");
await page.waitForFunction(() => document.querySelector('[aria-label="Nonclinical staff"]')?.textContent.includes("$786"));
await page.getByRole("button", { name: "Pay structure", exact: true }).click();
await page.getByText("Annual Base Pay", { exact: true }).waitFor({ state: "visible" });
assert.ok(await page.getByText("Annual Base Pay", { exact: true }).isVisible());
assert.ok(await page.getByText("$8,640", { exact: true }).count());
assert.ok(await page.getByText("$791", { exact: true }).count());
assert.ok(await page.getByText("$9,431", { exact: true }).count());
await capture("grace-pay-compatibility-desktop", 1280, 900);
await capture("grace-pay-compatibility-mobile", 390, 900);
await page.getByRole("button", { name: "Sandbox", exact: true }).click();
assert.equal(await page.locator(".pw-clinicians .pw-person").count(), 0, "blank Sandbox does not inherit any clinical roster");
assert.equal(await page.locator(".pw-modeled-staff-row").count(), 0, "blank Sandbox does not inherit either Grace row");
assert.deepEqual({ clinicians: context.clinicians, staff: context.staff }, originalRows);
assert.ok(writes.every((request) => request.path === "/api/hub"), "switching changes only mocked active-workspace preferences, never staff or scenario records");
await capture("inventory-blank-sandbox-mobile", 390, 900);

const payTemplate = originalRows.staff[0];
context.staff = [
  { ...payTemplate, id: 301, label: "Synthetic zero-salary hourly", annualSalary: 0 },
  { ...payTemplate, id: 302, label: "Synthetic omitted-salary hourly", annualSalary: undefined },
  { ...payTemplate, id: 303, label: "Synthetic zero-week hourly", weeksPerYear: 0 },
  { ...payTemplate, id: 304, label: "Synthetic missing-pay staff", hourlyRate: null, hoursPerWeek: null },
];
await page.reload(); await clickSection("Team");
const supportPanel = page.getByLabel("Nonclinical staff", { exact: true });
const supportRow = (label) => supportPanel.locator(".pw-modeled-staff-row").filter({ has: page.getByText(label, { exact: true }) });
for (const label of ["Synthetic zero-salary hourly", "Synthetic omitted-salary hourly"])
  assert.match(await supportRow(label).innerText(), /Hourly.*\$786 monthly practice cost/s);
assert.match(await supportRow("Synthetic zero-week hourly").innerText(), /Hourly.*\$0 monthly practice cost/s);
assert.match(await supportRow("Synthetic missing-pay staff").innerText(), /Pay unavailable.*Unknown monthly practice cost/s);
await capture("staff-pay-edge-fixes-desktop", 1280, 900);
await capture("staff-pay-edge-fixes-mobile", 390, 900);
await page.getByRole("button", { name: "Pay structure", exact: true }).click();
assert.ok(await page.getByText("Unknown", { exact: true }).count() >= 4, "missing individual and aggregate costs are unknown in Pay structure too");
assert.ok(writes.every((request) => request.path === "/api/hub"));
const report = { candidate: process.env.PRACTICE_CANDIDATE_REF ?? "working candidate", compatibilityOnly: true, productionReadOrWrite: false, source: "parent-reported roster shape and explicit Year 1 Grace terms; synthetic IDs and clinical economics, independent unknown Step 2 pay", results, unassignedClinical: 6, savedStaffRows: originalRows.staff.map((row) => ({ id: row.id, goalId: row.goalId, label: row.label })), emptySandboxStaff: 0, payEdgeFixes: ["zero/omitted salary labels", "zero weeks", "missing pay remains unknown", "unknown aggregate remains unknown"], findings, mockPreferenceWrites: writes, captures: checks };
await fs.writeFile(path.join(outDir, "configuration-roster-results.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
`;

await import("data:text/javascript;base64," + Buffer.from(source.slice(0, start) + verification + "\n//# sourceURL=staff-configuration-check.mjs").toString("base64"));
