# Fixed-date financial/model reconciliation

## Scope and evidence boundary

Base: `0e69b86842f1216f9accc1f911218f96d75d1f2d`, the reviewed mobile release.
The parent reports live attendance/billing coverage through October 21. No real
records were read or changed by this repair, and that statement does not certify
expense, payroll, collections or cash completeness. The existing January real-
account receipt remains a bounded historical result, not a current-account replay.
Its superseded consultation definitions were not reused or re-investigated.

The new baseline is entirely synthetic, fixed at observation date October 23,
2026, planning month October 1-31, and complete activity proof October 8-21. A
clinician starts October 16; the established observed-pace rule yields 7/week.
This fixture tests the existing pace rule, not a new tenure-normalization policy.

## Fixed-date checklist and results

| Check | Expected result and boundary |
| --- | --- |
| Service pace versus monthly forecast | Existing complete-period pace 7/week; 16 active modeled days gives 16 October sessions. These are modeled sessions, not 16 certified attended appointments. |
| Billed estimate versus recorded charges | 16 modeled sessions at the configured $100 fee gives $1,600 revenue. Injecting a $9,999 synthetic billed row does not rewrite this planning scenario. |
| Compensation | Configured 60% split gives $960. Separate salary control accrues $12,000 annual salary over 16/31 of October, assigns it once to Owner payroll, and leaves zero duplicate therapist salary. |
| Variable Budget costs | $10/session gives $160; 10% of revenue gives $160. Both lines cover every modeled session/revenue day. Required operating Budget is $320, not $165.16129032258064. |
| Processing | Configured 3% plus $0.30 per estimated transaction gives $52.80. This is an estimate, not verified Stripe fees or cash collected. |
| Operating profit versus allocations | Forecast operating profit is $267.20 before allocation/funding choices. Operating allocation need is $372.80 including processing, displayed with existing nearest-dollar formatting as $373. |
| Dated price changes | Four sessions at $10 plus twelve at $20 gives $280, plus the other $160 line: $440. The existing forecast already calculates these daily slices. |
| Annual/quarterly accrual | $365 annual and $92 Q4 costs starting October 16 add $16 each. No transaction/payment is created, and reference billing dates do not establish payment. |
| Tax input | Explicit synthetic zero remains zero; deleting that planning input leaves tax and total funding unknown. The current 3% allocation is not treated as tax liability. |
| Unknown and stale inputs | Wrong month, shortened month, missing line, changed cost/dates/events or mismatched volume cannot reuse the dated estimate. A missing partial-period variable-cost basis stays unknown. |
| Ordinary costs and scenarios | Full-month variable inputs retain their original meaning; fixed Budget, legacy scenario overhead, salary, caps, estimates/actual boundaries and fund stock-versus-flow controls remain in the regression suite. |
| Persistence and actuals | Source rows, Budget lines, goals and input objects are unchanged by calculation/rendering. New basis metadata is in-memory only; no schema, API, migration or actual-cost certification. |

## Confirmed defect and narrow repair

The new test failed on the base with exactly `$165.16129032258064 != $320`.
`moneyPlanningForecast` already returned correct day-aware `budgetLines` of $160
each. `profitFirstPlanning.budgetSum` discarded them, reapplied each line's
16/31 active fraction to monthly totals that already represented those active
days, and understated this synthetic Budget need by $154.83870967741936.

Today Money and Goals funding now receive the existing selected-month per-line
estimates with cloned source Budget/event snapshots. The planner checks the
month/range, relevant cost inputs/events and variable-volume basis before reuse.
It does not multiply those amounts by active days again. Without a matching dated
basis it does not invent a uniform distribution for a partial variable-cost line.
Known ordinary fixed/full-month calculations retain the original fallback.

Only three runtime files change: the planning forecast's returned in-memory
basis, the allocation planner and two prop lines in the workspace. No domain
engine equations, actual-report calculations, source admission, consultation
rules, API, database, dependency, layout, CSS, artwork or icon changes.

## Verification checkpoint

- Ten new fixed-date checks pass, including actual planning-component server
  markup showing $373 rather than $218. Help and unsaved hooks are stubbed for
  that server-render check; it is not a browser/native visual acceptance claim.
- The first nine new checks plus existing financial/range/estimate/goal/quarterly/
  bridge suites passed 146 tests before the final markup case was added.
- Library declarations and dashboard/API typechecks pass.
- Full canonical regression passes 1,356 tests, including the ten new fixed-date
  cases and the independently authored numerical/source probe. Database-free API
  checks pass 251/251; retained Tidal/PDF/icon checks pass 35/35 locally.
- Both production builds pass with existing nonfatal Vite source-map/chunk-size
  advisories. Independent numerical/source review accepts the bounded correction
  with 90/90 focused tests and no blocking finding. Runtime source hashes are
  recorded in `FINANCIAL-BUDGET-INDEPENDENT-REVIEW.md`.
- CSS is unchanged: `index-DRAqG8Dh.css`, SHA-256
  `618d50267c9b11235cb9ec95418a3fda85de88fc8deb7ab4aed7f7f3514dfeab`.
  Local JS is `index-D62Rn0jF.js`, SHA-256
  `c7ddd796f91a3507cfa8021b11369da2e348d37cdd39614aa7f8969df3d2e113`.
  Publisher public build inputs may change JS bytes; reconcile after a coordinated
  publication rather than assuming this local filename is the served artifact.

## Remaining uncertainties, not requests for more owner work

No current real-account financial total is independently certified by these
fixtures. An old or unsaved assumption snapshot cannot be reconstructed by
choosing today's dates. Actual cash/payroll and exact processor charges remain
separate from configured estimates. No bank/payroll records, new connection or
owner recollection was requested. No real import or consultation issue reopened.

After coordinated publication, capture the same current month/scope and compare
Money and Goals Budget costs against their dated model basis. Cases without
partial variable costs or dated amount changes need not change. Do not force the
whole-month planning scenario to equal a selected-date historical-plus-future
estimate: those are different date and source bases. Preserve all current records,
the accepted mobile layout/readiness patch and the publisher's history/configuration.
