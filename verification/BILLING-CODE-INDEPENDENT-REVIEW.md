# Independent Billing Code Review

Reviewed 2026-10-22 against `9263eda5e45358d102dffbe7823a498280d8cb88`. Read-only review of runtime code; this report is the only reviewer-created repository file. No database, private input, or production service was accessed.

## Final Re-review Outcome

No outstanding reproduced findings remain in the reviewed code. All four findings documented below are resolved. This conclusion is limited to the reviewed billing-code changes and synthetic evidence, not a live production or database certification.

Independently reran the latest two reproductions through real `completeReportCoverage`, `billingRowsInSnapshots`, `summarizeReportedBilling`, and `buildImportedSessionOverlay` exports. With no approvals, with `billingResolutions: []` after final undo, and with an identical excluded copy sorting first, each scenario now recovers exactly one admitted original row, reports $125, emits one known $125 actual from the admitted source, and preserves input data. Complete billing views always preserve the original source ID; ordinary duplicate groups select an admitted equivalent without relaxing approval-anchor coverage.

Latest focused verification: 63 tests passed across billing-code integration (14), complete-report coverage, import-derived sessions, and reported billing. These include both selected-code choices, missing selected sources, retained-but-unadmitted selected anchors, third-code and identical-payload C invalidation, existing charge approvals, and ordinary coverage/deduplication behavior. The additional real-coverage regression tests announced by the core agent had not yet appeared in the file when this run completed; the independent executable probes covered those cases directly.

Inspected the final compact source-provenance UI and updated synthetic render receipt at `/tmp/billing-code-review-render/results.json`: nine captures include compact preview and expanded provenance at 320/390 widths and 200% zoom, zero browser errors, no automatic writes, and unchanged source facts. The final envelope guard rejects malformed top-level candidates/revision responses. The independent reviewer read this render evidence rather than rerunning the browser harness. Full Data recorded 31/31 passing mounted checks; backup and integration previously independently passed 109/109 (95 backup plus 14 integration). No live DB or private source data was accessed. Only this report was written by the reviewer.

## Re-review History (Resolved)

The original P1 and P2 below are resolved by the updated evidence handoff and summary callers. Independently reran both recognized code choices (`90837`, `90834`) through real coverage -> overlay -> engine exports: each produces one $125 charge, no unknown billing day, and no code resolution in the canonical engine context. Adding an unadmitted third source makes each choice stale: the summary becomes null, only admitted A/B actuals are emitted, both carry `evidenceUnknown`, and the engine withholds billing. The strict raw-evidence helper still requires all anchors; no singleton waiver was introduced.

At that review boundary, two newly reproduced regressions remained in the eligibility integration. Both are now resolved as verified above:

### P1: Without any approvals, admitted coverage rows cannot map back to original billing sources

Locations: `artifacts/comp-dashboard/src/lib/reported-billing.ts:45`, `artifacts/comp-dashboard/src/lib/complete-report-coverage.ts:170`, `artifacts/comp-dashboard/src/lib/import-derived-sessions.ts:221`.

`billingRowsInSnapshots` requires source identity equality, but `completeReportCoverage` only preserves `sourceSnapshotId` when `declarations.billingResolutions.length` is nonzero. With no approvals (including after undoing the final approval), the coverage view has an ID such as `billing-source:complete:1:2026-10-08` and no original source ID. It never matches the original `billing-source`. Both updated workspace summaries and the accepted overlay therefore lose valid admitted billing.

Executed synthetic reproduction: one $125 `90837` row on `2026-10-12`, one mapped clinician/team, frozen complete billing source set for `2026-10-08` through `2026-10-21`, no billing resolutions. Real `completeReportCoverage` reports one `eligibleBillingRows` member and one complete snapshot. Real `billingRowsInSnapshots` recovers zero rows. The former direct eligible-snapshot summary returns `[125]`; the new raw-source-plus-eligibility summary returns `[]`. The accepted overlay with `billingEvidenceSnapshots` emits `[]` actuals. Preserve original source identity for all complete billing views, independently of approval count, and test the no-approval and final-undo paths.

### P2: An identical excluded copy can make ordinary admitted billing unknown

Location: `artifacts/comp-dashboard/src/lib/import-derived-sessions.ts:242`.

