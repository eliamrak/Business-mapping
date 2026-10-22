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

## Scoped Frontend Review: Saved Import Exceptions

Reviewed `codex/saved-import-review` against base `13784`, including the subsequent collapsed Source receipt disclosure. **No blocker found in the bounded frontend change.** This conclusion concerns exception visibility and action safety; it does not certify or repair the live eight-source package's actual membership, carryovers, or metadata.

The new blocked fallback handles a saved package whose `sourceIds` are absent or empty. Nonempty but invalid membership still goes through the existing pure planner. The panel now renders blocked plans with `period: null`, shows the first reason directly, and keeps additional reasons in a closed details element. No package still yields no panel, and up-to-date plans remain hidden. The reconcile button requires both ready status and a non-null period; blocked fallback and missing-member cases expose no reconciliation action.

The collapsed Source receipt uses existing in-memory package, snapshot, and declaration fields only: package ID; absent membership versus a supplied zero-length array; count of IDs matching exactly one active snapshot; count of frozen links missing or duplicated by ID/kind; declaration revision. These are diagnostic counts, not a membership certification. Duplicate frozen links are counted as links across declarations, not unique missing source IDs. No raw client facts or billing approval details are introduced by this disclosure.

Persistence review: no backend or planner change is part of this frontend diff. No effect, fetch, mutation handler, upload branch, declaration payload, membership admission policy, or billing-journal path was added or altered. The existing explicit reconciliation handler and persistence guards remain unchanged. Reading the memoized fallback, expanding details, and displaying receipt counts cannot save metadata. Existing advanced date/identity controls retain their prior behavior; this patch does not grant them new authority.

Independent verification: `git diff --check 13784` passed. Executed the actual extracted panel JSX with React server rendering entirely in memory: blocked null-period reasons visible, first reason outside details, remaining reasons collapsed, Source receipt collapsed, no blocked button, no ready-without-period button, ready-with-period explicit button retained, null/up-to-date panels absent, and zero callback writes. The initial extraction was refreshed to include the concurrently added receipt's local inputs before the successful run; no application file was edited.

Mounted browser evidence is owned by the render agent. Waited for its completed receipt-specific run: `verification/next-period-render-results.json`, saved 2026-10-22T16:27:11Z, contains **23 passing checks, zero failures**, including missing `sourceIds`, empty `sourceIds`, and missing frozen-member/null-period scenarios at 1440, 390, and 320 widths. All nine exception cases recorded GET requests only and retained declaration revision 2. Inspected the test assertions covering unchanged raw rows/declarations, no reconciliation button or visible date input, visible first reason, collapsed remaining reasons, exact receipt counts, Enter/Space disclosure handling, and GET-only reload. The final artifacts include nine receipt screenshots; this reviewer visually inspected `missing-source-ids-receipt-320.png`. These are synthetic mounted-app results, not inspection of the live eight-source history.

Final scoped disposition: **clear**, with no unintended persistence or newly enabled action path found. Live metadata remains pending; live membership is unknown and was not fixed or certified by this UI patch. No data writes, browser access to the live service, or code edits were performed by this reviewer.

### Final Banner And Manual-Form Follow-up

Reviewed the final additional diff before freeze. **Clear; no actual blocker found.** The blocked Needs attention banner now directs the user to the saved-report issue above. With a known `nextPeriod`, it explicitly says the dates do not need re-entry; otherwise it says to resolve the issue before changing coverage. This supersedes the contradictory old full-period confirmation instruction for blocked plans.

The missing-date manual forms remain intact under a new, initially closed nested details element. Its blocked-state summary is Manual coverage for other reports; normal nonblocked guidance remains available. The forms' original snapshot arguments, duplicate-ID/busy/unconfirmed guards, and `confirmSnapshotCoverage` save handler are unchanged. No eligibility, admission, API payload, persistence handler, or automatic action changed.

Independent in-memory rendering of the actual final banner/disclosure JSX passed: known-period blocked copy, unknown-period blocked copy, retained closed manual forms, unchanged nonblocked copy, zero save callbacks. `git diff --check 13784` passed. No application files were edited by this reviewer.

Browser evidence boundary at freeze: the earlier completed receipt run passed 23/23, but the latest saved run (16:29:29Z) predates the corrected test selectors and shows nine test failures: six ambiguous descendant-summary locator failures and three expectations for known-period copy in the intentionally unknown-period fixture. Inspection identifies these as stale test expectations rather than a demonstrated application blocker. The updated render script was present; its rerun result had not yet been saved at this review's final read. This review does not claim a fresh 23/23 pass for the final banner change. Per parent request, review is frozen without further waiting.

### Final Harness Assertion Review

