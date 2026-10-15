import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  emptyWorkspace,
  workspaceSchema,
  clinicianSettingSchema,
  familyPaycheckSchema,
  allocationSchema,
  termSchema,
  staffTermSchema,
  periodSchema,
  monthFlow,
  forecast,
  staffMemberAt,
  staffCostForRange,
  additionalWithholdingPctFromNet,
  semiMonthlyChecksThrough,
  type Context,
} from "../src/hub/index.ts";

const wife = {
  id: 1,
  label: "W2 owner",
  goalId: null,
  sessionRate: 150,
  sessionsPerWeek: 20,
  weeksWorkedPerYear: 52.1786,
  capEnabled: false,
  capAmount: 0,
  preCapClinicianSplit: 60,
  preCapPracticeSplit: 40,
  postCapClinicianSplit: 60,
  postCapPracticeSplit: 40,
  classification: "w2",
  w2EmployerFicaPct: 7.65,
  futaSutaPct: 1,
  workersCompPct: 0.5,
  otherEmployerBurdenPct: 0.85,
};
const record = (start: string, end: string, completed: number) => ({
  id: 1,
  revision: 1,
  updatedAt: "2026-02-11T00:00:00Z",
  clinicianId: 1,
  start,
  end,
  completed,
  desired: 20,
  cancelled: null,
  noShow: null,
  scheduled: null,
  inPerson: null,
  telehealth: null,
  sourceAttachmentId: null,
});
const setup = () => {
  const workspace = emptyWorkspace("2026-01-15");
  workspace.settings.familyW2ClinicianId = 1;
  workspace.settings.baselineMode = "manual";
  workspace.settings.baselineWeeklySessions = 20;
  workspace.settings.defaultInPersonPct = 0;
  workspace.clinicians.push(
    clinicianSettingSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      start: "2026-01-01",
      desiredWeeklySessions: 20,
      payMode: "salary",
      payAmount: 120000,
      expectedSessionRevenue: 80,
    }),
  );
  return workspace;
};
const context = (sessions: Context["sessions"]): Context => ({
  clinicians: [wife],
  staff: [],
  sessions,
});
const staff = (classification = "w2", goalId: number | null = null) => ({
  id: 1,
  label: "Support",
  goalId,
  annualSalary: 48000,
  hourlyRate: null,
  hoursPerWeek: null,
  weeksPerYear: 52,
  classification,
  w2EmployerFicaPct: 7.65,
  futaSutaPct: 1,
  workersCompPct: 0.5,
  otherEmployerBurdenPct: 0.85,
});
const close = (actual: number | null, expected: number) =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) < 0.01,
    `${actual} != ${expected}`,
  );

test("W2 salary estimates net family pay without using recorded deposits", () => {
  const workspace = setup();
  workspace.familyPaychecks.push(
    familyPaycheckSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      date: "2026-01-09",
      netAmount: 2000,
    }),
  );
  const flow = monthFlow(
    workspace,
    context([record("2026-01-01", "2026-01-15", 20)]),
    "2026-01-01",
    "2026-01-15",
  );
  assert.equal(flow.through, "2026-01-15");
  close(flow.revenue, 1600);
  close(flow.familyGrossPay, 120000 / 24);
  close(flow.familyEmployerBurden, flow.familyGrossPay * 0.1);
  close(
    flow.profit,
    1600 - flow.familyGrossPay - flow.familyEmployerBurden - flow.processing,
  );
  assert.equal(flow.distribution, 0);
  close(flow.estimatedEmployeePayrollTax, flow.familyGrossPay * 0.0765);
  close(flow.estimatedAdditionalWithholding, flow.familyGrossPay * 0.15);
  close(flow.estimatedNetPay, flow.familyGrossPay * (1 - 0.0765 - 0.15));
  close(flow.familyTakeHome, flow.estimatedNetPay!);
  assert.notEqual(flow.familyTakeHome, 2000);
});

test("cross-month biweekly records are estimated by days and future periods are excluded", () => {
  const workspace = setup();
  const data = context([
    record("2026-01-28", "2026-02-10", 14),
    { ...record("2026-02-11", "2026-02-24", 14), id: 2 },
  ]);
  const january = monthFlow(workspace, data, "2026-01-01", "2026-02-11");
  const february = monthFlow(workspace, data, "2026-02-01", "2026-02-11");
  close(january.sessions, 4);
  close(february.sessions, 10);
  assert.equal(january.splitPeriods, true);
  assert.equal(february.splitPeriods, true);
  assert.equal(february.through, "2026-02-10");
});

test("missing session data remains unknown and old workspaces gain the tax estimate", () => {
  const workspace = setup();
  const old = structuredClone(workspace) as Record<string, unknown>;
  delete old.familyPaychecks;
  delete (old.settings as Record<string, unknown>).estimatedIncomeTaxPct;
  const restored = workspaceSchema.parse(old);
  assert.deepEqual(restored.familyPaychecks, []);
  assert.equal(restored.settings.estimatedIncomeTaxPct, 15);
  const flow = monthFlow(restored, context([]), "2026-01-01", "2026-01-15");
  assert.equal(flow.revenue, null);
  assert.equal(flow.profit, null);
  assert.equal(flow.familyTakeHome, null);
});

