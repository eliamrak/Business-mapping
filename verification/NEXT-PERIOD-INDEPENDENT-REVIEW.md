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

## Independent Frozen Historical Attendance Review (2026-10-22)

Disposition: **clear; no blocker found in this bounded change.** Independently reviewed `codex/frozen-historical-attendance` against `469cefb73c28ce82af9c930fcd490b3f29ce300f`, including the working runtime/test diff. The only behavioral relaxation removes the attendance-kind rejection from the already-confirmed historical identity exception in frozen-member validation. The quoted provider labels improve genuine frozen/incoming error diagnostics. Incoming provider scope, canonical dates, carryover admission, source exclusions, mappings, historical-registry validation and billing reconciliation remain enforced.

The exception agrees with existing `completeReportCoverage` source-set validation and the API declaration validator: both already accept a resolved historical billing identity when validating frozen attendance membership. This does not map that identity to a clinician. `resolveHistoricalBillingProvider` rejects roster/mapping collisions, and the planner still runs `validateHistoricalBillingProviders` before accepting frozen evidence. Coverage row admission requires a mapped reporting clinician; derived sessions likewise require clinician identity. Historical rows therefore remain excluded clinical evidence.

Independent local verification, entirely synthetic:

- `node --test lib/practice/test/next-report-period.test.ts artifacts/comp-dashboard/src/lib/complete-report-coverage.test.ts`: **48/48 passed**, including all five added planner regressions.
- `node --test artifacts/comp-dashboard/src/lib/import-derived-sessions.test.ts`: **25/25 passed**.
- Loaded the baseline planner using `git show` and TypeScript stripping into an in-memory module alongside the actual current planner. The same confirmed historical attendance fixture is blocked by baseline frozen attendance validation and ready under current code. Existing coverage independently admits prior proof through **2026-10-07**; the proposed declarations extend joint coverage through **2026-10-21**, with **2026-10-22** payday and **25/25/0** carryover rows/matched/conflicts.
- Ran actual `completeReportCoverage` and `buildImportedSessionOverlay` together: **53 eligible attendance rows**, **4 eligible billing rows**, **27 unique completed clinical visits**, **$300 billed fees**. Both historical source rows are excluded; every eligible row and derived session belongs to clinician 1. The billing rows reconcile to three billed encounters. Deep comparison confirms unchanged input snapshots, declarations and registry.
- Eleven extra in-memory negative cases passed: absent registry, missing historical billing member, historical identity absent from its billing proof, roster collision, invalid historical bounds, incoming known-historical and unknown providers in each of attendance and billing, a different unknown frozen provider, and a historical frozen attendance row outside confirmed bounds. Every case blocks, returns no proposal and leaves its inputs unchanged.
- The existing regression specifically confirms excluded historical carryover cannot be admitted as a clinical visit: **26/25/1** rows/matched/conflicts. Unknown labels remain blocked despite another confirmed historical identity.
- `git diff --check 469cefb73c28ce82af9c930fcd490b3f29ce300f` passed before this append.

Harness note: the supplied fixture initially shares one historical row object between attendance and billing. An initial independent assertion expecting two excluded objects failed because coverage counts unique object references. The completed integration detached the billing row into a distinct synthetic CSV row and verified both exclusions; no application change was needed.

Only this section was appended by this reviewer. No runtime/test files were edited; no live browser, owner records, network, database, or metadata writes were used. API execution belongs to the separate API reviewer and is not certified here. This establishes the bounded code behavior, not readiness of the actual live package or equality of its carryovers. No remaining blocker identified in this review scope.

## Independent Mixed-Attendance And Billing-Diagnostic Review (2026-10-22)

Disposition: **clear; no blocker found in the bounded diff.** Reviewed `codex/import-conflict-evidence` against `f567caadd90c920ce150b535ed62f314ceb8ab5e`, including working changes. Runtime changes are confined to `next-report-period.ts`. Removing the single-export mixed status/location/subtype rejection agrees with the established `attendanceStatusConflicts` rule: one export may contain different appointments, while differing status sets between exports remain conflicts. The planner still compares full cross-export fact multisets, including multiplicity; it neither selects a newer/older winner nor relaxes carryovers, provider scope, frozen membership, package provenance, or billing approvals.

The diagnostic uses normalized field-value sets only to label an already-established signature conflict. Row multiplicity is identified separately as `rowCount`; equal marginal sets with different composite facts fall back to `rowAssociation`. Messages retain the date and add field names, source IDs and counts without serializing client identities, row hashes, or changed values. Diagnostic detail does not change eligibility or authorize a billing reconciliation.

Independent local evidence, entirely synthetic:

