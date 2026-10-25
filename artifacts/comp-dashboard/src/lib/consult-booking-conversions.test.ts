import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalRetentionMetrics, importAttendanceCsv, importBillingCsv,
  type ConsultAttributionOverrideInput, type LocalSnapshot,
} from "./retention-local.ts";
import { summarizeBookingConversions, type BookingConversionOptions } from "./consult-booking-conversions.ts";

function attendance(rows: string[], observedAt = "2026-02-01T12:00:00Z", covered = true) {
  const snapshot = importAttendanceCsv([
    "Client,Clinician,Date of service,Location,Status", ...rows,
  ].join("\n")).snapshot;
  snapshot.importedAt = observedAt;
  for (const row of snapshot.rows) if (row.location === "Phone") row.visitKind = "consultation";
  if (covered) snapshot.reportCoverage = { start: "2026-01-01", end: "2026-03-31", complete: true };
  return snapshot;
}
const consult = "synthetic,Intake,2026-01-10,Phone,show";
const appointment = (provider = "Intake", date = "2026-01-20", status = "show") =>
  `synthetic,${provider},${date},Room A,${status}`;
function summarize(snapshots: LocalSnapshot[], asOf = "2026-03-01", options: BookingConversionOptions = {},
  overrides: ConsultAttributionOverrideInput[] = []) {
  return summarizeBookingConversions(snapshots, {}, "2026-01-01", "2026-01-31", asOf, overrides, options);
}
const clinician = (result: ReturnType<typeof summarize>, name = "Intake") =>
  result.byClinician.find(row => row.clinician === name)!;

test("a known close and mature unknown preserve counts with an observed rate of 100", () => {
  const result = summarize([attendance([
    consult, appointment(), "unknown,Intake,2026-01-10,Phone,show",
  ], undefined, false)]);
  for (const metric of [result.practice, clinician(result)]) {
    assert.equal(metric.consultations, 2);
    assert.equal(metric.converted, 1);
    assert.equal(metric.missed, 0);
    assert.equal(metric.pending, 1);
    assert.equal(metric.evaluated, 1);
    assert.equal(metric.internalReferralsProtected, 0);
    assert.equal(metric.conversionRate, null);
    assert.equal(metric.observedConversionRate, 100);
  }
});

for (const [converted, missed, pending, expectedRate] of [[28, 6, 3, "82.3529"], [2, 1, 1, "66.6667"]] as const) {
test(`${converted} closes, ${missed} misses, ${pending} unresolved and one referral preserve classifications`, () => {
  const rows: string[] = [];
  for (let index = 0; index < converted; index++) rows.push(
    `close-${index},Intake,2026-01-10,Phone,show`,
    `close-${index},Intake,2026-01-20,Room A,show`,
  );
  for (let index = 0; index < missed; index++) rows.push(`miss-${index},Intake,2026-01-10,Phone,show`);
  for (let index = 0; index < pending; index++) rows.push(`unknown-${index},Intake,2026-01-10,Phone,show`);
  rows.push("referral,Intake,2026-01-10,Phone,show", "referral,Other,2026-01-20,Room A,show");
  const result = summarize([attendance(rows)], undefined, {
    unresolvedAppointmentEvidence: Array.from({ length: pending }, (_, index) => ({
      clientId: `unknown-${index}`, serviceDate: "2026-01-20",
    })),
  });
  for (const metric of [result.practice, clinician(result)]) {
    assert.equal(metric.consultations, converted + missed + pending + 1);
    assert.equal(metric.converted, converted);
    assert.equal(metric.missed, missed);
    assert.equal(metric.pending, pending);
    assert.equal(metric.internalReferralsProtected, 1);
    assert.equal(metric.evaluated, converted + missed);
    assert.equal(metric.conversionRate, null);
    assert.ok(Math.abs(metric.observedConversionRate! - converted / (converted + missed) * 100) < 1e-10);
    assert.equal(metric.observedConversionRate!.toFixed(4), expectedRate);
  }
  assert.equal(result.journeys.filter(row => row.status === "converted").length, converted);
  assert.equal(result.journeys.filter(row => row.status === "missed").length, missed);
});
}

