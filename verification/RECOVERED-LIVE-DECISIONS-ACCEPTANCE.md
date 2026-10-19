# Recovered Live Decisions 1-11

## Scope and Authority

The recovered call notes supplied October 19 are the intended next Practice scope. They supersede earlier assumptions about what remained after technical acceptance. Decision7 supersedes decision6's reporting-window behavior **only for retention and attrition**. The explicit release instruction covers these changes in the existing app after tests and independent review. No financial transfers, production record rewrites, bank/cash tracking, new spending or access grants are authorized by this implementation.

Base: `ea3ff7b853248ebd12d9dba7b32d0e894ab17936`, branch `codex/recovered-live-planning-decisions`. Prior source-preservation, exact import facts/approvals, clinical maturity rules, billed-fee versus cash distinction, staff editing and keyboard/draft fixes remain in force.

## Acceptance Checklist

| Decision | Required Behavior | Evidence / Status |
| --- | --- | --- |
| 1 | Money estimates overhead from trailing12months or an explicitly labeled annual period. Monthly set-aside is annual total/12; an already-monthly average stays unchanged. No finalized-expense gate. Quarterly/annual bill shares included. | Implemented; annual/monthly/cadence and zero-period tests in `profit-first-planning.test.ts`. |
| 2 | Money is a planning estimate. Staffing, clinician mix/pay and cost changes affect the outlook. No bank reconciliation, transaction log, finalized expense periods or tracked account balances needed. Assumptions and periods explicit. | Implemented; configured full-month forecast plus separately persisted estimate overrides. Source reports remain collapsed and optional. |
| 3 | Seven distinct buckets: business profit, taxes, operating expenses, owner payroll, therapist payroll, admin payroll, distributions. Profit and distributions remain separate. | Implemented; seven-row rendered assertion and numerical tests. |
| 4 | Current confirmed baseline: operating28%,therapist36%,admin4%,owner27%,tax3%,profit2%,distributions0%; total100%. Compare as user-confirmed baseline, not invented accounting actuals or a database rewrite. | Implemented constant; rendered exact percentages and immutable-input tests. |
| 5 | Explicit additional monthly goal funding updates recommended percentages beside current split. No double-counting existing expenses/buckets. Explain shortfall/revenue needed when goals cannot be funded. | Implemented; monthly contribution/marketing-total tests and reviewed staged save/reload. Independent edge-case review underway. |
| 6 | Consultations moves into Sessions, including count, confirmed closes, pending outcomes and rates. Selected dates still govern sessions and consultation activity. Prominent session total and weekly average for Whole Practice/clinician. | Implemented; clinical source/metric tests and actual workspace rendered checks. Historical part superseded by7. |
| 7 | Historical retention rate and average monthly attrition use trailing3months independent of selected activity dates. Keep eligible counts, monthly units, maturity and observation basis explicit; clinician selection applies. Never replace an average by a three-month total. | Implemented; weighted counts, maturity, later-return and date-selector independence tested. No eligible mature month remains unknown. |
| 8 | Team historical close rate defaults trailing3months, offers year with exact date bounds, leads with rate plus consult/confirmed/pending counts. Rate is eligible closes/evaluated count, not an unweighted mean. | Implemented; weighted10-evaluated fixture and shared year rendered control. |
| 9 | Overview uses the same historical definitions/ranges as Sessions/Team, default3months and consistent year option. Selected-period session totals/pace stay distinct. | Implemented; one shared helper/control, rendered year-basis equality across all three tabs. |
| 10 | Erin's configured payroll is a protected required funding need before optional savings, counted only once. Rooms remains Growth; Consultations is Sessions. | Implemented; protected minimum/subset numerical tests and navigation checks. Inherited owner targets separated from salary. |
| 11 | Infeasible planning remains editable and saveable. Show prominent red text, dollar shortfall and revenue needed; expose required allocations above100%. Do not normalize/clamp away obligations or silently reduce goals. | Implemented; persisted150% floor, saved Sandbox snapshot and actual workspace rendered save checks pass. |

## Work Boundaries

- Money worker owns new planning calculation/component files and numerical tests; it does not edit the shared workspace page or core forecast engine.
- Metrics worker owns clinical/history helpers, tests and metrics/navigation regions in the workspace page; it leaves Money regions unchanged.
- Author integrates Money after metrics changes, maintains this checklist, runs end-to-end fixtures and obtains a fresh independent review.
- No fixture values are sent to production. Current allocation percentages come directly from these user decisions; missing initial dollar goals remain editable rather than blocking the build.

