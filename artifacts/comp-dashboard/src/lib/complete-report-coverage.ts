import { canonicalServicePeriod, resolveImportedProvider, type ImportDeclarations, type PaceCoverage } from "@workspace/practice/hub";
import type { AttendanceRow, BillingRow, LocalFactKind, LocalSnapshot } from "./retention-local.ts";
import { attendanceStatusConflicts } from "./retention-local.ts";

type Clinician = { id: number; label: string; goalId?: number | null };
export type IncompleteReportPeriod = {
  start: string | null;
  end: string | null;
  kind: LocalFactKind;
  clinicianId?: number;
  clinicianLabel?: string;
  snapshotId?: string;
  reason: string;
  conflictKind?: "attendance-status";
};
export type CompleteReportCoverage = {
  eligibleSnapshots: LocalSnapshot[];
  /** Original references for source admission before reconciliation; then apply team/date scope. Do not mutate. */
  eligibleBillingRows: BillingRow[];
  eligibleAttendanceRows: AttendanceRow[];
  completeAttendanceCoverage: PaceCoverage[];
  completeBillingCoverage: PaceCoverage[];
  attendanceThrough: string | null;
  billingThrough: string | null;
  dataThrough: string | null;
  incompletePeriods: IncompleteReportPeriod[];
  excludedRowsCount: number;
  attendanceStatusConflictCount: number;
  limits: string[];
};

const dayMs = 86400000;
const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const validDate = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z"))
  && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
const shift = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * dayMs).toISOString().slice(0, 10);
const periodStart = (date: string) => canonicalServicePeriod(date).start;
type Range = { start: string; end: string };