test("zero evaluated outcomes keep the observed rate null", () => {
  for (const result of [summarize([]), summarize([attendance([consult], undefined, false)])]) {
    assert.equal(result.practice.evaluated, 0);
    assert.equal(result.practice.observedConversionRate, null);
    assert.equal(result.practice.conversionRate, null);
  }
});

test("same-clinician consultation then completed full session is one observable close", () => {
  const result = summarize([attendance([consult, appointment()])]);
  assert.equal(result.measurement, "consult_to_scheduled_session");
  assert.equal(result.bookingEvidenceAvailable, true);
  assert.equal(result.practice.converted, 1);
  assert.equal(result.practice.conversionRate, 100);
  assert.equal(clinician(result).converted, 1);
  assert.equal(result.practice.observedTreatmentStarts, 1);
  assert.equal(result.journeys[0].attributionSource, "scheduled_session");
  assert.equal(result.journeys[0].scheduledClinician, "Intake");
  assert.equal(result.journeys[0].scheduledAppointmentDate, "2026-01-20");
  assert.equal(result.journeys[0].bookingDate, null);
  assert.ok(result.byClinician.every(row => row.rateBasis === "observable_scheduled_sessions"));
});

test("cancelled and no-show full appointments close without completed attendance", () => {
  for (const status of ["cancelled", "no show", "clinician cancelled"]) {
    const result = summarize([attendance([consult, appointment("Intake", "2026-01-20", status)])]);
    assert.equal(result.practice.converted, 1);
    assert.equal(result.practice.observedTreatmentStarts, 0);
    assert.equal(clinician(result).converted, 1);
  }
});

test("future full appointment observed now qualifies even beyond the deadline", () => {
  const result = summarize([attendance([consult, appointment("Intake", "2026-03-20")], "2026-02-10T23:59:59Z")], "2026-02-10");
  assert.equal(result.practice.converted, 1);
  assert.equal(result.practice.observedTreatmentStarts, 0);
  assert.equal(result.journeys[0].scheduledAppointmentDate, "2026-03-20");
  assert.equal(result.journeys[0].bookingDate, null);
});

test("appointment service date inside the window establishes sequence without a booking clock", () => {
  const result = summarize([attendance([consult, appointment("Intake", "2026-02-10", "cancelled")], "2026-02-20T00:00:00Z")]);
  assert.equal(result.practice.converted, 1);
});

test("cross-clinician first appointment is protected and cannot become a practice close", () => {
  const result = summarize([attendance([consult, appointment("Other")])]);
  for (const metric of [result.practice, clinician(result)]) {
    assert.equal(metric.converted, 0);
    assert.equal(metric.missed, 0);
    assert.equal(metric.pending, 0);
    assert.equal(metric.internalReferralsProtected, 1);
    assert.equal(metric.evaluated, 0);
    assert.equal(metric.observedConversionRate, null);
  }
  assert.equal(clinician(result, "Other").converted, 0);
  assert.equal(result.journeys[0].creditedClinician, null);
  assert.equal(result.journeys[0].scheduledClinician, "Other");
});

test("a receiving provider gets a close only with their own preceding consultation", () => {
  const result = summarize([attendance([consult, "synthetic,Other,2026-01-12,Phone,show", appointment("Other")])]);
  assert.equal(result.practice.converted, 1);
  assert.equal(clinician(result, "Other").converted, 1);
  assert.equal(clinician(result).internalReferralsProtected, 1);
  assert.equal(clinician(result).missed, 0);
});

test("a consultation after the first appointment cannot claim a later transfer close", () => {
  const result = summarize([attendance([consult, appointment("Other", "2026-01-15"),
    "synthetic,Other,2026-01-17,Phone,show", appointment("Other", "2026-01-25")])]);
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.internalReferralsProtected, 1);
  assert.equal(clinician(result, "Other").converted, 0);
});

test("appointment dates define sequence even when a later appointment was observed first", () => {
  const early = attendance([consult, appointment("Intake", "2026-03-20")], "2026-01-12T00:00:00Z", false);
  const later = attendance([appointment("Other", "2026-02-20")], "2026-01-15T00:00:00Z", false);
  const result = summarize([later, early], "2026-01-16");
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.internalReferralsProtected, 1);
  assert.equal(result.journeys[0].scheduledClinician, "Other");
  assert.equal(result.journeys[0].scheduledAppointmentDate, "2026-02-20");
});