test("full-month projection applies the observed period average uniformly to every calendar day", () => {
  const workspace = setup();
  const flow = monthFlow(
    workspace,
    context([record("2026-10-01", "2026-10-07", 14)]),
    "2026-10-01",
    "2026-10-13",
    { fullMonthProjection: true },
  );
  assert.equal(flow.basisLabel, "Projection");
  assert.equal(flow.through, "2026-10-31");
  assert.equal(flow.sessionDataThrough, "2026-10-07");
  assert.equal(
    flow.paceSource,
    "observed session averages; unverified coverage remains an estimate; no desired-session fill",
  );
  assert.equal(flow.paceLookbackStart, "2026-08-19");
  close(flow.sessions, 14 / 7 * 31);
  close(flow.revenue, 14 / 7 * 31 * 80);
  close(flow.familyGrossPay, 120000 / 12);
});

test("a longer observed period with the same daily average does not add actual counts to the projection", () => {
  const workspace = setup();
  const flow = monthFlow(
    workspace,
    context([record("2026-10-01", "2026-10-14", 28)]),
    "2026-10-01",
    "2026-10-15",
    { fullMonthProjection: true },
  );
  const expectedSessions = 28 / 14 * 31;
  close(flow.sessions, expectedSessions);
  close(flow.revenue, expectedSessions * 80);
  assert.equal(flow.sessionDataThrough, "2026-10-14");
});

test("full-month projection uses the full contained cross-month period average, not clipped actuals plus gap-fill", () => {
  const workspace = setup();
  const flow = monthFlow(
    workspace,
    context([record("2026-09-24", "2026-10-07", 14)]),
    "2026-10-01",
    "2026-10-08",
    { fullMonthProjection: true },
  );
  const expectedSessions = 14 / 14 * 31;
  assert.equal(flow.splitPeriods, false, "A uniform period-average projection does not split actual service records");
  assert.equal(flow.sessionDataThrough, "2026-10-07");
  close(flow.sessions, expectedSessions);
  close(flow.revenue, expectedSessions * 80);
  const actual = monthFlow(workspace, context([record("2026-09-24", "2026-10-07", 14)]), "2026-10-01", "2026-10-08");
  assert.equal(actual.splitPeriods, true);
  close(actual.sessions, 7);
});

test("full-month projection stays unknown without observed sessions instead of falling back to desired pace", () => {
  const workspace = setup();
  const flow = monthFlow(workspace, context([]), "2026-10-01", "2026-10-13", {
    fullMonthProjection: true,
  });
  assert.equal(flow.basisLabel, "Projection");
  assert.equal(flow.through, "2026-10-31");
  assert.equal(flow.sessionDataThrough, null);
  assert.equal(
    flow.paceSource,
    "observed session average unavailable; no desired-session substitution",
  );
  assert.equal(flow.sessions, null);
  assert.equal(flow.revenue, null);
  assert.equal(flow.profit, null);
  assert.equal(flow.familyTakeHome, null);
  assert.deepEqual(flow.incompleteClinicians, [wife.label]);
});

test("one clinician without observed history makes the complete projection unknown", () => {
  const workspace = setup();
  const data = context([record("2026-10-01", "2026-10-14", 28)]);
  data.clinicians.push({ ...wife, id: 2, label: "Synthetic missing clinician", sessionsPerWeek: 50 });
  const flow = monthFlow(workspace, data, "2026-10-01", "2026-10-14", { fullMonthProjection: true });
  assert.equal(flow.sessions, null);
  assert.equal(flow.revenue, null);
  assert.equal(flow.profit, null);
  assert.deepEqual(flow.incompleteClinicians, ["Synthetic missing clinician"]);
});

test("six sparse clinician histories project 351 visits over 56 calendar days instead of full desired capacity", () => {
  const workspace = emptyWorkspace("2026-10-14");
  workspace.settings.defaultInPersonPct = 0;
  const totals = [66, 73, 34, 12, 104, 62];
  const desired = [15, 16, 20, 5, 23, 15];
  const fees = [150, 185, 150, 150, 175, 175];
  const dates = ["2026-08-20", "2026-08-27", "2026-09-03", "2026-09-10", "2026-09-17", "2026-09-24", "2026-10-09"];
  const data: Context = {
    clinicians: totals.map((_, index) => ({
      ...wife, id: index + 1, label: `Synthetic clinician ${index + 1}`, classification: "1099",
      sessionRate: fees[index], sessionsPerWeek: desired[index], weeksWorkedPerYear: 48,
    })), staff: [],
    sessions: totals.flatMap((total, index) => dates.map((date, day) => ({
      ...record(date, date, Math.floor(total / dates.length) + Number(day < total % dates.length)),
      id: -(index * dates.length + day + 1), clinicianId: index + 1,
    }))),
  };
  const before = structuredClone({ workspace, data });
  const flow = monthFlow(workspace, data, "2026-10-01", "2026-10-14", { fullMonthProjection: true });
  close(flow.sessions, 351 / 56 * 31);
  close(flow.sessions! * 7 / 31, 43.875);
  const weightedFees = totals.reduce((sum, total, index) => sum + total * fees[index], 0);
  close(flow.revenue, weightedFees / 56 * 31);
  assert.ok(flow.revenue! < 40000, "Actual-pace projection must not become the prior 61542.47 full-capacity projection");
  assert.match(flow.paceSource, /observed.*unverified.*no desired-session fill/);
  assert.equal(flow.paceLookbackStart, "2026-08-20");
  assert.equal(flow.sessionDataThrough, "2026-10-09");
  const changed = structuredClone(data);
  changed.clinicians.forEach((person) => { person.sessionsPerWeek += 10; });
  const higherDesired = monthFlow(workspace, changed, "2026-10-01", "2026-10-14", { fullMonthProjection: true });
  close(higherDesired.sessions, flow.sessions!);
  close(higherDesired.revenue, flow.revenue!);
  assert.deepEqual({ workspace, data }, before);
});

