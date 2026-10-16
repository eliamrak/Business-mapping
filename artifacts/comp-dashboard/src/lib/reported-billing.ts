import type { BillingRow, LocalSnapshot } from "./retention-local.ts";
import { reconcileBillingEvidence } from "@workspace/practice/hub";
import type { BillingChargeResolutionEvidence } from "@workspace/practice/hub";

export type ReportedBillingMonth = {
  month: string;
  label: string;
  charges: number | null;
  rowCount: number;
  rawRowCount: number;
  duplicateRowCount: number;
  conflictingHashCount: number;
  ambiguousEncounterCount: number;
  invalidFeeRowCount: number;
  firstServiceDate: string;
  latestServiceDate: string;
  fullyElapsed: boolean;
  coverage: "reported-rows-only";
};

export type ReportedBillingAverage = {
  months: string[];
  monthLabels: string[];
  denominator: number;
  totalCharges: number | null;
  averageMonthlyCharges: number | null;
  label: string;
  coverage: "reported-rows-only";
};

const validDate = (date: unknown): date is string => {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = Date.parse(date + "T12:00:00Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date;
};
const monthLabel = (month: string) => new Date(month + "-01T12:00:00Z")
  .toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const normalizedLabel = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();

/** Reported charged fees by service date, not cash, production projections or coverage claims.
 * Hash identity is global across snapshots. Conflicting identities never select a winner.
 * No client identifiers, clinician roster, hashes or raw rows leave this helper.
 */
export function summarizeReportedBilling(
  snapshots: readonly LocalSnapshot[],
  asOf: string,
  options: { clinicianLabel?: string; clinicianLabels?: readonly string[]; start?: string; end?: string; eligibleRows?: ReadonlySet<BillingRow>; billingResolutions?: readonly BillingChargeResolutionEvidence[] } = {},
) {
  if (!validDate(asOf)) throw new Error("Reported billing requires a valid as-of date.");
  if ((options.start !== undefined && !validDate(options.start)) || (options.end !== undefined && !validDate(options.end)) || (options.start && options.end && options.start > options.end))
    throw new Error("Reported billing range requires valid ordered calendar dates.");
  const scope = options.clinicianLabel === undefined ? null : normalizedLabel(options.clinicianLabel);
  if (scope === "") throw new Error("Selected clinician label must not be blank.");
  const teamScope = options.clinicianLabels === undefined ? null : new Set(options.clinicianLabels.map(normalizedLabel));
  if (teamScope?.has("")) throw new Error("Selected clinician labels must not be blank.");
  const matches = (row: BillingRow) => (scope === null || normalizedLabel(row.clinician) === scope) && (teamScope === null || teamScope.has(normalizedLabel(row.clinician)));
  const billingSnapshots = snapshots.filter((snapshot) => snapshot.kind === "billing");
  const groups = reconcileBillingEvidence(billingSnapshots.flatMap((snapshot) => snapshot.rows.filter((row) => options.eligibleRows === undefined || options.eligibleRows.has(row)).map((row) => ({ row, snapshotId: snapshot.sourceSnapshotId ?? snapshot.id }))), options.billingResolutions);
  const evidence = {
    billingSnapshotCount: billingSnapshots.length,
    rawRowCount: 0,
    uniqueRowCount: 0,
    duplicateRowCount: 0,
    conflictingHashCount: 0,
    ambiguousEncounterCount: 0,
    resolvedCaseCount: 0,
    staleResolutionCount: 0,
    originalConflictingCaseCount: 0,
    originalAmbiguousCaseCount: 0,
    invalidFeeRowCount: 0,
    invalidDateRowCount: 0,
    missingHashRowCount: 0,
    futureDatedRowCount: 0,
    coverageVerified: false as const,
    warnings: [] as string[],
  };
  const months = new Map<string, ReportedBillingMonth>();
  let unassignedRows = false;
  for (const group of groups) {
    const rows = group.rows;
    const scopedRows = rows.filter(matches).filter((row) => options.eligibleRows === undefined || options.eligibleRows.has(row)).filter((row) => !validDate(row.serviceDate) || ((!options.start || row.serviceDate >= options.start) && (!options.end || row.serviceDate <= options.end)));
    if (!scopedRows.length) continue;
    const conflicting = group.conflicting && !group.resolutionId;
    const ambiguous = group.ambiguous && !group.resolutionId;
    const acceptedRows = (group.acceptedRows ?? [group.row]).filter((row) => scopedRows.includes(row));
    const acceptedCount = group.known ? acceptedRows.length : 1;
    const missingHash = group.missingHash;
    evidence.rawRowCount += scopedRows.length;
    evidence.uniqueRowCount += acceptedCount;
    evidence.duplicateRowCount += scopedRows.length - acceptedCount;
    if (conflicting) evidence.conflictingHashCount++;
    if (ambiguous) evidence.ambiguousEncounterCount++;
    if (group.resolutionId) evidence.resolvedCaseCount++;
    if (group.resolutionStale) evidence.staleResolutionCount++;
    if (group.conflicting) evidence.originalConflictingCaseCount++;
    if (group.ambiguous) evidence.originalAmbiguousCaseCount++;
    if (missingHash) evidence.missingHashRowCount += scopedRows.length;
    const byMonth = new Map<string, BillingRow[]>();
    for (const row of scopedRows) {
      if (!Number.isFinite(row.totalFeeCharged)) evidence.invalidFeeRowCount++;
      if (!validDate(row.serviceDate)) {
        evidence.invalidDateRowCount++;
        unassignedRows = true;
        continue;
      }
      if (row.serviceDate > asOf) { evidence.futureDatedRowCount++; continue; }
      const month = row.serviceDate.slice(0, 7);
      const monthRows = byMonth.get(month);
      if (monthRows) monthRows.push(row); else byMonth.set(month, [row]);
    }
    for (const [month, monthRows] of byMonth) {
      const dates = monthRows.map((row) => row.serviceDate).sort();
      const aggregate = months.get(month) ?? {
        month, label: monthLabel(month), charges: 0, rowCount: 0, rawRowCount: 0,
        duplicateRowCount: 0, conflictingHashCount: 0, ambiguousEncounterCount: 0, invalidFeeRowCount: 0,
        firstServiceDate: dates[0], latestServiceDate: dates.at(-1)!,
        fullyElapsed: month < asOf.slice(0, 7), coverage: "reported-rows-only" as const,
      };
      const acceptedMonthRows = acceptedRows.filter((row) => row.serviceDate.slice(0, 7) === month);
      const monthCount = group.known ? acceptedMonthRows.length : 1;
      aggregate.rowCount += monthCount;
      aggregate.rawRowCount += monthRows.length;
      aggregate.duplicateRowCount += monthRows.length - monthCount;
      aggregate.conflictingHashCount += Number(conflicting);
      aggregate.ambiguousEncounterCount += Number(ambiguous);
      aggregate.invalidFeeRowCount += monthRows.filter((row) => !Number.isFinite(row.totalFeeCharged)).length;
      aggregate.firstServiceDate = aggregate.firstServiceDate < dates[0] ? aggregate.firstServiceDate : dates[0];
      aggregate.latestServiceDate = aggregate.latestServiceDate > dates.at(-1)! ? aggregate.latestServiceDate : dates.at(-1)!;
      // Signed adjustments and PHONE fees are included. Bad fees and conflicting
      // hash payloads invalidate the affected total instead of becoming zero.
      const sum = aggregate.charges === null ? null : aggregate.charges + acceptedMonthRows.reduce((total, row) => total + row.totalFeeCharged, 0);
      aggregate.charges = !group.known || monthRows.some((row) => !Number.isFinite(row.totalFeeCharged))
        || sum === null || !Number.isFinite(sum) ? null : sum;
      months.set(month, aggregate);
    }
  }
  if (evidence.conflictingHashCount) evidence.warnings.push("Conflicting encounter/source identities make affected monthly charges unknown; no payload was selected as authoritative.");
  if (evidence.ambiguousEncounterCount) evidence.warnings.push("Indistinguishable repeated encounters cannot establish separate charges; affected totals remain unknown.");
  if (evidence.resolvedCaseCount) evidence.warnings.push("Explicit owner-approved billing exceptions retain two pinned charges each, not two treatment visits. Original source signals and records remain unchanged.");
  if (evidence.staleResolutionCount) evidence.warnings.push("A billing exception no longer matches its pinned evidence; affected charges require review and remain unknown.");
  if (evidence.invalidFeeRowCount) evidence.warnings.push("Nonfinite charged fees make affected monthly charges unknown.");
  if (evidence.missingHashRowCount) evidence.warnings.push("Rows without a stable source hash cannot be safely deduplicated; affected monthly charges are unknown.");
  if (unassignedRows) evidence.warnings.push("Invalid service dates cannot be assigned to a month; summary averages and charges to date are unknown.");
  if (evidence.futureDatedRowCount) evidence.warnings.push("Future-dated billing rows are excluded from as-of charged fees.");
  evidence.warnings.push("Elapsed months contain reported rows; complete-month coverage is not established. Charged fees are not cash collections.");
  const ordered = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  const elapsed = ordered.filter((month) => month.fullyElapsed);
  const average = (selected: ReportedBillingMonth[], description: string): ReportedBillingAverage => {
    const total = !unassignedRows && selected.length && selected.every((month) => month.charges !== null)
      ? selected.reduce((sum, month) => sum + month.charges!, 0) : null;
    const totalCharges = total !== null && Number.isFinite(total) ? total : null;
    return {
      months: selected.map((month) => month.month), monthLabels: selected.map((month) => month.label),
      denominator: selected.length, totalCharges,
      averageMonthlyCharges: totalCharges === null ? null : totalCharges / selected.length,
      label: `${description}: ${selected.length ? selected.map((month) => month.label).join(", ") : "no elapsed reported months"}; denominator ${selected.length} reported months`,
      coverage: "reported-rows-only",
    };
  };
  const currentMonth = asOf.slice(0, 7);
  const current = months.get(currentMonth);
  const latestServiceDate = ordered.reduce<string | null>((latest, month) => !latest || month.latestServiceDate > latest ? month.latestServiceDate : latest, null);
  return {
    asOf, measure: "charged-fees" as const,
    label: "Reported charged fees, not cash collections",
    months: ordered,
    latestServiceDate,
    latestThreeMonthAverage: average(elapsed.slice(-3), "Latest three fully elapsed reported-month average"),
    elapsedReportedMonthAverage: average(elapsed, "All fully elapsed reported-month average"),
    currentMonth: {
      month: currentMonth, label: `${monthLabel(currentMonth)} charged fees to date, not cash collections`,
      asOf, through: current?.latestServiceDate ?? null,
      chargesToDate: unassignedRows ? null : current?.charges ?? null,
      rowCount: current?.rowCount ?? 0,
      coverage: "reported-rows-only" as const,
    },
    evidence,
  };
}