test("a later transfer appointment cannot reassign the first chronological appointment", () => {
  const result = summarize([attendance([consult, appointment(), appointment("Other", "2026-01-25")])]);
  assert.equal(result.practice.converted, 1);
  assert.equal(result.journeys[0].scheduledClinician, "Intake");
});

test("provider consultation must precede observation of their future appointment", () => {
  const booked = attendance([consult, appointment("Other", "2026-03-20")], "2026-01-15T12:00:00Z", false);
  const laterConsult = attendance(["synthetic,Other,2026-01-20,Phone,show"], "2026-01-21T12:00:00Z", false);
  const result = summarize([booked, laterConsult]);
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.internalReferralsProtected, 1);
  assert.equal(clinician(result, "Other").converted, 0);
});

test("duplicates and contradictory appointment statuses preserve one booking existence", () => {
  const first = attendance([consult, appointment()], "2026-01-21T00:00:00Z");
  const second = attendance([appointment("Intake", "2026-01-20", "cancelled")], "2026-01-22T00:00:00Z");
  const result = summarize([first, structuredClone(first), second]);
  assert.equal(result.practice.consultations, 1);
  assert.equal(result.practice.converted, 1);
  assert.equal(result.journeys[0].creditedClinician, "Intake");
});

test("tied first providers are unknown with no double credit or invented practice close", () => {
  const result = summarize([attendance([consult, appointment(), appointment("Other")])]);
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.missed, 0);
  assert.equal(result.practice.pending, 1);
  assert.equal(result.practice.conversionRate, null);
  assert.equal(result.journeys[0].status, "needs_attribution");
  assert.equal(result.journeys[0].scheduledClinician, null);
  assert.ok(result.byClinician.every(row => row.converted === 0));
});

test("mixed appointment statuses cannot change order or resolve tied providers", () => {
  const earlier = summarize([attendance([consult, appointment("Other", "2026-01-15", "cancelled"), appointment()])]);
  assert.equal(earlier.practice.internalReferralsProtected, 1);
  assert.equal(earlier.practice.converted, 0);
  const tied = summarize([attendance([consult, appointment(), appointment("Other", "2026-01-20", "no show")])]);
  assert.equal(tied.practice.converted, 0);
  assert.equal(tied.journeys[0].scheduledClinician, null);
  assert.equal(tied.journeys[0].status, "needs_attribution");
});

test("same-day date-only order stays pending even with a later appointment", () => {
  const result = summarize([attendance([consult, appointment("Intake", "2026-01-10"), appointment()])]);
  assert.equal(result.practice.pending, 1);
  assert.equal(result.practice.missed, 0);
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.conversionRate, null);
});

test("partial coverage retains a unique observable positive pair", () => {
  const result = summarize([attendance([consult, appointment()], undefined, false)]);
  assert.equal(result.practice.converted, 1);
  assert.equal(result.practice.conversionRate, 100);
  assert.equal(result.coverageVerified, false);
  assert.match(result.bookingLimitation!, /coverage.*unverified/i);
});

test("complete one-month report absence establishes a mature observable zero", () => {
  const result = summarize([attendance([consult])]);
  assert.equal(result.practice.missed, 1);
  assert.equal(clinician(result).missed, 1);
  assert.equal(result.practice.conversionRate, 0);
  assert.equal(result.coverageVerified, true);
  assert.equal(result.journeys[0].scheduledAppointmentDate, null);
});

test("partial coverage and excluded follow-up evidence block absence", () => {
  for (const [covered, options] of [
    [false, {}],
    [true, { excludedFollowUpEvidence: [{ clientId: " synthetic ", serviceDate: "2026-01-20" }] }],
  ] as const) {
    const result = summarize([attendance([consult], undefined, covered)], undefined, options);
    assert.equal(result.practice.missed, 0);
    assert.equal(result.practice.pending, 1);
    assert.equal(result.practice.conversionRate, null);
  }
});

test("beyond-deadline appointments first observed later have unknown timing, never misses", () => {
  const result = summarize([attendance([consult, appointment("Intake", "2026-03-20")], "2026-02-11T00:00:00Z")]);
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.missed, 0);
  assert.equal(result.practice.pending, 1);
  assert.match(result.bookingLimitation!, /timing.*unknown/);
});