test("sparse negative-ID visit days use a 56-day denominator until matching attendance coverage is supplied", () => {
  const workspace = setup();
  const data = context([{ ...record("2026-09-20", "2026-09-20", 14), id: -1 },
    { ...record("2026-10-09", "2026-10-09", 14), id: -2 }]);
  const sparse = monthFlow(workspace, data, "2026-10-01", "2026-10-14", { fullMonthProjection: true });
  close(sparse.sessions, 28 / 56 * 31);
  assert.match(sparse.paceSource, /unverified/);
  const coverage = [{ clinicianId: 1, start: "2026-09-17", end: "2026-10-14" }];
  const covered = monthFlow(workspace, data, "2026-10-01", "2026-10-14", { fullMonthProjection: true, attendanceCoverage: coverage });
  close(covered.sessions, 28 / 28 * 31);
  const wrongClinician = monthFlow(workspace, data, "2026-10-01", "2026-10-14", {
    fullMonthProjection: true, attendanceCoverage: [{ ...coverage[0], clinicianId: 2 }],
  });
  close(wrongClinician.sessions, sparse.sessions!);
});

test("projection ignores imported billed amounts while month-to-date retains those exact actuals", () => {
  const workspace = setup();
  const data = context([record("2026-10-01", "2026-10-07", 14)]);
  const projectedBefore = monthFlow(workspace, data, "2026-10-01", "2026-10-14", { fullMonthProjection: true });
  const actualBefore = monthFlow(workspace, data, "2026-10-01", "2026-10-14");
  data.importedBillingActuals = [{ clinicianId: 1, serviceDate: "2026-10-01", totalFeeCharged: 999,
    sourceRowHash: "synthetic-billing-actual" }];
  const before = structuredClone(data);
  const projectedAfter = monthFlow(workspace, data, "2026-10-01", "2026-10-14", { fullMonthProjection: true });
  const actualAfter = monthFlow(workspace, data, "2026-10-01", "2026-10-14");
  close(projectedAfter.revenue, projectedBefore.revenue!);
  close(projectedAfter.sessions, projectedBefore.sessions!);
  close(actualAfter.revenue, 999 + 6 * 2 * 80);
  close(actualAfter.revenue! - actualBefore.revenue!, 999 - 2 * 80);
  assert.deepEqual(data, before);
});

test("a recorded zero remains zero and future incomplete periods cannot inflate the observed projection", () => {
  const workspace = setup();
  const data = context([record("2026-10-01", "2026-10-08", 0),
    { ...record("2026-10-09", "2026-10-22", 1000), id: 2 }]);
  const flow = monthFlow(workspace, data, "2026-10-01", "2026-10-14", { fullMonthProjection: true });
  close(flow.sessions, 0);
  close(flow.revenue, 0);
  assert.deepEqual(flow.incompleteClinicians, []);
  assert.equal(flow.sessionDataThrough, "2026-10-08");
});

test("October contractor projection pays both complete service periods including September 24-30", () => {
  const workspace = setup();
  workspace.clinicians[0].payMode = "per_session";
  workspace.clinicians[0].payAmount = 100;
  const data = context([record("2026-09-24", "2026-10-07", 14)]);
  data.clinicians[0] = { ...wife, classification: "1099" };
  const before = structuredClone({ workspace, data });
  const flow = monthFlow(workspace, data, "2026-10-01", "2026-10-08", { fullMonthProjection: true });
  // October 8 and 22 checks each pay 14 service days at one observed
  // session/day. Seven September service days belong to October's first check.
  close(flow.clinicianPay, 2 * 14 * 100);
  assert.notEqual(flow.clinicianPay, 2100, "Do not clip the first projected paycheck to October 1-7");
  close(flow.sessions, 31);
  assert.equal(flow.through, "2026-10-31");
  assert.deepEqual({ workspace, data }, before);
});

