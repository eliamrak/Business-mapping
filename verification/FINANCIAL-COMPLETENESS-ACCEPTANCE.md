# Financial Completeness Acceptance

Runtime/test candidate: `9cb696b8da70e3cdbd819236b4a7e8e1f420a7eb`, tree `e1a4904a1eb115f339733bbf1e968417333d84ab`. Branch `codex/attendance-money-acceptance`. This is a bounded correction, not whole-app acceptance or a local deployment.

## Reproduced And Repaired

Before the fix, a finalized financial period tiling every selected date plus complete billing proof set `actual.complete=true` even when `expensesComplete=false` or clinician pay, employer burden, staff pay or owner pay was null. Actual profit correctly remained null, but Overview claimed financial coverage complete, and the period passed the shared financial-observation admission flag used by Goals.

The three-line runtime correction requires known operating revenue, clinician compensation and operating profit in addition to the existing finalized-period and billing coverage checks. It does not change any dollar arithmetic, saved value, source row, approval, calculation boundary, navigation, circular KPI or API format. Missing costs now produce the existing incomplete label and warning and exclude the period from complete financial observations.

Operating coverage does not certify collected cash. Known accrued operating profit can coexist with unknown collections, distributions, balances and separately classified processing fees; those values remain null. The new inverse control proves this distinction. A configured annual $350 service starting November 15 contributes `350 * 16 / 365` to November's accrual estimate, with no payment transaction created.

## Verification

- Baseline: 693 domain/dashboard tests passed before changes. New missing-expense test failed with the exact false-complete result before the correction.
- Candidate: 696 domain/dashboard tests pass. Controls independently omit each of five actual cost/payroll fields, preserve distinct billed $100 and collected $25, verify unknown cash/processing/distributions, and prove the annual budget is not payment evidence.
- Independent reviewer reports no findings at exact `9cb696b`; 71 focused tests passed, including goal-observation, missing-cap financial-goal gating and annual-budget controls.
- Seven post-import attendance controls and 20 declarations API tests pass. Attendance controls cover six-provider 126/21 synthetic pace, exact daily clipping versus manual no-proration, unfinished October exclusion, PHONE/numeric-4/documentation, 47 late cancellations, duplicates and status-conflict withholding. See `POST-IMPORT-ATTENDANCE-ACCEPTANCE.md`.
- Dashboard typecheck/build pass; existing nonfatal source-map/chunk warnings remain.
- Synthetic mounted actual workspace: six desktop/mobile states, no browser errors, zero writes or external production access, no horizontal overflow, unchanged six top-level navigation labels and circular KPIs. Incomplete/complete financial labels were checked. Evidence: `/tmp/financial-completeness-render/results.json`; focused mobile financial panel visually inspected. Reproduce with `node verification/financial-completeness-render.mjs` using installed local headless-browser dependencies. This is not hosted authentication or a production edit/save run.

## Release And Remaining Gates

The parent reports converter installation, real import, five exceptions, full-history billing reconciliation and Mentaya entry complete. Do not repeat those actions. Publish only this reviewed code correction through the existing environment, preserving all business/source/manual fingerprints, declaration revision 2, the five approval entries and the first-four fingerprint. No migration, record save or converter update is needed. The compatible reader must retain both `late_cancelled` and `historicalProviderId` support on backout; never revert those features or restore a prior database.

After publication, read back the exact live asset/commit, verify Overview/Goals completeness labels against existing financial evidence without editing records, and confirm top navigation/circular visuals remain unchanged. The existing production SQL billing diagnostic remains unchanged. The JS audit source guard is repinned for this candidate; it cannot validate a checkout still running the older financial function and must never substitute a development database for production.

Real selected-30-day attendance `144/21` is still UI-reported, not independently certified by local synthetic controls or billing SQL. A reviewed production read-only attendance reconciliation is still needed. Actual cash, payroll, expense, owner-payment and fund-balance certification needs independently complete real source evidence; its absence from this audit is not proof that the account lacks a record. Keep unavailable actuals unknown and state the limitation instead of entering invented values.

The arbitrary provider-alias finding was withdrawn after the actual save API rejected its unsupported fixture. A midyear missing opening-cap balance is an explicitly warned forecast assumption; financial-goal certification already rejects the unknown input. Neither is permission to broaden this release or change owner assumptions.
