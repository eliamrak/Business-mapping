import { test } from "node:test";
import assert from "node:assert/strict";
import { importAttendanceCsv, sameDayVisitKey } from "./retention-local.ts";
import { sessionProgression } from "./session-progression.ts";
const attendance = (rows: string) => importAttendanceCsv(`Client,Clinician,Date of service,Location,Status\n${rows}`).snapshot;
const options = { start: "2026-01-01", end: "2026-01-31", asOf: "2026-03-01" };
test("empty and future cohorts have null percentages and eight stable milestones", () => {
  const result = sessionProgression([], options);
  assert.equal(result.rows.length, 8);
  assert.ok(result.rows.every(row => row.eligibleClients === 0 && row.completions === 0 && row.reachedPct === null && row.changePercentagePoints === null));
  assert.equal(sessionProgression([attendance("a,Lane,2026-04-01,Room,show")], options).eligibleClients, 0);
});
test("cohort window never truncates historical sequence; clinician selects first date and retains referrals", () => {
  const snapshot = attendance(`old,Lane,2025-12-01,Room,show
old,Lane,2026-01-03,Room,show
a,Lane,2026-01-02,Room,show
a,Other,2026-02-03,Room,show
a,Other,2026-03-02,Room,show
b,Other,2026-01-03,Room,show
b,Lane,2026-02-04,Room,show`);
  const result = sessionProgression([snapshot], { ...options, clinician: " LANE " });
  assert.equal(result.eligibleClients, 1);
  assert.deepEqual(result.rows.slice(0, 3).map(row => row.completions), [1, 1, 0]);
  assert.equal(sessionProgression([snapshot], { ...options, end: "2026-01-01" }).eligibleClients, 0);
});
test("recent ongoing clients remain in the denominator without absence or dropout inference; changes use unrounded rates", () => {
  const result = sessionProgression([attendance(`a,Lane,2026-01-01,Room,show
a,Lane,2026-01-02,Room,show
b,Lane,2026-01-31,Room,show
c,Lane,2026-01-31,Room,show`)], options);
  assert.equal(result.eligibleClients, 3);
  assert.equal(result.rows[0].changePercentagePoints, null);
  assert.ok(Math.abs(result.rows[1].reachedPct! - 100 / 3) < 1e-12);
  assert.equal(result.rows[1].changePercentagePoints, result.rows[1].reachedPct! - 100);
  assert.equal(result.rows[1].changePercentagePoints!.toFixed(1), "-66.7");
});
test("deduplicates imports and same-day rows, honors explicit same-day exceptions", () => {
  const snapshot = attendance(`a,Lane,2026-01-01,Room A,show
a,Lane,2026-01-01,Room B,show`);
  assert.equal(sessionProgression([snapshot, snapshot], options).rows[1].completions, 0);
  const overrides = { [sameDayVisitKey(snapshot.rows[0])]: 2 };
  assert.equal(sessionProgression([snapshot, snapshot], { ...options, sameDayVisitOverrides: overrides }).rows[1].completions, 1);
});
test("excludes consultations, documentation, non-shows and conflicts; classification evidence adds no visits", () => {
  const snapshot = attendance(`consult,Lane,2026-01-01,Room,show
doc,Lane,2026-01-01,Room,show
miss,Lane,2026-01-01,Room,no show
conflict,Lane,2026-01-01,Room,show
conflict,Lane,2026-01-01,Room,cancelled
a,Lane,2026-01-01,Room,show`);
  snapshot.rows[0].visitKind = "consultation";
  snapshot.rows[1].billingCode = "2";
  const classification = attendance("not-eligible,Lane,2026-01-02,Room,show");
  const conflicting = attendance("conflict,Lane,2026-01-01,Room,cancelled");
  const result = sessionProgression([snapshot, conflicting], { ...options, classificationSnapshots: [snapshot, classification], excludedFollowUpEvidence: [{ clientId: "a", serviceDate: "2026-02-01" }] });
  assert.equal(result.clientsWithUnresolvedEvidence, 1);
  assert.equal(result.eligibleClients, 1);
});
test("first-date clinician ties are explicit membership and independent of input order", () => {
  const snapshot = attendance(`a,Other,2026-01-01,Room,show
a,Lane,2026-01-01,Room,show`);
  const first = sessionProgression([snapshot], { ...options, clinician: "Lane" });
  assert.equal(first.eligibleClients, 1);
  assert.equal(first.rows[1].completions, 1);
  assert.deepEqual(sessionProgression([{ ...snapshot, rows: [...snapshot.rows].reverse() }], { ...options, clinician: "Lane" }), first);
});
test("rejects invalid dates, windows, filters and milestone limits", () => {
  for (const change of [{ start: "2026-02-30" }, { start: "2026-02-01" }, { sessions: 0 }, { sessions: 1.5 }, { sessions: 101 }, { clinician: " " }])
    assert.throws(() => sessionProgression([], { ...options, ...change }), RangeError);
});