test("inactive or future-start clinicians with no history do not make active Money projection unavailable", () => {
  for (const profile of [
    { status: "planned", start: "2026-01-01", end: null },
    { status: "archived", start: "2026-01-01", end: null },
    { status: "active", start: "2026-11-01", end: null },
    { status: "active", start: "2026-01-01", end: "2026-09-30" },
  ] as const) {
    const workspace = setup();
    const data = context([record("2026-10-01", "2026-10-14", 28)]);
    data.clinicians.push({ ...wife, id: 2, label: "Synthetic inactive clinician", sessionsPerWeek: 30 });
    workspace.clinicians.push(clinicianSettingSchema.parse({
      id: randomUUID(), clinicianId: 2, desiredWeeklySessions: 30,
      payMode: "per_session", payAmount: 100, ...profile,
    }));
    const before = structuredClone({ workspace, data });
    const flow = monthFlow(workspace, data, "2026-10-01", "2026-10-14", { fullMonthProjection: true });
    assert.deepEqual(flow.incompleteClinicians, [], JSON.stringify(profile));
    close(flow.sessions, 62);
    close(flow.revenue, 62 * 80);
    assert.deepEqual({ workspace, data }, before);
  }
});

test("historical Money fallback reports actual history dates and the reported-period average", () => {
  const workspace = setup();
  const data = context([record("2026-07-01", "2026-07-14", 14)]);
  const flow = monthFlow(workspace, data, "2026-10-01", "2026-10-14", { fullMonthProjection: true });
  close(flow.sessions, 31);
  assert.equal(flow.sessionDataThrough, null, "Historical history must not appear as current-month recorded service dates");
  assert.match(flow.paceSource, /historical fallback 2026-05-20 to 2026-07-14, reported-period average/);
  assert.match(flow.paceSource, /no desired-session fill/);
});

test("month flow keeps month-to-date behavior unless projection is requested", () => {
  const workspace = setup();
  const flow = monthFlow(
    workspace,
    context([record("2026-10-01", "2026-10-07", 14)]),
    "2026-10-01",
    "2026-10-13",
  );
  assert.equal(flow.basisLabel, "Month to date");
  assert.equal(flow.through, "2026-10-07");
  assert.equal(flow.sessionDataThrough, "2026-10-07");
  close(flow.sessions, 14);
  close(flow.revenue, 1120);
  close(flow.familyGrossPay, 0);
});

test("historical unclosed months remain projections when projection mode is requested", () => {
  const workspace = setup();
  const flow = monthFlow(
    workspace,
    context([record("2026-09-01", "2026-09-14", 28)]),
    "2026-09-01",
    "2026-10-13",
    { fullMonthProjection: true },
  );
  assert.equal(flow.basisLabel, "Projection");
  assert.equal(flow.through, "2026-09-30");
  assert.equal(flow.sessionDataThrough, "2026-09-14");
});

test("support staff pay follows scheduled payroll even when session data is missing", () => {
  const workspace = setup();
  const flow = monthFlow(
    workspace,
    { clinicians: [wife], staff: [staff()], sessions: [] },
    "2026-01-01",
    "2026-01-15",
  );
  close(flow.staffPay, (48000 * 1.1) / 24);
  assert.equal(flow.revenue, null);
  assert.equal(flow.profit, null);
});

test("support staff pay respects the selected team filter", () => {
  const workspace = setup();
  workspace.settings.teamId = 7;
  const flow = monthFlow(
    workspace,
    { clinicians: [wife], staff: [staff("w2", 8)], sessions: [] },
    "2026-01-01",
    "2026-01-30",
  );
  close(flow.staffPay, 0);
});

test("support staff W2 pay uses semi-monthly checks and hourly burden once", () => {
  const workspace = setup();
  const hourly = {
    ...staff(),
    annualSalary: null,
    hourlyRate: 25,
    hoursPerWeek: 40,
  };
  const first = monthFlow(
    workspace,
    { clinicians: [wife], staff: [hourly], sessions: [] },
    "2026-01-01",
    "2026-01-15",
  );
  close(first.staffPay, (25 * 40 * 52 * 1.1) / 24);
  const second = monthFlow(
    workspace,
    { clinicians: [wife], staff: [hourly], sessions: [] },
    "2026-01-01",
    "2026-01-31",
  );
  close(second.staffPay, (25 * 40 * 52 * 1.1) / 12);
});

test("support staff scheduled payroll does not accrue before the payday", () => {
  const workspace = setup();
  const beforePayday = monthFlow(
    workspace,
    { clinicians: [wife], staff: [staff()], sessions: [] },
    "2026-10-01",
    "2026-10-10",
  );
  close(beforePayday.staffPay, 0);
});

test("default staff pay changes apply across one selected year only", () => {
  const workspace = setup();
  const hourly = {
    ...staff(),
    annualSalary: null,
    hourlyRate: 18,
    hoursPerWeek: 10,
    weeksPerYear: 48,
  };
  workspace.staffTerms.push(
    staffTermSchema.parse({
      id: randomUUID(),
      staffMemberId: hourly.id,
      effectiveDate: "2026-01-01",
      end: "2026-12-31",
      hourlyRate: 16,
    }),
  );
  const january = monthFlow(
    workspace,
    { clinicians: [wife], staff: [hourly], sessions: [] },
    "2026-01-01",
    "2026-01-31",
  );
  const october = monthFlow(
    workspace,
    { clinicians: [wife], staff: [hourly], sessions: [] },
    "2026-10-01",
    "2026-10-31",
  );
  const nextYear = monthFlow(
    workspace,
    { clinicians: [wife], staff: [hourly], sessions: [] },
    "2027-01-01",
    "2027-01-31",
  );
  close(january.staffPay, (16 * 10 * 48 * 1.1) / 12);
  close(october.staffPay, (16 * 10 * 48 * 1.1) / 12);
  close(nextYear.staffPay, (18 * 10 * 48 * 1.1) / 12);
});