- Focused planner and imported-session tests: **63/63 passed**. Includes field privacy, row-count and association regressions, negative attendance/billing cross-export conflicts, carryovers, providers, approval anchors, stale/competing approvals and extra charges.
- Newly completed API and October-overlap test additions were also inspected and independently executed: **34/34 passed**. The actual-route harness virtualizes the DB entry point; mixed Oct 14 rows survive explicit metadata PUT and reload, while changed billing fields return bounded errors with zero writes. The frontend fixture counts one completed visit and one client cancellation, retaining both original row references.
- Independent temporary in-memory bundle: loaded the baseline planner with `git show` alongside the current planner. The same Oct 14 fixture with a show and a cancellation differing in location/subtype is blocked by baseline and ready under current code. Ran actual `completeReportCoverage` and `buildImportedSessionOverlay` forward and with snapshot, selected-source and row orders reversed: coverage through **2026-10-21**, **55 eligible attendance rows**, **54 show observations**, **26 collapsed duplicate shows**, **28 unique completed visits**, **one excluded non-show**, **three billed encounters / $300**, **zero attendance-status or billing conflicts**. Both Oct 14 rows remain eligible; cancellation does not add a completed visit. Inputs remain deeply unchanged. These are cumulative fixture totals, including prior history, not 28 visits in the new period alone.
- **864 planner permutation checks passed**: all 24 four-snapshot permutations times both selected-source orders for 18 cases. Cases comprise the mixed positive fixture; five cross-export attendance field changes; four private billing field changes explicitly dated **Oct 8**; and distinct/equal-fee approvals with valid full exports, absent approvals, valid partial re-exports, and changed clinical facts after approval. Status, carryovers (**25/25/0**), presence/absence of proposals, and input immutability agree across every permutation. Oct 8 diagnostics identify the changed field and both source counts while excluding sentinel client IDs, row hashes and raw changed values. Reason wording can reflect traversal order; acceptance does not.
- `git diff --check f567caadd90c920ce150b535ed62f314ceb8ab5e` passed before this append. The verification allowlist addition is limited to the October-overlap regression file.

Independent harness corrections: esbuild was resolved through the existing API-server package rather than the root package. A privacy assertion initially matched the generic fixture client `overlap` inside the diagnostic word `overlapping`; replacing generic identities/hashes with distinct private sentinels made the assertion precise. Both corrections concern the temporary harness, not application defects.

Only this review section was appended in the repository; the additional harness is `/tmp/next-period-bounded-independent.mjs`. No runtime/test edits, owner-data reads, live browser access, network requests, database connections, or real metadata writes were performed. No full build, broad gate suite, real PostgreSQL concurrency, or actual-owner carryover equality is certified here. **No remaining blocker in this review scope.**

## Independent Billing-Code Diagnostic Review (2026-10-22)

Disposition: **one P2 blocker in diagnostic accuracy; admission/data parity verified.** Reviewed `codex/billing-code-diagnostic` and its working runtime diff against `847fd809`. Scope is the diagnostic suffix and moving the existing reconciliation map into the enclosing loop. Only this section was appended by this reviewer; runtime and test files were not edited.

### P2: Ambiguous reconciliation evidence is falsely reported as no approval

Location: `lib/practice/src/hub/next-report-period.ts:268` through the fallback at line 270. The helper guards multiple matching groups and mixed codes/providers, but never checks the matched group's `ambiguous` flag or unknown reconciliation state. A single homogeneous group can still be ambiguous. When it has no stale resolution, the fallback emits `none` despite `known: false` and `ambiguous: true`. This contradicts the requested unverified status for ambiguous groups and the explicit unknown-not-false-none requirement.

Independent synthetic reproduction: add a frozen billing export with two distinct-hash same-code A rows for the same client/provider/date; traverse that export before the original frozen export, which has one A row. The selected billing export has one B row with code `0`. Existing reconciliation correctly marks the A group ambiguous and unknown. The final one-row A versus one-row B comparison nevertheless emits:

```text
billing overlapping facts/status/fees or multiplicity conflict on 2026-10-12. Fields: billingCode. Sources: billing-00000001 (1 row), billing-00000002 (1 row). Code classification A: nonempty; B: explicit 0. Incoming rows: 1; code matches A: 0, B: 1, neither: 0. Approval applicability A: none; B: none.
```

Expected A applicability: `unverified`. Both baseline and current planner remain blocked; this finding does not claim incorrect admission. Fix the diagnostic classification using already-computed reconciliation flags, preserving accepted/stale semantics and existing admission behavior. Include this same-code ambiguous-group case in the focused regression coverage.

Independent verification, local and synthetic only:

