import {
  consultSchedulingEvidence,
  summarizeConsultConversions,
  type ConsultConversionMetric,
  type ConsultConversionOptions,
  type ConsultConversionSummary,
  type ConsultJourney,
  type LocalSnapshot,
} from "./retention-local.ts";

export type BookingConversionOptions = ConsultConversionOptions & {
  /** Positive consultation/appointment evidence only; never certifies absence. */
  appointmentSnapshots?: readonly LocalSnapshot[];
  /** Unmapped or stale-provider observations can make the first appointment unresolved. */
  unresolvedAppointmentEvidence?: readonly {
    clientId: string;
    serviceDate: string;
    observedAt?: string;
    status?: string;
  }[];
};

const cleanName = (value: string) => value.trim().replace(/\s+/g, " ");
const identity = (value: string) => cleanName(value).toLowerCase();
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const observationDay = (value: string) => Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString().slice(0, 10) : null;

const blankMetric = (clinician: string | null): ConsultConversionMetric => ({
  clinician, rateBasis: "observable_scheduled_sessions", observedTreatmentStarts: 0,
  consultations: 0, converted: 0, candidateConversions: 0, missed: 0, pending: 0,
  needsAttribution: 0, internalReferralsProtected: 0, evaluated: 0, conversionRate: null,
});

