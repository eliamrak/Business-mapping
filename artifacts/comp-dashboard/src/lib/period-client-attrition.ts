import {
  parseServiceDate,
  periodClientAttritionEvidence,
  type ClientActivityOptions,
  type LocalSnapshot,
  type SameDayVisitOverrides,
} from "./retention-local.ts";

export type AttritionWindow = { start: string; end: string };
export type PeriodAttritionResult = {
  requestedWindow: AttritionWindow;
  effectiveWindow: AttritionWindow | null;
  /** Earlier unobserved establishment cannot be certified by current report metadata. */
  cohortQualifier: "observed-established-clients";
  allHistoricalClientsCertified: false;
  totalEligible: number | null;
  totalEnded: number | null;
  percentage: number | null;
  eligibleClientIds: string[] | null;
  endingClientIds: string[] | null;
  coverageComplete: boolean;
  reasons: string[];
};
export type PeriodClientAttritionInput = ClientActivityOptions & {
  /** Already admitted using the full identity roster and validated provider scope. */
  snapshots: LocalSnapshot[];
  requestedWindow: AttritionWindow;
  asOf: string;
  overrides?: SameDayVisitOverrides;
};

const addDays = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

function calculate(input: PeriodClientAttritionInput, window: AttritionWindow, evidence: ReturnType<typeof periodClientAttritionEvidence>): PeriodAttritionResult {
  const covers = (start: string, end: string) => evidence.intervals.some((range) => range.start <= start && range.end >= end);
  const reasons = new Set<string>();
  const eligible = new Set<string>();
  if (addDays(window.end, 90) > input.asOf) reasons.add("immature-follow-up");
  if (!covers(window.start, addDays(window.end, 90))) reasons.add("incomplete-window-or-follow-up-coverage");
  for (const [id, dates] of evidence.datesByClient) {
    const established = dates[2];
    const activeInWindow = dates.some((date) => date <= window.end && addDays(date, 90) >= window.start);
    if (!activeInWindow) continue;
    if (!established || established > window.end) {
      if (dates[0] < window.start) reasons.add("left-censored-establishment");
      continue;
    }
    // At establishment the third visit itself is active; later visits can reactivate.
    if (!dates.some((date) => date >= established && date <= window.end && addDays(date, 90) >= window.start)) continue;
    eligible.add(id);
    if (!covers(dates[0], window.start > established ? window.start : established)) reasons.add("incomplete-prior-establishment-coverage");
    if (evidence.intervals.some((range) => range.start === dates[0])) reasons.add("left-censored-establishment");
  }
  if (evidence.excluded.some((row) => eligible.has(row.clientId))) reasons.add("uncertain-follow-up-evidence");
  const ended = [...new Set(evidence.endingEvents.map((event) => event.clientId))].sort();
  if (ended.some((id) => !eligible.has(id))) throw new Error("Period endings must be a subset of eligible clients");
  const coverageComplete = reasons.size === 0;
  const ids = [...eligible].sort();
  return {
    requestedWindow: { ...window }, effectiveWindow: coverageComplete ? { ...window } : null,
    cohortQualifier: "observed-established-clients", allHistoricalClientsCertified: false,
    totalEligible: coverageComplete ? ids.length : null, totalEnded: coverageComplete ? ended.length : null,
    percentage: coverageComplete && ids.length > 0 ? 100 * ended.length / ids.length : null,
    eligibleClientIds: coverageComplete ? ids : null, endingClientIds: coverageComplete ? ended : null,
    coverageComplete, reasons: [...reasons, ...(!ids.length && coverageComplete ? ["zero-eligible-denominator"] : [])],
  };
}

/** Whole-window unique clients, with an explicitly separate mature observed portion. */
export function periodClientAttrition(input: PeriodClientAttritionInput) {
  for (const date of [input.asOf, input.requestedWindow.start, input.requestedWindow.end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || parseServiceDate(date) !== date) throw new Error("Attrition requires valid ISO dates");
  }
  if (input.requestedWindow.start > input.requestedWindow.end) throw new Error("Attrition window is reversed");
  const result = (clinician?: string) => {
    const evidence = periodClientAttritionEvidence(input.snapshots, input.asOf, input.requestedWindow, input.overrides, input, clinician);
    const full = calculate(input, input.requestedWindow, evidence);
    // Preserve actual contiguous dates when admitted coverage ends before the as-of date.
    const portions = full.coverageComplete ? [] : evidence.intervals.map((range) => ({
      start: range.start > input.requestedWindow.start ? range.start : input.requestedWindow.start,
      end: [input.requestedWindow.end, addDays(range.end, -90), addDays(input.asOf, -90)].sort()[0],
    })).filter((range) => range.start <= range.end)
      .map((range) => calculate(input, range, periodClientAttritionEvidence(input.snapshots, input.asOf, range, input.overrides, input, clinician))).filter((portion) => portion.coverageComplete);
    return { ...full, observedMaturePortion: portions.at(-1) ?? null };
  };
  const clinicians = new Map<string, string>();
  for (const snapshot of input.snapshots) if (snapshot.kind === "attendance") {
    for (const label of [...snapshot.rows.filter((row) => row.serviceDate <= input.asOf).map((row) => row.clinician), ...(snapshot.coverageClinicians ?? [])]) {
      if (normalize(label)) clinicians.set(normalize(label), label.trim().replace(/\s+/g, " "));
    }
  }
  return { practice: result(), byClinician: [...clinicians.values()].sort().map((clinician) => ({ clinician, ...result(clinician) })) };
}
