import test from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, goalSchema, fundGoalSchema, allocationSchema } from "@workspace/practice/hub";
import { overviewFundingSummary, overviewClientFlow } from "./practice-overview.ts";

test("combined funding target subtracts matching salary once and excludes headcount and fund balance totals", () => {
  const workspace = emptyWorkspace();
  workspace.goals = [goalSchema.parse({ id: "00000000-0000-4000-8000-000000000001", name: "Owner pay", metric: "ownerDistributionsPretax", amount: 12000 }), goalSchema.parse({ id: "00000000-0000-4000-8000-000000000002", name: "Co-owner pay", metric: "coOwnerSalaryPretax", amount: 24000 }), goalSchema.parse({ id: "00000000-0000-4000-8000-000000000003", name: "Business Profit", metric: "profit", amount: 36000 })];
  const months = Array.from({ length: 12 }, (_, index) => ({ date: `2026-${String(index + 1).padStart(2, "0")}-01`, values: { revenue: 10000, clinicianPay: 3000, profit: 5000, coOwnerSalaryPretax: 2000 } })) as any;
  workspace.goals = workspace.goals.map((goal) => ({ ...goal, basis: "annual" }));
  const result = overviewFundingSummary(workspace, months);
  assert.equal(result.target, 48000);
  assert.equal(result.ownerAnnual, 12000);
  assert.equal(result.includedSalaryAnnual, 24000);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.salaryGap, 0);
  assert.equal(result.profit, 60000);
  assert.equal(overviewFundingSummary({ ...workspace, goals: workspace.goals.slice(0, 2) }, months).target, null);
  workspace.goals.push(goalSchema.parse({ id: "00000000-0000-4000-8000-000000000004", name: "Desired Clinicians", metric: "activeClinicalHeadcount", amount: 10 }));
  workspace.fundGoals.push(fundGoalSchema.parse({ id: "00000000-0000-4000-8000-000000000005", name: "Building Fund", amount: 100000 }));
  workspace.allocations.push(allocationSchema.parse({ id: "00000000-0000-4000-8000-000000000006", name: "Building Fund", kind: "reserve", percent: 100, start: "2026-01-01" }));
  for (const month of months) Object.assign(month.values, { reserves: 100, retainedCash: 0, taxReserve: 0, distributions: 0, employerBurden: 0, staffCost: 0, overhead: 2000, marketing: 0, fees: 0, ownerPayroll: 0 });
  const funded = overviewFundingSummary(workspace, months);
  assert.equal(funded.target, 49200);
  assert.equal(funded.fundsAnnual, 1200);
  assert.equal(funded.otherCosts, 24000);
  assert.equal(funded.adjustments, 0);
  workspace.allocations[0].start = "2026-10-01";
  assert.equal(overviewFundingSummary(workspace, months).fundsAnnual, 300);
  assert.equal(overviewFundingSummary(workspace, months).target, 48300);
});

test("funding summary uses typed identity despite canonical or historic names and preserves salary gaps", () => {
  const workspace = emptyWorkspace();
  workspace.goals = [
    goalSchema.parse({ id: crypto.randomUUID(), name: "Owner pay", metric: "coOwnerSalaryPretax", amount: 36000, basis: "annual" }),
    goalSchema.parse({ id: crypto.randomUUID(), name: "Co-owner pay", metric: "ownerDistributionsPretax", amount: 12000, basis: "annual" }),
    goalSchema.parse({ id: crypto.randomUUID(), name: "Business Profit", metric: "profit", amount: 36000, basis: "annual" }),
  ];
  const months = Array.from({ length: 12 }, (_, index) => ({ date: `2026-${String(index + 1).padStart(2, "0")}-01`, values: { coOwnerSalaryPretax: 2000 } })) as any;
  const before = structuredClone(workspace);
  const result = overviewFundingSummary(workspace, months);
  assert.equal(result.salaryGap, 12000);
  assert.equal(result.ownerAnnual, 12000);
  assert.equal(result.target, 60000);
  assert.deepEqual(workspace, before);
  workspace.goals[0].name = "Historic salary name";
  workspace.goals[1].name = "Historic distribution name";
  assert.equal(overviewFundingSummary(workspace, months).target, 60000);
});