test("staff pay terms reject backwards ranges and duplicate scopes", () => {
  assert.equal(
    staffTermSchema.safeParse({
      id: randomUUID(),
      staffMemberId: 1,
      effectiveDate: "2026-10-01",
      end: "2026-09-30",
      hourlyRate: 16,
    }).success,
    false,
  );
  const workspace = setup();
  workspace.staffTerms.push(
    staffTermSchema.parse({
      id: randomUUID(),
      staffMemberId: 1,
      effectiveDate: "2026-01-01",
      end: "2026-12-31",
      hourlyRate: 16,
    }),
    staffTermSchema.parse({
      id: randomUUID(),
      staffMemberId: 1,
      effectiveDate: "2026-01-01",
      end: "2026-12-31",
      hoursPerWeek: 12,
    }),
  );
  assert.equal(workspaceSchema.safeParse(workspace).success, false);
});

test("date-specific staff pay changes require an explicit boundary and isolate employees", () => {
  const workspace = setup();
  const hourly = {
    ...staff(),
    annualSalary: null,
    hourlyRate: 18,
    hoursPerWeek: 10,
    weeksPerYear: 48,
  };
  const peer = {
    ...hourly,
    id: 2,
    label: "Peer",
  };
  workspace.staffTerms.push(
    staffTermSchema.parse({
      id: randomUUID(),
      staffMemberId: hourly.id,
      effectiveDate: "2026-10-01",
      hourlyRate: 16,
    }),
  );
  const september = monthFlow(
    workspace,
    { clinicians: [wife], staff: [hourly, peer], sessions: [] },
    "2026-09-01",
    "2026-09-30",
  );
  const october = monthFlow(
    workspace,
    { clinicians: [wife], staff: [hourly, peer], sessions: [] },
    "2026-10-01",
    "2026-10-31",
  );
  close(september.staffPay, ((18 + 18) * 10 * 48 * 1.1) / 12);
  close(october.staffPay, ((16 + 18) * 10 * 48 * 1.1) / 12);
});

test("explicit same-date staff term overrides annual baseline deterministically", () => {
  const workspace = setup();
  const hourly = {
    ...staff(),
    annualSalary: null,
    hourlyRate: 18,
    hoursPerWeek: 10,
    weeksPerYear: 48,
  };
  workspace.staffTerms.push(
    staffTermSchema.parse({
      id: randomUUID(),
      staffMemberId: hourly.id,
      effectiveDate: "2026-01-01",
      hourlyRate: 15,
    }),
    staffTermSchema.parse({
      id: randomUUID(),
      staffMemberId: hourly.id,
      effectiveDate: "2026-01-01",
      end: "2026-12-31",
      hourlyRate: 16,
    }),
  );
  assert.equal(staffMemberAt(workspace, hourly, "2026-01-15").hourlyRate, 15);
});

test("staff pay terms accumulate partial later changes", () => {
  const workspace = setup();
  const hourly = {
    ...staff(),
    annualSalary: null,
    hourlyRate: 18,
    hoursPerWeek: 10,
    weeksPerYear: 48,
  };
  workspace.staffTerms.push(
    staffTermSchema.parse({
      id: randomUUID(),
      staffMemberId: hourly.id,
      effectiveDate: "2026-01-01",
      end: "2026-12-31",
      hourlyRate: 16,
    }),
    staffTermSchema.parse({
      id: randomUUID(),
      staffMemberId: hourly.id,
      effectiveDate: "2026-10-01",
      hoursPerWeek: 12,
    }),
  );
  const effective = staffMemberAt(workspace, hourly, "2026-10-15");
  assert.equal(effective.hourlyRate, 16);
  assert.equal(effective.hoursPerWeek, 12);
  close(
    staffCostForRange(workspace, hourly, "2026-10-01", "2026-10-31"),
    (16 * 12 * 48 * 1.1) / 12,
  );
});

test("staff pay terms prorate midmonth boundaries consistently", () => {
  const workspace = setup();
  const hourly = {
    ...staff(),
    annualSalary: null,
    hourlyRate: 18,
    hoursPerWeek: 10,
    weeksPerYear: 48,
  };
  workspace.staffTerms.push(
    staffTermSchema.parse({
      id: randomUUID(),
      staffMemberId: hourly.id,
      effectiveDate: "2026-10-16",
      hourlyRate: 16,
    }),
  );
  const expected =
    ((18 * 10 * 48 * 1.1) / 12 / 31) * 15 +
    ((16 * 10 * 48 * 1.1) / 12 / 31) * 16;
  close(
    staffCostForRange(workspace, hourly, "2026-10-01", "2026-10-31"),
    expected,
  );
  close(
    forecast(workspace, {
      clinicians: [wife],
      staff: [hourly],
      sessions: [],
    })[9].values.staffCost,
    expected,
  );
});