Reviewed the subsequent change from `innerText()` to `textContent()` on `manual.locator(':scope > summary')` while its parent coverage disclosure is closed. **No gate weakening found.** At that point the assertion establishes the direct summary's exact DOM label, not visibility. Its separate assertion that the manual disclosure lacks `open` is retained.

Later in each of the same nine desktop/mobile exception cases, the harness opens the coverage parent using Enter, explicitly verifies the manual summary is visible while its manual disclosure remains closed, and verifies date inputs are hidden. It then opens the manual disclosure and a source form through their direct summaries and requires exactly two visible date inputs. It closes the disclosures using Space and verifies their closed state. POST/PUT counts remain zero and raw rows/declarations must remain unchanged, including after reload. Thus replacing the closed-parent structural text read does not remove the actual visibility, reachability, keyboard, or persistence gates.

The earlier 23/23 pass predates these new manual-form assertions and must not be reused as the final run result. The final rerun is tracked in `/tmp/practice-saved-review-final-render.log`; its completed result will be recorded separately if available before this turn closes. No new application blocker identified.

### Verified Final Result And Freeze

Independently read the newly completed results and final log. `verification/next-period-render-results.json` was updated at **2026-10-22T16:31:31.514Z**, after both the final component change (16:28:59.883Z) and final harness correction (16:31:01.937Z). **23/23 checks pass; zero failures.** The final log agrees: `{"passed":23,"failed":[]}`. This supersedes the pending/failed intermediate browser evidence above.

All nine missing-membership/empty-membership/missing-frozen-link cases across 1440, 390, and 320 widths pass the final manual-disclosure workflow assertions. Independently confirmed each result records GET requests only and declaration revision 2. The structural hidden-label assertion correction preserves the subsequent visible-summary, keyboard, visible-date-input, and unchanged-record checks.

**Final bounded review: clear, no actual blockers. Report frozen.** The change exposes saved-import exceptions and diagnostic receipts without certifying or repairing actual live membership. Live metadata remains pending. This reviewer wrote only this report and made no code or data writes.

## Independent Bounded Billing-Minute Review (2026-10-22)

Disposition: **clear; no blocker found in the minimal fix.** Independently reviewed the actual working diff on `codex/deterministic-billing-minutes` against `a69170e8f8c35e49efe9fcb91c3494b29c6be104`. Runtime scope is confined to `retention-local.ts`: configured minutes accumulate under the same normalized clinician key as the billing metric, then divide by 60 once. Unknown-only metrics remain null; configured zero creates a map entry and yields zero. The metric exists before final assignment. Existing row admission, fee accumulation, and configured-row counting remain intact. The test diff adds exact forward/reverse assertions and null/zero controls; the verification allowlist adds only the explicit legacy test path. No rounding or tolerance was introduced.

Independent evidence, using synthetic fixtures only:

- `node --test artifacts/comp-dashboard/src/lib/legacy-service-codes.test.ts`: **9/9 passed**, zero failures.
- Loaded the baseline runtime with `git show <base>:artifacts/comp-dashboard/src/lib/retention-local.ts`, bundled it through an in-memory esbuild `onLoad` replacement with `write: false`, and executed it alongside the current runtime. No source replacement or workspace reversion occurred. Using the exact client-ID assignment from the new regression tests, forward baseline/current both return `7.666666666666667`; reverse baseline returns `7.666666666666666`, failing the required exact `460 / 60` comparison, while current returns `7.666666666666667`. Current retains fees **650** and configured rows **9** in both cases. This independently establishes that the reverse regression detects the baseline defect.
- Additional independent in-memory billing fixture, evaluated in both row orders: normalized variants ` Dr   Alpha `, `dr alpha`, `DR ALPHA`, and `Dr Alpha` combine into one clinician. Durations 0.5, 0, unknown, and 0.25 produce exactly `0.75 / 60 = 0.0125`, configured rows 3, billed rows 4, fees 100. Separate Dr Beta with 120.5 and unknown produces exactly `120.5 / 60 = 2.0083333333333333`, configured rows 1, billed rows 2, fees 110. Dr Unknown remains null/configured rows 0/fees 70; Dr Zero remains zero/configured rows 1/fees 80. Exactly four clinician metrics in each order; all assertions passed.
- `git diff --check a69170e8f8c35e49efe9fcb91c3494b29c6be104` passed before this report append.

Numeric boundary: the fix removes the reproduced per-row hour-conversion error for the integral legacy-minute totals. Arbitrary non-binary fractional minute additions still have ordinary IEEE-754 limitations; the fractional checks above establish preservation of fractional values, not a universal exact-summation guarantee. This is not a blocker for the bounded legacy-service regression.

Only this bounded review section was appended by this reviewer. No runtime/test edits, owner-data access, network requests, database tests, or broad gates were performed. Other gate outcomes remain outside this review; no remaining blocker identified here.
