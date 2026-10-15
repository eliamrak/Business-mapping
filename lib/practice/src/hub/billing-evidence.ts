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
const kind = (row: EncounterBillingRow) => row.visitKind ?? (code(row) === "phone" ? "consultation" : "");
const identity = (row: EncounterBillingRow) => JSON.stringify([row.clientId.trim(), normalize(row.clinician), row.serviceDate, code(row)]);
const same = (a: EncounterBillingRow, b: EncounterBillingRow) => identity(a) === identity(b)
  && kind(a) === kind(b) && Object.is(a.totalFeeCharged, b.totalFeeCharged);

/** Reconcile derived evidence only. Raw snapshots and their row hashes are untouched. */
export function reconcileBillingEvidence<T extends EncounterBillingRow>(entries: readonly { row: T; snapshotId: string }[]) {
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
    return {
      rows, row: rows[0], missingHash, invalidFee, hashConflict, conflicting, ambiguous,
      known: !missingHash && !invalidFee && !conflicting && !ambiguous,
      duplicateRowCount: rows.length - 1,
    };
  }).sort((a, b) => identity(a.row).localeCompare(identity(b.row)) || a.row.sourceRowHash.localeCompare(b.row.sourceRowHash));
}
