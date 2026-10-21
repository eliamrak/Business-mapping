import {
  summarizeConsultConversions,
  type ConsultConversionMetric,
  type ConsultConversionOptions,
  type ConsultConversionSummary,
  type ConsultJourney,
} from "./retention-local.ts";

/** Immutable original scheduling evidence, not a current appointment/attendance row. */
export type BookingEvent = {
  id: string;
  clientId: string;
  clinician: string;
  bookedAt: string;
  appointmentDate: string;
  serviceKind: "treatment" | "consultation" | "documentation";
  status?: string;
};

/** Complete booking-history coverage for this client, inclusive calendar dates. */
export type BookingCoverage = {
  clientId: string;
  start: string;
  end: string;
  complete: boolean;
};

export type BookingConversionOptions = ConsultConversionOptions & {
  bookingEvents?: readonly BookingEvent[];
  bookingCoverage?: readonly BookingCoverage[];
};

const unavailable = "Booking-time records unavailable; close rate is unknown.";
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const cleanName = (name: string) => name.trim().replace(/\s+/g, " ");
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
// Require a timezone: a local timestamp cannot establish an unambiguous booking instant.
const bookingTime = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && validDate(value.slice(0, 10)) ? Date.parse(value) : NaN;
const bookingDay = (event: BookingEvent) => new Date(bookingTime(event.bookedAt)).toISOString().slice(0, 10);
const nextDay = (date: string) => new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);

function coversClient(coverage: readonly BookingCoverage[], clientId: string, start: string, end: string) {
  let cursor = start;
  for (const interval of coverage.filter((row) => row.clientId.trim() === clientId && row.complete
    && validDate(row.start) && validDate(row.end) && row.start <= row.end)
    .sort((a, b) => a.start.localeCompare(b.start))) {
    if (interval.end < cursor) continue;
    if (interval.start > cursor) return false;
    if (interval.end >= end) return true;
    cursor = nextDay(interval.end);
  }
  return false;
}

const blankMetric = (clinician: string | null): ConsultConversionMetric => ({
  clinician, rateBasis: "scheduled_treatment_bookings", observedTreatmentStarts: 0,
  consultations: 0, converted: 0, candidateConversions: 0, missed: 0, pending: 0,
  needsAttribution: 0, internalReferralsProtected: 0, evaluated: 0, conversionRate: null,
});
const finish = (metric: ConsultConversionMetric): ConsultConversionMetric => {
  const evaluated = metric.converted + metric.missed;
  return { ...metric, evaluated, conversionRate: evaluated ? 100 * metric.converted / evaluated : null };
};

/** Attendance supplies cohorts and observed starts only; it cannot prove scheduling or absence.
 * Missing source fields: immutable appointment/event ID, bookedAt, original scheduled clinician,
 * scheduled appointment date, service classification, and client-scoped booking-history coverage.
 */