The new known-state check requires `(group.acceptedRows ?? [group.row])` to be eligible. For ordinary identical cross-source copies, `group.row` is a deterministic reconciliation representative, not a pinned approval anchor. If an excluded copy sorts first by hash, the eligible equivalent is incorrectly marked unknown. Explicit approvals must require eligible selected anchors, but ordinary identical groups need an admitted equivalent representative.

Executed synthetic reproduction: two source snapshots contain the same clinician/client/day/code/fee ($125), with hashes `a-excluded` and `z-admitted`; only the second is admitted. Pass both as `billingEvidenceSnapshots` and the admitted source as overlay snapshots. The real summary over both originals plus `billingRowsInSnapshots` returns `[125]`. The real overlay emits the admitted row with `evidenceUnknown: true`, and `diagnostic.billedFees` is null. This reproduces without coverage clones, isolating it from the preceding identity bug. Add a regression with an identical excluded copy sorting before the admitted copy, and keep the selected-anchor check strict for approved cases.

Re-review verification: reran import-derived sessions, reported billing, and the expanded pure code suite: 84 passing tests. Ran separate assertion-based synthetic probes for both original fixes and the two new regressions. The subsequently arrived `billing-code-integration.test.ts` now contains 14 passing tests, independently run. Those cover both recognized selections, three-source shared-hash cases, unadmitted C, missing selected sources, excluded selected sources, and unrelated unadmitted billing. They manually construct admitted views with `sourceSnapshotId` and always supply an approval, so they do not cover the real no-approval coverage-clone failure. They also do not cover an ordinary identical excluded copy sorting before its admitted equivalent. No runtime files were edited by this reviewer.

Additional backup/UI evidence reviewed: independently ran all 95 `backup-contract.test.mjs` tests with the 14 integration tests (109/109 passed). The backup delta only changes the in-memory reader to handle the existing package-source audit query and all three billing journal actions, then adds approval-only and approval-plus-reversal round trips. Those round trips preserve the five preceding charge approvals, raw snapshot tables, declarations, and exported audit records. No backup runtime broadening beyond the previously reviewed journal union was introduced. The current saved `next-period-render-results.json` contains 31 checks and zero failed checks, superseding the earlier stale-fixture failure recorded below. Inspected the arriving UI response-envelope guard: it rejects missing/non-array candidates or invalid revision before rendering. Final compact-provenance render evidence was still pending at this review boundary.

## Original Findings (Resolved On Re-review)

### P1: The engine rejects an already reconciled code choice because the overlay discarded its other anchors

Locations: `lib/practice/src/hub/engine.ts:171`, `artifacts/comp-dashboard/src/lib/import-derived-sessions.ts:237`, `lib/practice/src/hub/billing-code-resolution.ts:58`.

`buildImportedSessionOverlay` correctly reconciles the original source entries, then emits only `group.acceptedRows` for a known code choice. It also puts the original resolution in the returned context (`import-derived-sessions.ts:358`). The engine now receives that union of charge and code resolutions and runs reconciliation again against the emitted billing actuals. A code approval requires at least two entries and the complete original evidence list; its one selected row cannot satisfy that contract. Therefore an otherwise valid owner approval becomes an unknown billing day in the engine. The row projection also drops cancellation subtype, which must be considered when designing the evidence handoff.

Synthetic reproduction executed through the real `buildImportedSessionOverlay`, `summarizeReportedBilling`, and `summarizeImportedBillingActuals` exports:

- One clinician, one attended client/day, two distinct billing snapshots, codes `90837` and `90834`, equal fee $125, different row hashes.
- Explicit code resolution pins both snapshots and selects the first row; confirmed mapping points to clinician 1/team 7.
- Overlay emits exactly one actual with `replacementSessionCount: 1` and no `evidenceUnknown`.
- Reported summary: October charges $125, one canonical row.
- Engine result: `billed: []`, `unknownDates: [{ clinicianId: 1, date: "2026-10-02", reason: "Billing encounter identity or amount is ambiguous; no duplicate or conflicting payload is authoritative." }]`.

This is a new integration failure caused by passing code resolutions into a second reconciliation designed for the raw evidence contract. Preserve enough original evidence through the engine boundary, or introduce an explicitly validated canonical handoff. Do not weaken the all-source validation merely to accept a singleton. Add an integration regression covering overlay -> engine/monthFlow, with both code selections and a new-source invalidation.

### P2: Coverage filtering reactivates an approval invalidated by a new source