test("future source knowledge is excluded, but completed past sessions imported later are usable", () => {
  const pastConsult = attendance([consult], "2026-01-11T00:00:00Z", false);
  for (const status of ["show", "cancelled", "no show"]) {
    const future = attendance([appointment("Intake", "2026-03-20", status)], "2026-02-11T00:00:00Z", false);
    assert.equal(summarize([pastConsult, future], "2026-02-10").practice.converted, 0);
  }
  const lateImport = attendance([appointment()], "2026-04-01T00:00:00Z", false);
  assert.equal(summarize([pastConsult, lateImport], "2026-02-10").practice.converted, 1);
  const futureCoverage = attendance([consult], "2026-04-01T00:00:00Z");
  assert.equal(summarize([futureCoverage], "2026-02-10").practice.missed, 0);
});

test("client whitespace and clinician whitespace/case normalize without changing input evidence", () => {
  const source = attendance([consult, " synthetic , intake ,2026-01-20,Room A,show"]);
  const before = structuredClone(source);
  const result = summarize([source]);
  assert.equal(result.practice.consultations, 1);
  assert.equal(result.practice.converted, 1);
  assert.equal(result.byClinician.length, 1);
  assert.deepEqual(source, before);
});

test("opaque client IDs retain case across appointments, exclusions, and manual reviews", () => {
  const source = attendance(["ClientA,Intake,2026-01-10,Phone,show", "clienta,Intake,2026-01-20,Room A,show"]);
  const result = summarize([source], undefined, {
    excludedFollowUpEvidence: [{ clientId: "clienta", serviceDate: "2026-01-20" }],
  }, [{ clientId: "clienta", outcome: "needs_review" }]);
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.missed, 1);
  assert.equal(result.journeys[0].clientId, "ClientA");
  assert.equal(result.journeys[0].status, "missed");
});

test("positive raw sources add current/future appointments without expanding admitted absence coverage", () => {
  const admitted = attendance([consult]);
  const raw = attendance([appointment("Intake", "2026-03-20")], "2026-02-01T12:00:00Z");
  assert.equal(summarize([admitted], "2026-02-01", { appointmentSnapshots: [raw] }).practice.converted, 1);
  const rawConsult = attendance([consult], "2026-02-01T12:00:00Z");
  const rawOnly = summarize([], undefined, { appointmentSnapshots: [rawConsult] });
  assert.equal(rawOnly.practice.consultations, 1);
  assert.equal(rawOnly.practice.missed, 0);
  assert.equal(rawOnly.practice.pending, 1);
  assert.equal(rawOnly.coverageVerified, false);
  assert.ok(rawConsult.reportCoverage);
});

test("full raw source supplies a future close before any report is canonically admitted", () => {
  const raw = attendance([consult, appointment("Intake", "2026-03-20")], "2026-01-15T12:00:00Z");
  const before = structuredClone(raw);
  const result = summarize([], "2026-01-15", {
    appointmentSnapshots: [raw],
    excludedFollowUpEvidence: [
      { clientId: "synthetic", serviceDate: "2026-01-10" },
      { clientId: "synthetic", serviceDate: "2026-03-20" },
    ],
  });
  assert.equal(result.practice.consultations, 1);
  assert.equal(result.practice.converted, 1);
  assert.equal(result.practice.observedTreatmentStarts, 0);
  assert.equal(result.practice.conversionRate, 100);
  assert.equal(result.coverageVerified, false);
  assert.equal(result.journeys[0].scheduledAppointmentDate, "2026-03-20");
  assert.deepEqual(raw, before);
});

test("unresolved earlier or tied unknown-provider evidence blocks false first appointment credit", () => {
  for (const date of ["2026-01-12", "2026-03-20"]) {
    const result = summarize([], undefined, {
      appointmentSnapshots: [attendance([consult, appointment("Intake", "2026-03-20")])],
      unresolvedAppointmentEvidence: [{ clientId: " synthetic ", serviceDate: date }],
    });
    assert.equal(result.practice.converted, 0);
    assert.equal(result.practice.missed, 0);
    assert.equal(result.practice.internalReferralsProtected, 0);
    assert.equal(result.practice.pending, 1);
    assert.equal(result.practice.conversionRate, null);
    assert.equal(result.journeys[0].creditedClinician, null);
    assert.match(result.bookingLimitation!, /sequence is unresolved/);
  }
});

