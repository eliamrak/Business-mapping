# Independent Next-Period Review

Reviewed branch `codex/next-reporting-period`, working changes over base `1a46ec5a`, on 2026-10-22. Read-only review of application code and isolated synthetic tests; this report is the only file written by this reviewer. No commits, database connections, network calls, private packages, or real-record writes.

## Re-review Outcome

Re-reviewed the package provenance repair on 2026-10-22. **No remaining blocker found in the reviewed changes. Both initial P2 findings below are resolved.** The initial reproduction evidence is retained below as review history, not as a claim about current behavior.

Current implementation requires `nextPeriod.packageId`, finds that package only among active tenant/account records inside the declaration transaction, reconstructs its validated pair, and compares the sorted request pair before invoking the planner. Both frontend paths send the selected package ID. This closes the unrelated-pair and missing-package acceptance paths.

`packageSources` reads tenant/account-scoped import/retain/replace audit receipts and prefers their exact validated pair, including references to collections owned by an earlier package. Conflicting, invalid, or inactive-source receipts block membership without ownership fallback. Legacy history without a source-ID receipt admits only exactly two owned snapshots, one of each kind. New import audit records retain both validated source IDs even when one collection is reused. The reuse/reload gap is therefore closed for newly receipted imports; legacy partially deduplicated imports lacking a receipt conservatively remain unavailable for automatic reconciliation.

Audit `LIMIT 10001` safety was checked against the final guard: `if (audit.rows.length >= 10001) return result;`. It returns an empty map before examining receipts or attempting ownership fallback. Thus an omitted conflict cannot cause admission. At 10,001 matching audit rows this conservatively disables automatic package-pair reconciliation for that tenant, including valid packages. This is an availability limit, not a data-integrity blocker; date ordering is unnecessary for safety because the entire sentinel-sized result is rejected.

Re-review verification, all isolated and synthetic:

- Updated actual-route API suite: **19/19 passed**. Includes unrelated pair/package rejection, tenant/account/package activity scope, reused-source GET recovery and PUT, invalid/conflicting receipts, and exact legacy fallback.
- Independently extracted and executed the actual `packageSources` helper: valid receipt and reused-source receipt accepted; conflicting/inactive-source receipts block fallback; legacy exact owned pair accepted; 10,000-row valid history accepted; 10,001-row history blocked even when fallback could otherwise succeed.
- Independently extended the actual-route harness in memory, modeling the SQL limit with a 10,002-entry audit history whose selected-package conflict is beyond the first 10,001 entries: **20/20 passed**, GET pair `[]`, PUT **409**, writes `[]`. No test or source files were edited.
- Frontend inspection confirms `packageId` is sent on both new-upload metadata PUT and the explicit saved-package action. Missing individual-date prompts are suppressed for the recognized pending pair while the reconciliation proposal/reasons remain visible. Mounted browser revalidation remains assigned to the browser agent.

## Initial Findings (Resolved)

### Resolved P2: PUT did not verify that the selected sources were a saved package pair

Location: `artifacts/api-server/src/routes/practiceImports.ts:520` and `:525`.

The transaction loads all active tenant snapshots, converts them to planner snapshots, and passes the two request IDs directly to the planner. It never reads package membership for that selection. The planner verifies one source of each kind and their facts, but deliberately assigns package provenance to its caller. Consequently, a request can combine two unrelated saved reports and certify their combined coverage with the `known-next-reporting-period` audit basis. Active tenant membership is enforced; the missing constraint is the exact owner-selected package pair.

Independent reproductions using the existing database-free route harness, extended only in memory:

- Move the selected billing snapshot's `packageImportId` from `next` to another active package. The unchanged proposal returns HTTP 200 and writes `["declarations", "audit"]`, with basis `known-next-reporting-period`.
- Remove the `next` package row while leaving its snapshots active. The unchanged proposal still returns HTTP 200 and writes `["declarations", "audit"]`.

Expected: under the same transaction, verify a durable validated-upload pair before granting this automatic metadata basis. A pair must be represented explicitly enough to support legitimate reused collections; requiring equal snapshot `packageImportId` alone would not handle the next finding.

### Resolved P2: Package history lost a reused collection, breaking reconciliation after reload

Location: `artifacts/api-server/src/routes/practiceImports.ts:363`, `:697`; consumer: `artifacts/comp-dashboard/src/components/practice/local-retention-workspace.tsx:448`.

POST correctly returns both validated `importedSourceIds`, but deliberately inserts only collections whose source identity is new. A reused collection keeps its earlier `packageImportId`. GET builds each package's `sourceIds` exclusively from snapshots owned by that package, so the new package's durable history contains only the newly inserted collection. The complete pair returned by POST is not preserved for recovery.