test("coverage admission excludes partial sources without inventing missing visits", async () => {
  const { completeReportCoverage } = await import("./complete-report-coverage.ts");
  const admitted = { ...attendance("a,Lane,2026-01-01,Room,show"), reportCoverage: { start: "2026-01-01", end: "2026-01-14", complete: true as const } };
  const partial = attendance("a,Lane,2026-01-15,Room,show\nraw,Lane,2026-01-15,Room,show");
  const coverage = completeReportCoverage([admitted, partial], [{ id: 1, label: "Lane" }], options.asOf);
  const result = sessionProgression(coverage.eligibleSnapshots, { ...options, classificationSnapshots: [admitted, partial] });
  assert.equal(result.eligibleClients, 1);
  assert.equal(result.rows[1].completions, 0);
  assert.ok(coverage.excludedRowsCount > 0);
});

const lifetimeOptions = { start: "2026-01-01", end: "2026-06-30", asOf: "2026-06-30" };
const proven = (rows: string, start = "2026-01-01", end = "2026-06-30") => ({
  ...attendance(rows), reportCoverage: { start, end, complete: true as const },
});
test("lifetime means and medians separate apparent endings from recent and short observations", () => {
  const snapshot = proven(`ended,Lane,2026-01-01,Room,show
ended,Lane,2026-01-02,Room,show
ended,Lane,2026-01-11,Room,show
ended2,Lane,2026-01-01,Room,show
ended2,Lane,2026-01-03,Room,show
ended2,Lane,2026-01-10,Room,show
ended2,Lane,2026-01-21,Room,show
recent,Lane,2026-06-30,Room,show
short,Lane,2026-01-01,Room,show
short,Lane,2026-01-05,Room,show`);
  const { lifetime } = sessionProgression([snapshot], lifetimeOptions);
  assert.deepEqual(lifetime.apparentEndings, { clients: 2, meanSessions: 3.5, medianSessions: 3.5, meanElapsedDays: 15, medianElapsedDays: 15, coverageLimitedClients: 0 });
  assert.deepEqual(lifetime.ongoingOrCensored, { clients: 2, meanSessions: 1.5, medianSessions: 1.5, meanElapsedDays: 2, medianElapsedDays: 2, coverageLimitedClients: 0 });
});
test("unverified and gapped follow-up cannot produce apparent endings", () => {
  const rows = `a,Lane,2026-01-01,Room,show\na,Lane,2026-01-02,Room,show\na,Lane,2026-01-03,Room,show`;
  for (const snapshots of [[attendance(rows)], [proven(rows, "2026-01-01", "2026-01-14"), proven("other,Lane,2026-06-30,Room,no show", "2026-06-01", "2026-06-30")]]) {
    const result = sessionProgression(snapshots, lifetimeOptions).lifetime;
    assert.equal(result.apparentEndings.clients, 0);
    assert.equal(result.ongoingOrCensored.clients, 1);
    assert.equal(result.ongoingOrCensored.coverageLimitedClients, 1);
    assert.equal(result.ongoingOrCensored.meanElapsedDays, 2);
  }
});
test("referrals and later returns invalidate earlier endings; unresolved follow-up blocks absence claims", () => {
  const snapshot = proven(`a,Lane,2026-01-01,Room,show
a,Lane,2026-01-02,Room,show
a,Lane,2026-01-03,Room,show
a,Other,2026-06-25,Room,show`);
  const returned = sessionProgression([snapshot], { ...lifetimeOptions, clinician: "Lane" }).lifetime;
  assert.equal(returned.apparentEndings.clients, 0);
  assert.equal(returned.ongoingOrCensored.meanSessions, 4);
  assert.equal(returned.ongoingOrCensored.meanElapsedDays, 175);
  const noReturn = { ...snapshot, rows: snapshot.rows.slice(0, 3) };
  const unresolved = sessionProgression([noReturn], { ...lifetimeOptions, excludedFollowUpEvidence: [{ clientId: "a", serviceDate: "2026-06-25" }] }).lifetime;
  assert.equal(unresolved.apparentEndings.clients, 0);
  assert.equal(unresolved.ongoingOrCensored.coverageLimitedClients, 1);
});
test("same-day exceptions increase session count but cannot establish a three-date ending", () => {
  const snapshot = proven(`a,Lane,2026-01-01,Room A,show
a,Lane,2026-01-01,Room B,show
a,Lane,2026-01-01,Room C,show`);
  const lifetime = sessionProgression([snapshot, snapshot], { ...lifetimeOptions, sameDayVisitOverrides: { [sameDayVisitKey(snapshot.rows[0])]: 3 } }).lifetime;
  assert.equal(lifetime.apparentEndings.clients, 0);
  assert.equal(lifetime.ongoingOrCensored.meanSessions, 3);
  assert.equal(lifetime.ongoingOrCensored.medianElapsedDays, 0);
});
test("90-day boundary remains exact; no artificial 28-day requirement for ending establishment", () => {
  const snapshot = proven(`a,Lane,2026-01-01,Room,show
a,Lane,2026-02-10,Room,show
a,Lane,2026-04-01,Room,show`);
  assert.equal(sessionProgression([snapshot], { ...lifetimeOptions, asOf: "2026-06-29" }).lifetime.apparentEndings.clients, 0);
  assert.equal(sessionProgression([snapshot], lifetimeOptions).lifetime.apparentEndings.clients, 1);
});
test("empty lifetime groups use null statistics, and odd medians differ from means", () => {
  const empty = sessionProgression([], lifetimeOptions).lifetime;
  assert.equal(empty.apparentEndings.meanSessions, null);
  assert.equal(empty.ongoingOrCensored.medianElapsedDays, null);
  const snapshot = proven(`a,Lane,2026-06-30,Room,show
b,Lane,2026-06-30,Room,show
c,Lane,2026-06-01,Room,show
c,Lane,2026-06-02,Room,show
c,Lane,2026-06-30,Room,show`);
  const group = sessionProgression([snapshot], lifetimeOptions).lifetime.ongoingOrCensored;
  assert.equal(group.meanSessions, 5 / 3);
  assert.equal(group.medianSessions, 1);
  assert.equal(group.meanElapsedDays, 29 / 3);
  assert.equal(group.medianElapsedDays, 0);
});

test("verified apparent ending remains flagged when later coverage has a gap", () => {
  const snapshot = proven(`a,Lane,2026-01-01,Room,show
a,Lane,2026-01-02,Room,show
a,Lane,2026-01-03,Room,show`, "2026-01-01", "2026-04-30");
  const lifetime = sessionProgression([snapshot], lifetimeOptions).lifetime;
  assert.equal(lifetime.apparentEndings.clients, 1);
  assert.equal(lifetime.apparentEndings.coverageLimitedClients, 1);
  assert.equal(lifetime.ongoingOrCensored.clients, 0);
});