Location: `artifacts/comp-dashboard/src/components/practice/local-retention-workspace.tsx:372` and `:383`. Related caller: `artifacts/comp-dashboard/src/pages/practice-workspace.tsx:915`.

The workspace passes only `eligibleMetricSnapshots` into `summarizeReportedBilling`. Its all-source reconciliation cannot see retained sources omitted by frozen coverage admission. An approval pinned to sources A and B consequently remains accepted in the displayed totals after a new active source C invalidates the approval in the raw evidence and owner API. The changed UI can simultaneously warn that an approval is stale and display its previously approved charge as known.

Synthetic reproduction executed using the real `completeReportCoverage` and `summarizeReportedBilling` exports:

- Same clinician/client on `2026-10-12`; A=`90837`, B=`90834`, C=`90832`, all $125 with distinct hashes.
- An explicit valid resolution pins A and B and chooses A.
- Frozen billing source set includes only A and B, with complete bounds `2026-10-08` through `2026-10-21`.
- `completeReportCoverage([A,B,C], ...)` admits A and B only, as expected.
- Full-source summary with that resolution: `[null]` monthly charges, stale.
- Exact workspace calculation over `coverage.eligibleSnapshots`: `[125]` monthly charges, accepted.

Reconcile all retained billing snapshots before applying coverage eligibility. The helper already accepts `eligibleRows`, but coverage snapshots clone their rows, so use the original-row eligibility set (`eligibleBillingRows`) with original snapshots. Audit the accepted overlay caller for the same filtered-evidence handoff; do not carry frozen coverage into C automatically. Add a regression for A/B admitted plus unadmitted C.

## Supporting Checks

- Independently ran the new pure suite, new actual-route suite, and existing charge-resolution suite: 106 passing tests (40 new pure, 58 new route, 8 existing charge).
- Independently ran import-derived sessions, reported billing, historical billing ledger, practice financial estimate, and historical clinician earnings suites: 116 passing tests. The two integration reproductions above demonstrate gaps in those passing suites.
- Verified the reported global hash-collision fix: the original hash conflict map is retained before code-handled entries are filtered; remaining charge groups inherit conflicts. Four synthetic collision cases (client, provider, date, fee) pass, with both the code group and colliding group unknown.
- Reviewed the new actual-route test harness: it bundles the real routes with an in-memory database replacement, checks actual SQL tenant/action filters, and does not initialize a DB pool.
- Reviewed exact encounter membership, per-row anchors, raw code preservation, no initial selected choice, equal fee/raw kind/cancellation checks, same-source multiplicity blocking, mapping binding, competing charge/code guards, owner-only new routes, authenticated router mounting, no-store on authorized new route responses, token/revision checks under an advisory transaction lock, and append-only reversal events in the existing audit table.
- Mixed journal parsing retains earlier two-charge approvals, orders approval/reversal events by revision, rejects gaps/duplicate IDs/invalid reversals, and allows a new approval after undo with a fresh ID. Backup validation includes all three billing journal actions; no migration was added.
- Code save and undo write only audit events, not raw snapshots, attendance, or declarations. Next-period admission remains a separate declaration operation; code approval alone does not extend coverage.
- Historical billing ledger, financial estimate, and clinician earnings helpers reconcile original retained entries before eligibility/provider filtering. No additional reproduced canonical fee/kind defect was found in those helpers.
- Inspected the actual new React component and its integration props/state. The synthetic browser harness mounts the real component and real fetch client, with synthetic API responses. Existing `/tmp/billing-code-review-render/results.json` records 320/390/1440 widths, 200% zoom, explicit apply/undo, stale rejection, owner denial, no automatic writes, and no browser errors. This reviewer did not rerun the browser harness.
- Read all initial tracked diffs and new UI/helper/test/render files, plus arriving theme-scope and render-result diffs. A concurrent full-workspace render result recorded an unhandled new candidates endpoint returning a non-candidate response and a component error. The arriving `verification/next-period-render.mjs:99` change adds the missing candidate response; reviewed that correction, but its rerun result was not yet verified. This is not asserted as a reproduced production API defect.

## Limits And Outcome

All four reported findings are resolved on final re-review. No additional reproduced authorization or tenant-isolation vulnerability was found in the new endpoints. Database behavior was simulated; no live DB, browser authentication session, or live restore operation was exercised. Runtime files were not changed by this reviewer.
