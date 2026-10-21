import assert from "node:assert/strict";
import test from "node:test";
import { buildLocalRetentionMetrics, importAttendanceCsv, importBillingCsv, type ConsultAttributionOverrideInput } from "./retention-local.ts";
import { summarizeBookingConversions, type BookingConversionOptions, type BookingEvent } from "./consult-booking-conversions.ts";

const event = (changes: Partial<BookingEvent> = {}): BookingEvent => ({
  id: "appointment-1", clientId: "synthetic", clinician: "Original", bookedAt: "2026-01-12T10:00:00Z",
  appointmentDate: "2026-03-20", serviceKind: "treatment", ...changes,
});
const coverage = (changes = {}) => ({ clientId: "synthetic", start: "2026-01-10", end: "2026-02-10", complete: true, ...changes });
function summarize(options: BookingConversionOptions = {}, extraRows = "", asOf = "2026-03-01", overrides: ConsultAttributionOverrideInput[] = []) {
  const attendance = importAttendanceCsv("Client,Clinician,Date of service,Location,Status\n"
    + "synthetic,Intake,2026-01-10,Phone,show\n" + extraRows).snapshot;
  for (const row of attendance.rows) if (row.location === "Phone") row.visitKind = "consultation";
  attendance.reportCoverage = { start: "2026-01-01", end: "2026-03-01", complete: true };
  return summarizeBookingConversions([attendance], {}, "2026-01-01", "2026-01-31", asOf, overrides, options);
}
const complete = (events = [event()]): BookingConversionOptions => ({ bookingEvents: events, bookingCoverage: [coverage()] });

test("attendance and manual legacy credit cannot manufacture booking facts", () => {
  const result = summarize({}, "synthetic,Observed,2026-01-20,Room A,show", undefined,
    [{ clientId: "synthetic", outcome: "confirmed_closer", clinicianName: "Manual" }]);
  assert.equal(result.measurement, "scheduled_treatment");
  assert.equal(result.bookingEvidenceAvailable, false);
  assert.equal(result.bookingLimitation, "Booking-time records unavailable; close rate is unknown.");
  assert.equal(result.practice.pending, 1);
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.missed, 0);
  assert.equal(result.practice.conversionRate, null);
  assert.equal(result.practice.observedTreatmentStarts, 1);
  const observed = result.byClinician.find((row) => row.clinician === "Observed")!;
  assert.equal(observed.observedTreatmentStarts, 1);
  assert.equal(observed.converted, 0);
  assert.equal(observed.conversionRate, null);
  assert.ok(result.byClinician.every((row) => row.rateBasis === "scheduled_treatment_bookings"));
  assert.equal(result.journeys[0].bookingDate, null);
  assert.equal(result.journeys[0].creditedClinician, null);
  assert.equal(result.journeys[0].status, "pending");
});

test("a deadline booking closes even when the scheduled appointment is in the future", () => {
  const result = summarize(complete([event({ bookedAt: "2026-02-10T23:59:59Z" })]), "", "2026-02-10");
  assert.equal(result.practice.converted, 1);
  assert.equal(result.practice.conversionRate, 100);
  assert.equal(result.practice.observedTreatmentStarts, 0);
  assert.equal(result.journeys[0].scheduledAppointmentDate, "2026-03-20");
  assert.equal(result.journeys[0].creditedClinician, "Original");
});

test("booked cancellations and no-shows retain credit without attendance", () => {
  for (const status of ["cancelled", "no-show"]) {
    const result = summarize(complete([event({ status })]));
    assert.equal(result.practice.converted, 1);
    assert.equal(result.practice.observedTreatmentStarts, 0);
    assert.equal(result.journeys[0].status, "converted");
  }
});

test("internal referrals protect intake and transfers retain the original booked clinician", () => {
  const result = summarize(complete([event(), event({ id: "transfer", clinician: "Later", bookedAt: "2026-01-15T10:00:00Z" })]),
    "synthetic,Later,2026-01-20,Room A,show", undefined,
    [{ clientId: "synthetic", outcome: "confirmed_closer", clinicianName: "Manual" }]);
  assert.equal(result.journeys[0].creditedClinician, "Original");
  assert.equal(result.journeys[0].treatmentStartClinician, "Later");
  assert.equal(result.byClinician.find((row) => row.clinician === "Intake")?.internalReferralsProtected, 1);
  assert.equal(result.byClinician.find((row) => row.clinician === "Intake")?.missed, 0);
  assert.equal(result.byClinician.find((row) => row.clinician === "Later")?.observedTreatmentStarts, 1);
  assert.equal(result.byClinician.find((row) => row.clinician === "Later")?.converted, 0);
});

test("duplicate IDs collapse, including equivalent offsets and changed terminal status", () => {
  const result = summarize(complete([event(), event({ bookedAt: "2026-01-12T05:00:00-05:00", status: "cancelled" })]));
  assert.equal(result.practice.converted, 1);
  assert.equal(result.journeys[0].status, "converted");
  assert.equal(result.journeys[0].bookingDate, "2026-01-12T10:00:00.000Z");
});

