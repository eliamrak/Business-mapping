# Room Headline Source Scope

## Confirmed Acceptance Defect

P2, reproduced against main `39f613d28cc15382488e8d325b6645170c35b926`. The Rooms headline calculates configured weekly slots from non-archived, non-review-only rooms active on `min(selected period end, today)`. Its adjacent assigned/open-hours subtitle instead summed every non-archived room, regardless of dates or review-only status.

The isolated synthetic fixture contains a current shared room with 10 available hours and two assigned hours, a future dedicated room with 40 hours, an expired dedicated room with 20 hours, a review-only room with 100 hours, and an archived room with 30 hours. On October 14 the existing app displays **10 slots / 162 assigned-open hours**. Expected scope is **10 slots / 2 assigned-open hours**. No source edits or save action are needed to expose the mismatch.

This is a source-scope inconsistency, not evidence of incorrect live room records or a new room-utilization definition. Existing assigned-versus-open-hour semantics, block intersection arithmetic, usable percentages and session lengths are preserved.

## Narrow Repair

`configuredRoomsAtDate` in `practice-scope.ts` applies the existing slot eligibility rule once. Both headline reductions consume that exact room set. Inclusive start/end boundaries, archive/review-only exclusions and the existing future-range clamp are unchanged. All rooms remain in the original editable list, including future, ended and imported review-only rooms; no records are removed or normalized.

There is no change to scheduling, skipped-week controls, forecasts, physical capacity arithmetic, financial/clinical equations, navigation, goals, import source admission, billing journals or persistence. No migration is required. Rollback is a code redeployment only; no record or approval should be reverted.

## Verification

- Four scope tests pass, including two new room cases: date boundaries, future/expired/review-only/archived exclusions, empty configured scope, reference identity and complete source preservation.
- Full domain/dashboard-library suite: 660 tests pass.
- Dashboard typecheck and production build pass with the existing nonfatal Vite notices.
- With unchanged main `39f613d` served locally, `verification/room-hours-scope-render.mjs` and `ROOM_SCOPE_PROBE_ONLY=1` prints the original 10/162 mismatch without asserting the repair. Against the candidate it prints 10/2. Without that flag the script asserts the repaired 10/2 headline, inclusive expiry, the following day, future selected dates clamped to today, and a date before any configured room starts.
- Ten new desktop/mobile captures pass, with no overflow, intact top navigation, zero browser errors/API writes and unchanged synthetic source/workspace/context facts. The existing 45-state workspace render suite also passes (55 total rendered states).
- Output stays under the existing untracked `verification/practice-workspace-render/` directory (`room-hours-*`, `room-hours-scope-results.json`). All browser sessions use a fresh isolated headless Chromium profile and mocked localhost APIs, not the shared browser used by Forge.

## Remaining Inputs And Acceptance Limits

No owner input is required for this repair: the date/configuration scope is already specified by the adjacent capacity headline and earlier approved behavior.

Meaningful physical-room capacity still depends on real setup wherever a room remains review-only: effective start/end, actual opening hours or recurring blocks, session minutes, usable percentage, shared/dedicated use and any clinician assignments. Those values belong in the existing editors and must not be invented from imported location names. This task does not assert that the current production account is missing any particular setting; it does not read production data.

Bank/payroll/expense reconciliation, supplied-report completeness and final owner design acceptance remain separate from synthetic tests. Unknown modality/report coverage remains unknown; no attendance, cash, salary, expense, goal or fund-balance values were filled. The four live fee approvals and owner-confirmed declarations are untouched. No production connection, mutation, deployment or main promotion is performed in this task.

## Exact Independent Review

Runtime: `d3444b323a200181c93fdebdb05ff306ded9aa51`, tree `301346248f1872e69b89789e38fe4395d31853a8`.

Independent read-only Newton worker `01a13c09-3ccf-7641-a5bc-5e2a89f4d0f9`: **PASS**, no findings. The reviewer confirmed the helper preserves existing nonarchived/nonplanning inclusive dated eligibility, both headlines share it, and the date clamp, capacity arithmetic, editors and source records are unchanged. Independently executed: four scope tests, dashboard typecheck and diff validation. Browser captures were not independently rerun. No reviewer edits, production calls or deployment.

The verification-only checkpoint pins the aggregate audit to this runtime. All 16 aggregate/identity-audit tests pass; no aggregate calculation code changed. Tracked runtime is identical to the reviewed commit after that checkpoint.
