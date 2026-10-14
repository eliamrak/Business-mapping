import { test } from "node:test";
import assert from "node:assert/strict";
import {
  derivedShowVisits,
  importAttendanceCsv,
  importBillingCsv,
  sameDayVisitKey,
  summarizeConsultConversions,
  treatmentBillingRows,
} from "./retention-local.ts";

function legacyFacts(attendanceRows: string, billingRows: string) {
  const attendance = importAttendanceCsv(
    `Client,Clinician,Date of service,Location,Status\n${attendanceRows}`,
  ).snapshot;
  const billing = importBillingCsv(
    `Date of Service,Client,Clinician,Total Fee,Billing Code\n${billingRows}`,
  ).snapshot;
  attendance.reportCoverage = {
    start: "2026-01-01", end: "2026-04-30", complete: true,
  };
  return { attendance, billing, snapshots: [attendance, billing] };
}

test("legacy billing-only PHONE classification matches stable client, normalized clinician and date", () => {
  const { snapshots } = legacyFacts(
    "stable-1,Dr Intake,2026-01-01,Room A,show\nstable-1,Dr Treatment,2026-01-20,Room B,show",
    "2026-01-01,stable-1,  dr   intake  ,0, PHONE \n2026-01-20,stable-1,Dr Treatment,150,90837",
  );
  const before = JSON.stringify(snapshots);
  const summary = summarizeConsultConversions(snapshots, {}, "2026-01-01", "2026-01-31", "2026-02-10");
  assert.equal(summary.practice.consultations, 1);
  assert.equal(summary.practice.converted, 1);
  assert.equal(summary.journeys[0].consultDate, "2026-01-01");
  assert.equal(summary.journeys[0].treatmentDate, "2026-01-20");
  assert.equal(summary.journeys[0].creditedClinician, null);
  assert.equal(summary.journeys[0].attributionSource, "treatment_start_candidate");
  assert.equal(summary.byClinician.find(row => row.clinician === "Dr Treatment")?.candidateConversions, 1);
  assert.equal(derivedShowVisits(snapshots).length, 1);
  assert.equal(treatmentBillingRows(snapshots).length, 1);
  assert.equal(JSON.stringify(snapshots), before);
});

test("legacy PHONE match requires the same client, clinician and service date", () => {
  const { snapshots } = legacyFacts(
    "stable-1,Dr Intake,2026-01-01,Room A,show",
    "2026-01-01,stable-1,Dr Other,0,PHONE\n2026-01-02,stable-1,Dr Intake,0,PHONE\n2026-01-01,stable-2,Dr Intake,0,PHONE",
  );
  assert.equal(summarizeConsultConversions(snapshots).practice.consultations, 0);
  assert.equal(derivedShowVisits(snapshots).length, 1);
});

test("billing-only PHONE without attended show cannot create or credit a consultation", () => {
  const { snapshots } = legacyFacts(
    "cancelled,Dr Intake,2026-01-01,Room A,cancelled\nno-show,Dr Intake,2026-01-01,Room A,no show\nclinician-cancelled,Dr Intake,2026-01-01,Room A,clinician cancelled\nmissing,Dr Treatment,2026-01-20,Room B,show",
    "2026-01-01,cancelled,Dr Intake,0,PHONE\n2026-01-01,no-show,Dr Intake,0,PHONE\n2026-01-01,clinician-cancelled,Dr Intake,0,PHONE\n2026-01-01,missing,Dr Intake,0,PHONE",
  );
  const summary = summarizeConsultConversions(snapshots, {}, "2026-01-01", "2026-01-31", "2026-02-10", [
    { clientId: "missing", outcome: "confirmed_closer", clinicianName: "Dr Intake" },
  ]);
  assert.equal(summary.practice.consultations, 0);
  assert.deepEqual(summary.journeys, []);
  assert.deepEqual(summary.byClinician, []);
});

