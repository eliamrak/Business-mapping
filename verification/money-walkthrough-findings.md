# Money walkthrough — source findings, synthetic verification

Baseline: `5bbe9aa1d68047f0fd87c4ca4dd1d8a7237dc703`. No live records were read or changed.

## Month selection
Native month and year dropdowns, named full month/year, previous/next, and Last month replace the typing control. Selection stays in existing parent component state across Money subviews; as before, a full page reload starts with the current month. No financial records or settings are written by selection. Years 0001–9999 are valid; arrows stop at boundaries. The year menu offers a rolling 51-year window.

## Payroll recommendation
The exact live September 41.5% cannot be reconciled without the saved scenario and its source values. This code path is a planning estimate, not a payroll ledger:

- `money-planning-forecast.ts`: selected calendar month; observed complete-period session pace, configured clinician-card fees and costs, and currently configured undated assumptions. It explicitly does not substitute historical billing actuals or bank collections.
- `profit-first-planning.ts`: saved `moneyPlanning.estimatedMonthlyValues` override generated monthly values and are not month-keyed. Income is billed revenue plus other income. Therapist base is clinician pay less owner clinical pay and configured co-owner salary, plus aggregate employer burden. Aggregate burden remains in this bucket even when owner salary is separated. Scenario floors and additional goals can increase the requirement.
- Required percentage is required monthly therapist funding / modeled income. Processing fees are operating expenses, not deducted from the clinician split. The hub engine calculates compensation on the full billed/card rate and subtracts fees separately from practice profit. This already matches the confirmed rule; no formula changed.
- Synthetic example only: $37,000 clinician pay plus $4,500 employer burden on $100,000 modeled income produces 41.5%, despite a 36% configured allocation. This proves a possible mechanism, not the actual September cause.

To reconcile September, inspect the selected month's modeled revenue/other income, therapist/owner pay components, employer burden, any saved estimate override/floor/additional goal, and current versus dated clinician terms. Compare actual payouts on matching service dates and billed-income denominator; payout date or collected-income comparisons can differ. Do not force the estimate to 36%.

## Tax Unknown: actual application dependencies
| Input | Why needed | Where supplied | Unlocks |
| --- | --- | --- | --- |
| Supported quarterly tax planning dollar amount | A percentage allocation is not an assessed tax obligation | Allocations → Taxes → Quarterly taxes $; stored monthly as one third | Taxes needed, gap and required percentage; dependent total-needed/revenue-needed summaries |
| Alternatively, active dated fixed-dollar tax budget line | Existing budget can supply the monthly obligation when no explicit estimate exists | Budget tax-category entry with applicable dates | Same obligation estimate; percentage-of-revenue lines do not count as liability evidence |

The existing Taxes allocation, profit reserve tax percentage, payroll burden, household withholding and estimated income-tax percentage are separate inputs; they do not automatically supply this obligation. Defaults are not verified user tax facts. No additional rates, filing status or entity facts are requested here because this UI does not calculate a tax return. A qualified/source-backed estimate must be supplied; parent handles official tax guidance.

## Recorded progression provenance
`local-retention-workspace.tsx` loads `/api/practice-imports`; server `practiceImports.ts` reads active `practiceImportSnapshotsTable` rows scoped to authenticated practice/account. `practice-workspace.tsx` admits complete-report coverage and practice clinician snapshots, then passes them to `SessionProgressionPanel` and `sessionProgression`.

The cohort contains clients whose first observed treatment visit is within the selected period. Clinician filtering uses the clinician on the first date, with subsequent cross-clinician follow-up counted through as-of today. Shared treatment classification excludes consultations; only shows count. Row hashes deduplicate imports; same-day groups default to one visit unless a confirmed exception applies. The denominator is this cohort, constant at each milestone; completion means at least N observed visits. Empty data yields zero clients and unknown percentages. Eight milestone labels are fixed, counts are calculated. Screenshot illustration values and synthetic fixture rows are not imported by this production path. Live counts have not been independently reconciled.
