import { normalizeProviderLabel, reconcileBillingEvidence } from "@workspace/practice/hub";

type Row = {
  clientId: string;
  clinician: string;
  serviceDate: string;
  sourceRowHash: string;
  billingCode?: string | null;
  visitKind?: string;
  status?: string;
  cancellationSubtype?: string;
  location?: string | null;
  totalFeeCharged?: number;
};
export type OverlapSource = {
  kind: string;
  sourceHash: string;
  coverageStart: string;
  coverageEnd: string;
  reportCoverage?: { start: string; end: string; complete: true } | null;
  rows: readonly Row[];
};
const identity = (row: Row) => JSON.stringify([row.clientId, normalizeProviderLabel(row.clinician), row.serviceDate]);
const fact = (kind: string, row: Row) => JSON.stringify([
  identity(row), row.billingCode ?? null, row.visitKind ?? null,
  ...(kind === "attendance"
    ? [row.status, row.cancellationSubtype ?? null, row.location ?? null]
    : [row.totalFeeCharged]),
]);
const proof = (source: OverlapSource) => JSON.stringify([
  source.coverageStart, source.coverageEnd,
  source.reportCoverage?.start ?? null, source.reportCoverage?.end ?? null,
]);

export function overlapReviewMessage(reason?: string) {
  const messages: Record<string, string> = {
    "same-source-coverage": "Confirm or revise the existing source's report coverage before importing it again.",
    "identity-review": "Resolve missing, ambiguous, aliased or historical provider identities before automatic reconciliation.",
    "row-hash-conflict": "The same row identity has different facts. Compare the original source rows before retaining or replacing them.",
    "attendance-multiplicity": "Multiple attendance rows describe the same client, provider and date. Review the source appointments and same-day visit count.",
    "attendance-fact-conflict": "Attendance status, location or service details disagree. Compare the original sources and explicitly retain or replace them.",
    "attendance-derived-count-review": "An existing same-day visit override could change counts. Review the repeated show rows and saved visit count before retaining.",
    "billing-evidence-review": "Billing charge, service or encounter evidence is ambiguous. Review the original charges before retaining or replacing sources.",
    "cross-kind-classification-review": "A new attendance/billing counterpart may change service classification. Review the encounter before retaining both sources.",
    "complete-coverage-conflict": "A complete report omits facts found in another source for the same provider and dates. Review the report's scope and confirm its coverage.",
    "automatic-review-limit": "History exceeds the automatic review limit (100 sources or 200,000 rows). Review the overlapping sources explicitly.",
  };
  return messages[reason ?? ""] ?? "Review the overlapping source facts and coverage before explicitly retaining or replacing them.";
}

export function sameSourceCoverageChanged(active: readonly OverlapSource[], incoming: readonly OverlapSource[]) {
  return incoming.some(source => active.some(previous => previous.kind === source.kind
    && previous.sourceHash === source.sourceHash && proof(previous) !== proof(source)));
}

/** Admission check only: never rewrites raw rows, hashes, exclusions, or saved approvals.
 * Exact facts can use existing derived dedupe; aliases and multiple encounter rows need review.
 */
