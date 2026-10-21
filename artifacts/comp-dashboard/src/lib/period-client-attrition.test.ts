import test from "node:test";
import assert from "node:assert/strict";
import { periodClientAttrition, type PeriodClientAttritionInput } from "./period-client-attrition.ts";
import { estimateLocalClientActivity, type AttendanceRow, type LocalSnapshot } from "./retention-local.ts";
import { historicalPerformance } from "./historical-performance.ts";

const july = { start: "2026-07-01", end: "2026-07-31" };
const visit = (date: string, clientId = "client", clinician = "Lane", billingCode = "90837"): AttendanceRow => ({
  clientId, clinician, serviceDate: date, billingCode, status: "show", location: null, sourceRowHash: `${clientId}:${clinician}:${date}:${billingCode}`,
});
const three = (clientId = "client", clinician = "Lane") => [2, 9, 16].map((day) => visit(`2026-07-${String(day).padStart(2, "0")}`, clientId, clinician));
const snapshot = (rows = three(), start = "2026-06-01", end = "2026-11-30", providers = ["Lane"]): LocalSnapshot => ({
  id: `${start}:${end}`, kind: "attendance", sourceHash: `${start}:${end}`, importedAt: "2026-12-01T00:00:00Z",
  coverageStart: rows.map((row) => row.serviceDate).sort()[0] ?? start,
  coverageEnd: rows.map((row) => row.serviceDate).sort().at(-1) ?? end,
  reportCoverage: { start, end, complete: true }, coverageClinicians: providers, rows,
});
const run = (snapshots = [snapshot()], extras: Partial<PeriodClientAttritionInput> = {}) => periodClientAttrition({ snapshots, requestedWindow: july, asOf: "2026-11-30", ...extras });

test("complete windows prepare evidence once per practice/clinician scope", () => {
  const sources = [snapshot()];
  const expected = run(sources);
  let sourceReads = 0;
  const result = periodClientAttrition({ get snapshots() { sourceReads++; return sources; }, requestedWindow: july, asOf: "2026-11-30" });
  assert.deepEqual(result, expected);
  assert.equal(sourceReads, 3, "one clinician enumeration plus one preparation for each of two scopes");
});

test("review July 2/9/16 counterexample: newly established unique client yields 1/1/100", () => {
  const snapshots = [snapshot()];
  const result = run(snapshots);
  assert.equal(result.practice.totalEligible, 1);
  assert.equal(result.practice.totalEnded, 1);
  assert.equal(result.practice.percentage, 100);
  assert.equal(result.practice.coverageComplete, true);
  assert.equal(result.practice.cohortQualifier, "observed-established-clients");
  assert.equal(result.practice.allHistoricalClientsCertified, false);
  assert.deepEqual(result.practice.endingClientIds, ["client"]);
  assert.deepEqual(result.practice.effectiveWindow, july);
  assert.deepEqual(result.byClinician[0].eligibleClientIds, result.practice.eligibleClientIds);
  const legacy = estimateLocalClientActivity(snapshots, {}, 56, 56, 28, "2026-11-30", 90, july.start, july.end)!;
  assert.equal(legacy.monthlyEndedClients.find((row) => row.month === "2026-07")?.establishedClientsAtStart, 0);
});

test("pre-window established clients active at start need no visit in the window; inclusive day 90", () => {
  const rows = ["2026-03-01", "2026-03-08", "2026-04-02"].map((date) => visit(date));
  const snapshots = [snapshot(rows, "2026-02-01")];
  const result = run(snapshots, { requestedWindow: { start: "2026-07-01", end: "2026-07-01" } }).practice;
  assert.equal(result.totalEligible, 1);
  assert.equal(result.totalEnded, 0);
  assert.equal(result.percentage, 0);
  assert.equal(run(snapshots, { requestedWindow: { start: "2026-07-02", end: "2026-07-02" } }).practice.totalEligible, 0);
});

test("later qualifying returns remove the earlier final ending even after a 90-day gap", () => {
  const result = run([snapshot([...three(), visit("2026-11-01")])]).practice;
  assert.equal(result.totalEligible, 1);
  assert.equal(result.totalEnded, 0);
  assert.equal(result.percentage, 0);
});

test("practice clients are unique across providers while clinician relationships stay separate", () => {
  const result = run([snapshot([...three(), ...three("client", "Moss"), visit("2026-11-01", "client", "Moss")], undefined, undefined, ["Lane", "Moss"])]);
  assert.equal(result.practice.totalEligible, 1);
  assert.equal(result.practice.totalEnded, 0);
  assert.equal(result.byClinician.find((row) => row.clinician === "Lane")?.totalEnded, 1);
  assert.equal(result.byClinician.find((row) => row.clinician === "Moss")?.totalEnded, 0);
  const split = run([snapshot([visit("2026-07-02"), visit("2026-07-09"), visit("2026-07-16", "client", "Moss")], undefined, undefined, ["Lane", "Moss"])]);
  assert.equal(split.practice.totalEligible, 1);
  assert.deepEqual(split.byClinician.map((row) => row.totalEligible), [0, 0]);
});

