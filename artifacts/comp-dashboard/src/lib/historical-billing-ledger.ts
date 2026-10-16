import { bindBillingResolutions, normalizeProviderLabel, resolveHistoricalBillingProvider, resolveImportedProvider,
  validateHistoricalBillingProviders, type ImportEvidenceDeclarations } from "@workspace/practice/hub";
import { summarizeReportedBilling } from "./reported-billing.ts";
import type { LocalSnapshot } from "./retention-local.ts";

type Person = { id: number; label: string; goalId?: number | null };
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
const shift = (value: string) => new Date(Date.parse(value + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
export function historicalBillingOverallStart(snapshots: readonly LocalSnapshot[], declarations: ImportEvidenceDeclarations, fallback: string) {
  return [
    ...declarations.sourceSets.filter(set => set.kind === "billing").map(set => set.start),
    ...(declarations.historicalBillingProviders ?? []).flatMap(provider => provider.sourceSets.map(set => set.start)),
    ...snapshots.filter(source => source.kind === "billing").flatMap(source => [
      source.coverageStart, ...(source.reportCoverage?.complete ? [source.reportCoverage.start] : []),
      ...source.rows.map(row => row.serviceDate),
    ]),
  ].filter(validDate).sort()[0] ?? fallback;
}
const covers = (ranges: { start: string; end: string }[], start: string, end: string) => {
  let cursor = start;
  for (const range of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    if (range.start > cursor) return false;
    if (range.end >= end) return true;
    if (range.end >= cursor) cursor = shift(range.end);
  }
  return false;
};

/** Reported service-date charges only. This never supplies clinical facts, compensation or forecast inputs. */
export function historicalBillingLedger(snapshots: readonly LocalSnapshot[], roster: readonly Person[], teamId: number | null,
  declarations: ImportEvidenceDeclarations, asOf: string, range: { start: string; end: string }) {
  if (![asOf, range.start, range.end].every(validDate) || range.start > range.end) throw new Error("Choose valid historical billing dates.");
  const end = range.end < asOf ? range.end : asOf;
  const selected = roster.filter((person) => (person.goalId ?? null) === teamId);
  const history = declarations.historicalBillingProviders ?? [];
  const issues = validateHistoricalBillingProviders(declarations, roster, snapshots);
  const identify = (label: string) => {
    const current = resolveImportedProvider(label, roster, teamId, declarations);
    if (current !== null) return `clinician:${current}`;
    const historical = resolveHistoricalBillingProvider(label, roster, declarations);
    return historical !== null ? `historical:${historical}` : null;
  };
  const knownLabels = [...new Set([...selected.map((person) => person.label), ...history.map((person) => person.sourceLabel),
    ...declarations.mappings.filter((mapping) => mapping.teamId === teamId).map((mapping) => mapping.sourceLabel)])];
  const inRange = (date: string) => validDate(date) && date >= range.start && date <= end;
  const billingSources = snapshots.filter((source) => source.kind === "billing");
  const unknownRows = billingSources.flatMap((source) => source.rows).filter((row) => (!validDate(row.serviceDate) || inRange(row.serviceDate)) && identify(row.clinician) === null).length;
  if (unknownRows) issues.push("Some billing providers are unconfirmed or ambiguous. Review their exact identities before certifying historical totals.");
  const proofs = new Map<string, { start: string; end: string }[]>();
  const sourceProofs = new Map<string, Set<string>>();
  const add = (provider: string, sourceIds: string[], proof: { start: string; end: string }) => {
    proofs.set(provider, [...(proofs.get(provider) ?? []), { start: proof.start, end: proof.end < asOf ? proof.end : asOf }]);
    for (const id of sourceIds) sourceProofs.set(id, new Set([...(sourceProofs.get(id) ?? []), provider]));
  };
  const membersFor = (ids: string[], proof: { start: string; end: string }) => {
    const members = ids.map((id) => billingSources.filter((source) => source.id === id));
    return validDate(proof.start) && validDate(proof.end) && proof.start <= proof.end && new Set(ids).size === ids.length && ids.length > 0
      && members.every((matches) => matches.length === 1)
      && members.flat().every((source) => source.rows.every((row) => validDate(row.serviceDate) && row.serviceDate >= proof.start && row.serviceDate <= proof.end)) ? members.flat() : null;
  };
  for (const source of billingSources) {
    const proof = source.reportCoverage;
    if (!proof?.complete || !membersFor([source.id], proof)) continue;
    for (const provider of new Set(source.rows.map((row) => resolveImportedProvider(row.clinician, roster, teamId, declarations)).filter((id) => id !== null)))
      add(`clinician:${provider}`, [source.id], proof);
  }
  for (const set of declarations.sourceSets.filter((set) => set.kind === "billing")) {
    const members = membersFor(set.snapshotIds, set);
    if (!members || members.some((source) => source.rows.some((row) => {
      const id = resolveImportedProvider(row.clinician, roster, teamId, declarations);
      return !(id !== null && set.clinicianIds.includes(id)) && resolveHistoricalBillingProvider(row.clinician, roster, declarations) === null;
    })) || set.clinicianIds.some((id) => !members.some((source) => source.rows.some((row) => resolveImportedProvider(row.clinician, roster, teamId, declarations) === id)))) continue;
    for (const id of set.clinicianIds.filter((id) => selected.some((person) => person.id === id))) add(`clinician:${id}`, set.snapshotIds, set);
  }
  for (const person of history) for (const set of person.sourceSets) {
    const members = membersFor(set.snapshotIds, set);
    if (resolveHistoricalBillingProvider(person.sourceLabel, roster, declarations) === person.id && members
      && members.some((source) => source.rows.some((row) => normalizeProviderLabel(row.clinician) === normalizeProviderLabel(person.sourceLabel))))
      add(`historical:${person.id}`, set.snapshotIds, set);
  }
  const unconfirmedSourceRows = billingSources.flatMap((source) => source.rows.filter((row) => inRange(row.serviceDate) && identify(row.clinician) !== null
    && !sourceProofs.get(source.id)?.has(identify(row.clinician)!))).length;
  const providers = [...selected.map((person) => `clinician:${person.id}`), ...history.map((person) => `historical:${person.id}`)];
  const coverageComplete = end >= range.start && providers.length > 0 && issues.length === 0 && unconfirmedSourceRows === 0
    && providers.every((provider) => covers(proofs.get(provider) ?? [], range.start, end));
  const report = summarizeReportedBilling(snapshots, asOf, { start: range.start, end: range.end, clinicianLabels: knownLabels,
    billingResolutions: bindBillingResolutions(declarations.billingResolutions ?? [], roster, declarations) });
  // Reconcile every retained source before selecting identities; new overlap cannot select a fee winner.
  const reportedCharges = issues.length || report.evidence.invalidDateRowCount || report.months.some((month) => month.charges === null)
    ? null : report.months.length ? report.months.reduce((sum, month) => sum + month.charges!, 0) : coverageComplete ? 0 : null;
  return { range: { start: range.start, end }, reportedCharges, coverageComplete, unknownProviderRows: unknownRows,
    unconfirmedSourceRows, historicalProviderCount: history.length,
    months: report.months.map((month) => ({ ...month, charges: issues.length ? null : month.charges })),
    warnings: [...new Set([...issues, ...report.evidence.warnings, ...(!coverageComplete ? ["Historical report coverage is unverified or incomplete; reported charges are not certified complete operating actuals."] : []),
      ...(unconfirmedSourceRows ? ["New billing sources have not inherited frozen coverage. Review their report ranges separately."] : [])])],
    evidence: report.evidence,
  };
}
