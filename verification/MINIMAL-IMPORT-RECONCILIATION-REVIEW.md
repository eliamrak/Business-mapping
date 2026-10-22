# Independent Minimal Import Reconciliation Review

Status: FINAL REVIEW of the dirty `codex/minimal-import-status` checkout on 2026-10-22, confirmed after AgentLagrange's backend freeze. **No remaining blocking findings in the reviewed helper/API and derived billing changes.** Two independently reproduced P1 findings and the attendance count regression were repaired and rechecked. The final reread includes the explicit nullable-provider-ID guard, narrowed review bounds, unchanged replacement scope, and new retain-handler cases. Only this report is written by the auditor. No database, network, private files, persisted raw records, saved declarations, exclusions, or commits used or changed.

## Closed Findings

1. **Closed P1: complete-report contradictions bypassed API admission review.** `artifacts/api-server/src/routes/practiceImports.ts:684` initially used only observed `coverageStart`/`coverageEnd` to decide whether to call `assessAutomaticOverlap()`. An existing report observed only October 1 but declared complete October 1-31, followed by a new October 15 fact for that provider, had no observed overlap. Before the repair, the actual handler returned HTTP 200, `status: "added"`, four active snapshots, and a normal import audit. Both attendance and billing observed spans were disjoint. The repaired gate uses valid declared bounds to select review evidence, preserving the distinction between observed bounds and completeness.

2. **Closed P1: saved alias mappings hid a conflict from automatic admission.** `artifacts/api-server/src/lib/import-overlap-reconciliation.ts:23` initially keyed touched encounters and complete-report providers by normalized source label. Existing mapped alias show versus incoming canonical-provider cancelled produced `{ safe: true }`; only the incoming canonical label reached the identity callback. The repair defers related alias-backed history before the touched-row filter, without choosing a status or changing mappings.

**Latest fix verification:** the implementation agent has addressed both findings. Normal imports now select review evidence using valid declared proof bounds that enclose observed bounds, while preserving the original observed-overlap scope for explicit replacement. Declared bounds select review evidence only; they do not establish new complete coverage. The helper accepts a related-provider resolver and defers alias/canonical history before its raw-label touched filter; saved alias IDs are used for conflict detection, not permission to choose facts. The helper suite now has 14 passing tests.

Direct **actual route-handler** checks after the narrowed admission-gate change:

| Synthetic scenario | Result | Persistence evidence |
| --- | --- | --- |
| Old complete Oct 1-31 report, then omitted Oct 15 fact | HTTP 409, `complete-coverage-conflict` | Zero mock-state writes |
| Oct 15 fact, then contradictory complete Oct 1-31 report | HTTP 409, `complete-coverage-conflict` | Zero mock-state writes |
| Saved mapped alias show, then canonical provider cancelled | HTTP 409, `identity-review` | Zero mock-state writes |
| Canonical provider show, then its saved mapped alias cancelled | HTTP 409, `identity-review` | Zero mock-state writes |
| Compatible rolling Oct 1 report followed by Oct 1-2 report | HTTP 200, `retained` | Four active raw snapshots; `automaticOverlapReconciliation: true` |

Each first import returned HTTP 200. Alias checks supplied a valid stored declaration mapping `Saved Alias` to roster clinician 1, `Synthetic`, with a null team ID. These are independent handler checks, not just calls to the helper.

**Closed validation blocker:** the intermediate six-test retain-overlap suite failed on a stale roster-query mock while admission assessment was temporarily unconditional. The final implementation narrows assessment to relevant observed/declared overlaps. The agent also updated the checked-in mock, pinned workspace aliases, changed the ordinary-overlap expectation, and added handler regressions. Independent rerun of the current checked-in suite: **10/10 passed**. Combined helper and actual-handler suites: **24/24 passed**. The auditor did not edit those tests.

## Other Findings And Limits

- **RESOLVED during agent edits: attendance count regression.** The initial replacement of `treatmentAttendanceRows()`'s global non-show dedupe changed two within-source cancellations from one clinician cancellation and one room cancellation at `HEAD` to two each. Two cross-source cancellations differing only in room likewise changed from one to two. The agent has now removed `derivedExactAttendanceRows()` and restored the original attendance consumer. Latest tests confirm the existing non-show and room-count semantics are preserved, as explicitly requested in the follow-up instruction. Distinct within-source attendance visits remain an established review/override limitation, not a change in this patch.
- Existing same-day show derivation defaults every client/provider/date to one visit, including two distinct within-source hashes. Synthetic input of two show rows returns one derived visit and a review item with `rawShowRows: 2`, `confirmedVisitCount: 1`, `overrideApplied: false`. This is pre-existing behavior, not introduced by the proposed derived dedupe. It remains a requirement limitation: the review item makes the collapse discoverable, but multiplicity is not preserved automatically.
- The helper's canonical fact tuple includes client, normalized provider, date, billing code, visit kind, status/cancellation subtype/location for attendance, and fee for billing. Hashes are checked against canonical facts rather than treated as authoritative facts. Different fees/statuses do not pick a winner for a directly matching encounter.
- Strict raw billing-code/visit-kind equality is conservative compared with billing evidence's normalized semantics. Equivalent case/whitespace codes may require review unnecessarily; this is a false-positive limitation, not an arbitrary-fact winner.