export function summarizeBookingConversions(
  snapshots: Parameters<typeof summarizeConsultConversions>[0],
  sameDayVisitOverrides: Parameters<typeof summarizeConsultConversions>[1] = {},
  periodStart = "0000-01-01",
  periodEnd = "9999-12-31",
  asOfDate = "9999-12-31",
  attributionOverrides: Parameters<typeof summarizeConsultConversions>[5] = [],
  options: BookingConversionOptions = {},
): ConsultConversionSummary {
  const legacy = summarizeConsultConversions(snapshots, sameDayVisitOverrides, periodStart, periodEnd,
    asOfDate, [], options);
  const events = options.bookingEvents ?? [];
  const coverage = options.bookingCoverage ?? [];
  const reviews = new Set(attributionOverrides.filter((row) => !row.archived && row.outcome === "needs_review")
    .map((row) => row.clientId.trim()));
  const byId = new Map<string, BookingEvent[]>();
  // Ignore future evidence before deduplication so later changes cannot leak into historical results.
  for (const event of events) {
    if (Number.isFinite(bookingTime(event.bookedAt)) && bookingDay(event) > asOfDate) continue;
    const id = event.id.trim();
    byId.set(id, [...(byId.get(id) ?? []), event]);
  }
  const clientsWithInvalidEvidence = new Set<string>();
  const evidenceAvailable = byId.size > 0 || coverage.some((row) => row.clientId.trim() && row.complete
    && validDate(row.start) && validDate(row.end) && row.start <= row.end && row.start <= asOfDate);
  const deduplicated: BookingEvent[] = [];
  for (const [id, rows] of byId) {
    const first = rows[0];
    const signature = (row: BookingEvent) => JSON.stringify([
      row.clientId.trim(), nameKey(row.clinician), bookingTime(row.bookedAt),
      row.appointmentDate, row.serviceKind,
    ]);
    const invalid = !id || rows.some((row) => !row.clientId.trim() || !Number.isFinite(bookingTime(row.bookedAt))
      || !validDate(row.appointmentDate) || row.appointmentDate < bookingDay(row)
      || !["treatment", "consultation", "documentation"].includes(row.serviceKind)
      || signature(row) !== signature(first));
    if (invalid) rows.forEach((row) => clientsWithInvalidEvidence.add(row.clientId.trim()));
    else deduplicated.push(first);
  }

  const bookedClients = new Set<string>();
  const journeys: ConsultJourney[] = legacy.journeys.map((cohort) => {
    const { clientId, consultDate, deadline } = cohort;
    const fullCoverage = evidenceAvailable && asOfDate >= deadline
      && coversClient(coverage, clientId, consultDate, deadline);
    const journey: ConsultJourney = {
      ...cohort, coverageVerified: false, status: "pending", closerClinician: null, creditedClinician: null,
      attributionSource: "none", attributionIssue: evidenceAvailable ? "Complete client booking history is required to establish absence." : unavailable,
      bookingDate: null, scheduledAppointmentDate: null,
    };
    if (!evidenceAvailable) return journey;
    if (clientsWithInvalidEvidence.has(clientId)) {
      journey.attributionIssue = "Conflicting booking IDs or invalid booking fields require review.";
      return journey;
    }
    const eligible = deduplicated.filter((event) => event.clientId.trim() === clientId && event.serviceKind === "treatment"
      && bookingDay(event) >= consultDate && bookingDay(event) <= deadline)
      .sort((a, b) => bookingTime(a.bookedAt) - bookingTime(b.bookedAt));
    const first = eligible[0];
    if (first && bookingDay(first) === consultDate) {
      journey.attributionIssue = "Date-only consultation cannot establish order with a same-day booking.";
      return journey;
    }
    if (first) {
      bookedClients.add(clientId);
      const prefixCovered = coversClient(coverage, clientId, consultDate, bookingDay(first));
      journey.bookingDate = prefixCovered ? new Date(bookingTime(first.bookedAt)).toISOString() : null;
      const tied = eligible.filter((event) => bookingTime(event.bookedAt) === bookingTime(first.bookedAt));
      const clinicians = new Set(tied.map((event) => nameKey(event.clinician)));
      journey.scheduledAppointmentDate = prefixCovered && new Set(tied.map((event) => event.appointmentDate)).size === 1 ? first.appointmentDate : null;
      journey.coverageVerified = true;
      const needsReview = reviews.has(clientId);
      if (!prefixCovered || clinicians.size !== 1 || clinicians.has("") || needsReview) {
        journey.status = "needs_attribution";
        journey.attributionSource = needsReview ? "manual_needs_review" : "booking_event";
        journey.attributionIssue = needsReview ? "Manual review withholds booking credit."
          : !prefixCovered ? "Complete booking history through the observed booking is required to identify the first scheduled clinician."
            : "First booking has unresolved original scheduled clinicians.";
      } else {
        journey.status = "converted";
        journey.closerClinician = cleanName(first.clinician);
        journey.creditedClinician = journey.closerClinician;
        journey.attributionSource = "booking_event";
        journey.attributionIssue = null;
      }
      return journey;
    }
    if (!fullCoverage) return journey;
    journey.coverageVerified = true;
    if (cohort.consultClinicians.length !== 1 || reviews.has(clientId)) {
      journey.status = "needs_attribution";
      journey.attributionIssue = "Booking absence is known, but a unique consultation owner is unresolved.";
      journey.attributionSource = reviews.has(clientId) ? "manual_needs_review" : "none";
    } else {
      journey.status = "missed";
      journey.creditedClinician = cohort.consultClinicians[0];
      journey.attributionSource = "consult_owner";
      journey.attributionIssue = null;
    }
    return journey;
  });

  const practice = blankMetric(null);
  const incompleteRates = new Set<ConsultConversionMetric>();
  const clinicians = new Map<string, ConsultConversionMetric>();
  const metricFor = (name: string) => {
    const key = nameKey(name);
    const metric = clinicians.get(key) ?? blankMetric(cleanName(name));
    clinicians.set(key, metric);
    return metric;
  };
  for (const journey of journeys) {
    const booked = bookedClients.has(journey.clientId);
    const mature = asOfDate >= journey.deadline;
    if (mature && !booked && !journey.coverageVerified) incompleteRates.add(practice);
    practice.consultations++;
    if (journey.treatmentDate) {
      practice.observedTreatmentStarts!++;
      if (journey.treatmentStartClinician) metricFor(journey.treatmentStartClinician).observedTreatmentStarts!++;
    }
    if (booked) practice.converted++;
    else if (journey.coverageVerified) practice.missed++;
    else practice.pending++;
    if (journey.status === "needs_attribution") practice.needsAttribution++;

    if (journey.creditedClinician) {
      const metric = metricFor(journey.creditedClinician);
      metric.consultations++;
      if (booked) metric.converted++;
      else metric.missed++;
      if (booked) for (const name of journey.consultClinicians) {
        if (nameKey(name) !== nameKey(journey.creditedClinician)) metricFor(name).internalReferralsProtected++;
      }
    } else {
      for (const name of journey.consultClinicians) {
        const metric = metricFor(name);
        metric.consultations++;
        metric.pending++;
        if (journey.status === "needs_attribution") metric.needsAttribution++;
        if (mature || journey.status === "needs_attribution") incompleteRates.add(metric);
      }
    }
  }
  const finishWithCompleteness = (metric: ConsultConversionMetric): ConsultConversionMetric => ({
    ...finish(metric),
    ...(incompleteRates.has(metric) ? { conversionRate: null } : {}),
  });
  return {
    measurement: "scheduled_treatment", bookingEvidenceAvailable: evidenceAvailable,
    bookingLimitation: !evidenceAvailable ? unavailable : journeys.some((journey) => !journey.coverageVerified || journey.status === "needs_attribution")
      ? "Some cohorts lack complete or unambiguous booking evidence; unresolved cohorts remain pending." : null,
    coverageVerified: journeys.length > 0 && journeys.every((journey) => journey.coverageVerified),
    periodStart, periodEnd, asOfDate, window: "one_calendar_month", practice: finishWithCompleteness(practice),
    byClinician: [...clinicians.values()].map(finishWithCompleteness).sort((a, b) => (a.clinician ?? "").localeCompare(b.clinician ?? "")),
    journeys,
  };
}