/** Explicit report proof only. Raw input snapshots remain reconciliation evidence. */
export function completeReportCoverage(
  snapshots: readonly LocalSnapshot[], clinicians: readonly Clinician[], asOf: string,
  identityClinicians: readonly Clinician[] = clinicians,
  options: { declarations?: ImportDeclarations | null; teamId?: number | null } = {},
): CompleteReportCoverage {
  if (!validDate(asOf)) throw new Error("Complete report coverage requires a valid as-of date.");
  const labels = new Map<string, number[]>();
  for (const person of [...identityClinicians, ...clinicians]) {
    const key = normalize(person.label);
    labels.set(key, [...new Set([...(labels.get(key) ?? []), person.id])]);
  }
  const reportingIds = new Set(clinicians.map((person) => person.id));
  const resolveAny = (label: string) => options.teamId !== undefined
    ? resolveImportedProvider(label, identityClinicians, options.teamId, options.declarations)
    : labels.get(normalize(label))?.length === 1 ? labels.get(normalize(label))![0] : null;
  const mappedId = (label: string) => {
    if (options.teamId !== undefined) {
      const id = resolveImportedProvider(label, identityClinicians, options.teamId, options.declarations);
      return id !== null && reportingIds.has(id) ? id : null;
    }
    const ids = labels.get(normalize(label));
    return ids?.length === 1 && reportingIds.has(ids[0]) ? ids[0] : null;
  };
  const incompletePeriods: IncompleteReportPeriod[] = [];
  const limits = [
    "Completeness requires explicit valid reportCoverage.complete; observed service-date spans and upload dates are not proof.",
    "Report metadata has no provider roster. Proof is attributed only to uniquely mapped providers present in each snapshot; absent providers are never inferred as zero.",
    "Name identity is validated across all known clinician IDs before reporting scope. Only a confirmed scoped crosswalk may resolve copied IDs; selecting a team alone never resolves ambiguity.",
    "Through dates require a common complete period for every supplied provider. Supply the intended reporting roster, including former clinicians where relevant; follow-up rows are not filtered by current employment.",
    "Canonical service periods are 14 calendar days anchored at 2026-01-01. Only periods ended on or before the as-of date qualify; gaps remain excluded.",
    "Attendance and billing proof are independent. dataThrough is only the earlier shared through-date, not certification of joint-source continuity or a forecast-start decision; inspect each provider's ranges and gaps.",
    "Raw rows remain available for reconciliation, not eligible actual totals or historical averages. Coverage proof does not certify fee identity, cash collection or contractual percentage-compensation basis.",
    "A source or explicitly confirmed frozen source set must enclose the entire canonical 14-day period. Adjacent partial declarations never combine automatically. Source-set declarations do not change individual source proofs or certify future uploads.",
    "Any invalid service date or row outside its own source's explicit proof bounds invalidates that whole source's proof, even if another source covers that date. Eligible raw-row arrays preserve original identity for source admission before conflict reconciliation, followed by team/date scoping; they are not reconciled totals.",
  ];
  const proofs = new Map<LocalSnapshot, Array<Range & { clinicianIds?: number[] }>>();
  const providerRanges = new Map<string, { kind: LocalFactKind; clinicianId: number; ranges: Range[] }>();
  const addRange = (kind: LocalFactKind, clinicianId: number, range: Range) => {
    const key = `${kind}:${clinicianId}`;
    const group = providerRanges.get(key) ?? { kind, clinicianId, ranges: [] };
    group.ranges.push(range);
    providerRanges.set(key, group);
  };
  for (const set of options.declarations?.sourceSets ?? []) {
    const members = set.snapshotIds.map((id) => snapshots.filter((snapshot) => snapshot.id === id));
    const valid = validDate(set.start) && validDate(set.end) && set.start <= set.end
      && members.length > 0 && new Set(set.snapshotIds).size === set.snapshotIds.length
      && members.every((matches) => matches.length === 1 && matches[0].kind === set.kind)
      && members.flat().every((snapshot) => snapshot.rows.every((row) => validDate(row.serviceDate) && row.serviceDate >= set.start && row.serviceDate <= set.end
        && set.clinicianIds.some((id) => resolveAny(row.clinician) === id)))
      && set.clinicianIds.every((id) => members.flat().some((snapshot) => snapshot.rows.some((row) => resolveAny(row.clinician) === id)));
    if (!valid) {
      incompletePeriods.push({ start: set.start, end: set.end, kind: set.kind, reason: "Source-set declaration is stale, unmapped, contradictory or missing an active member; it is not admitted." });
      continue;
    }
    const scopedIds = set.clinicianIds.filter((id) => reportingIds.has(id));
    for (const snapshot of members.flat()) proofs.set(snapshot, [...(proofs.get(snapshot) ?? []), { start: set.start, end: set.end, clinicianIds: scopedIds }]);
    for (const id of scopedIds) addRange(set.kind, id, { start: set.start, end: set.end });
  }
  for (const snapshot of snapshots) {
    const proof = snapshot.reportCoverage;
    if (!proof || proof.complete !== true || !validDate(proof.start) || !validDate(proof.end) || proof.start > proof.end) {
      if (!proofs.has(snapshot)) incompletePeriods.push({ start: validDate(snapshot.coverageStart) ? snapshot.coverageStart : null,
        end: validDate(snapshot.coverageEnd) ? snapshot.coverageEnd : null, kind: snapshot.kind, snapshotId: snapshot.id,
        reason: "Missing or invalid explicit complete report proof; observed bounds do not establish completeness." });
      continue;
    }
    if (snapshot.rows.some((row) => !validDate(row.serviceDate) || row.serviceDate < proof.start || row.serviceDate > proof.end)) {
      incompletePeriods.push({ start: proof.start, end: proof.end, kind: snapshot.kind, snapshotId: snapshot.id,
        reason: "Invalid or contradictory report range: at least one service date is invalid or outside the declared proof; the entire source proof is rejected." });
      continue;
    }
    proofs.set(snapshot, [...(proofs.get(snapshot) ?? []), proof]);
    const ids = new Set(snapshot.rows.filter((row) => validDate(row.serviceDate) && row.serviceDate >= proof.start && row.serviceDate <= proof.end)
      .map((row) => mappedId(row.clinician)).filter((id): id is number => id !== null));
    if (!ids.size) incompletePeriods.push({ ...proof, kind: snapshot.kind, snapshotId: snapshot.id,
      reason: "No uniquely mapped provider in this report; provider scope cannot be established." });
    for (const clinicianId of ids) {
      addRange(snapshot.kind, clinicianId, { start: proof.start, end: proof.end });
    }
  }
  const eligible = new Map<string, Range[]>();
  const completeAttendanceCoverage: PaceCoverage[] = [];
  const completeBillingCoverage: PaceCoverage[] = [];
  for (const [key, group] of providerRanges) {
    const ranges = group.ranges;
    const periods: Range[] = [];
    const first = ranges.map((range) => range.start).sort()[0];
    const last = periodStart(asOf);
    for (let start = periodStart(first); start <= last; start = shift(start, 14)) {
      const end = shift(start, 13);
      const complete = end <= asOf && ranges.some((range) => range.start <= start && range.end >= end);
      if (complete) periods.push({ start, end });
      else incompletePeriods.push({ start, end, kind: group.kind, clinicianId: group.clinicianId,
        reason: end > asOf ? "Canonical service period has not ended as of the reporting date." : "No individual provider report proof encloses this entire canonical service period (gap or partial period); partial declarations cannot combine." });
    }
    eligible.set(key, periods);
    const destination = group.kind === "attendance" ? completeAttendanceCoverage : completeBillingCoverage;
    destination.push(...periods.map((range) => ({ ...range, clinicianId: group.clinicianId })));
  }
  const eligibleSnapshots: LocalSnapshot[] = [];
  const eligibleBillingRows = new Set<BillingRow>();
  const eligibleAttendanceRows = new Set<AttendanceRow>();
  for (const snapshot of snapshots) {
    const sourceProofs = proofs.get(snapshot);
    if (!sourceProofs) continue;
    const ids = new Set([...snapshot.rows.map((row) => mappedId(row.clinician)).filter((id): id is number => id !== null), ...sourceProofs.flatMap((proof) => proof.clinicianIds ?? [])]);
    for (const clinicianId of ids) for (const period of eligible.get(`${snapshot.kind}:${clinicianId}`) ?? []) {
      if (!sourceProofs.some((proof) => proof.start <= period.start && proof.end >= period.end && (!proof.clinicianIds || proof.clinicianIds.includes(clinicianId)))) continue;
      const { start, end } = period;
      const rows = snapshot.rows.filter((row) => mappedId(row.clinician) === clinicianId && validDate(row.serviceDate) && row.serviceDate >= start && row.serviceDate <= end);
      for (const row of rows) {
        if (snapshot.kind === "billing") eligibleBillingRows.add(row as BillingRow);
        else eligibleAttendanceRows.add(row as AttendanceRow);
      }
      eligibleSnapshots.push({ ...structuredClone(snapshot), id: `${snapshot.id}:complete:${clinicianId}:${period.start}`,
        coverageStart: start, coverageEnd: end, reportCoverage: { start, end, complete: true },
        coverageClinicians: [clinicians.find((person) => person.id === clinicianId)!.label], rows: structuredClone(rows) } as LocalSnapshot);
    }
  }
  const ids = [...new Set(clinicians.map((person) => person.id))];
  // Partial sources stay reconciliation-only and cannot poison an independently complete replacement.
  const statusConflicts = attendanceStatusConflicts(eligibleSnapshots);
  const conflictedPeriods = new Set<string>();
  for (const conflict of statusConflicts) {
    const clinicianId = mappedId(conflict.clinician);
    if (clinicianId === null) continue;
    const period = canonicalServicePeriod(conflict.serviceDate);
    const key = `${clinicianId}:${period.start}`;
    if (conflictedPeriods.has(key)) continue;
    conflictedPeriods.add(key);
    incompletePeriods.push({ ...period, kind: "attendance", clinicianId, conflictKind: "attendance-status",
      reason: "Conflicting attendance statuses among complete reports; this provider period is withheld, not zero. Original rows and independent billing evidence are retained for reconciliation." });
  }
  if (conflictedPeriods.size) {
    for (const row of eligibleAttendanceRows) {
      const id = mappedId(row.clinician);
      if (id !== null && conflictedPeriods.has(`${id}:${periodStart(row.serviceDate)}`)) eligibleAttendanceRows.delete(row);
    }
    const retainedCoverage = completeAttendanceCoverage.filter((row) => !conflictedPeriods.has(`${row.clinicianId}:${row.start}`));
    completeAttendanceCoverage.splice(0, completeAttendanceCoverage.length, ...retainedCoverage);
    const retainedSnapshots = eligibleSnapshots.filter((snapshot) => snapshot.kind !== "attendance" || !snapshot.coverageClinicians?.some((label) => {
      const id = mappedId(label);
      return id !== null && conflictedPeriods.has(`${id}:${snapshot.coverageStart}`);
    }));
    eligibleSnapshots.splice(0, eligibleSnapshots.length, ...retainedSnapshots);
  }
  for (const kind of ["attendance", "billing"] as const) for (const clinicianId of ids) {
    if (!providerRanges.has(`${kind}:${clinicianId}`)) incompletePeriods.push({ start: null, end: null, kind, clinicianId,
      reason: "No valid explicit report proof attributable to this provider; missing reporting cannot establish zero activity." });
  }
  const commonThrough = (coverage: PaceCoverage[]) => {
    const ends = [...new Set(coverage.map((range) => range.end))].sort().reverse();
    return ids.length ? ends.find((end) => ids.every((id) => coverage.some((range) => range.clinicianId === id && range.end === end))) ?? null : null;
  };
  const attendanceThrough = commonThrough(completeAttendanceCoverage);
  const billingThrough = commonThrough(completeBillingCoverage);
  const allRows = new Set(snapshots.flatMap<AttendanceRow | BillingRow>((snapshot) => snapshot.rows));
  const includedRows = new Set<AttendanceRow | BillingRow>([...eligibleAttendanceRows, ...eligibleBillingRows]);
  return { eligibleSnapshots, eligibleBillingRows: [...eligibleBillingRows], eligibleAttendanceRows: [...eligibleAttendanceRows],
    completeAttendanceCoverage, completeBillingCoverage, attendanceThrough, billingThrough,
    dataThrough: attendanceThrough && billingThrough ? (attendanceThrough < billingThrough ? attendanceThrough : billingThrough) : null,
    attendanceStatusConflictCount: statusConflicts.length,
    incompletePeriods: incompletePeriods.map((period) => ({ ...period,
      ...(period.clinicianId === undefined ? {} : { clinicianLabel: clinicians.find((person) => person.id === period.clinicianId)?.label }),
    })), excludedRowsCount: [...allRows].filter((row) => !includedRows.has(row)).length, limits };
}