## Synthetic Evidence

Pure checks use bundled modules with the checkout's practice/hub alias explicitly pinned. An additional actual-handler check bundles the route with `@workspace/db` replaced by the existing `practice-retain-overlap.test.mjs` in-memory mock. No database module initialization, server start, database, network, or real package used. The mock harness was adapted only in memory and was not written to a file.

- `node --test artifacts/api-server/test/import-overlap-reconciliation.test.mjs`: latest 14/14 passed (initially 12/12).
- `node --test artifacts/api-server/test/practice-retain-overlap.test.mjs`: latest 10/10 passed. New checked-in cases independently inspected and executed: compatible overlap auto-retains; changed fees return actionable review with zero writes; declared-range omission in both import orders; saved alias/canonical conflict in both import orders; unrelated unproved spans do not trigger proactive identity review. Existing explicit retain, idempotency, same-source changed-proof rejection, rollback, and explicit replacement checks still pass.
- Exact cross-source billing, two $120 copies with distinct hashes: one derived billed row, $120 total, two original rows retained in reconciliation evidence.
- Two distinct within-source $120 billing charges: two derived billed rows and $240 total; no silent collapse.
- Two within-source differing $120/$130 charges: both raw charges preserved, $250 local fee sum. The admission helper defers such overlapping multiplicity; pre-existing local summaries still sum unresolved evidence and should not be interpreted as proof that it is reconciled.
- Complete report outside observed span: route gating misses a conflict the helper correctly detects.
- Alias/canonical conflict: helper returns safe without visiting the old alias row.
- Independent baseline comparison bundled `git show HEAD:.../retention-local.ts` directly in memory, with no fixture file writes. Exact cross-report cancellations produce one derived cancellation, preserve both raw rows, and remain stable under reversed source order. After the agent restored attendance semantics, visit reconciliation again reports two raw attendance-only diagnostic rows and retains both original evidence rows, matching the baseline.
- Two exact cross-report $120 charges produce $120 in both source orders; two copies carrying the same `sourceSnapshotId` produce $240 because clips of one original source are not independent cross-report proof. This conservatively preserves within-source multiplicity.
- `completeReportCoverage()` with a synthetic mapped roster and complete September 24-October 7 proof admits two clipped snapshots for two original reports. Passing those clips into the changed metrics still dedupes exact billing to $120 and cancellations to one. It does not admit excluded source rows or manufacture completeness. Raw rows and metadata remain unchanged.
- The initial new-test run had two intermediate failures (undefined `patch`, and a mismatched consultation-exclusion expectation). The agent fixed both. Latest combined in-memory execution of `retention-exact-source-facts.test.ts`, `retention-local.test.ts`, `retention-local.privacy.test.ts`, and `complete-report-coverage.test.ts`: **94 passed, 0 failed**. `import.meta.url` was pinned to each original test path for checked-in synthetic fixture/source reads.

UI/visual results are deliberately outside this numerical/code review. There are **118 passing tests independently executed** in this review: 94 derived/coverage/privacy tests plus 24 helper/actual-handler tests. Main-agent typecheck, build, and other API test results are not included in this independent count. Real database durability, production data, and deployment remain outside this synthetic-only review.

## Reviewed Snapshot

SHA-256 identifiers at the final reread:

| File | SHA-256 |
| --- | --- |
| `artifacts/api-server/src/lib/import-overlap-reconciliation.ts` | `a48215003425a6576c3778c071bf08000e3e92bb29e5d085628cd99ab4123695` |
| `artifacts/api-server/src/routes/practiceImports.ts` | `e4698b420da3b7a09ea68109d73058f3e6cae7183a770fc38aa1a67e6bc79825` |
| `artifacts/comp-dashboard/src/lib/retention-local.ts` | `b2ce316fe56cbb741f095e98642f0cd9d0c846131c0fce54ed228d03c6bb7809` |
| `artifacts/api-server/test/practice-retain-overlap.test.mjs` | `b44a094629e515e4daf964f5396213e605ba61b4f29e299203e573db9ecd312d` |

Disposition: accepted within this numeric/code audit scope, with no remaining blocker. Established attendance defaults and review overrides remain as explicitly requested; this patch does not claim to solve all pre-existing same-day visit multiplicity. No commit made.