test("conflicting IDs never select an arbitrary original provider", () => {
  const result = summarize(complete([event(), event({ clinician: "Conflict" })]));
  assert.equal(result.journeys[0].status, "pending");
  assert.equal(result.practice.conversionRate, null);
  assert.equal(result.journeys[0].creditedClinician, null);
});

test("tied first clinicians preserve known practice close while withholding attribution", () => {
  const result = summarize(complete([event(), event({ id: "tie", clinician: "Other" })]));
  assert.equal(result.practice.converted, 1);
  assert.equal(result.journeys[0].status, "needs_attribution");
  assert.equal(result.journeys[0].creditedClinician, null);
  assert.ok(result.bookingLimitation);
  assert.ok(result.byClinician.every((row) => row.converted === 0 && row.conversionRate === null));
});

test("an incomplete booking prefix proves a close but cannot identify the first clinician", () => {
  const result = summarize({ bookingEvents: [event()], bookingCoverage: [coverage({ start: "2026-01-12" })] });
  assert.equal(result.practice.converted, 1);
  assert.equal(result.practice.conversionRate, 100);
  assert.equal(result.journeys[0].status, "needs_attribution");
  assert.equal(result.journeys[0].creditedClinician, null);
  assert.equal(result.journeys[0].bookingDate, null);
  assert.equal(result.journeys[0].scheduledAppointmentDate, null);
  assert.match(result.bookingLimitation!, /unresolved/);
});

test("complete empty client booking ledger supports a known mature zero", () => {
  const result = summarize({ bookingCoverage: [coverage()] });
  assert.equal(result.bookingEvidenceAvailable, true);
  assert.equal(result.practice.missed, 1);
  assert.equal(result.practice.conversionRate, 0);
  assert.equal(result.journeys[0].creditedClinician, "Intake");
  assert.equal(result.byClinician[0].missed, 1);
});

test("partial, wrong-client and attendance coverage cannot establish absence", () => {
  for (const row of [coverage({ end: "2026-02-09" }), coverage({ start: "2026-01-11" }),
    coverage({ complete: false }), coverage({ clientId: "someone-else" })]) {
    const result = summarize({ bookingCoverage: [row] });
    assert.equal(result.practice.pending, 1);
    assert.equal(result.practice.missed, 0);
    assert.equal(result.practice.conversionRate, null);
  }
});

test("contiguous client coverage merges, gaps remain unknown, and immature cohorts stay pending", () => {
  const intervals = [coverage({ end: "2026-01-20" }), coverage({ start: "2026-01-21" })];
  assert.equal(summarize({ bookingCoverage: intervals }).practice.missed, 1);
  assert.equal(summarize({ bookingCoverage: [intervals[0], coverage({ start: "2026-01-22" })] }).practice.pending, 1);
  assert.equal(summarize({ bookingCoverage: intervals }, "", "2026-02-09").practice.pending, 1);
});

test("multiple consultation owners cannot receive a mature miss via legacy overrides", () => {
  const result = summarize({ bookingCoverage: [coverage()] }, "synthetic,Backup,2026-01-11,Phone,show", undefined,
    [{ clientId: "synthetic", outcome: "missed_owner", clinicianName: "Intake" }]);
  assert.equal(result.practice.missed, 1);
  assert.equal(result.journeys[0].status, "needs_attribution");
  assert.equal(result.journeys[0].creditedClinician, null);
  assert.ok(result.byClinician.every((row) => row.missed === 0 && row.pending === 1));
});

test("needs_review withholds clinician credit for both known bookings and known absences", () => {
  for (const options of [complete(), { bookingCoverage: [coverage()] }]) {
    const result = summarize(options, "", undefined,
      [{ clientId: "synthetic", outcome: "needs_review", clinicianName: "Original" }]);
    assert.equal(result.practice.evaluated, 1);
    assert.equal(result.journeys[0].creditedClinician, null);
    assert.equal(result.journeys[0].attributionSource, "manual_needs_review");
    assert.ok(result.bookingLimitation);
  }
});

test("same-day date-only consult cannot prove booking order", () => {
  const result = summarize(complete([event({ bookedAt: "2026-01-10T23:59:59Z" }), event({ id: "later" })]));
  assert.equal(result.practice.pending, 1);
  assert.equal(result.practice.conversionRate, null);
  assert.equal(result.journeys[0].creditedClinician, null);
});

test("preconsult, late, consultation, and documentation bookings are excluded", () => {
  for (const changes of [{ bookedAt: "2026-01-09T10:00:00Z" }, { bookedAt: "2026-02-11T00:00:00Z" },
    { serviceKind: "consultation" as const }, { serviceKind: "documentation" as const }]) {
    assert.equal(summarize(complete([event(changes)])).practice.converted, 0);
  }
});

test("future booking events and future conflicting versions do not leak into as-of results", () => {
  const future = event({ bookedAt: "2026-01-13T00:00:00Z" });
  const onlyFuture = summarize({ bookingEvents: [future] }, "", "2026-01-12");
  assert.equal(onlyFuture.bookingEvidenceAvailable, false);
  assert.equal(onlyFuture.practice.pending, 1);
  const result = summarize(complete([event(), future]), "", "2026-01-12");
  assert.equal(result.journeys[0].status, "converted");
});