test("later unresolved evidence and incomplete coverage preserve a known positive first pair", () => {
  const result = summarize([], undefined, {
    appointmentSnapshots: [attendance([consult, appointment()])],
    unresolvedAppointmentEvidence: [{ clientId: "synthetic", serviceDate: "2026-01-25" }],
  });
  assert.equal(result.practice.converted, 1);
  assert.equal(result.practice.conversionRate, 100);
  assert.equal(result.coverageVerified, false);
});

test("unknown future classification evidence cannot prove a close or absence", () => {
  const result = summarize([attendance([consult])], undefined, {
    unresolvedAppointmentEvidence: [{ clientId: "synthetic", serviceDate: "2026-03-20" }],
  });
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.missed, 0);
  assert.equal(result.practice.pending, 1);
  assert.equal(result.practice.conversionRate, null);
});

test("only as-of-active unresolved evidence can block a positive pair or prove absence unresolved", () => {
  const futureSource = "2026-04-01T00:00:00Z";
  for (const [status, serviceDate, observedAt, active] of [
    ["show", "2026-03-10", futureSource, false],
    ["cancelled", "2026-01-12", futureSource, false],
    ["no show", "2026-01-12", futureSource, false],
    ["show", "2026-01-12", futureSource, true],
    ["cancelled", "2026-01-12", "2026-02-01T12:00:00Z", true],
  ] as const) {
    const options: BookingConversionOptions = {
      unresolvedAppointmentEvidence: [{ clientId: " synthetic ", serviceDate, observedAt, status }],
    };
    const before = structuredClone(options);
    const positive = summarize([], undefined, {
      ...options, appointmentSnapshots: [attendance([consult, appointment("Intake", "2026-03-20")])],
    });
    assert.equal(positive.practice.converted, active ? 0 : 1);
    assert.equal(positive.practice.pending, active ? 1 : 0);
    const absent = summarize([attendance([consult])], undefined, options);
    assert.equal(absent.practice.missed, active ? 0 : 1);
    assert.equal(absent.practice.pending, active ? 1 : 0);
    assert.deepEqual(options, before);
  }
});

test("canonical alias classification identifies billing-only PHONE without creating visit facts", () => {
  const raw = attendance([appointment("Canonical Name", "2026-01-10"), appointment("Canonical Name", "2026-03-20")],
    "2026-01-15T12:00:00Z", false);
  const billing = importBillingCsv("Date of Service,Client,Clinician,Total Fee,Billing Code\n"
    + "2026-01-10,synthetic, canonical   name ,0,PHONE").snapshot;
  const result = summarize([], "2026-01-15", {
    appointmentSnapshots: [raw], classificationSnapshots: [raw, billing],
  });
  assert.equal(result.practice.consultations, 1);
  assert.equal(result.practice.converted, 1);
  assert.equal(result.practice.observedTreatmentStarts, 0);
  assert.equal(result.journeys[0].consultDate, "2026-01-10");
  assert.equal(result.journeys[0].scheduledAppointmentDate, "2026-03-20");
  assert.equal(result.journeys[0].scheduledClinician, "Canonical Name");
});

test("raw cohorts can close with raw appointments, but coverage must match their consult date", () => {
  const admitted = attendance(["synthetic,Intake,2026-01-15,Phone,show"]);
  const rawConsult = attendance([consult]);
  const mismatched = summarize([admitted], undefined, { appointmentSnapshots: [rawConsult] });
  assert.equal(mismatched.journeys[0].consultDate, "2026-01-10");
  assert.equal(mismatched.practice.missed, 0);
  const closed = summarize([], undefined, { appointmentSnapshots: [attendance([consult, appointment()])] });
  assert.equal(closed.practice.converted, 1);
  assert.equal(closed.coverageVerified, false);
});

test("classification-only sources never supply consultations, appointments, or absence coverage", () => {
  const result = summarize([attendance([consult], undefined, false)], undefined, {
    classificationSnapshots: [attendance([consult, appointment()])],
  });
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.missed, 0);
  assert.equal(result.practice.pending, 1);
});

