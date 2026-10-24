import { derivedShowVisits, periodClientAttritionEvidence, type ClientActivityOptions, type LocalSnapshot, type SameDayVisitOverrides } from "./retention-local.ts";

export type SessionProgressionOptions = ClientActivityOptions & {
  /** Inclusive first-observed-treatment cohort window, not a visit filter. */
  start: string;
  end: string;
  /** Explicit observation cutoff. Later visits never contribute. */
  asOf: string;
  /** First-date clinician membership; follow-up remains practice-wide. */
  clinician?: string;
  /** Defaults to eight milestones, independent of observed maximum. */
  sessions?: number;
  sameDayVisitOverrides?: SameDayVisitOverrides;
};
export type SessionProgressionRow = {
  session: number;
  eligibleClients: number;
  completions: number;
  /** Unrounded percentage; null when the cohort is empty. */
  reachedPct: number | null;
  /** Difference of unrounded percentages; null for the first/empty row. */
  changePercentagePoints: number | null;
};
export type ObservedLifetimeGroup = {
  clients: number;
  meanSessions: number | null;
  medianSessions: number | null;
  /** Calendar days first-to-last (not inclusive); one-date observations are zero. */
  meanElapsedDays: number | null;
  medianElapsedDays: number | null;
  /** Missing continuous practice-wide evidence from first observation through cutoff. */
  coverageLimitedClients: number;
};
export type ObservedLifetimeSummary = {
  basis: "observed-first-to-last";
  endingGapDays: 90;
  /** Existing >=3 distinct treatment dates plus verified 90-day absence evidence. */
  apparentEndings: ObservedLifetimeGroup;
  /** No confirmed apparent ending: ongoing, recent, <3 dates, or uncertain coverage. */
  ongoingOrCensored: ObservedLifetimeGroup;
};
export type SessionProgression = {
  basis: "first-observed-treatment";
  start: string;
  end: string;
  observedThrough: string;
  clinician: string | null;
  eligibleClients: number;
  clientsWithUnresolvedEvidence: number;
  rows: SessionProgressionRow[];
  lifetime: ObservedLifetimeSummary;
};
const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
function validDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Supply ALL eligible historical snapshots, including cross-clinician follow-up,
 * before date/clinician UI filtering. Use the existing coverage pipeline to select
 * eligible snapshots; raw/unverified reconciliation rows must not be passed here.
 * Classification-only snapshots cannot add visits. Missing history can move a
 * first-observed date and undercount milestones: these are observed counts, not
 * verified lifetime session ordinals, new-client counts, retention or attrition.
 * Lifetime groups reuse existing coverage-aware ending evidence; 28/90-day rules
 * remain unchanged. Observed means are not expected eventual lifetime estimates.
 */
export function sessionProgression(snapshots: LocalSnapshot[], options: SessionProgressionOptions): SessionProgression {
  const { start, end, asOf } = options;
  const sessions = options.sessions ?? 8;
  if (![start, end, asOf].every(validDate) || start > end)
    throw new RangeError("Progression requires valid ISO dates and an ordered cohort window.");
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 100)
    throw new RangeError("Progression requires 1–100 session milestones.");
  if (options.clinician !== undefined && !normalize(options.clinician))
    throw new RangeError("A clinician filter must not be blank.");
  const clients = new Map<string, { first: string; last: string; clinicians: Set<string>; visits: number }>();
  for (const visit of derivedShowVisits(snapshots, options.sameDayVisitOverrides, options.classificationSnapshots ?? snapshots)) {
    if (visit.serviceDate > asOf) continue;
    let client = clients.get(visit.clientId);
    if (!client) {
      client = { first: visit.serviceDate, last: visit.serviceDate, clinicians: new Set(), visits: 0 };
      clients.set(visit.clientId, client);
    }
    client.visits++;
    if (visit.serviceDate > client.last) client.last = visit.serviceDate;
    if (visit.serviceDate < client.first) {
      client.first = visit.serviceDate;
      client.clinicians.clear();
    }
    if (visit.serviceDate === client.first) client.clinicians.add(normalize(visit.clinician));
  }
  const clinician = options.clinician === undefined ? null : normalize(options.clinician);
  const cohort = new Map([...clients].filter(([, client]) => client.first >= start && client.first <= end && (clinician === null || client.clinicians.has(clinician))));
  const denominator = cohort.size;
  const unresolved = new Set((options.excludedFollowUpEvidence ?? []).filter(row => cohort.has(row.clientId) && row.serviceDate <= asOf).map(row => row.clientId));
  let previous: number | null = null;
  const rows = Array.from({ length: sessions }, (_, index): SessionProgressionRow => {
    const completions = [...cohort.values()].filter(client => client.visits >= index + 1).length;
    const reachedPct = denominator ? completions / denominator * 100 : null;
    const changePercentagePoints = reachedPct === null || previous === null ? null : reachedPct - previous;
    previous = reachedPct;
    return { session: index + 1, eligibleClients: denominator, completions, reachedPct, changePercentagePoints };
  });
  // Never clinician-scope follow-up: a referral or unresolved row can prevent an ending.
  const evidence = cohort.size ? periodClientAttritionEvidence(
    snapshots, asOf, { start, end: asOf }, options.sameDayVisitOverrides, options,
  ) : null;
  const ended = new Set(evidence?.endingEvents.map(event => event.clientId));
  type Observation = { sessions: number; days: number; coverageLimited: boolean };
  const apparent: Observation[] = [];
  const censored: Observation[] = [];
  for (const [id, client] of cohort) {
    const observation = {
      sessions: client.visits,
      days: (Date.parse(client.last + "T00:00:00Z") - Date.parse(client.first + "T00:00:00Z")) / 86400000,
      coverageLimited: unresolved.has(id) || !evidence?.intervals.some(range => range.start <= client.first && range.end >= asOf),
    };
    (ended.has(id) ? apparent : censored).push(observation);
  }
  const summarize = (observations: Observation[]): ObservedLifetimeGroup => {
    const statistics = (values: number[]) => {
      if (!values.length) return { mean: null, median: null };
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return { mean: values.reduce((sum, value) => sum + value, 0) / values.length,
        median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 };
    };
    const sessions = statistics(observations.map(row => row.sessions));
    const duration = statistics(observations.map(row => row.days));
    return { clients: observations.length, meanSessions: sessions.mean, medianSessions: sessions.median,
      meanElapsedDays: duration.mean, medianElapsedDays: duration.median,
      coverageLimitedClients: observations.filter(row => row.coverageLimited).length };
  };
  const lifetime: ObservedLifetimeSummary = { basis: "observed-first-to-last", endingGapDays: 90,
    apparentEndings: summarize(apparent), ongoingOrCensored: summarize(censored) };
  return { basis: "first-observed-treatment", start, end, observedThrough: asOf, clinician, eligibleClients: denominator, clientsWithUnresolvedEvidence: unresolved.size, rows, lifetime };
}
