# Financial Completeness Release Handoff

## Exact Code

- Independently reviewed runtime/test commit: `9cb696b8da70e3cdbd819236b4a7e8e1f420a7eb`.
- Runtime/test tree: `e1a4904a1eb115f339733bbf1e968417333d84ab`.
- Release commit including acceptance documentation and audit source pin: `675ae026424b8715e6471225ce871579904d0e41`.
- Release tree: `6baf6f54922dec45d7ebe06cb3705124fd59b998`.
- Branch: `codex/attendance-money-acceptance`. Later attendance diagnostic commits on this branch are verification-only; they do not require deployment.

The only runtime diff from the already published historical-reader release is `artifacts/comp-dashboard/src/lib/practice-financial-range.ts`: financial completeness additionally requires known actual operating revenue, clinician pay and profit after their existing calculations. Finalized date coverage alone no longer certifies incomplete expenses/payroll. No financial arithmetic, stored values, source admission, fee approvals, database schema, API or visuals change.

## Preflight And Update

1. In the existing authorized production environment, capture the current post-Mentaya preservation baseline: all business/source/manual fingerprints, source counts and 47 subtype rows, declaration revision 2 with six mappings/three historical identities/three source members per kind, five complete approval-event fingerprints, and the unchanged first-four fingerprint `cc19f8c6dd2eec520b459206a632561c`. Do not restore the older pre-Mentaya workspace baseline.
2. Fetch the existing candidate branch and merge/cherry-pick the reviewed change into the existing project without resetting unrelated work. Confirm runtime files match `9cb696b` and the only runtime change relative to the published historical reader is the three-line completeness correction. Verification scripts/docs may differ without changing runtime. If runtime drift exists, stop for review rather than publishing an unreviewed merge.
3. Run the existing project build/typecheck and focused tests in the established development environment using synthetic fixtures, not production records. Publish the existing environment through the normal authorized release path. No migration, data bootstrap, import, declaration save, exception save, payment entry or converter action is required.
4. Read back the deployed commit/tree and served asset against the build log; distinguish this live proof from a successful local build or a started publication.

## Regression Evidence

Author: 696 domain/dashboard tests, 42 focused attendance/API/audit checks, dashboard typecheck and build all pass. The missing-expense control failed before the correction, then all five missing cost/payroll variants passed. Independently reviewed exact `9cb696b`: no findings, 71 tests pass, including financial-goal observation semantics, missing-cap solver gating and annual-budget controls.

Mounted actual workspace with invented fixtures: six desktop/mobile states, zero writes, no browser errors/overflow, incomplete/complete Overview label transition, unchanged top navigation order and circular KPIs. Evidence: `/tmp/financial-completeness-render/results.json`; source harness `verification/financial-completeness-render.mjs`. These are not live authentication or real-record save tests.

## Exact Live Acceptance

1. Open Today / Overview with the existing selected dates. If real selected actual expense/payroll evidence is incomplete and actual operating profit is unavailable, the financial coverage label must say incomplete. Billed charges may still be known under their separate billing-complete label. Do not fabricate records to create the synthetic test state.
2. If existing actual operating inputs are complete, their coverage may remain complete; missing cash alone must not change accrued operating profit into an unknown. Collections, distributions, balances and separately classified processing fees must retain their own unknown states. Never equate a known billed fee with a cash receipt or configured pay with a paid paycheck.
3. In Goals, verify incomplete financial periods do not establish a complete financial observation. Goal amounts and retained goals must be unchanged; do not edit goals merely to test achievement.
4. Recheck the existing January windows and current selected-period billed values against the prepublication baseline: no arithmetic changes are expected. Existing completed-source cutoff remains October 7. October 8-12 is partial source evidence, not a completed October 8-21 operating period.
5. Verify six top tabs in order Overview, Sessions, Team, Money, Growth, Goals; separate Today/Long Term Goals/Sandbox; circular clinical KPIs and their markers remain intact at desktop/mobile sizes. No screenshot redesign or alternative navigation is part of this release.
6. Reload and compare all preservation fingerprints to the current prepublication baseline, including the full five-entry approval journal and unchanged original four. Confirm the saved Mentaya budget remains $350 annual from November 15, 2026 and no payment transaction appeared. This is a read-back, not a request to resave it.

If existing real evidence cannot demonstrate a missing-cost case, report that live case as unavailable while citing the reproduced synthetic regression; do not claim it was tested live.

## Backout

Code-only backout to the already published historical-reader code is format-compatible: prior production commit `a02b080addae3ce6b1e24408ce7d3607092edc88`, reviewed tree `b76454cbc3b4ca831f6d2e9acf0830619a1b7c6b`, preserves both late-cancellation and historical-approval support. The old false-complete label would return; all real records stay untouched. Never roll back to a pre-historical-approval or pre-late-cancellation strict reader, strip fields, delete approvals, restore an older database or overwrite the current budget. The JS audit source pin must match whichever runtime is actually being checked; production SQL diagnostics require no app deployment.

## Remaining Acceptance

Run the independently reviewed `post-import-attendance-reconciliation.sql` in the established production SQL viewer for the reported September 17-October 16 `144/21` observation. It computes imported treatment counts and shared included days independently, with duplicate/status/kind handling and no private output. Its results have not been observed locally against production. A synthetic result equal to `144/21` is not real-data certification.

Actual cash/payroll/cost/balance certification requires the relevant real evidence and reconciliation. Missing evidence is not a software bug or permission to invent records. No whole-app completion claim until the remaining bounded checks are resolved or clearly reported as unavailable evidence.