test("PHONE, documentation and same-day duplicates never establish clients", () => {
  const rows = [visit("2026-07-02"), visit("2026-07-02"), visit("2026-07-09"), visit("2026-07-16", "client", "Lane", "PHONE"), visit("2026-07-23", "client", "Lane", "2")];
  assert.equal(run([snapshot(rows)]).practice.totalEligible, 0);
  const result = run([snapshot([...rows, visit("2026-07-24")])]).practice;
  assert.equal(result.totalEligible, 1);
  assert.equal(result.totalEnded, 1);
});

test("classification-only billing evidence excludes documentation without adding visits", () => {
  const source = snapshot(three().map((row) => ({ ...row, billingCode: null })));
  const billing: LocalSnapshot = { ...source, kind: "billing", rows: [{ ...three()[2], billingCode: "2", totalFeeCharged: 0 }] };
  assert.equal(run([source], { classificationSnapshots: [source, billing] }).practice.totalEligible, 0);
});

test("exact requested dates count events outside full-month subtotals", () => {
  const result = run(undefined, { requestedWindow: { start: "2026-07-16", end: "2026-07-16" } }).practice;
  assert.equal(result.totalEligible, 1);
  assert.equal(result.totalEnded, 1);
  assert.equal(run(undefined, { requestedWindow: { start: "2026-07-17", end: "2026-07-31" } }).practice.totalEnded, 0);
});

test("one client active over multiple months contributes one unique denominator", () => {
  const rows = [...three(), visit("2026-08-01"), visit("2026-09-01"), visit("2026-10-01")];
  const result = run([snapshot(rows, "2026-06-01", "2027-01-31")], {
    asOf: "2027-01-31", requestedWindow: { start: "2026-08-01", end: "2026-10-31" },
  }).practice;
  assert.equal(result.totalEligible, 1);
  assert.equal(result.totalEnded, 1);
  assert.equal(result.percentage, 100);
});

test("immature full window stays unknown with exact separately labeled mature dates", () => {
  const result = run(undefined, { asOf: "2026-10-20" }).practice;
  assert.equal(result.totalEnded, null);
  assert.equal(result.totalEligible, null);
  assert.equal(result.percentage, null);
  assert.equal(result.effectiveWindow, null);
  assert.ok(result.reasons.includes("immature-follow-up"));
  assert.deepEqual(result.observedMaturePortion?.effectiveWindow, { start: "2026-07-01", end: "2026-07-22" });
  assert.equal(result.observedMaturePortion?.percentage, 100);
});

test("90-day follow-up is inclusive, full-window certification requires E+90", () => {
  const window = { start: "2026-07-16", end: "2026-07-16" };
  assert.equal(run(undefined, { requestedWindow: window, asOf: "2026-10-14" }).practice.percentage, 100);
  assert.equal(run(undefined, { requestedWindow: window, asOf: "2026-10-13" }).practice.percentage, null);
});

test("mature portion uses admitted coverage end rather than silently labeling a longer window", () => {
  const result = run([snapshot(three(), "2026-06-01", "2026-10-20")]).practice;
  assert.equal(result.totalEnded, null);
  assert.deepEqual(result.requestedWindow, july);
  assert.deepEqual(result.observedMaturePortion?.effectiveWindow, { start: "2026-07-01", end: "2026-07-22" });
});

test("historical report exposes the same helper for unchanged 3/12 windows", () => {
  const snapshots = [snapshot(three(), "2026-06-01", "2026-09-30")];
  for (const period of ["3mo", "year"] as const) {
    const report = historicalPerformance({ snapshots, today: "2026-10-20", period });
    const expected = run(snapshots, { asOf: "2026-10-20", requestedWindow: report.window.attrition });
    assert.deepEqual(report.periodAttrition, expected);
    assert.deepEqual(report.window.attrition, { start: period === "3mo" ? "2026-07-01" : "2025-10-01", end: "2026-09-30" });
    assert.equal(report.periodAttrition.practice.totalEnded, null);
  }
});