test("legacy manual credit cannot reassign observed closes; needs review can withhold", () => {
  const sources = [attendance([consult, appointment()])];
  const before = structuredClone(sources);
  const overrides: ConsultAttributionOverrideInput[] = [
    { clientId: "synthetic", outcome: "confirmed_closer", clinicianName: "Manual" },
  ];
  assert.equal(summarize(sources, undefined, {}, overrides).journeys[0].creditedClinician, "Intake");
  const review = summarize(sources, undefined, {}, [{ clientId: "synthetic", outcome: "needs_review" }]);
  assert.equal(review.practice.converted, 0);
  assert.equal(review.journeys[0].creditedClinician, null);
  assert.equal(review.journeys[0].scheduledClinician, "Intake");
  assert.deepEqual(sources, before);
});

test("multiple consultation owners with known absence get no arbitrary miss attribution", () => {
  const result = summarize([attendance([consult, "synthetic,Backup,2026-01-11,Phone,show"])]);
  assert.equal(result.practice.missed, 1);
  assert.equal(result.journeys[0].creditedClinician, null);
  assert.ok(result.byClinician.every(row => row.missed === 0 && row.conversionRate === null));
});

test("mature unknown gates rates while retaining known counts; immature pending is excluded", () => {
  for (const [date, expectedRate] of [["2026-01-10", null], ["2026-01-25", 100]] as const) {
    const known = attendance([consult, appointment()], "2026-02-01T00:00:00Z", false);
    const unknown = attendance([`unknown,Intake,${date},Phone,show`], "2026-02-01T00:00:00Z", false);
    const result = summarize([known, unknown], "2026-02-10");
    for (const metric of [result.practice, clinician(result)]) {
      assert.equal(metric.converted, 1);
      assert.equal(metric.evaluated, 1);
      assert.equal(metric.pending, 1);
      assert.equal(metric.missed, 0);
      assert.equal(metric.conversionRate, expectedRate);
    }
  }
});

test("PHONE remains excluded and retention still needs three completed full sessions", () => {
  for (const completed of [0, 2, 3]) {
    const source = attendance([
      appointment("Intake", "2026-01-10"),
      ...["2026-01-15", "2026-01-22", "2026-01-29"].slice(0, completed).map(date => appointment("Intake", date)),
      appointment("Intake", "2026-01-16", "cancelled"),
      appointment("Intake", "2026-01-17", "no show"),
    ]);
    const billing = importBillingCsv("Date of Service,Client,Clinician,Total Fee,Billing Code\n"
      + "2026-01-10,synthetic,Intake,0,PHONE").snapshot;
    const sources = [source, billing];
    const booking = summarize(sources);
    const retention = buildLocalRetentionMetrics(sources, {}, {}, 28, "2026-03-01");
    assert.equal(booking.practice.converted, 1);
    assert.equal(booking.practice.observedTreatmentStarts, completed > 0 ? 1 : 0);
    assert.equal(retention.excludedConsultationShowRows, 1);
    assert.equal(retention.derivedShowVisits, completed);
    assert.equal(retention.attendanceByClinician[0].retainedClients, completed === 3 ? 1 : 0);
  }
});

test("unresolved reason counts are disjoint, clinician-scoped and exclude closes/referrals", () => {
 const snapshot=attendance([consult,appointment(),
  'open,Intake,2026-01-28,Phone,show',
  'coverage,Intake,2026-01-01,Phone,show',
  'referral,Intake,2026-01-10,Phone,show','referral,Other,2026-01-20,Room,show',
  'ambiguous,Intake,2026-01-05,Phone,show','ambiguous,Intake,2026-01-05,Room,show',
 ],undefined,false);
 const result=summarize([snapshot],'2026-02-15');
 for(const metric of [result.practice,clinician(result)]) {
  assert.equal(metric.pending,3);
  assert.deepEqual(metric.pendingReasons,{openWindow:1,unverifiedCoverage:1,other:1});
  assert.equal(metric.converted,1);assert.equal(metric.internalReferralsProtected,1);assert.equal(metric.missed,0);
 }
 assert.equal(result.byClinician.find(row=>row.clinician==='Other')?.pending ?? 0,0);
 assert.equal(result.practice.observedConversionRate,100);
});
