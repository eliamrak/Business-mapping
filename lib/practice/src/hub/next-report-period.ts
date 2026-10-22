import { canonicalServicePeriod } from "./complete-periods.ts";
import { reconcileBillingEvidence } from "./billing-evidence.ts";
import type { BillingChargeResolution } from "./billing-resolution.ts";
import {
  bindBillingResolutions, importDeclarationsSchema, normalizeProviderLabel, resolveImportedProvider,
  resolveHistoricalBillingProvider, validateHistoricalBillingProviders,
  type ImportDeclarations,
} from "./import-declarations.ts";

type ReadonlyDeep<T> = T extends readonly (infer U)[] ? readonly ReadonlyDeep<U>[]
  : T extends object ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> } : T;

export type StructuralReportRow = {
  readonly clientId: string;
  readonly clinician: string;
  readonly serviceDate: string;
  readonly sourceRowHash: string;
  readonly status?: string | null;
  readonly cancellationSubtype?: string | null;
  readonly location?: string | null;
  readonly billingCode?: string | null;
  readonly visitKind?: string | null;
  readonly totalFeeCharged?: number | null;
};
export type StructuralSnapshot = {
  readonly id: string;
  readonly kind: "attendance" | "billing";
  readonly sourceHash: string;
  readonly importedAt?: string;
  readonly coverageStart: string;
  readonly coverageEnd: string;
  readonly rows: readonly StructuralReportRow[];
};
export type NextReportPeriodInput = {
  readonly snapshots: readonly StructuralSnapshot[];
  readonly storedDeclarations: ReadonlyDeep<{ revision: number; data: ImportDeclarations; confirmedAt: string }> | null;
  readonly roster: readonly { readonly id: number; readonly label: string; readonly goalId?: number | null }[];
  readonly teamId: number | null;
  /** Exact saved package membership; calling this planner asserts the owner's next-period intent. */
  readonly newSourceIds: readonly string[];
  readonly today: string;
  readonly billingResolutions?: readonly BillingChargeResolution[];
};
export type NextReportPeriodPlan = {
  status: "ready" | "blocked" | "up-to-date";
  period: { start: string; end: string; payDate: string } | null;
  data?: ImportDeclarations;
  reasons: string[];
  carryover: { rows: number; matched: number; conflicts: number };
};

const DAY = 86400000;
const shift = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * DAY).toISOString().slice(0, 10);
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date + "T12:00:00Z"))
  && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;
const kinds = ["attendance", "billing"] as const;
const text = (value?: string | null) => normalizeProviderLabel(value ?? "");

