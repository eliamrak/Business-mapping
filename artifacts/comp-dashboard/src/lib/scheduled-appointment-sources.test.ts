import assert from "node:assert/strict";
import test from "node:test";
import type { ImportEvidenceDeclarations } from "@workspace/practice/hub";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { summarizeBookingConversions } from "./consult-booking-conversions.ts";
import { consultAttendanceClassifier, importAttendanceCsv, importBillingCsv } from "./retention-local.ts";
import { scheduledAppointmentSources } from "./scheduled-appointment-sources.ts";

const roster = [
  { id: 1, label: "Intake", goalId: 7 },
  { id: 2, label: "Other", goalId: 8 },
  { id: 3, label: "Copied", goalId: 7 },
  { id: 4, label: "Copied", goalId: 8 },
];
const declarations: ImportEvidenceDeclarations = {
  version: 1, sourceSets: [], mappings: [
    { sourceLabel: "Alias", clinicianId: 1, clinicianLabel: "Intake", teamId: 7 },
    { sourceLabel: "Receiving", clinicianId: 2, clinicianLabel: "Other", teamId: 8 },
  ],
};
function attendance(rows: string[]) {
  const source = importAttendanceCsv([
    "Client,Clinician,Date of service,Location,Status,Billing code", ...rows,
  ].join("\n")).snapshot;
  source.importedAt = "2026-01-12T12:00:00Z";
  source.reportCoverage = { start: "2026-01-01", end: "2026-03-31", complete: true };
  source.coverageClinicians = ["Intake", "Quiet"];
  return source;
}

test("aliases use canonical identities and retain partial/future observations without source retagging", () => {
  const source = attendance([
    "ClientA, alias ,2026-01-10,Phone,show,CONSULT",
    "ClientA,Intake,2026-03-20,Room,cancelled,FULLSESSION",
    "clienta,Intake,2026-01-11,Room,no show,FULLSESSION",
  ]);
  source.rows[0].visitKind = "consultation";
  source.rows[1].cancellationSubtype = "late_cancelled";
  source.sourceSnapshotId = "original-source";
  const before = structuredClone({ source, roster, declarations });
  const result = scheduledAppointmentSources([source], roster, declarations);
  const { reportCoverage, coverageClinicians, ...expected } = source;
  assert.deepEqual(result.snapshots, [{ ...expected, rows: source.rows.map(row => ({ ...row, clinician: "Intake" })) }]);
  assert.deepEqual(result.excludedFollowUpEvidence, []);
  assert.notEqual(result.snapshots[0], source);
  assert.notEqual(result.snapshots[0].rows[0], source.rows[0]);
  const summary = summarizeBookingConversions([], {}, "2026-01-01", "2026-01-31", "2026-01-12", [], {
    appointmentSnapshots: result.snapshots, excludedFollowUpEvidence: result.excludedFollowUpEvidence,
  });
  assert.equal(summary.practice.converted, 1);
  assert.equal(summary.practice.observedTreatmentStarts, 0);
  assert.equal(summary.coverageVerified, false);
  assert.deepEqual({ source, roster, declarations }, before);
});

test("unknown and ambiguous same-name providers are excluded across the full roster", () => {
  const source = attendance([
    "ClientA,Copied,2026-01-20,Room,show,FULLSESSION",
    "clienta,Unknown,2026-01-21,Room,cancelled,FULLSESSION",
  ]);
  const result = scheduledAppointmentSources([source], roster);
  assert.deepEqual(result.snapshots[0].rows, []);
  assert.deepEqual(result.excludedFollowUpEvidence, source.rows.map(({ clientId, serviceDate, status }) => ({ clientId, serviceDate, status, observedAt: source.importedAt })));
});

test("stale and conflicting mappings follow resolver semantics without name fallback", () => {
  const source = attendance(["ClientA,Alias,2026-01-20,Room,show,FULLSESSION"]);
  const staleRosters = [
    roster.filter(person => person.id !== 1),
    roster.map(person => person.id === 1 ? { ...person, label: "Renamed" } : person),
    roster.map(person => person.id === 1 ? { ...person, goalId: 8 } : person),
  ];
  for (const people of staleRosters) {
    const result = scheduledAppointmentSources([source], people, declarations);
    assert.equal(result.snapshots[0].rows.length, 0);
    assert.deepEqual(result.excludedFollowUpEvidence, [{ clientId: "ClientA", serviceDate: "2026-01-20", observedAt: source.importedAt, status: "show" }]);
  }
  const conflicting = { ...declarations, mappings: [...declarations.mappings, declarations.mappings[0]] };
  assert.equal(scheduledAppointmentSources([source], roster, conflicting).snapshots[0].rows.length, 0);
  const normal = attendance(["ClientA,Intake,2026-01-20,Room,show,FULLSESSION"]);
  const invalid = { ...declarations, mappings: [{ ...declarations.mappings[0], sourceLabel: "Intake", clinicianLabel: "Old" }] };
  assert.equal(scheduledAppointmentSources([normal], roster, invalid).snapshots[0].rows.length, 0);
});

