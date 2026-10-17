# Billed-Charge Estimate Candidate

## Scope And Lineage

Local runtime/test candidate: `1b8d0b643def10ea0a0d7125d3cf3ecfe5bfb9b5`, tree `614c5b2120067afb9d05365e5fee8faa59f5db03`, branch `codex/billed-financial-estimates`. No push or deployment. Starts from reviewed handoff `bf4f6a0`; runtime before this change matches released `675ae026` (runtime `9cb696b`).

Owner scope: financial estimates from accepted discounted billed charges, compensation rules and configured expense assumptions. Bank reconciliation, paid payroll and exact accounting certification are not required to use the estimate. Recorded actuals remain separate and unknown where incomplete.

## Code

- New pure historical estimate replays dated billed-dollar compensation, annual caps, salary/hourly/per-session modes, employer burden, staff, expense accruals, overhead floor/detail maximum and dated surplus allocations. It reconciles source conflicts globally before admitting coverage. Five pinned fee approvals and declared historical-only providers retain their own scope. Same-day visit overrides remain effective for count-based costs. No card-fee replacement of historical discounts.
- Owner clinical pay and the mapped family salary are subsets, not extra payroll. An owner-pay target inherited for planning is excluded from additional salary expense. Cash, paid payroll, bank transfers and family cash take-home remain unknown in the historical estimate.
- Money has a separately labelled estimate panel. Overview uses estimated surplus and a consistent year split. Goals displays estimated pre-tax progress without certifying a recorded completed-period achievement. Disjoint history/future composition propagates missing inputs and rejects overlapping segments.
- A supported import/save-path reproduction exposed a clinical classification defect: complete attendance could become treatment when PHONE/documentation evidence existed only in an unproved billing source. Raw classification evidence now reaches all clinical views but cannot add visits, source coverage, admitted fees or actual costs. Explicit treatment codes retain precedence. Partial attendance status evidence cannot poison admitted complete attendance.
- `practice-financial-range.ts`, `lib/practice/src/hub/engine.ts`, API source, schema, import storage and actual-goal evaluator are unchanged from the released actual-completeness repair. No business records, source facts, approvals, balances, goals, room settings or converter files changed.

## Author Checks

- `npm test`: 727/727 pass, no skipped tests.
- Six bounded pure verification suites: 30/30 pass, including six-provider attendance, incomplete October 8-21, manual aggregate boundaries, late cancellations, duplicate imports, fee evidence and mapping controls.
- Four pure API/import suites: 40/40 pass, including source coverage, declarations, append-only/overlap and replacement safeguards. These are not authenticated database integration tests.
- Library TypeScript build, dashboard TypeScript, dashboard Vite build and API build pass. Vite emits the existing large-chunk advisory. Local dashboard asset: `index-CKcYz1u1.js`.
- Isolated mounted-page Playwright: 12 states at 1280px/390px, zero browser errors, no horizontal overflow, only synthetic loopback GETs, zero writes. Covers estimates with no finalized periods, estimate/actual distinction, goal progress, inherited owner target versus salary, missing billing-proof unknown state, navigation and circular KPIs. Numerical overview split regression checks history plus future equals the combined bridge within display rounding.
- Final screenshots and results: `/tmp/financial-completeness-render-Q740oy/`. Machine-readable results are also saved as `verification/BILLED-ESTIMATE-RENDER-RESULTS.json`; reproducible harness: `verification/billed-estimate-render.mjs`. Uses the existing local Playwright installation via `PRACTICE_PLAYWRIGHT_PACKAGE=/tmp/forge-reviewed-da6f1d2c-stage/package.json`, not an owner browser/profile. Author inspected the mobile and desktop estimate-panel captures.

## Failed Or Blocked Checks

Fresh synthetic Postgres/API integration could not initialize: macOS `shmget` returned `No space left on device` (shared-memory resource limit, not disk space). No unrelated server or system setting was changed. API integration therefore remains unverified on this candidate; it is not a failing business-data reconciliation.

A broad `verification/*test.mjs` attempt returned 42 pass / 22 fail: fresh-loopback sandbox failures, the same Postgres initialization limit, the intentionally pinned `9cb696b` source guard refusing changed candidate source, and the scale fixture pinned to older `254c21c` differing in warning metadata. These are not claimed as a passing broad suite. The source guard was not weakened or repointed to make it pass. Bounded applicable pure suites were run separately as reported above.

Logs: `/tmp/practice-estimate-tests.log`, `/tmp/practice-estimate-pure-verification.log`, `/tmp/practice-estimate-api-pure-tests.log`, `/tmp/practice-estimate-verification-tests.log`, `/tmp/practice-estimate-api-tests.log`, `/tmp/practice-estimate-render.log`, and type/build logs with the same prefix.

## Review And Release Boundary

Independent review reproduced two monthly overhead errors and an Overview split-basis mismatch during implementation. All three were corrected with regression tests before runtime freeze.

Final frozen review: Franklin (`01a14b90-5f21-73fd-838d-b3029f2be0eb`) verified exact commit/tree above, 20/20 focused tests and independent numerical fixtures; no remaining blockers in that scope. Confirmed monthly max/floor, additive event costs, partial-month proration, historical-only versus unknown identities, multi-visit overrides and unchanged null actual profit/false completeness. Goodall (`01a14b85-bfe7-7227-a546-02f5ad8330d6`) verified exact commit/tree, 178 focused tests, TypeScript and diff checks; no remaining findings in the reviewed page/classification/boundary scope. Both were read-only and did not rerun browser checks. Author's final 12-state mounted render ran against the same frozen runtime after both code fixes; runtime stayed unchanged afterward.

This is a local candidate, not production or whole-account acceptance. Release coordination must review it before any push/deploy and preserve the existing five approvals, declaration revision and every owner record. Additional real operational periods/manual leads and authenticated save/reload/import/export/backup checks remain bounded live work. No repeat owner interview or bank-account reconciliation is needed for the estimated model.

No migration or data backout is necessary. A code-only rollback to the last released runtime preserves stored records and the released `actual.complete` safety repair. Never restore an old database or replay prior approvals as rollback.