test("UTC instants define deadline, consult-day ambiguity, and end-of-as-of filtering", () => {
  const deadline = summarize(complete([event({ bookedAt: "2026-02-11T00:30:00+01:00" })]), "", "2026-02-10");
  assert.equal(deadline.practice.converted, 1);
  const future = summarize({ bookingEvents: [event({ bookedAt: "2026-01-12T23:30:00-01:00" })] }, "", "2026-01-12");
  assert.equal(future.bookingEvidenceAvailable, false);
  const sameDay = summarize(complete([event({ bookedAt: "2026-01-11T00:30:00+01:00" })]));
  assert.equal(sameDay.practice.pending, 1);
});

test("input evidence is not mutated", () => {
  const options = complete([event(), event()]);
  const before = structuredClone(options);
  summarize(options);
  assert.deepEqual(options, before);
});

test("a mature unknown outcome gates practice and associated clinician rates without inventing a miss", () => {
  const result = summarize(complete([event({ clinician: "Intake" })]),
    "unknown,Intake,2026-01-10,Phone,show\nunknown,Backup,2026-01-11,Phone,show");
  assert.equal(result.practice.converted, 1);
  assert.equal(result.practice.evaluated, 1);
  assert.equal(result.practice.pending, 1);
  assert.equal(result.practice.missed, 0);
  assert.equal(result.practice.conversionRate, null);
  const intake = result.byClinician.find((row) => row.clinician === "Intake")!;
  assert.equal(intake.converted, 1);
  assert.equal(intake.evaluated, 1);
  assert.equal(intake.pending, 1);
  assert.equal(intake.missed, 0);
  assert.equal(intake.conversionRate, null);
  assert.equal(result.byClinician.find((row) => row.clinician === "Backup")?.conversionRate, null);
});

test("an immature pending cohort preserves the known evaluated subset rate and explicit pending count", () => {
  const result = summarize(complete([event({ clinician: "Intake" })]),
    "unknown,Intake,2026-01-25,Phone,show", "2026-02-10");
  for (const metric of [result.practice, result.byClinician.find((row) => row.clinician === "Intake")!]) {
    assert.equal(metric.converted, 1);
    assert.equal(metric.evaluated, 1);
    assert.equal(metric.pending, 1);
    assert.equal(metric.missed, 0);
    assert.equal(metric.conversionRate, 100);
  }
});

test("known practice outcomes keep their rate while ambiguous clinician ownership gates only affected clinicians", () => {
  const result = summarize({
    bookingEvents: [event({ clinician: "Intake" }), event({ id: "unknown-client", clientId: "unknown" })],
    bookingCoverage: [coverage()],
  }, "unknown,Intake,2026-01-10,Phone,show");
  assert.equal(result.practice.converted, 2);
  assert.equal(result.practice.evaluated, 2);
  assert.equal(result.practice.conversionRate, 100);
  const intake = result.byClinician.find((row) => row.clinician === "Intake")!;
  assert.equal(intake.converted, 1);
  assert.equal(intake.evaluated, 1);
  assert.equal(intake.pending, 1);
  assert.equal(intake.conversionRate, null);
});

test("a verified booking does not establish retention: three completed treatment visits are required and PHONE is excluded", () => {
  for (const completed of [0, 2, 3]) {
    const shows = ["2026-01-15", "2026-01-22", "2026-01-29"].slice(0, completed)
      .map((date) => `synthetic,Original,${date},Room A,show`);
    const attendance = importAttendanceCsv([
      "Client,Clinician,Date of service,Location,Status",
      "synthetic,Original,2026-01-10,Room A,show",
      ...shows,
      "synthetic,Original,2026-01-16,Room A,cancelled",
      "synthetic,Original,2026-01-17,Room A,no show",
    ].join("\n")).snapshot;
    attendance.reportCoverage = { start: "2026-01-01", end: "2026-03-01", complete: true };
    const billing = importBillingCsv("Date of Service,Client,Clinician,Total Fee,Billing Code\n"
      + "2026-01-10,synthetic,Original,0,PHONE").snapshot;
    const snapshots = [attendance, billing];
    const booking = summarizeBookingConversions(snapshots, {}, "2026-01-01", "2026-01-31", "2026-03-01", [], complete());
    const retention = buildLocalRetentionMetrics(snapshots, {}, {}, 28, "2026-03-01");
    assert.equal(booking.practice.converted, 1);
    assert.equal(booking.practice.observedTreatmentStarts, completed > 0 ? 1 : 0);
    assert.equal(retention.excludedConsultationShowRows, 1);
    assert.equal(retention.rawShowRows, completed + 1);
    assert.equal(retention.derivedShowVisits, completed);
    assert.equal(retention.attendanceByClinician[0].shows, completed);
    assert.equal(retention.attendanceByClinician[0].retainedClients, completed === 3 ? 1 : 0);
  }
});