For a next-period upload containing new attendance and unchanged billing previously saved after the last declaration confirmation, immediate POST-to-PUT can use the correct two IDs. If metadata fails, the page reloads, or the upload was saved using Other report, the explicit existing-upload action instead receives a one-member pair and is blocked. A duplicate POST can return the pair again, but GET alone cannot recover it, defeating the promised saved-history recovery path.

Independent GET reproduction in the route harness: keep both selected snapshots active, assign selected billing to an earlier `previous-other-report` package, and read history. `synthetic-next.sourceIds` is `["attendance-00000002"]`, whereas the validated upload pair is `["attendance-00000002", "billing-00000002"]`. The deduplication branch at `:697` is the production path that creates this ownership arrangement. This reproduction constructs the resulting synthetic state; it does not claim to exercise a complete partial-dedup POST.

Expected: retain/reconstruct the exact validated upload references independently of which package physically owns each snapshot, and consume that pair in both PUT validation and the reload recovery UI. Do not duplicate raw rows or weaken individual coverage proofs to repair it.

## Independent Verification

Commands run successfully:

- `node --test lib/practice/test/next-report-period.test.ts`: 29/29 passed, including the final recency guard tests.
- `node --test artifacts/api-server/test/practice-next-report-period.test.mjs`: 15/15 passed, with the real route and planner bundled and only the database entry point virtualized.
- In-memory extension of the API harness: 17/17 passed, including two assertions demonstrating the accepted cross-package/missing-package requests above. These two passing assertions establish current undesired behavior, not acceptance of that behavior.
- Separate in-memory extension: 16/16 passed, including the reused-collection history reproduction.
- Independent in-memory integration of the planner fixture, actual `completeReportCoverage`, and actual `buildImportedSessionOverlay`: assertions below passed.

Numerical integration evidence:

| Measure | Result |
| --- | --- |
| Planned service period | 2026-10-08 through 2026-10-21 |
| Pay date | 2026-10-22 |
| Carryovers / matched / conflicts | 25 / 25 / 0 |
| Joint data-through after proposal | 2026-10-21 |
| Raw admitted attendance rows | 53 |
| Collapsed duplicate show rows | 26 |
| Unique completed visits | 27 |
| Unique billed rows / total fees | 3 / $300 |
| Billing / attendance-status conflicts | 0 / 0 |

The 26 duplicates comprise the 25 Oct 7 carryovers plus one overlapping Oct 12 visit. Deep comparison confirmed the fixture, raw snapshots, and stored declarations were unchanged. The proposal retains the original two source sets and mappings and appends two combined frozen sets. Individual `reportCoverage` was absent and was not added to the raw snapshots.

The authoritative calendar is consistent: Sep 10-23 pays Sep 24; Oct 8-21 pays Oct 22. Sparse occupied dates are not used to infer period bounds. Tests cover absent prior proof, partial canonical proof, frozen-history gaps, future rows, changed carryover facts and multiplicity, scope/team changes, and excluded unselected sources.

The recency guard is present in `lib/practice/src/hub/next-report-period.ts:150`: a selected source imported at or before the latest confirmation is blocked before automatic inclusion; already included sources return up-to-date first. New Oct 22 sources after an Oct 13 confirmation remain eligible. Malformed available timestamps block. Optional absent timestamps remain supported by the pure planner; production `snapshotFromRow` supplies the stored timestamp.

API inspection and isolated tests confirm expected-revision checking, the shared advisory transaction lock, proposal rederivation from current snapshots/roster/journal, canonical proposal comparison, CAS persistence, and metadata/audit rollback in the harness. The successful automatic branch writes declarations and audit only. Existing billing approvals retain original anchors and journal entries; invalid competing/stale approvals and extra charges block.

Frontend inspection confirms visible Next full period / Other report selection before the picker, normal upload POST before metadata PUT, an explicit existing-upload action, no mount-triggered PUT, saved-row feedback on metadata rejection, and upload/reconcile controls locked after uncertain acknowledgment until successful history reload. The legacy editor preserves all additional source sets when rebuilding its first attendance/billing sets. Mounted browser evidence is being owned separately; the existing `verification/next-period-render-results.json` was inspected as supporting evidence, not independently rerun here.

## Limits And Remaining Work

The two package-pair findings are resolved by the re-reviewed changes described above. No remaining code blocker was identified in this review scope. The audit sentinel and legacy missing-receipt behavior conservatively restrict automatic availability.

The actual live 25-row comparison was not available or performed. Synthetic equality proves the code path, not that the owner's real carryover facts match. Before a real metadata action, use the authorized read-only live plan preview against the exact selected source pair; no new date question is needed. Code publication alone does not require a real-record metadata write.

No claim of real PostgreSQL concurrency testing: rollback and CAS were tested through the isolated harness, with transaction/lock SQL inspected. The parent owns final type/build checks and the broader functional suite. This reviewer did not rerun or independently certify the reported 1207-test suite or 58 legacy API tests.
