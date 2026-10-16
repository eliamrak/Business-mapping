import type { BillingChargeResolution, BillingChargeResolutionEvidence } from "./billing-resolution.ts";
import { legacyServiceDefinition } from "./service-codes.ts";

export type EncounterBillingRow = {
  clientId: string;
  clinician: string;
  serviceDate: string;
  totalFeeCharged: number;
  billingCode?: string | null;
  visitKind?: string | null;
  sourceRowHash: string;
};
const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const code = (row: EncounterBillingRow) => normalize(row.billingCode ?? "");
const kind = (row: EncounterBillingRow) => {
  const legacy = legacyServiceDefinition(row.billingCode);
  return legacy ? legacy.kind === "treatment" ? "" : legacy.kind : row.visitKind ?? (code(row) === "phone" ? "consultation" : "");
};
const identity = (row: EncounterBillingRow) => JSON.stringify([row.clientId.trim(), normalize(row.clinician), row.serviceDate, code(row)]);
const same = (a: EncounterBillingRow, b: EncounterBillingRow) => identity(a) === identity(b)
  && kind(a) === kind(b) && Object.is(a.totalFeeCharged, b.totalFeeCharged);

type Entry<T extends EncounterBillingRow> = { row: T; snapshotId: string };
const anchorKey = (entry: Entry<EncounterBillingRow>) => JSON.stringify([entry.snapshotId, entry.row.sourceRowHash, entry.row.totalFeeCharged]);

/** Two source-backed charge slots only; this never establishes attendance or visit multiplicity. */
export function prepareBillingChargeResolution<T extends EncounterBillingRow>(entries: readonly Entry<T>[]) {
  if (!entries.length) return null;
  const first = entries[0].row;
  if (!first.clientId.trim() || !normalize(first.clinician) || code(first) === "phone" || kind(first) === "consultation"
    || entries.some(({ row }) => identity(row) !== identity(first) || kind(row) !== kind(first)
      || !row.sourceRowHash?.trim() || !Number.isFinite(row.totalFeeCharged) || row.totalFeeCharged <= 0)) return null;
  const byAmount = new Map<number, Map<string, Map<string, Entry<T>>>>();
  for (const entry of entries) {
    const sources = byAmount.get(entry.row.totalFeeCharged) ?? new Map<string, Map<string, Entry<T>>>();
    const rows = sources.get(entry.snapshotId) ?? new Map<string, Entry<T>>();
    rows.set(entry.row.sourceRowHash, entry);
    sources.set(entry.snapshotId, rows);
    byAmount.set(entry.row.totalFeeCharged, sources);
  }
  const charges = [...byAmount.entries()].sort(([a], [b]) => a - b).flatMap(([amount, sources]) => {
    const source = [...sources.entries()].sort(([a, x], [b, y]) => y.size - x.size || a.localeCompare(b))[0][1];
    return [...source.values()].sort((a, b) => a.row.sourceRowHash.localeCompare(b.row.sourceRowHash)).map((entry) => ({
      amount, anchor: { snapshotId: entry.snapshotId, sourceRowHash: entry.row.sourceRowHash },
    }));
  });
  return charges.length === 2 ? { clientId: first.clientId.trim(), clinicianLabel: first.clinician, serviceDate: first.serviceDate, billingCode: code(first), visitKind: kind(first), charges: charges as BillingChargeResolution["charges"] } : null;
}

function acceptedChargeRows<T extends EncounterBillingRow>(entries: readonly Entry<T>[], resolution: BillingChargeResolution): T[] | null {
  if (!entries.length) return null;
  const first = entries[0].row;
  if (normalize(first.clinician) !== normalize(resolution.clinicianLabel) || first.serviceDate !== resolution.serviceDate
    || first.clientId.trim() !== resolution.clientId
    || code(first) !== resolution.billingCode || kind(first) !== resolution.visitKind || code(first) === "phone" || kind(first) === "consultation") return null;
  if (entries.some(({ row }) => identity(row) !== identity(first) || kind(row) !== kind(first) || !row.sourceRowHash?.trim()
    || !Number.isFinite(row.totalFeeCharged) || row.totalFeeCharged <= 0)) return null;
  const selected = resolution.charges.map((charge) => entries.find((entry) => entry.snapshotId === charge.anchor.snapshotId
    && entry.row.sourceRowHash === charge.anchor.sourceRowHash && Object.is(entry.row.totalFeeCharged, charge.amount)));
  if (selected.some((entry) => !entry) || new Set(selected.map((entry) => anchorKey(entry!))).size !== 2) return null;
  const allowed = new Map<number, number>();
  for (const charge of resolution.charges) allowed.set(charge.amount, (allowed.get(charge.amount) ?? 0) + 1);
  const observed = new Map<string, Set<string>>();
  for (const entry of entries) {
    const max = allowed.get(entry.row.totalFeeCharged);
    if (max === undefined) return null;
    const key = JSON.stringify([entry.snapshotId, entry.row.totalFeeCharged]);
    const hashes = observed.get(key) ?? new Set<string>();
    hashes.add(entry.row.sourceRowHash);
    if (hashes.size > max) return null;
    observed.set(key, hashes);
  }
  return selected.map((entry) => entry!.row);
}

