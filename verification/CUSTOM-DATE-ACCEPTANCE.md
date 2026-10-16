# Shared Custom-Date Acceptance Repair

## Finding

P1, reproduced against release `37179df3b5ac7db7a89fdeae2a86a9aaede8badb`: select Sessions, choose Custom dates, clear From. The shared handler sends an empty start date directly into the range-dependent models. `buildSessionTrend` eventually formats an invalid date and the entire workspace unmounts with `Invalid time value`. The browser body was reduced to a leftover chart tooltip rather than a usable app. No save or business-data edit was required to trigger it.

Requirements reviewed: `EXPANSION_PLAN.md`, `BUILD_STATUS.md` (historical checkpoint), current metric traceability and complete-period acceptance documents, and [Practice UX Working Map](https://chatgpt.com/space/page_2f40d53a52288191865b6bb9b3d11cf7), sequence 27. Current deployment/approval status comes from the parent deployment worker, not older Page release checkpoints. The four live charge approvals and declaration revision 1 are not changed or reapplied.

The failure contradicts shared/custom timeframe behavior and the requirement to preserve valid work during incomplete input. It was selected ahead of stylistic changes because an ordinary date edit makes all views unusable.

## Repair

Only `SharedPeriodControls` runtime code changes. Both input values remain local drafts until the existing shared `dateRangeSchema` validates a complete, real, non-reversed range. Invalid drafts do not enter calculations. A concise status message explicitly names the still-applied start/end dates, and date fields expose invalid state and link to that message for assistive technology. Completing the range immediately applies it; contributor changes preserve it and top-level tab changes still reset the contributor to Whole Practice.

No tabs, calculation formulas, source admission, goals, monetary units, persistence formats, backend routes or business records change. The current last-valid date range is never converted into zero or replaced with an inferred wider range. No migration is required. Code rollback is a normal redeployment without a data rollback, although it restores the old date-edit crash.

## Regression Evidence

`node verification/timeframe-input-audit.mjs` uses frozen synthetic data, mocked API responses and localhost only. It tests blank start, blank end, reversed start and reversed end in seven views: Overview, Sessions, Team, Money, Growth, Goals and Rooms. All 28 cases preserve the applied view's entire text apart from the explicit validation status, avoid browser exceptions and recover after correction.

The fixture has six treatment visits over 14 covered days, two retained relationships, two zero-fee PHONE consultations and $600 billed charges. A successful range change to the subsequent fully covered quiet period changes eligible visits from six to zero. That is a sourced zero, not an unknown observation. Tests also assert contributor/date carry behavior, eight desktop/mobile captures, no horizontal overflow, intact top navigation, zero API writes and unchanged workspace/context/import facts. Screenshots and JSON are in the existing untracked `verification/practice-workspace-render/` directory (`custom-date-*`, `timeframe-input-results.json`).

Coordinator checks: 656 domain/dashboard-library tests, 33 mocked import API tests, 19 aggregate/identity/fee-diagnostic tests and three frozen-reference scale checks pass (711 total). Dashboard typecheck and production build pass with existing nonfatal Vite notices. The 45 existing workspace render states pass separately, for 53 rendered states including the eight new captures.

Runtime: `cb052f1d2506352e11b494af6cb544e2c1767d85`, tree `b005f6893203b3cea11ddb8d08dcead4a06d01bf`. Independent bounded review PASS, no findings; the reviewer reran dashboard typecheck, seven date/session tests and diff validation, and reviewed the 28-case harness. Browser captures were not independently rerun. See `CUSTOM-DATE-REVIEW.md`. The following verification-only checkpoint pins the read-only audit to this exact runtime. No calculation or journal code changed from the preceding approved release.

## Acceptance Limits And Next Checks

- This is not whole-app acceptance or live business-number certification. No production connection, mutation, publish, approval application or reconciliation was performed.
- Recorded fees versus future configured-fee estimates, unknown actual payroll/costs, clinical percentages with counts, top navigation, nonclinical placement and existing Goal/capacity markers remain covered by existing model/render fixtures; this repair does not redesign them.
- Live acceptance should reproduce a blank/reversed custom date, verify the last applied period remains labelled, complete the new range, switch tabs/contributors, then verify no source or configuration revision changed. Reapplying the four billing approvals is neither needed nor authorized by this repair.
- Actual bank/payroll/expense reconciliation, supplied-report completeness, owner-edited goal values, meaningful plan assumptions and final user preference acceptance remain separate from automated correctness. Missing evidence must stay unknown.
- A secondary source-only wording issue remains noted for follow-up: Team labels a calendar-month attrition denominator as "client-months" while Sessions/Compare correctly say mature months. This small label issue was not bundled into the crash repair.