## Release Gate

- [x] All11 decisions mapped to implemented code and focused tests; final review corrections included.
- [x] Full test suites, types/builds, desktop/mobile rendered owner paths and preserved keyboard/draft controls pass.
- [x] Independent exact-candidate numeric/source review, with limitations named in `RECOVERED-DECISIONS-INDEPENDENT-REVIEW.md`.
- [ ] Normal push/fetch-back verification in established Business-mapping repository.
- [ ] Existing release task prepares the exact reviewed source, repeats established read-only preservation comparisons, builds and publishes once within existing authorization.
- [ ] Public assets/health, preservation and bounded live owner-view verification recorded separately from fixtures. No production business-record edits or source-history rewrites.

## Implementation Checkpoint

- Money calculation/component: `profit-first-planning.ts` and its tests/component implement seven distinct buckets, annual overhead accrual, editable estimates, explicit contribution targets and unclamped percentage floors. Persisted optional `workspace.moneyPlanning` is separate from metric achievement goals; no table migration, transfers or source-record changes.
- PracticeWorkspace now stages planning settings through its existing review/save boundary. Inherited owner-pay targets are not persisted or counted as configured salary. Monthly planning uses the full configured forecast, not a selected pay-period subtotal; selected actuals and source editors remain available in a collapsed reference section.
- `historical-performance.ts` supplies the shared historical basis. Calendar source bounds are separate from canonical evidence admission and true-today follow-up. Consultations is in Sessions, Rooms in Growth. Historical retention and monthly attrition do not change with the activity date selector.
- Initial full suite: 781 passing; selected API preservation suites:133 passing. Dashboard types and both builds pass. Existing Vite sourcemap/mixed-import/chunk-size warnings remain. These are checkpoint results, not final-candidate or production certification.
- Independent reviews found and drove correction of calendar clipping, excluded later-return evidence, team-calendar scope, inherited salary, absent-payee handling, exactly100% funding floors, and configured tax obligations. Final review must rerun after all corrections.

## Backout and Data Safety

Existing workspaces without `moneyPlanning` parse unchanged. New settings are written only by the existing authenticated, revision-checked workspace save or saved draft flow after owner action. Fixture values are never production seeds. No database migration or backfill is required.

After a user saves new planning settings, do **not** roll back blindly to the older strict workspace parser: it does not recognize the new optional field. A code-only feature backout must retain this schema/comparator compatibility while hiding the new planner or restoring the previous navigation. Preserve the saved planning payload; do not delete or rewrite production data to make an older parser accept it. Before any deployment, the existing release task must retain its recoverable checkpoint and repeat the established five read-only preservation comparisons.

## Final Local Acceptance

Runtime commit `fdb013c336a1209cd0170c918e002a31377519fe`, tree `8513df816868b2496271508c81013629da969e74`:

- `npm test`:789 passed,0 failed. Selected five API preservation suites:133 passed,0 failed. Dashboard typecheck and dashboard/API builds pass. Existing Vite advisories only.
- `recovered-live-decisions-render.mjs`:14 desktop/mobile captures at1280/390px, zero browser errors or document overflow. Checks seven baseline percentages, no finalized periods, complete configured monthly estimates, current-goal isolation, monthly-goal save/reload,150% floor persistence, staged-only Sandbox edits and saved infeasible model, $700 real owner budget retained while inherited target is not saved as salary, independent/shared historical controls and consultation/Rooms navigation. Four synthetic local hub saves; zero production access.
- `recovered-keyboard-results.json`:32 passed. `recovered-keyboard-zoom-results.json`:26 passed. Covers normal/320px/390px and200% reflow emulation, modal keyboard/focus restoration, unsaved raw/staged edits, navigation and pending-review reachability. Zero browser errors or API writes in this suite.
- Actual integrated Money desktop/mobile and Sessions desktop screenshots visually inspected. Dark theme readable; no unintended text collision or page overflow. Wide numeric table intentionally scrolls within its bounded container on narrow screens.
- Independent clinical97/97 and Money9/9 checks cleared; no remaining finding within reviewed scope. No real business total is certified by these fixtures. Production preservation/publication/live acceptance remains the separate gate below.