test("scheduled staff payroll prorates effective rates over the paycheck service period", () => {
  const workspace = setup();
  const hourly = {
    ...staff(),
    annualSalary: null,
    hourlyRate: 18,
    hoursPerWeek: 10,
    weeksPerYear: 48,
  };
  workspace.staffTerms.push(
    staffTermSchema.parse({
      id: randomUUID(),
      staffMemberId: hourly.id,
      effectiveDate: "2026-10-08",
      hourlyRate: 16,
    }),
  );
  const expected =
    ((18 * 10 * 48 * 1.1) / 24 / 15) * 7 + ((16 * 10 * 48 * 1.1) / 24 / 15) * 8;
  close(
    monthFlow(
      workspace,
      { clinicians: [wife], staff: [hourly], sessions: [] },
      "2026-10-01",
      "2026-10-15",
    ).staffPay,
    expected,
  );
});

test("recorded staff payroll stays actual while modeled months recalculate", () => {
  const workspace = setup();
  workspace.periods.push(
    periodSchema.parse({
      id: randomUUID(),
      name: "January actuals",
      start: "2026-01-01",
      end: "2026-01-31",
      status: "finalized",
      revenue: 5000,
      earnedRevenue: 5000,
      clinicianPay: 1000,
      employerBurden: 100,
      staffPay: 1234,
      ownerPay: 0,
      expensesComplete: true,
    }),
  );
  workspace.staffTerms.push(
    staffTermSchema.parse({
      id: randomUUID(),
      staffMemberId: 1,
      effectiveDate: "2026-01-01",
      end: "2026-12-31",
      hourlyRate: 16,
    }),
  );
  const hourly = {
    ...staff(),
    annualSalary: null,
    hourlyRate: 18,
    hoursPerWeek: 10,
    weeksPerYear: 48,
  };
  const months = forecast(workspace, {
    clinicians: [wife],
    staff: [hourly],
    sessions: [],
  });
  close(workspace.periods[0].staffPay, 1234);
  close(months[0].values.staffCost, (16 * 10 * 48 * 1.1) / 12);
  close(months[1].values.staffCost, (16 * 10 * 48 * 1.1) / 12);
});

test("support staff 1099 pay follows biweekly Thursdays including three-check months", () => {
  const workspace = setup();
  const contractor = { ...staff("1099"), annualSalary: 52000 };
  const beforeFirstCurrentYearPeriod = monthFlow(
    workspace,
    { clinicians: [wife], staff: [contractor], sessions: [] },
    "2026-01-01",
    "2026-01-01",
  );
  close(beforeFirstCurrentYearPeriod.staffPay, 0);
  const december = monthFlow(
    workspace,
    { clinicians: [wife], staff: [contractor], sessions: [] },
    "2026-12-01",
    "2026-12-31",
  );
  close(december.staffPay, (52000 / 26) * 3);
  const july = monthFlow(
    workspace,
    { clinicians: [wife], staff: [contractor], sessions: [] },
    "2027-07-01",
    "2027-07-31",
  );
  close(july.staffPay, 6000);
});

test("the forecast uses expected average revenue without changing fixed W2 salary", () => {
  const workspace = setup();
  const modeled = forecast(workspace, context([]))[0].values;
  const listed = structuredClone(workspace);
  listed.clinicians[0].expectedSessionRevenue = null;
  const original = forecast(listed, context([]))[0].values;
  close(modeled.revenue, ((original.revenue ?? 0) * 80) / 150);
  close(modeled.clinicianPay, original.clinicianPay ?? 0);
  close(modeled.familyTakeHome, (120000 / 12) * (1 - 0.0765 - 0.15));
});

test("named savings funds are allocations after profit, not business costs", () => {
  const workspace = setup();
  workspace.clinicians[0].payAmount = 0;
  workspace.familyPaychecks.push(
    familyPaycheckSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      date: "2026-01-09",
      netAmount: 2000,
    }),
  );
  workspace.allocations.push(
    allocationSchema.parse({
      id: randomUUID(),
      name: "Tax fund",
      kind: "tax",
      percent: 20,
      start: "2026-01-01",
    }),
    allocationSchema.parse({
      id: randomUUID(),
      name: "Furniture fund",
      kind: "reserve",
      percent: 15,
      start: "2026-01-01",
    }),
    allocationSchema.parse({
      id: randomUUID(),
      name: "Your distribution",
      kind: "distribution",
      household: true,
      percent: 25,
      start: "2026-01-01",
    }),
  );
  const flow = monthFlow(
    workspace,
    context([record("2026-01-01", "2026-01-14", 20)]),
    "2026-01-01",
    "2026-01-15",
  );
  close(flow.profit, 1600);
  close(
    flow.allocations.find((item) => item.name === "Furniture fund")?.amount ??
      null,
    240,
  );
  close(flow.distribution, 400);
  close(flow.retained, 640);
  close(flow.familyTakeHome, 400);
});