test("known other-team follow-up and normal names need no current-team admission", () => {
  const source = attendance([
    "ClientA,Receiving,2026-01-20,Room,show,FULLSESSION",
    "ClientA, other ,2026-01-21,Room,clinician cancelled,FULLSESSION",
    "ClientA, intake ,2026-01-10,Phone,show,CONSULT",
  ]);
  assert.deepEqual(scheduledAppointmentSources([source], roster, declarations).snapshots[0].rows.map(row => row.clinician), ["Other", "Other", "Intake"]);
  assert.equal(scheduledAppointmentSources([source], roster).snapshots[0].rows.length, 2);
});

test("attendance only, including quiet sources, carries no report proof or invented coverage", () => {
  const source = attendance(["ClientA,Intake,2026-01-10,Phone,show,CONSULT"]);
  source.rows[0].visitKind = "consultation";
  const quiet = { ...source, id: "quiet-source", rows: [] };
  const billing = importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code\nClientA,Unknown,2026-01-20,100,FULLSESSION").snapshot;
  const result = scheduledAppointmentSources([source, quiet, billing], roster);
  assert.equal(result.snapshots.length, 2);
  assert.deepEqual(result.excludedFollowUpEvidence, []);
  for (const snapshot of result.snapshots) {
    assert.equal(Object.hasOwn(snapshot, "reportCoverage"), false);
    assert.equal(Object.hasOwn(snapshot, "coverageClinicians"), false);
  }
  const proof = completeReportCoverage(result.snapshots, roster, "2026-04-01", roster);
  assert.equal(proof.attendanceThrough, null);
  assert.deepEqual(proof.completeAttendanceCoverage, []);
  const summary = summarizeBookingConversions([], {}, "2026-01-01", "2026-01-31", "2026-04-01", [], { appointmentSnapshots: result.snapshots });
  assert.equal(summary.practice.missed, 0);
  assert.equal(summary.practice.pending, 1);
});

test("observed mapped IDs sharing a canonical name cannot form a false same-clinician close", () => {
  const people = [{ id: 1, label: "Copied", goalId: 7 }, { id: 2, label: "Copied", goalId: 8 }];
  const data: ImportEvidenceDeclarations = { version: 1, sourceSets: [], mappings: people.map((person, index) => ({
    sourceLabel: index === 0 ? "aliasA" : "aliasB", clinicianId: person.id, clinicianLabel: person.label, teamId: person.goalId,
  })) };
  const consult = attendance(["ClientA,aliasA,2026-01-10,Phone,show,CONSULT"]);
  consult.rows[0].visitKind = "consultation";
  const followUp = attendance(["ClientA,aliasB,2026-01-20,Room,show,FULLSESSION"]);
  const before = structuredClone({ consult, followUp, people, data });
  const result = scheduledAppointmentSources([consult, followUp], people, data);
  assert.ok(result.snapshots.every(snapshot => snapshot.rows.length === 0));
  assert.equal(result.excludedFollowUpEvidence.length, 2);
  const summary = summarizeBookingConversions([], {}, "2026-01-01", "2026-01-31", "2026-02-01", [], {
    appointmentSnapshots: result.snapshots, classificationSnapshots: result.classificationSnapshots,
    unresolvedAppointmentEvidence: result.excludedFollowUpEvidence,
  });
  assert.equal(summary.practice.converted, 0);
  const single = scheduledAppointmentSources([consult], people, data);
  assert.equal(single.snapshots[0].rows[0].clinician, "Copied", "Unused roster copy must not reject the sole observed mapped ID");
  const billing = importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code\nClientA,aliasB,2026-01-20,100,FULLSESSION").snapshot;
  const crossKind = scheduledAppointmentSources([consult, billing], people, data);
  assert.ok(crossKind.classificationSnapshots.every(snapshot => snapshot.rows.length === 0));
  assert.equal(crossKind.excludedFollowUpEvidence.length, 1);
  assert.deepEqual({ consult, followUp, people, data }, before);
});

test("billing-only PHONE aliases classify mapped attendance without supplying appointment facts", () => {
  const source = attendance(["ClientA,Intake,2026-01-10,Room,show,"]);
  const billing = importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code\nClientA,Alias,2026-01-10,0,PHONE").snapshot;
  const before = structuredClone({ source, billing });
  const result = scheduledAppointmentSources([source, billing], roster, declarations);
  assert.equal(result.snapshots.length, 1);
  assert.equal(result.classificationSnapshots.length, 2);
  assert.ok(result.classificationSnapshots.every(snapshot => snapshot.rows[0].clinician === "Intake"));
  assert.equal(consultAttendanceClassifier(result.classificationSnapshots)(result.snapshots[0].rows[0]), true);
  const summary = summarizeBookingConversions([], {}, "2026-01-01", "2026-01-31", "2026-02-01", [], {
    appointmentSnapshots: result.snapshots, classificationSnapshots: result.classificationSnapshots,
  });
  assert.equal(summary.practice.consultations, 1);
  assert.equal(summary.practice.converted, 0);
  assert.equal(summary.practice.observedTreatmentStarts, 0);
  assert.deepEqual({ source, billing }, before);
});