test("unknown or duplicate owner mappings withhold funding totals rather than reinterpret amounts", () => {
  const workspace = emptyWorkspace();
  workspace.goals.push(goalSchema.parse({ id: crypto.randomUUID(), name: "Owner pay", metric: "familyTakeHome", amount: 12000 }));
  const unknown = overviewFundingSummary(workspace, []);
  assert.equal(unknown.target, null);
  assert.ok(unknown.diagnostics.some(message => /unrecognized funding metric/.test(message)));
  workspace.goals = ["A", "B"].map(name => goalSchema.parse({ id: crypto.randomUUID(), name, metric: "coOwnerSalaryPretax", amount: 12000 }));
  const duplicate = overviewFundingSummary(workspace, []);
  assert.equal(duplicate.target, null);
  assert.ok(duplicate.diagnostics.some(message => /multiple saved/.test(message)));
});

test("client flow requires real history and preserves unknown departure maturity", () => {
  assert.deepEqual(overviewClientFlow([], {}, "2026-01-01", "2026-01-31", "2026-01-31"), { starts: null, departures: null, through: null, leftCensoredStarts: 0 });
});

test("client flow counts unique treatment starts, excludes PHONE and left boundary, and waits for mature departures", () => {
  const row = (clientId: string, clinician: string, serviceDate: string, phone = false) => ({ clientId, clinician, serviceDate, status: "show" as const, location: null, billingCode: phone ? "PHONE" : "90837", sourceRowHash: `${clientId}-${clinician}-${serviceDate}` });
  const snapshots = [{ id: "synthetic", kind: "attendance" as const, sourceHash: "synthetic", importedAt: "2026-01-31T00:00:00Z", coverageStart: "2026-01-01", coverageEnd: "2026-01-31", rows: [row("uncertain", "A", "2026-01-01"), row("phone", "A", "2026-01-05", true), row("new", "A", "2026-01-06"), row("new", "B", "2026-01-07")] }];
  const result = overviewClientFlow(snapshots, {}, "2026-01-01", "2026-01-31", "2026-01-31");
  assert.equal(result.starts, 1);
  assert.equal(result.leftCensoredStarts, 1);
  assert.equal(result.departures, null);
});

test("Overview departures use exact dates and include the mature partial cutoff month", () => {
  const rows = [
    ["june", "2026-05-20"], ["june", "2026-05-27"], ["june", "2026-06-03"],
    ["july", "2026-06-26"], ["july", "2026-07-03"], ["july", "2026-07-10"],
  ].map(([clientId, serviceDate]) => ({ clientId, serviceDate, clinician: "A", status: "show" as const, location: null, sourceRowHash: clientId + serviceDate }));
  const snapshot = { id: "synthetic", kind: "attendance" as const, sourceHash: "synthetic", importedAt: "2026-10-14T00:00:00Z", coverageStart: "2026-05-20", coverageEnd: "2026-07-10", reportCoverage: { start: "2026-01-01", end: "2026-10-14", complete: true as const }, rows };
  assert.equal(overviewClientFlow([{ ...snapshot, reportCoverage: undefined }], {}, "2026-06-15", "2026-06-20", "2026-10-14").departures, null);
  assert.equal(overviewClientFlow([snapshot], {}, "2026-06-15", "2026-06-20", "2026-10-14").departures, 0);
  assert.equal(overviewClientFlow([snapshot], {}, "2026-07-01", "2026-07-16", "2026-10-14").departures, 1);
  assert.equal(overviewClientFlow([{ ...snapshot, reportCoverage: { ...snapshot.reportCoverage, end: "2026-07-15" } }, { ...snapshot, id: "later", coverageStart: "2026-09-01", coverageEnd: "2026-10-14", reportCoverage: undefined, rows: [] }], {}, "2026-07-01", "2026-07-16", "2026-10-14").departures, null);
});