test("income-tax assumption changes net pay, not business profit", () => {
  const workspace = setup();
  const data = context([record("2026-01-01", "2026-01-15", 20)]);
  const original = monthFlow(workspace, data, "2026-01-01", "2026-01-15");
  workspace.settings.estimatedIncomeTaxPct = 20;
  const adjusted = monthFlow(workspace, data, "2026-01-01", "2026-01-15");
  close(adjusted.profit, original.profit!);
  close(
    adjusted.familyTakeHome,
    original.familyTakeHome! - original.familyGrossPay * 0.05,
  );
  const modeled = forecast(workspace, context([]))[0].values;
  close(modeled.familyTakeHome, (120000 / 12) * (1 - 0.0765 - 0.2));
});

test("month-to-date processing uses the existing successful-payment assumption", () => {
  const workspace = setup();
  workspace.settings.collectionPct = 75;
  workspace.settings.processingPct = 3.15;
  workspace.settings.processingFixedPerTransaction = 0.3;
  workspace.settings.processingTransactionsPerSession = 1;
  const flow = monthFlow(
    workspace,
    context([record("2026-01-01", "2026-01-14", 20)]),
    "2026-01-01",
    "2026-01-15",
  );
  close(flow.revenue, 1600);
  close(flow.processing, 1600 * 0.75 * 0.0315 + 20 * 0.75 * 0.3);
});

test("planned clinicians remain outside Today's operating totals", () => {
  const workspace = setup();
  workspace.clinicians[0].status = "planned";
  const flow = monthFlow(
    workspace,
    context([record("2026-01-01", "2026-01-14", 20)]),
    "2026-01-01",
    "2026-01-15",
  );
  close(flow.revenue, 0);
  close(flow.clinicianPay, 0);
});

test("month-to-date pay uses the clinician setup active in the selected month", () => {
  const workspace = setup();
  workspace.terms.push(
    termSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      effectiveDate: "2026-02-01",
      payMode: "salary",
      payAmount: 60000,
    }),
  );
  const data = context([
    record("2026-01-01", "2026-01-15", 20),
    { ...record("2026-02-01", "2026-02-15", 20), id: 2 },
  ]);
  const january = monthFlow(workspace, data, "2026-01-01", "2026-02-15");
  const february = monthFlow(workspace, data, "2026-02-01", "2026-02-15");
  close(january.familyGrossPay, 120000 / 12);
  close(february.familyGrossPay, 60000 / 24);
});

test("dated terms change revenue and salary on their effective day", () => {
  const workspace = setup();
  workspace.terms.push(
    termSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      effectiveDate: "2026-01-16",
      payMode: "salary",
      payAmount: 60000,
      expectedSessionRevenue: 100,
    }),
  );
  const flow = monthFlow(
    workspace,
    context([record("2026-01-01", "2026-01-30", 30)]),
    "2026-01-01",
    "2026-01-30",
  );
  close(flow.revenue, 15 * 80 + 15 * 100);
  close(flow.familyGrossPay, 120000 / 24 + 60000 / 24);
});

test("dated pay changes reload without creating a second operating profile", () => {
  const workspace = setup();
  workspace.terms.push(
    termSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      effectiveDate: "2026-02-01",
      payMode: "per_session",
      payAmount: 85,
    }),
  );
  const restored = workspaceSchema.parse(JSON.parse(JSON.stringify(workspace)));
  assert.equal(restored.clinicians.length, 1);
  assert.equal(restored.terms.length, 1);
  const duplicate = structuredClone(workspace);
  duplicate.clinicians.push(
    clinicianSettingSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      start: "2026-02-01",
      desiredWeeklySessions: 20,
    }),
  );
  assert.equal(workspaceSchema.safeParse(duplicate).success, false);
});

test("dated hourly terms carry their own paid-hours assumption", () => {
  const workspace = setup();
  workspace.terms.push(
    termSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      effectiveDate: "2026-01-16",
      payMode: "hourly",
      payAmount: 100,
      paidHoursPerWeek: 14,
    }),
  );
  const flow = monthFlow(
    workspace,
    context([record("2026-01-01", "2026-01-30", 30)]),
    "2026-01-01",
    "2026-01-30",
  );
  close(flow.familyGrossPay, 120000 / 24 + ((100 * 14) / 7) * 15);
});

test("a known net paycheck calibrates withholding and two scheduled checks", () => {
  const workspace = setup();
  workspace.clinicians[0].payAmount = 90000;
  const additionalPct = additionalWithholdingPctFromNet(90000 / 24, 2741.42);
  assert.ok(additionalPct !== null);
  workspace.settings.estimatedIncomeTaxPct = additionalPct;
  close(additionalPct, 19.245466666666662);
  assert.equal(
    semiMonthlyChecksThrough("2026-02-01", "2026-02-27", "2026-02-01"),
    1,
  );
  assert.equal(
    semiMonthlyChecksThrough("2026-02-01", "2026-02-28", "2026-02-01"),
    2,
  );
  const beforeFirst = monthFlow(
    workspace,
    context([record("2026-09-01", "2026-09-14", 20)]),
    "2026-09-01",
    "2026-09-14",
  );
  close(beforeFirst.familyGrossPay, 0);
  const first = monthFlow(
    workspace,
    context([record("2026-09-01", "2026-09-23", 20)]),
    "2026-09-01",
    "2026-09-28",
  );
  close(first.familyGrossPay, 3750);
  close(first.estimatedEmployeePayrollTax, 286.875);
  close(first.estimatedAdditionalWithholding, 721.705);
  close(first.estimatedNetPay, 2741.42);
  close(first.employerBurden, 375);
  close(first.profit, first.revenue! - 3750 - 375 - first.processing);
  close(first.familyTakeHome, 2741.42);
  const full = monthFlow(
    workspace,
    context([record("2026-09-01", "2026-09-30", 20)]),
    "2026-09-01",
    "2026-09-30",
  );
  close(full.familyGrossPay, 7500);
  close(full.estimatedNetPay, 5482.84);
  close(forecast(workspace, context([]))[0].values.familyTakeHome, 5482.84);
});