test("absent, invalid, interrupted or insufficient prior evidence withholds whole-window totals", () => {
  const noProof = snapshot(); delete noProof.reportCoverage;
  const invalid = snapshot(); invalid.reportCoverage!.end = "2026-11-31";
  const gap = [snapshot(three(), "2026-06-01", "2026-08-01"), snapshot([], "2026-08-03", "2026-11-30")];
  const prior = snapshot([visit("2026-05-02"), visit("2026-06-09"), visit("2026-07-16")]);
  for (const snapshots of [[noProof], [invalid], gap, [prior], []]) {
    const result = run(snapshots).practice;
    assert.equal(result.coverageComplete, false);
    assert.equal(result.totalEnded, null);
    assert.equal(result.percentage, null);
  }
});

test("left-censored establishment and incomplete prior active relationships are explicit", () => {
  const boundary = snapshot([visit("2026-06-01"), visit("2026-06-09"), visit("2026-07-16")]);
  assert.ok(run([boundary]).practice.reasons.includes("left-censored-establishment"));
  const onlyTwo = snapshot([visit("2026-06-10"), visit("2026-07-16")]);
  assert.ok(run([onlyTwo]).practice.reasons.includes("left-censored-establishment"));
});

test("uncertain later evidence blocks absence claims; future evidence cannot change them", () => {
  const excludedFollowUpEvidence = [{ clientId: "client", serviceDate: "2026-11-01" }];
  const result = run(undefined, { excludedFollowUpEvidence }).practice;
  assert.equal(result.totalEnded, null);
  assert.ok(result.reasons.includes("uncertain-follow-up-evidence"));
  assert.equal(run(undefined, { excludedFollowUpEvidence: [{ clientId: "client", serviceDate: "2026-12-01" }] }).practice.totalEnded, 1);
});

test("clinician coverage filters quiet declarations and never borrows another provider's proof", () => {
  const lane = snapshot(); delete lane.reportCoverage; delete lane.coverageClinicians;
  const moss = snapshot([], undefined, undefined, ["Moss"]);
  const result = run([lane, moss]);
  assert.equal(result.practice.coverageComplete, false);
  assert.equal(result.byClinician.find((row) => row.clinician === "Lane")?.coverageComplete, false);
  assert.equal(result.byClinician.find((row) => row.clinician === "Moss")?.coverageComplete, true);
  assert.equal(result.byClinician.find((row) => row.clinician === "Moss")?.totalEligible, 0);
});

test("contradictory attendance status removes coverage and cannot create an ending", () => {
  const cancelled = { ...three()[1], status: "cancelled" as const };
  const result = run([snapshot(), { ...snapshot([cancelled]), id: "conflicting-export" }]).practice;
  assert.equal(result.coverageComplete, false);
  assert.equal(result.totalEnded, null);
});

test("quiet derived coverage follows normalized admitted clinician scope", () => {
  const lane = snapshot(three().map((row) => ({ ...row, clinician: "  LANE  " })), "2026-06-01", "2026-07-31", [" Lane "]);
  const followUp = snapshot([], "2026-08-01", "2026-11-30", ["lane", "Moss"]);
  const result = run([lane, followUp]);
  assert.equal(result.byClinician.length, 2);
  assert.equal(result.byClinician.find((row) => row.clinician.toLowerCase() === "lane")?.percentage, 100);
  assert.equal(result.byClinician.find((row) => row.clinician === "Moss")?.totalEligible, null);
  assert.equal(result.practice.totalEnded, null);
});

test("covered zero ending numerator is 0%, but complete empty population has unknown percentage", () => {
  assert.equal(run([snapshot([...three(), visit("2026-11-01")])]).practice.percentage, 0);
  const empty = run([snapshot([])]).practice;
  assert.equal(empty.coverageComplete, true);
  assert.equal(empty.totalEligible, 0);
  assert.equal(empty.totalEnded, 0);
  assert.equal(empty.percentage, null);
  assert.ok(empty.reasons.includes("zero-eligible-denominator"));
});

test("frozen snapshots, classification, overrides and legacy results are preserved", () => {
  const snapshots = [snapshot()];
  const before = structuredClone(snapshots);
  const legacy = estimateLocalClientActivity(snapshots);
  const freeze = (value: object) => { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child); };
  freeze(snapshots);
  const overrides = Object.freeze({});
  const result = run(snapshots, { overrides, classificationSnapshots: snapshots });
  assert.equal(result.practice.percentage, 100);
  assert.deepEqual(snapshots, before);
  assert.deepEqual(estimateLocalClientActivity(snapshots), legacy);
});

test("invalid and reversed windows reject rather than silently shifting dates", () => {
  assert.throws(() => run(undefined, { requestedWindow: { start: "2026-07-32", end: july.end } }));
  assert.throws(() => run(undefined, { requestedWindow: { start: july.end, end: july.start } }));
});