/** Observable appointments establish scheduling existence without inventing a booking clock. */
export function summarizeBookingConversions(
  snapshots: Parameters<typeof summarizeConsultConversions>[0],
  sameDayVisitOverrides: Parameters<typeof summarizeConsultConversions>[1] = {},
  periodStart = "0000-01-01",
  periodEnd = "9999-12-31",
  asOfDate = "9999-12-31",
  attributionOverrides: Parameters<typeof summarizeConsultConversions>[5] = [],
  options: BookingConversionOptions = {},
): ConsultConversionSummary {
  const names = new Map<string, string>();
  const normalize = (sources: readonly LocalSnapshot[]): LocalSnapshot[] => sources.map(snapshot => ({
    ...snapshot,
    reportCoverage: (observationDay(snapshot.importedAt) ?? "9999-12-31") <= asOfDate
      ? snapshot.reportCoverage : undefined,
    rows: snapshot.rows.map(row => {
      const key = identity(row.clinician);
      if (!names.has(key)) names.set(key, cleanName(row.clinician));
      return { ...row, clientId: row.clientId.trim(), clinician: names.get(key)! };
    }),
  } as LocalSnapshot));
  const normalized = normalize(snapshots);
  const positive = [...normalized, ...normalize(options.appointmentSnapshots ?? []).map(snapshot => ({
    ...snapshot, reportCoverage: undefined,
  }))];
  const classification = options.classificationSnapshots ? normalize(options.classificationSnapshots) : positive;
  const unresolvedAppointments = (options.unresolvedAppointmentEvidence ?? []).filter(row => {
    if (!validDay(row.serviceDate)) return false;
    // Untimed inputs remain caller-scoped; timed sources follow appointment as-of rules.
    if (row.observedAt === undefined) return true;
    const observed = observationDay(row.observedAt);
    return (observed !== null && observed <= asOfDate)
      || (row.status === "show" && row.serviceDate <= asOfDate);
  }).map(row => ({ ...row, clientId: row.clientId.trim() }));
  const normalizedOptions: ConsultConversionOptions = {
    ...options, classificationSnapshots: classification,
    excludedFollowUpEvidence: [
      ...(options.excludedFollowUpEvidence ?? []).map(row => ({ ...row, clientId: row.clientId.trim() })),
      ...unresolvedAppointments,
    ],
  };
  const admitted = summarizeConsultConversions(normalized, sameDayVisitOverrides, periodStart, periodEnd,
    asOfDate, [], normalizedOptions);
  const legacy = options.appointmentSnapshots?.length
    ? summarizeConsultConversions(positive, sameDayVisitOverrides, periodStart, periodEnd, asOfDate, [], normalizedOptions)
    : admitted;
  const evidence = consultSchedulingEvidence(positive, classification);
  const reviews = new Set(attributionOverrides.filter(row => !row.archived && row.outcome === "needs_review")
    .map(row => row.clientId.trim()));
  const outcomes = new Map<ConsultJourney, "close" | "referral" | "miss" | "unknown">();
  const journeys = legacy.journeys.map(cohort => {
    const covered = admitted.journeys.some(row => row.clientId === cohort.clientId
      && row.consultDate === cohort.consultDate && row.coverageVerified);
    const journey: ConsultJourney = {
      ...cohort, coverageVerified: covered, status: "pending", closerClinician: null, creditedClinician: null,
      attributionSource: "none", attributionIssue: null, bookingDate: null,
      scheduledAppointmentDate: null, scheduledClinician: null,
    };
    const consultations = evidence.consultations.filter(row => row.clientId === cohort.clientId
      && row.serviceDate >= cohort.consultDate && row.serviceDate <= cohort.deadline
      && row.serviceDate <= asOfDate);
    const candidates = evidence.appointments.flatMap(({ row, observedAt }) => {
      if (row.clientId !== cohort.clientId || !validDay(row.serviceDate) || row.serviceDate < cohort.consultDate) return [];
      const observed = observationDay(observedAt);
      // Completed past sessions remain historical evidence when imported later.
      const completed = row.status === "show" && row.serviceDate <= asOfDate;
      if (!completed && (!observed || observed > asOfDate)) return [];
      const known = completed && (!observed || row.serviceDate < observed) ? row.serviceDate : observed!;
      const observedOrder = Date.parse(observed ? observedAt : known);
      return [{ row, known, observedOrder, qualifies: row.serviceDate <= cohort.deadline || known <= cohort.deadline }];
    // Appointment dates define the observable session sequence; observation bounds eligibility only.
    }).sort((a, b) => a.row.serviceDate.localeCompare(b.row.serviceDate) || a.observedOrder - b.observedOrder);
    const first = candidates[0];
    const unresolvedSequence = unresolvedAppointments?.some(row =>
      row.clientId === cohort.clientId && validDay(row.serviceDate) && row.serviceDate >= cohort.consultDate
      && (!first || row.serviceDate <= first.row.serviceDate));
    let outcome: "close" | "referral" | "miss" | "unknown" = "unknown";
    if (first) {
      const tied = candidates.filter(item => item.row.serviceDate === first.row.serviceDate);
      const providers = new Set(tied.map(item => identity(item.row.clinician)));
      journey.scheduledAppointmentDate = first.row.serviceDate;
      journey.scheduledClinician = providers.size === 1 && !providers.has("") ? cleanName(first.row.clinician) : null;
      journey.attributionSource = "scheduled_session";
      if (unresolvedSequence) {
        journey.status = "needs_attribution";
        journey.attributionIssue = "Unresolved provider evidence precedes or ties the first known appointment; session sequence is unresolved.";
      } else if (first.row.serviceDate === cohort.consultDate) {
        journey.attributionIssue = "Same-day date-only consultation and appointment order is unresolved.";
      } else if (!first.qualifies) {
        journey.attributionIssue = "Appointment beyond the deadline was observed later; timing within the window is unknown.";
      } else if (providers.size !== 1 || providers.has("")) {
        journey.status = "needs_attribution";
        journey.attributionIssue = "First observable appointments have unresolved clinicians.";
      } else {
        const provider = identity(first.row.clinician);
        const preceding = consultations.filter(row => row.serviceDate < first.row.serviceDate
          && row.serviceDate <= first.known && identity(row.clinician) === provider);
        const sameDay = consultations.some(row => row.serviceDate === first.row.serviceDate && identity(row.clinician) === provider);
        if (preceding.length) {
          outcome = "close";
          journey.status = "converted";
          journey.closerClinician = cleanName(first.row.clinician);
          journey.creditedClinician = journey.closerClinician;
        } else if (sameDay) {
          journey.attributionIssue = "Same-day date-only consultation and appointment order is unresolved.";
        } else {
          outcome = "referral";
          journey.status = "needs_attribution";
          journey.attributionIssue = "First observable appointment is with another clinician; internal referral protected.";
        }
      }
    } else if (unresolvedSequence) {
      journey.status = "needs_attribution";
      journey.attributionIssue = "Unresolved provider evidence leaves appointment eligibility unresolved.";
    } else if (asOfDate >= cohort.deadline && covered) {
      outcome = "miss";
      if (cohort.consultClinicians.length === 1) {
        journey.status = "missed";
        journey.creditedClinician = cohort.consultClinicians[0];
        journey.attributionSource = "consult_owner";
      } else {
        journey.status = "needs_attribution";
        journey.attributionIssue = "No eligible appointment observed in the covered window; consultation owner is unresolved.";
      }
    } else {
      journey.attributionIssue = asOfDate < cohort.deadline ? "Consultation follow-up window is still open."
        : "Complete observable follow-up coverage is unavailable.";
    }
    if (outcome === "unknown" || !covered) journey.coverageVerified = false;
    if (reviews.has(cohort.clientId)) {
      outcome = "unknown";
      journey.status = "needs_attribution";
      journey.closerClinician = null;
      journey.creditedClinician = null;
      journey.attributionSource = "manual_needs_review";
      journey.attributionIssue = "Manual review withholds unresolved scheduling credit.";
    }
    outcomes.set(journey, outcome);
    return journey;
  });

  const practice = blankMetric(null);
  const clinicians = new Map<string, ConsultConversionMetric>();
  const incompleteRates = new Set<ConsultConversionMetric>();
  const metricFor = (name: string) => {
    const key = identity(name);
    const metric = clinicians.get(key) ?? blankMetric(cleanName(name));
    clinicians.set(key, metric);
    return metric;
  };
  for (const journey of journeys) {
    const outcome = outcomes.get(journey)!;
    const mature = asOfDate >= journey.deadline;
    practice.consultations++;
    if (journey.treatmentDate) {
      practice.observedTreatmentStarts!++;
      if (journey.treatmentStartClinician) metricFor(journey.treatmentStartClinician).observedTreatmentStarts!++;
    }
    if (outcome === "close") practice.converted++;
    else if (outcome === "referral") practice.internalReferralsProtected++;
    else if (outcome === "miss") practice.missed++;
    else {
      practice.pending++;
      if (mature) incompleteRates.add(practice);
    }
    if (journey.status === "needs_attribution" && outcome !== "referral") practice.needsAttribution++;
    for (const name of journey.consultClinicians) {
      const metric = metricFor(name);
      metric.consultations++;
      if (outcome === "referral" || (outcome === "close" && identity(name) !== identity(journey.creditedClinician!))) {
        metric.internalReferralsProtected++;
      } else if (outcome === "close") metric.converted++;
      else if (outcome === "miss" && journey.creditedClinician) metric.missed++;
      else {
        metric.pending++;
        if (mature || journey.status === "needs_attribution") incompleteRates.add(metric);
        if (journey.status === "needs_attribution") metric.needsAttribution++;
      }
    }
  }
  const finish = (metric: ConsultConversionMetric): ConsultConversionMetric => {
    const evaluated = metric.converted + metric.missed;
    return { ...metric, evaluated, conversionRate: evaluated && !incompleteRates.has(metric)
      ? 100 * metric.converted / evaluated : null };
  };
  const reasons = [...new Set(journeys
    .flatMap(journey => [outcomes.get(journey) !== "referral" ? journey.attributionIssue : null,
      !journey.coverageVerified ? "Observable follow-up coverage is unverified." : null])
    .filter((reason): reason is string => !!reason))];
  return {
    measurement: "consult_to_scheduled_session", bookingEvidenceAvailable: admitted.journeys.some(journey => journey.coverageVerified) || evidence.appointments.some(({ row, observedAt }) =>
      (observationDay(observedAt) ?? "9999-12-31") <= asOfDate || (row.status === "show" && row.serviceDate <= asOfDate)),
    bookingLimitation: reasons.length ? reasons.join(" ") : null,
    coverageVerified: journeys.length > 0 && journeys.every(journey => journey.coverageVerified),
    periodStart, periodEnd, asOfDate, window: "one_calendar_month", practice: finish(practice),
    byClinician: [...clinicians.values()].map(finish).sort((a, b) => (a.clinician ?? "").localeCompare(b.clinician ?? "")),
    journeys,
  };
}