test("1099 salary follows the Thursday biweekly calendar anchored back to January 2026", () => {
  const workspace = setup();
  const contractor = { ...wife, classification: "1099" };
  const janFirst = monthFlow(
    workspace,
    {
      clinicians: [contractor],
      staff: [],
      sessions: [record("2026-01-01", "2026-01-01", 1)],
    },
    "2026-01-01",
    "2026-01-01",
  );
  close(janFirst.clinicianPay, 0);
  const oneCheck = monthFlow(
    workspace,
    {
      clinicians: [contractor],
      staff: [],
      sessions: [record("2026-01-01", "2026-01-28", 20)],
    },
    "2026-01-01",
    "2026-01-28",
  );
  close(oneCheck.clinicianPay, 120000 / 26);
  const twoChecks = monthFlow(
    workspace,
    {
      clinicians: [contractor],
      staff: [],
      sessions: [record("2026-01-01", "2026-01-29", 20)],
    },
    "2026-01-01",
    "2026-01-29",
  );
  close(twoChecks.clinicianPay, (120000 / 26) * 2);
});

test("1099 per-session pay lands on the next anchored Thursday paycheck", () => {
  const workspace = setup();
  workspace.clinicians[0].payMode = "per_session";
  workspace.clinicians[0].payAmount = 100;
  const contractor = { ...wife, classification: "1099" };
  const beforePayday = monthFlow(
    workspace,
    {
      clinicians: [contractor],
      staff: [],
      sessions: [record("2026-09-10", "2026-09-23", 14)],
    },
    "2026-09-01",
    "2026-09-23",
  );
  close(beforePayday.clinicianPay, 0);
  const septemberPayday = monthFlow(
    workspace,
    {
      clinicians: [contractor],
      staff: [],
      sessions: [record("2026-09-10", "2026-09-23", 14)],
    },
    "2026-09-01",
    "2026-09-24",
  );
  close(septemberPayday.clinicianPay, 1400);
  const octoberPayday = monthFlow(
    workspace,
    {
      clinicians: [contractor],
      staff: [],
      sessions: [record("2026-09-24", "2026-10-07", 14)],
    },
    "2026-10-01",
    "2026-10-08",
  );
  close(octoberPayday.sessions, 7);
  close(octoberPayday.clinicianPay, 1400);
});

test("1099 per-session pay without an operating profile includes the full prior-month pay period", () => {
  const workspace = setup();
  workspace.clinicians = [];
  const contractor = { ...wife, classification: "1099" };
  const octoberPayday = monthFlow(
    workspace,
    {
      clinicians: [contractor],
      staff: [],
      sessions: [record("2026-09-24", "2026-10-07", 14)],
    },
    "2026-10-01",
    "2026-10-08",
  );
  close(octoberPayday.sessions, 7);
  close(
    octoberPayday.clinicianPay,
    ((14 * contractor.preCapClinicianSplit) / 100) * contractor.sessionRate,
  );
});

test("1099 per-session pay honors an explicit operating profile start date", () => {
  const workspace = setup();
  workspace.clinicians[0].start = "2026-10-01";
  workspace.clinicians[0].payMode = "per_session";
  workspace.clinicians[0].payAmount = 100;
  const contractor = { ...wife, classification: "1099" };
  const octoberPayday = monthFlow(
    workspace,
    {
      clinicians: [contractor],
      staff: [],
      sessions: [record("2026-09-24", "2026-10-07", 14)],
    },
    "2026-10-01",
    "2026-10-08",
  );
  close(octoberPayday.sessions, 7);
  close(octoberPayday.clinicianPay, 700);
});

test("semi-monthly pay uses the 30th instead of waiting for a 31st", () => {
  assert.equal(
    semiMonthlyChecksThrough("2026-01-01", "2026-01-29", "2026-01-01"),
    1,
  );
  assert.equal(
    semiMonthlyChecksThrough("2026-01-01", "2026-01-30", "2026-01-01"),
    2,
  );
  assert.equal(
    semiMonthlyChecksThrough("2026-01-01", "2026-01-31", "2026-01-01"),
    2,
  );
  assert.equal(
    semiMonthlyChecksThrough("2026-02-01", "2026-02-28", "2026-02-01"),
    2,
  );
});
