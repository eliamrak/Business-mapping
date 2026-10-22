# Encounter-Specific Billing Code Review

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

- Functional suite: 1,303 passed, including 43 new adversarial core cases and 20 new downstream integration cases.
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
