# Former Clinician Historical Billing: Not Implemented

Historical baseline note: this document records investigation commit `fdbe612`, before implementation was authorized. A subsequent separate historical-billing candidate implements the explicit registry/ledger path and marker review guards; see `FORMER-CLINICIAN-BILLING-SUPPORT.md`. The actual forthcoming export format is still unverified, and no real import is certified. The observations below describe the earlier baseline rather than the new candidate's behavior.

## Owner Requirement And Current Boundary

Owner instruction relayed October 16: preserve former clinicians' historical billed charges from July 1, 2025 in historical monthly totals, without creating clinician cards or including them in forecasts/current-team metrics. A possible `deleted` marker is expected in forthcoming exports, but its format and semantics are **unverified**. No new report has been received, parsed, imported, uploaded or written to production by this task.

This requirement is **not implemented**. Investigation and synthetic characterization do not constitute feature acceptance. Runtime label candidate remains `3f5ad92c5bebedc2d740b9ebb8c88b84abf2f689`, delivered on main `d8d67f8`; its independent review/tests/render evidence remain in `PROVENANCE-LABEL-FIX.md`. No deployment/live confirmation of that candidate has been received locally. This investigation makes no runtime change or production connection and does not block unrelated reviewed label work.

## Confirmed Source Findings

- `practiceFinancialRange` supplies only selected clinician-card roster IDs to `completeReportCoverage`, and filters historical charge reporting to that roster's labels. A source provider with no card cannot resolve through the current mapping schema. Synthetic example: retained source billing contains current $100 plus cardless former $175; the raw reconciled report is $275, but the selected historical Money report contains only $100. This demonstrates the missing separation, not a real business discrepancy or permission to certify an incomplete total.
- Existing `currentPracticeClinicians` filters cards by selected configuration and active/on-team dates, but it is not a billing-only historical identity registry. Do not create a dummy former clinician card, rename an existing provider, merge a planning copy or change current-team membership to work around historical billing scope.
- The current strict package billing-row schema has no deletion/former-provider field and rejects an extra `deleted` property. A name ending `(deleted)` is retained as supplied, not stripped or automatically matched to an active clinician.
- **Important import risk:** legacy raw CSV parsing reads its known columns and silently ignores an extra `Deleted` column, returning no warning. This is not verified support for that format and is not an acceptable route for the forthcoming reports without inspection. No runtime guard for an unknown marker has been added in this investigation. The converter is a separate workstream; it must not silently drop the marker before this contract is settled.

## Overlap And Approval Controls

Synthetic parser-backed checks establish:

- An old October 10 charge and a new October 10-12 export reconcile the same October 10 encounter once, adding October 11 and 12. Shifted row indexes/hashes do not defeat canonical encounter deduplication. Example $100 + $200 + $300 yields $600, not $700.
- A changed fee on the repeated October 10 encounter remains a conflict/unknown, not an automatic newer-export winner.
- Four synthetic source-pinned approved two-charge pairs remain valid when unrelated October overlap is added. Both original anchors and inputs remain unchanged; no approval is recreated. These tests do not reread or mutate the actual four production approvals.
- Reconciliation and source admission are different. Existing billing report coverage through October 10 and a separate October 10-12 report do not establish a complete October 8-21 canonical period as of October 16. The common complete billing cutoff remains October 7 under the existing rules. October 11-12 can be retained/reconciled source facts without being relabeled complete-period actuals. Do not extend the frozen declaration or infer coverage from occupied dates automatically.
- API overlap handling already has distinct explicit retain/replace choices; the default requires review. Existing mocked API tests confirm retain preserves source identities, active packages, rows and settings, exact duplicates remain idempotent, conflicting proof identities are rejected, and audit failure rolls back. Replacement archives overlapping sources and is not interchangeable with retaining a small incremental export. Do not choose replacement for the forthcoming partial report without a separately reviewed preservation plan.
- July 1 itself may lie in a partial canonical boundary period under the existing admission rule. The forthcoming historical monthly charge design must explicitly preserve the requested July 1 service-date facts while distinguishing reported charges from complete-period operating actuals/pace. Do not silently omit the boundary or reinterpret the existing complete-period equations.

## Safe Next Increment After A Report Arrives

1. Inspect the actual report headers, provider identity fields and marker values locally in the already authorized environment. Determine whether the marker describes a clinician, client, appointment, billing row or export status. Retain original text/keys and evidence. Do not infer former-provider status from a generic deletion flag, absent roster match or name suffix.
2. Confirm a minimal import contract using the observed format. Ambiguous/missing markers stay review-required; do not auto-delete, hide fees, choose an active clinician or fabricate aliases. Do not import the new report before that review.
3. Implement historical billing identity/scope independently of the staffing/clinical roster: a validated historical provider reference can contribute accepted service-date charges without creating a card, compensation term, session baseline, current clinical cohort or forecast capacity. No identity key or database migration is chosen by this document; it must follow the actual source contract and reviewed storage/preservation design.
4. Reconcile all retained old/new billing evidence globally before narrowing historical/reporting scope. Preserve stable source identities, overlap deduplication, signed/invalid/zero fee handling, raw conflicts, frozen coverage sets and exact approved exception anchors. Historical charges remain distinct from cash, payroll and profit.
5. Add prospective acceptance tests that are separate from the current limitation characterizations: historical monthly totals include correctly identified former-provider fees since July 1; no cards/current-team/forecast additions; ambiguous markers withhold affected certification; overlapping October 10 reconciles once and October 11-12 are retained; all four actual approval bindings remain valid; repeated imports are idempotent; save/reload/backout preserve original sources and metadata.

## Verification

```sh
node --test verification/former-clinician-billing-investigation.test.mjs
```

Author result: eight synthetic characterization tests plus six existing mocked retain-overlap API tests pass (14 total). The approval fixtures cover one unequal-fee pair and three equal-fee pairs, not replicas or rereads of the four production cases. A separate frozen-source-set test proves new source rows cannot inherit proof even inside an already proved provider period. Tests intentionally document current unsupported paths, not fulfillment of the new requirement. No business records, declarations, balances, goals, room settings, staff cards or approvals were changed. No new spending/access grants, migration, source export or deployment occurred.

Independent reviewer Newton reports PASS/no blockers for this investigation-only evidence and document, independently rerunning 14/14 controls. The existing ten aggregate-runner checks also pass with the unchanged runtime source pin (24 author checks total). This is not implementation approval or a real-data import/deployment result.
