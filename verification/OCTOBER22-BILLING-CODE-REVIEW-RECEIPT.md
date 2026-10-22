# Encounter-Specific Billing Code Review

Current governing rule: the owner's latest explicit clarification defines literal `0` as consultation. Matching `PHONE` / `0` sources now reconcile automatically; no discretionary choice is required. The earlier free-PHONE choice sections below are historical and superseded for these equivalent aliases. Genuine other-code conflicts retain the reviewed owner-choice workflow.

Base: `9263eda5e45358d102dffbe7823a498280d8cb88`.

## Scope And Owner Boundary

Data -> Billing exceptions -> Billing code conflicts presents the stored private client reference, clinician, appointment date, both source codes and import dates. Full source provenance is expandable. No winner is preselected. The owner selects a source, previews one source-backed billed charge, enters a note and explicitly confirms Apply code choice. Existing raw rows, attendance, source selections and coverage declarations are unchanged. Reconcile this period remains a separate, explicit operation after all blocking issues are resolved.

Only one-row-per-source alternatives with equal fees and otherwise matching facts are eligible. Same-source multiplicity, different fees, different consultation/documentation classification, conflicting hashes, competing charge approvals and missing provider mapping remain blocked. This is not a two-charge override. Explicit zero and missing codes remain distinct.

New owner-only, no-store endpoints:

- GET `/api/practice-imports/billing-code-candidates`
- POST `/api/practice-imports/billing-code-resolutions`
- POST `/api/practice-imports/billing-code-resolutions/:id/revoke`

Save rederives the exact case and opaque choice under the existing tenant/account advisory transaction lock, checks source evidence, declaration revision and journal revision, and appends an attributed audit event. Undo appends a reversal, including when an approval is stale or its sources are no longer active. Neither operation changes source facts or certifies coverage. No production resolution was applied during development.

## Calculation Integration

Pinned evidence is checked against all retained billing sources before coverage filtering. A newly retained but unadmitted source can invalidate an older approval without becoming admitted evidence. Coverage/scope row clones are matched back to exact original references. The overlay passes validated canonical singleton actuals to the forecast engine without reapplying the raw multi-source code-approval contract. Unknown or stale evidence remains unknown. The raw journal and snapshots remain intact.

Independent review reproduced singleton revalidation in the engine, stale approvals hidden by coverage filtering, missing source identity without approvals, and an ordinary excluded duplicate sorting before its admitted equivalent. These were corrected and received new end-to-end regressions through real coverage views, the overlay, engine, month flow, forecast and Data summaries. The review report retains the initial evidence and final clear disposition separately.

## Verification

- Frozen original candidate functional suite: 1,309 cases, including 43 new adversarial core cases and 26 downstream integration cases. The earlier local 1,303 run preceded six final integration regressions; the publisher independently passed all 1,309 on the frozen candidate.
- Existing database-free API suite: 83 passed.
- New actual-route owner/code-choice/Undo suite: 58 passed.
- Backup contract: 95 passed, including mixed charge/code journal and reversal roundtrips. Its virtual reader now models the previously added package-membership query and all three billing journal actions; production backup routing was not changed.
- Theme/PDF/icon compatibility: 35 passed locally. The publisher also retains the separately accepted 32-check mobile readiness gate.
- Library declaration build, dashboard/API typechecks and dashboard/API production builds passed.
- Actual full Data workspace: 31 synthetic mounted browser checks passed at 1440/390/320, preserving the explicit saved-period workflow and no automatic writes.
- Actual new review component: synthetic preview/apply/Undo/reload, stale response, owner denial, malformed response, keyboard, 320/390/1440 and 200% CSS zoom checks. Evidence and captures are under `/tmp/billing-code-review-render/`; full Data captures are under `/tmp/practice-next-period-render/`.

The full Data harness initially lacked the new endpoint fixture and returned an unrelated array, exposing an unchecked envelope crash. The component now rejects malformed response envelopes safely, and the harness models the real candidates response. Final runs supersede failed intermediate runs.

## Persistence And Backout

No database migration, new table, dependency or hosting configuration change. Existing two-charge approvals retain their data and identities. New code approvals/reversals use the existing append-only `practice_import_audit` table and shared revisioned reader; backup validation preserves those events.