/** Reconcile derived evidence only. Raw snapshots and their row hashes are untouched. */
export function reconcileBillingEvidence<T extends EncounterBillingRow>(entries: readonly Entry<T>[], resolutions: readonly BillingChargeResolutionEvidence[] = []) {
  const parents = entries.map((_, index) => index);
  const root = (index: number): number => parents[index] === index ? index : (parents[index] = root(parents[index]));
  const hashes = new Map<string, number>();
  const encounters = new Map<string, number>();
  entries.forEach(({ row }, index) => {
    const keys: [Map<string, number>, string][] = [[encounters, identity(row)]];
    if (row.sourceRowHash?.trim()) keys.push([hashes, row.sourceRowHash]);
    for (const [map, key] of keys) {
      const previous = map.get(key);
      if (previous !== undefined) parents[root(index)] = root(previous);
      else map.set(key, index);
    }
  });
  const grouped = new Map<number, typeof entries[number][]>();
  entries.forEach((entry, index) => grouped.set(root(index), [...(grouped.get(root(index)) ?? []), entry]));
  return [...grouped.values()].map((group) => {
    const ordered = [...group].sort((a, b) => identity(a.row).localeCompare(identity(b.row))
      || a.row.sourceRowHash.localeCompare(b.row.sourceRowHash)
      || String(a.row.totalFeeCharged).localeCompare(String(b.row.totalFeeCharged)));
    const rows = ordered.map((entry) => entry.row);
    const byHash = new Map<string, T[]>();
    const bySnapshot = new Map<string, Set<string>>();
    for (const entry of ordered) {
      const hash = entry.row.sourceRowHash;
      byHash.set(hash, [...(byHash.get(hash) ?? []), entry.row]);
      const seen = bySnapshot.get(entry.snapshotId) ?? new Set<string>();
      seen.add(hash);
      bySnapshot.set(entry.snapshotId, seen);
    }
    const missingHash = rows.some((row) => !row.sourceRowHash?.trim());
    const invalidFee = rows.some((row) => !Number.isFinite(row.totalFeeCharged));
    const hashConflict = [...byHash.values()].some((items) => items.some((row) => !same(items[0], row)));
    const conflicting = rows.some((row) => !same(rows[0], row));
    const ambiguous = [...bySnapshot.values()].some((seen) => seen.size > 1)
      || (rows.length > 1 && !code(rows[0]) && new Set(rows.map((row) => row.sourceRowHash)).size > 1)
      || rows.some((row) => !row.clientId.trim() || !normalize(row.clinician));
    const relevant = resolutions.filter((resolution) => rows.some((row) => row.clientId.trim() === resolution.clientId
      && normalize(row.clinician) === normalize(resolution.clinicianLabel) && row.serviceDate === resolution.serviceDate && code(row) === resolution.billingCode));
    const approvals = relevant.flatMap((resolution) => {
      if (resolution.mappingInvalid) return [];
      const acceptedRows = acceptedChargeRows(ordered, resolution);
      return acceptedRows ? [{ resolutionId: resolution.id, acceptedRows }] : [];
    });
    const approval = relevant.length === 1 && approvals.length === 1 ? approvals[0] : null;
    return {
      rows, row: rows[0], missingHash, invalidFee, hashConflict, conflicting, ambiguous,
      known: !!approval || (!relevant.length && !missingHash && !invalidFee && !conflicting && !ambiguous),
      duplicateRowCount: rows.length - (approval?.acceptedRows.length ?? 1),
      ...(approval ?? {}),
      ...(!approval && relevant.length ? { resolutionStale: true } : {}),
    };
  }).sort((a, b) => identity(a.row).localeCompare(identity(b.row)) || a.row.sourceRowHash.localeCompare(b.row.sourceRowHash));
}