/** Pure proposal only. The caller owns package provenance, owner intent and persistence. */
export function planNextReportPeriod(input: NextReportPeriodInput): NextReportPeriodPlan {
  const { snapshots, storedDeclarations, roster, teamId, newSourceIds, today } = input;
  const result: NextReportPeriodPlan = { status: "blocked", period: null, reasons: [], carryover: { rows: 0, matched: 0, conflicts: 0 } };
  const issue = (reason: string) => { if (!result.reasons.includes(reason)) result.reasons.push(reason); };
  if (!validDate(today)) { issue("A valid calendar today is required."); return result; }
  const parsed = importDeclarationsSchema.safeParse(storedDeclarations?.data);
  if (!parsed.success || !storedDeclarations || !Number.isInteger(storedDeclarations.revision) || storedDeclarations.revision < 1) {
    issue("Previously confirmed frozen source sets are required."); return result;
  }
  // Parsing also detaches the proposal from all readonly inputs.
  const data = parsed.data;
  const sourceById = new Map<string, StructuralSnapshot>();
  for (const source of snapshots) {
    if (sourceById.has(source.id)) issue(`Duplicate snapshot identity ${source.id}; frozen membership is ambiguous.`);
    sourceById.set(source.id, source);
  }
  if (newSourceIds.length !== 2 || new Set(newSourceIds).size !== 2) issue("Select the exact saved next-period source pair: one attendance and one billing source.");
  const selected = newSourceIds.flatMap((id) => {
    const source = sourceById.get(id);
    if (!source) issue(`Selected package source ${id} is missing.`);
    return source ? [source] : [];
  });
  for (const kind of kinds) if (selected.filter((source) => source.kind === kind).length !== 1)
    issue(`The selected package requires exactly one ${kind} source.`);

  const resolve = (row: StructuralReportRow) => resolveImportedProvider(row.clinician, roster, teamId, data);
  for (const mapping of data.mappings) {
    if (resolveImportedProvider(mapping.sourceLabel, roster, teamId, data) !== mapping.clinicianId)
      issue("Provider mapping is stale, moved, renamed or belongs to a different team.");
  }
  for (const reason of validateHistoricalBillingProviders(data, roster, snapshots)) issue(reason);
  for (const set of data.sourceSets) {
    const members = set.snapshotIds.flatMap((id) => {
      const source = sourceById.get(id);
      if (!source || source.kind !== set.kind) { issue(`Frozen ${set.kind} set is missing member ${id} or its kind changed.`); return []; }
      return [source];
    });
    if (set.end > today) issue(`Frozen ${set.kind} coverage ends in the future (${set.end}).`);
    for (const source of members) {
      if (!source.sourceHash.trim() || !validDate(source.coverageStart) || !validDate(source.coverageEnd) || source.coverageStart > source.coverageEnd)
        issue(`Frozen member ${source.id} has invalid source bounds or no source hash.`);
      for (const row of source.rows) {
        if (!validDate(row.serviceDate) || row.serviceDate < set.start || row.serviceDate > set.end)
          issue(`Frozen member ${source.id} has a row outside its confirmed bounds ${set.start} through ${set.end}.`);
        if (row.serviceDate < source.coverageStart || row.serviceDate > source.coverageEnd)
          issue(`Frozen member ${source.id} has a row outside its source bounds.`);
        const id = resolve(row);
        if (id === null || !set.clinicianIds.includes(id)) {
          // Preserve confirmed historical exclusions in frozen reports of either kind.
          if (resolveHistoricalBillingProvider(row.clinician, roster, data) === null)
            issue(`Frozen member ${source.id} has an unmapped or out-of-scope provider ${JSON.stringify(row.clinician)}.`);
        }
      }
    }
    for (const id of set.clinicianIds) {
      if (!data.mappings.some((mapping) => mapping.clinicianId === id)
        || !members.some((source) => source.rows.some((row) => resolve(row) === id)))
        issue(`Frozen ${set.kind} scope for clinician ${id} no longer has its mapped source evidence.`);
    }
  }
  const scope = [...new Set(data.sourceSets.flatMap((set) => set.clinicianIds))].sort((a, b) => a - b);
  if (!scope.length || kinds.some((kind) => scope.some((id) => !data.sourceSets.some((set) => set.kind === kind && set.clinicianIds.includes(id)))))
    issue("Attendance and billing require a common previously confirmed provider scope.");
  if (result.reasons.length) return result;

  const fullyCovers = (kind: StructuralSnapshot["kind"], id: number, start: string, end: string) =>
    data.sourceSets.some((set) => set.kind === kind && set.clinicianIds.includes(id) && set.start <= start && set.end >= end);
  // Candidate boundaries come only from frozen report declarations and the canonical calendar.
  const boundaries = data.sourceSets.map((set) => {
    const period = canonicalServicePeriod(set.end);
    return period.end <= set.end ? period.end : shift(period.start, -1);
  }).sort().reverse();
  const through = boundaries.find((end) => {
    const { start } = canonicalServicePeriod(end);
    return kinds.every((kind) => scope.every((id) => fullyCovers(kind, id, start, end)));
  });
  if (!through) { issue("No shared fully ended canonical period is proven by the frozen attendance and billing sets."); return result; }
  const period = canonicalServicePeriod(shift(through, 1));
  result.period = { ...period, payDate: shift(period.end, 1) };
  const alreadyIncluded = selected.every((source) => data.sourceSets.some((set) => set.kind === source.kind
    && set.snapshotIds.includes(source.id) && set.start <= canonicalServicePeriod(through).start && set.end >= through
    && scope.every((id) => set.clinicianIds.includes(id))));
  if (alreadyIncluded) {
    result.status = "up-to-date";
    result.period = { ...canonicalServicePeriod(through), payDate: shift(through, 1) };
    return result;
  }
  // Import time only protects a prior review decision; it never determines service dates.
  for (const source of selected) if (source.importedAt !== undefined) {
    const imported = Date.parse(source.importedAt), confirmed = Date.parse(storedDeclarations.confirmedAt);
    if (!Number.isFinite(imported) || !Number.isFinite(confirmed))
      issue(`Selected ${source.kind} provenance timestamps require review before an automatic next-period proposal.`);
    else if (imported <= confirmed)
      issue(`Selected ${source.kind} is an existing excluded or previously reviewed source from before the last declaration confirmation; review its inclusion explicitly.`);
  }
  if (result.reasons.length) return result;
  if (period.end > today) issue(`Next service period ${period.start} through ${period.end} has not ended.`);

  const oldIds = new Set(data.sourceSets.flatMap((set) => set.snapshotIds));
  const oldSources = snapshots.filter((source) => oldIds.has(source.id));
  const identity = (row: StructuralReportRow) => JSON.stringify([row.clientId.trim(), resolve(row), row.serviceDate]);
  const fact = (row: StructuralReportRow, kind: StructuralSnapshot["kind"]) => JSON.stringify([
    row.clientId.trim(), resolve(row), row.serviceDate, text(row.billingCode), text(row.visitKind), text(row.cancellationSubtype),
    ...(kind === "attendance" ? [text(row.status), text(row.location)] : [row.totalFeeCharged]),
  ]);
  const groups = (rows: readonly StructuralReportRow[]) => {
    const grouped = new Map<string, StructuralReportRow[]>();
    for (const row of rows) {
      const key = identity(row);
      const group = grouped.get(key);
      if (group) group.push(row);
      else grouped.set(key, [row]);
    }
    return grouped;
  };
  const signature = (rows: readonly StructuralReportRow[], kind: StructuralSnapshot["kind"]) => JSON.stringify(rows.map((row) => fact(row, kind)).sort());
  const admittedCarryovers = new Map<string, StructuralReportRow[][]>();
  for (const source of oldSources) {
    const admitted = source.rows.filter((row) => {
      if (row.serviceDate >= period.start) return false;
      const canonical = canonicalServicePeriod(row.serviceDate);
      return data.sourceSets.some((set) => set.kind === source.kind && set.snapshotIds.includes(source.id)
        && set.clinicianIds.includes(resolve(row) ?? -1) && set.start <= canonical.start && set.end >= canonical.end);
    });
    for (const [identityKey, rows] of groups(admitted)) {
      const key = JSON.stringify([source.kind, identityKey]);
      admittedCarryovers.set(key, [...(admittedCarryovers.get(key) ?? []), rows]);
    }
  }

  for (const source of selected) {
    if (!source.sourceHash.trim() || !validDate(source.coverageStart) || !validDate(source.coverageEnd) || source.coverageStart > source.coverageEnd)
      issue(`Selected ${source.kind} source has invalid structural coverage or source hash.`);
    if (source.coverageStart > period.end || source.coverageEnd < period.start)
      issue(`Selected ${source.kind} coverage does not intersect the next period ${period.start} through ${period.end}.`);
    for (const row of source.rows) {
      const id = resolve(row);
      if (id === null || !scope.includes(id)) issue(`Selected ${source.kind} provider lacks valid prior confirmed team scope: ${JSON.stringify(row.clinician)}.`);
      if (!row.clientId.trim()) issue(`Selected ${source.kind} has a row without a client identity.`);
      if (!validDate(row.serviceDate) || row.serviceDate < source.coverageStart || row.serviceDate > source.coverageEnd)
        issue(`Selected ${source.kind} row has an invalid service date or lies outside its source bounds.`);
      if (row.serviceDate > period.end) issue(`Selected ${source.kind} has future/out-of-period facts on ${row.serviceDate}; next period ends ${period.end}.`);
    }
    const carryovers = source.rows.filter((row) => validDate(row.serviceDate) && row.serviceDate < period.start);
    result.carryover.rows += carryovers.length;
    for (const [key, rows] of groups(carryovers)) {
      const previous = admittedCarryovers.get(JSON.stringify([source.kind, key])) ?? [];
      if (!previous.length || previous.some((old) => signature(old, source.kind) !== signature(rows, source.kind))) {
        result.carryover.conflicts += rows.length;
        issue(`${source.kind} carryover ${rows[0].serviceDate}: ${previous.length ? "changed facts or multiplicity" : "novel facts without previously admitted complete source evidence"}.`);
      } else result.carryover.matched += rows.length;
    }
  }

  const billingApprovals = bindBillingResolutions(input.billingResolutions ?? [], roster, data);
  for (const kind of kinds) {
    const sources = [...oldSources.filter((source) => source.kind === kind), ...selected.filter((source) => source.kind === kind && !oldIds.has(source.id))];
    const approvedEncounters = new Set<string>();
    if (kind === "billing") {
      const entries = sources.flatMap((source) => source.rows.filter((row) => row.serviceDate >= period.start && row.serviceDate <= period.end)
        .map((row) => ({ snapshotId: source.id, row: { ...row, totalFeeCharged: row.totalFeeCharged ?? Number.NaN } })));
      const reconciled = reconcileBillingEvidence(entries, billingApprovals);
      const byEncounter = new Map<string, typeof reconciled>();
      for (const group of reconciled) {
        const key = identity(group.row);
        byEncounter.set(key, [...(byEncounter.get(key) ?? []), group]);
        if (!group.known)
          issue(`Billing evidence requires reconciliation on ${group.row.serviceDate}: conflicting fees, hashes or ambiguous multiplicity.`);
      }
      for (const [key, evidence] of byEncounter) {
        // Charge approvals cover fees and charge slots, never changes to other clinical facts.
        const rows = evidence.flatMap((group) => group.rows);
        const unchangedFacts = new Set(rows.map((row) => fact({ ...row, totalFeeCharged: 0 }, "billing"))).size === 1;
        if (evidence.every((group) => group.known && group.resolutionId && group.rows.every((row) => identity(row) === key)) && unchangedFacts)
          approvedEncounters.add(key);
        if (new Set(rows.map((row) => text(row.cancellationSubtype))).size > 1)
          issue(`Billing facts have conflicting cancellation subtypes on ${rows[0].serviceDate}.`);
      }
    }
    const encounters = new Map<string, string>();
    for (const source of sources) for (const [key, rows] of groups(source.rows.filter((row) => row.serviceDate >= period.start && row.serviceDate <= period.end))) {
      const facts = signature(rows, kind);
      if (kind === "attendance" && new Set(rows.map((row) => JSON.stringify([text(row.status), text(row.location), text(row.cancellationSubtype)]))).size > 1)
        issue(`Attendance facts within source ${source.id} have ambiguous statuses, locations or cancellation subtypes on ${rows[0].serviceDate}.`);
      if (encounters.has(key) && encounters.get(key) !== facts && !approvedEncounters.has(key))
        issue(`${kind} overlapping facts/status/fees or multiplicity conflict on ${rows[0].serviceDate}.`);
      encounters.set(key, facts);
    }
    const prior = data.sourceSets.filter((set) => set.kind === kind);
    const start = prior.map((set) => set.start).sort()[0];
    if (sources.some((source) => source.rows.some((row) => row.serviceDate < start || row.serviceDate > period.end)))
      issue(`Combined ${kind} coverage ${start} through ${period.end} cannot contain all frozen and selected member rows.`);
    // Extending a combined set must not fill a gap in the previously confirmed history.
    for (const id of scope) {
      let cursor = start;
      for (const set of prior.filter((set) => set.clinicianIds.includes(id)).sort((a, b) => a.start.localeCompare(b.start))) {
        if (set.start > cursor || cursor > through) break;
        if (set.end >= cursor) cursor = shift(set.end, 1);
      }
      if (cursor <= through) issue(`Frozen ${kind} history has a coverage gap for clinician ${id} before ${period.start}.`);
    }
    data.sourceSets.push({ kind, clinicianIds: [...scope], snapshotIds: [...new Set([...prior.flatMap((set) => set.snapshotIds), ...selected.filter((source) => source.kind === kind).map((source) => source.id)])],
      start, end: period.end, complete: true });
  }
  if (result.reasons.length) return result;
  const proposal = importDeclarationsSchema.safeParse(data);
  if (!proposal.success) { issue("The combined frozen source proposal exceeds declaration limits or requires review."); return result; }
  result.status = "ready";
  result.data = proposal.data;
  return result;
}