Before any owner uses the new actions, rolling back this code delta is data-neutral. After code events are recorded, keep a code-journal-aware reader when backing out UI/calculation changes: an older reader does not understand the new audit actions, and later interleaved charge approvals can otherwise appear to have revision gaps. Do not delete audit events or restore over business records as a routine rollback. Use the explicit Undo action to reverse a choice while retaining its audit history.

## Remaining Acceptance

Publisher integration, publication identity, fresh authenticated owner UI, production database behavior and public asset provenance for this candidate are not established by local tests. Verify them separately. Do not select or apply the real October 8 conflict during release QA. No original report code was inferred, no patient names/crosswalk were added to app storage, and no real records were changed.

## Bounded PHONE / Zero Follow-up

Base `1840c5659fbd506db02a70edeaaa071f24769606` was published and independently reproduced using served public configuration. The actual owner card then exposed PHONE / 0 / 0, one row per source. The initial eligibility guard compared visit classifications inferred from the disputed codes and incorrectly presented that interpretation as an additional exported-fact conflict.

The follow-up permits only the specific free PHONE / literal-zero alternative when both codes occur, every reported fee is zero, and every raw exported visit kind is absent. Independent exported visit-kind differences, nonzero or differing fees, cancellation differences, same-source multiplicity, hash conflicts, and stale source membership remain blocked. Zero and missing remain distinct. No default code is chosen and original rows remain unchanged.

The preview states that PHONE identifies consultation, zero does not establish an appointment type, and the billing choice does not rewrite attendance or confirm treatment. This is not permission to turn code zero into a completed treatment session. The synthetic three sources use October 8 service date and October 13/16/22 import dates; repeated zero rows may share their identical row hash across independent sources.

Final follow-up verification: 1,316 functional, 246 database-free API/backup, 35 local compatibility tests; library declarations, both typechecks/builds; actual component rendered at 320/390/1440 with each PHONE/0/0 preview, zero extra writes, retained classification warning, plus prior stale/Undo/keyboard/zoom checks. Independent review ran 76 core/integration and 68 actual-route checks and found no actionable issue. No real choice or admission was applied. The actual live fee/raw-kind condition must be verified through the owner card before claiming that this encounter is now selectable.

## Owner-Confirmed Zero Consultation Semantics

Base `65db712e1146470d3e27224184a780499c12079d`. Authority is the current owner clarification `Sentinel_38e669d5343081919c0da1684d33bd2a`; no earlier matching quote is asserted verified.

The shared service classifier recognizes literal `0` and `PHONE` as consultation aliases. Semantic comparison is derived only: raw strings, row/source hashes, snapshots, provider mappings and journals are unchanged. Blank/null, `00000`, `00`, other procedure codes and treatment appointments are not aliases. No duration is invented for zero. The existing free PHONE/consultation fee policy is applied consistently to the alias, preserving any reported nonzero amount and its anomaly instead of rewriting it to zero.

Equivalent encounter facts deduplicate automatically across independent sources. Explicit contradictory kinds, differing fees/cancellation, real same-source multiplicity, and raw hash/payload collisions still block. Identical stable-hash copies keep their established duplicate behavior. The planner checks raw source hash evidence separately before applying semantic equivalence, including hashes touched by selected carryovers, without reopening unrelated historical conflicts.

The billing-code chooser is not offered for matching PHONE/0/0 facts, and no code approval or journal event is generated. Existing exceptional-code review and Undo remain for genuine disagreements. Consultation classification is shared by clinical activity, scheduled conversion and retention; code-zero calls cannot become treatment starts or satisfy the three-treatment retention threshold.

Synthetic saved-period preview shows October 8-21 ready with 25/25 matching carryovers and no code choice, POST, PUT, row mutation or journal change. Explicit Reconcile this period remains a separate action; preview alone does not admit coverage. Existing Converter output already preserves literal zero, so the supplied saved package needs no re-upload, parser rewrite or Converter replacement.

Final verification: 1,335 functional tests, 251 database-free API/backup tests, 35 local theme/PDF/icon checks; library declarations and both artifact typechecks/builds; 32 full Data browser checks and actual code-review component checks at 320/390/1440, keyboard and zoom. Independent final review passed 224 focused tests with no remaining reproduced finding after two raw-hash guard regressions were fixed. No actual owner resolution, admission, import or record write was performed. Production preview and fresh public provenance remain publisher-coordinated gates.