test("future-source exclusions preserve exact observation time, clinical status and opaque client IDs", () => {
  const source = attendance([
    "ClientA,Unknown,2026-01-20,Room,cancelled,FULLSESSION",
    "clienta,Unknown,2026-01-21,Room,no show,FULLSESSION",
  ]);
  source.importedAt = "2026-04-01T23:45:00Z";
  const before = structuredClone(source);
  const result = scheduledAppointmentSources([source], roster);
  assert.deepEqual(result.excludedFollowUpEvidence, [
    { clientId: "ClientA", serviceDate: "2026-01-20", observedAt: source.importedAt, status: "cancelled" },
    { clientId: "clienta", serviceDate: "2026-01-21", observedAt: source.importedAt, status: "no show" },
  ]);
  assert.deepEqual(source, before);
});

test("future unrelated copied-ID observations cannot erase a known January close as of February 20", () => {
  const people = [{ id: 1, label: "Copied", goalId: 7 }, { id: 2, label: "Copied", goalId: 8 }];
  const data: ImportEvidenceDeclarations = { version: 1, sourceSets: [], mappings: people.map((person, index) => ({
    sourceLabel: index === 0 ? "AliasA" : "AliasB", clinicianId: person.id, clinicianLabel: person.label, teamId: person.goalId,
  })) };
  const known = attendance([
    "ClientA,AliasA,2026-01-10,Phone,show,CONSULT",
    "ClientA,AliasA,2026-01-20,Room,show,FULLSESSION",
  ]);
  known.rows[0].visitKind = "consultation";
  const summarize = (sources: ReturnType<typeof scheduledAppointmentSources>) => summarizeBookingConversions(
    [], {}, "2026-01-01", "2026-01-31", "2026-02-20", [], {
      appointmentSnapshots: sources.snapshots, classificationSnapshots: sources.classificationSnapshots,
      unresolvedAppointmentEvidence: sources.excludedFollowUpEvidence,
    });
  const baseline = summarize(scheduledAppointmentSources([known], people, data, "2026-02-20"));
  assert.equal(baseline.practice.converted, 1);
  assert.equal(baseline.practice.conversionRate, 100);
  for (const [date, status] of [["2026-03-20", "show"], ["2026-01-15", "cancelled"], ["2026-01-15", "no show"]]) {
    const future = attendance([`Unrelated,AliasB,${date},Room,${status},FULLSESSION`]);
    future.importedAt = "2026-03-01T12:00:00Z";
    const before = structuredClone({ known, future, people, data });
    const result = scheduledAppointmentSources([known, future], people, data, "2026-02-20");
    assert.equal(result.snapshots[0].rows.length, 2);
    assert.equal(result.classificationSnapshots[1].rows.length, 0);
    assert.deepEqual(result.excludedFollowUpEvidence, [{
      clientId: "Unrelated", serviceDate: date, observedAt: future.importedAt, status,
    }]);
    assert.deepEqual(summarize(result).practice, baseline.practice);
    const later = scheduledAppointmentSources([known, future], people, data, "2026-03-01");
    assert.ok(later.snapshots.every(snapshot => snapshot.rows.length === 0), "Once observed, both IDs collide");
    assert.deepEqual({ known, future, people, data }, before);
  }
  const lateShow = attendance(["Unrelated,AliasB,2026-01-15,Room,show,FULLSESSION"]);
  lateShow.importedAt = "2026-03-01T12:00:00Z";
  const historical = scheduledAppointmentSources([known, lateShow], people, data, "2026-02-20");
  assert.ok(historical.snapshots.every(snapshot => snapshot.rows.length === 0), "Past shows remain operational history despite late import");
});

test("classification excludes future-import billing PHONE evidence while retaining late past shows", () => {
  const source = attendance(["ClientA,Intake,2026-01-10,Room,show,"]);
  source.importedAt = "2026-03-01T12:00:00Z";
  const billing = importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code\nClientA,Alias,2026-01-10,0,PHONE").snapshot;
  billing.importedAt = source.importedAt;
  const result = scheduledAppointmentSources([source, billing], roster, declarations, "2026-02-20");
  assert.equal(result.snapshots[0].rows.length, 1);
  assert.equal(result.snapshots[0].importedAt, source.importedAt);
  assert.equal(result.classificationSnapshots[1].rows.length, 0);
  assert.equal(consultAttendanceClassifier(result.classificationSnapshots)(result.snapshots[0].rows[0]), false);
  const later = scheduledAppointmentSources([source, billing], roster, declarations, "2026-03-01");
  assert.equal(consultAttendanceClassifier(later.classificationSnapshots)(later.snapshots[0].rows[0]), true);
});