- `node --test lib/practice/test/next-report-period.test.ts`: **38/38 passed**.
- Temporary in-memory esbuild harness `/tmp/billing-code-independent-review.mjs` loads the actual current planner and a baseline planner obtained by `git show 847fd809:lib/practice/src/hub/next-report-period.ts`. **778 generated cases passed** exact full-result comparison after removing only the added diagnostic suffix, plus deep input immutability checks. Cases cross eight null/empty/whitespace/zero/nonempty/case-normalized codes, six evidence variants (clean, missing hash, invalid fee, shared hash, multiplicity, changed clinical facts), and forward/reversed snapshot/row/selected-source orders; ten additional cases cover valid, absent, partial, stale and changed-code approvals with distinct/equal fee slots.
- The 779th comparison is the explicit ambiguity reproduction above; baseline status, period, carryovers, proposal presence/data and existing reasons remain identical after stripping the suffix. Separate assertions confirm the reconciler's `ambiguous: true` and `known: false`, and the erroneous `none` output.
- Generated diagnostic messages exclude sentinel client IDs, hashes, raw nonempty codes, clinical values and fee values. Static inspection confirms the suffix serializes only fixed code classes, counts and fixed approval labels. Existing dates/source IDs/counts remain intact.
- Lookup checks trimmed client identity, normalized actual raw clinician label, service date and normalized billing code inside canonical reconciliation results. It does not trust a nullable resolved clinician ID alone. Mixed-provider/code groups and unmatched/duplicate groups return `unverified`. Incoming counts come only from selected billing sources and partition the normalized A/B codes; no unselected source contributes to those counts.
- No admission condition was modified in the reviewed runtime diff. The preexisting historical-provider/null identity grouping issue is outside scope and was not repaired or certified. No owner data, network, database, browser, metadata writes, API/UI certification or broad gates were used.

Harness correction: the first ambiguity fixture put the two-row export last, making the immediately compared pair a two-row/one-row conflict where the new suffix intentionally does not apply. Ordering the extra frozen export first reproduces the intended one-row/one-row code-only path without changing reconciliation ambiguity. This was a harness setup correction, not an application change.

**Remaining blocker: classify ambiguous/unknown applicability conservatively instead of emitting false `none`.**

## Independent Billing-Code Diagnostic Fix Re-Review (2026-10-22)

Final disposition: **clear; the preceding P2 is resolved, with no remaining blocker in this bounded review.** This disposition supersedes the preceding review's remaining-blocker statement. Rechecked the working `codex/billing-code-diagnostic` runtime diff against `847fd809` after the applicability fix and inspected the targeted regression updates. Only this review section was appended in the repository by this reviewer.

The homogeneous-group guard now checks every member's trimmed client ID, exact service date, normalized actual raw provider label and normalized code. Accepted applicability requires both `known` and `resolutionId`; explicit stale evidence returns `stale`; an otherwise unknown group returns `unverified`; `none` is restricted to known unapproved evidence. Mixed identity/code/provider groups remain unverified before applicability classification. Lookup continues to use canonical reconciliation output and actual provider labels, rather than nullable clinical identity alone.

The distinction between `unverified` and `none` is diagnostic only. A single blank-code row with no matching blank re-export can remain known and unapproved (`none`); repeated blank-code rows with distinct hashes are canonically ambiguous and therefore `unverified`. The three initially failing expectations asserted `none` for the latter. The owner updated those cases to explicit expected applicability values with a canonical-ambiguity comment, without wildcard assertions. Independent inspection and execution confirm the distinction; the existing A-blank/B-zero/incoming-B case still reports `none` on both sides. Accepted and stale labels likewise do not authorize changed-code conflicts.

Completed independent evidence:

- `node --test lib/practice/test/next-report-period.test.ts`: **53/53 passed** after the explicit expectation corrections. The ten approval/hash-group/count-boundary focused tests also passed independently before those corrections.
- `/tmp/billing-code-independent-review.mjs`: **784 baseline/current comparisons passed**, each comparing full results after stripping only the new suffix and deeply checking input immutability. This reruns the original 778 generated cases and the original same-code ambiguity reproduction, plus independent missing-hash, invalid-fee, mixed-client, mixed-date and mixed-provider cases. All five additional unknown/mixed cases report `unverified` for the affected side. The former blocker now reads `Approval applicability A: unverified; B: none.` and remains blocked identically to baseline.
- Reconfirmed unchanged status, period, carryovers, proposal presence/data and preexisting reason content across those comparisons; generated privacy checks still pass. Static runtime diff review confirms no admission condition changed. New detail contains only bounded classes/counts/applicability labels and preserves existing date/source/count context.
- `git diff --check 847fd809` passed before this append. No runtime/test files were edited by this reviewer. No owner records, live browser, network, database, metadata writes or broad gates were used. API/UI execution remains with the owning reviewers; the preexisting historical-provider/null identity grouping issue remains outside this scope.

Independent harness setup correction: the first mixed-provider fixture lacked frozen scope for its additional provider and correctly stopped before diagnostics. Adding valid synthetic prior attendance/billing scope allowed the intended mixed-provider reconciliation assertion to run and pass. This did not require any application change.

**No remaining blocker in the reviewed diagnostics-only change.**