export function assessAutomaticOverlap(
  active: readonly OverlapSource[],
  incoming: readonly OverlapSource[],
  providerIsUnambiguous: (label: string) => boolean,
  hasSameDayOverride: (row: Row) => boolean = () => false,
  relatedProviderIdentity: (label: string) => string | number | null = normalizeProviderLabel,
): { safe: boolean; reason?: string } {
  const reject = (reason: string) => ({ safe: false, reason });
  if (sameSourceCoverageChanged(active, incoming)) return reject("same-source-coverage");
  const sources = [...active, ...incoming];
  if (sources.length > 100 || sources.reduce((count, source) => count + source.rows.length, 0) > 200_000)
    return reject("automatic-review-limit");
  if (new Set(sources.map(source => `${source.kind}:${source.sourceHash}`)).size !== sources.length)
    return reject("identity-review");
  const incomingLabels = new Set(incoming.flatMap(source => source.rows.map(row => normalizeProviderLabel(row.clinician))));
  const incomingProviders = new Set([...incomingLabels].map(relatedProviderIdentity).filter(id => id !== null));
  const incomingClientDates = new Set(incoming.flatMap(source => source.rows.map(row => JSON.stringify([row.clientId, row.serviceDate]))));
  if (active.some(source => source.rows.some(row => incomingClientDates.has(JSON.stringify([row.clientId, row.serviceDate]))
    && !providerIsUnambiguous(row.clinician)))) return reject("identity-review");
  // Derived consumers still key raw labels. Even a valid alias cannot safely merge with a
  // canonical label here; defer related history before the raw-label touched-row filter.
  if (active.some(source => source.rows.some(row => {
    const providerId = relatedProviderIdentity(row.clinician);
    return providerId !== null && !incomingLabels.has(normalizeProviderLabel(row.clinician)) && incomingProviders.has(providerId);
  }))) return reject("identity-review");
  const incomingRows = new Set(incoming.flatMap(source => [...source.rows]));
  // Check only encounters and hashes touched by this import, not unrelated historical exceptions.
  const touched = new Set(incoming.flatMap(source => source.rows.map(row => `${source.kind}:${identity(row)}`)));
  const touchedHashes = new Set(incoming.flatMap(source => source.rows.map(row => `${source.kind}:${row.sourceRowHash}`)));
  const activeIdentities = new Set(active.flatMap(source => source.rows.map(row => `${source.kind}:${identity(row)}`)));
  for (const source of incoming) for (const row of source.rows) {
    const otherKind = source.kind === "attendance" ? "billing" : "attendance";
    if (!activeIdentities.has(`${source.kind}:${identity(row)}`) && activeIdentities.has(`${otherKind}:${identity(row)}`))
      return reject("cross-kind-classification-review");
  }
  const facts = new Map<string, string>();
  const hashes = new Map<string, string>();
  for (const source of sources) {
    const counts = new Set<string>();
    for (const row of source.rows) {
      const key = `${source.kind}:${identity(row)}`;
      const hash = `${source.kind}:${row.sourceRowHash}`;
      if (!touched.has(key) && !touchedHashes.has(hash)) continue;
      if (!row.clientId.trim() || !row.sourceRowHash.trim() || !providerIsUnambiguous(row.clinician))
        return reject("identity-review");
      const value = fact(source.kind, row);
      if (hashes.has(hash) && hashes.get(hash) !== value) return reject("row-hash-conflict");
      hashes.set(hash, value);
      if (counts.has(key)) return reject(source.kind === "attendance" ? "attendance-multiplicity" : "billing-evidence-review");
      counts.add(key);
      if (facts.has(key) && facts.get(key) !== value)
        return reject(source.kind === "attendance" ? "attendance-fact-conflict" : "billing-evidence-review");
      if (source.kind === "attendance" && facts.has(key) && row.status === "show" && hasSameDayOverride(row))
        return reject("attendance-derived-count-review");
      facts.set(key, value);
    }
  }
  const billing = sources.flatMap((source, index) => source.kind === "billing"
    ? source.rows.filter(row => touched.has(`${source.kind}:${identity(row)}`) || touchedHashes.has(`${source.kind}:${row.sourceRowHash}`))
      .map(row => ({ row: row as Row & { totalFeeCharged: number }, snapshotId: String(index) })) : []);
  const billingGroups = reconcileBillingEvidence(billing);
  if (billingGroups.some(group => group.rows.some(row => incomingRows.has(row)) && !group.known))
    return reject("billing-evidence-review");

  // A complete report asserts absence too, scoped only to providers actually present in it.
  // Observed min/max bounds alone never establish completeness or override another source.
  for (const declared of sources) {
    const range = declared.reportCoverage;
    if (!range) continue;
    const providers = new Set(declared.rows.map(row => normalizeProviderLabel(row.clinician)));
    const declaredFacts = new Set(declared.rows.map(row => fact(declared.kind, row)));
    for (const other of sources) {
      if (declared === other || declared.kind !== other.kind
        || (!incoming.includes(declared) && !incoming.includes(other))) continue;
      if (other.rows.some(row => providers.has(normalizeProviderLabel(row.clinician))
        && row.serviceDate >= range.start && row.serviceDate <= range.end
        && !declaredFacts.has(fact(other.kind, row)))) return reject("complete-coverage-conflict");
    }
  }
  return { safe: true };
}
