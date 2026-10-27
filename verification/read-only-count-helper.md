# Read-only count helper

Exact application source: 9865635faf427df7f9a10c479042c10493984a18.
Standalone browser/Node ESM: `read-only-count-helper-9865635.mjs` (612692 bytes).
SHA256: `097b3536cb6e961f926477254f0611bd7a26e7b8e15de42d3bb7b3594d35e823`.

Built using installed esbuild 0.27.3, exact isolated source checkout and existing locked zod dependency. Entry source is adjacent. No actual data, secrets, network client, storage writer or app connection is included. Import/empty-input/immutability smoke passes. Existing full source release had 1302 regression tests passed.

`admitClinicalInput({snapshots, workspace, context, asOf, declarations, sameDayVisitOverrides})` composes the exact app admission pipeline from practice-workspace.tsx (894–940): completeReportCoverage, buildImportedSessionOverlay, completeServicePeriodState, snapshotsForClinicians, currentPracticeClinicians, derivedShowVisits. `declarations` must be the app's merged importEvidenceDeclarations (including current billing resolutions). Pass original full history and classifier snapshots, not date-truncated input. Output includes eligible historical snapshots, admitted visits, current-roster visits, coverage, roster, diagnostic and session aggregates. Output includes client identifiers: retain within authorized worker memory; return aggregates only.

Also exports the original retention-local public functions (including periodClientAttritionEvidence, buildLocalRetentionMetrics, estimateLocalClientActivity), sessionProgression and named pipeline helpers. No A4/A5/A6 formula is embedded; apply independently reviewed period/cutoff/cohort definitions. Empty coverage is unknown, not proof of zero. Never use fixture counts as actuals. Do not run any unrelated exported importer/restore helper for this lookup.