test("duplicate PHONE rows, shows and snapshots produce one consult journey", () => {
  const { attendance, billing, snapshots } = legacyFacts(
    "stable-1,Dr Intake,2026-01-01,Room A,show\nstable-1,Dr Intake,2026-01-01,Room A,show",
    "2026-01-01,stable-1,Dr Intake,0,PHONE\n2026-01-01,stable-1,Dr Intake,0,PHONE",
  );
  const summary = summarizeConsultConversions([...snapshots, attendance, billing], {
    [sameDayVisitKey(attendance.rows[0])]: 2,
  }, "2026-01-01", "2026-01-31", "2026-02-10");
  assert.equal(summary.practice.consultations, 1);
  assert.equal(summary.practice.missed, 1);
  assert.equal(summary.practice.converted, 0);
  assert.equal(summary.journeys.length, 1);
  assert.deepEqual(summary.journeys[0].consultClinicians, ["Dr Intake"]);
  assert.equal(summary.journeys[0].creditedClinician, null);
  assert.equal(derivedShowVisits(snapshots).length, 0);
  attendance.rows[0].billingCode = "PHONE";
  attendance.rows[0].visitKind = "consultation";
  assert.equal(summarizeConsultConversions(snapshots).practice.consultations, 1);
});

test("mixed PHONE and treatment billing preserves treatment shows and same-day overrides", () => {
  const { attendance, snapshots } = legacyFacts(
    "mixed,Dr Intake,2026-01-01,Room A,show\nmixed,Dr Intake,2026-01-01,Room B,show",
    "2026-01-01,mixed,Dr Intake,0,PHONE\n2026-01-01,mixed,Dr Intake,150,90837",
  );
  const overrides = { [sameDayVisitKey(attendance.rows[0])]: 2 };
  assert.equal(derivedShowVisits(snapshots).length, 1);
  assert.equal(derivedShowVisits(snapshots, overrides).length, 2);
  assert.equal(summarizeConsultConversions(snapshots, overrides).practice.consultations, 0);
  attendance.rows[0].visitKind = "consultation";
  const summary = summarizeConsultConversions(snapshots, overrides);
  assert.equal(summary.practice.consultations, 1);
  assert.equal(summary.practice.converted, 1);
  assert.equal(summary.journeys[0].treatmentDate, "2026-01-01");
  assert.equal(derivedShowVisits(snapshots, overrides).length, 1);
});

test("legacy consults preserve period, as-of, calendar-month and coverage maturity boundaries", () => {
  const { attendance, snapshots } = legacyFacts(
    "boundary,Dr Intake,2026-01-31,Room A,show\nboundary,Dr Treatment,2026-02-28,Room B,show\nlate,Dr Intake,2026-01-31,Room A,show\nlate,Dr Treatment,2026-03-01,Room B,show\nfuture,Dr Intake,2026-03-01,Room A,show",
    "2026-01-31,boundary,Dr Intake,0,PHONE\n2026-01-31,late,Dr Intake,0,PHONE\n2026-03-01,future,Dr Intake,0,PHONE",
  );
  const summarize = (start: string, end: string, asOf: string) =>
    summarizeConsultConversions(snapshots, {}, start, end, asOf);
  const mature = summarize("2026-01-31", "2026-01-31", "2026-03-10");
  assert.equal(mature.practice.consultations, 2);
  assert.equal(mature.practice.converted, 1);
  assert.equal(mature.practice.missed, 1);
  assert.equal(mature.practice.evaluated, 2);
  assert.equal(mature.practice.conversionRate, 50);
  assert.ok(mature.journeys.every(row => row.deadline === "2026-02-28"));
  assert.equal(summarize("2026-02-01", "2026-02-28", "2026-03-10").practice.consultations, 0);
  assert.equal(summarize("2026-01-01", "2026-03-31", "2026-01-30").practice.consultations, 0);
  const pending = summarize("2026-01-01", "2026-03-31", "2026-02-27");
  assert.equal(pending.practice.consultations, 2);
  assert.equal(pending.practice.pending, 2);
  assert.equal(pending.practice.evaluated, 0);
  delete attendance.reportCoverage;
  const unverified = summarize("2026-01-31", "2026-01-31", "2026-03-10");
  assert.equal(unverified.practice.converted, 1);
  assert.equal(unverified.practice.pending, 1);
  assert.equal(unverified.practice.missed, 0);
  assert.equal(unverified.coverageVerified, false);
});
