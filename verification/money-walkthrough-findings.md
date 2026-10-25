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

## Final coordinated UI scope
Shared opaque-first surface tokens provide a 75% light glass enhancement with blur, darker text, solid controls and reduced-transparency/no-blur fallback. Background remains visible. Team exposes identity, role and recent workload; all existing performance and operating details remain in disclosures. Growth fields use shrinking/wrapping grid tracks; the wide monthly data table is an explicitly labeled keyboard-focusable scroll region. Attrition retains endings/month in a neutral circular visual (no invented percentage denominator or progress fill). Redundant comparison arithmetic is removed; labeled metrics and calculation evidence remain.

Progression now defaults to all eligible imported history independently of global activity dates, with last-year, six-month and custom cohort windows. Follow-up remains through as-of today and retains cross-clinician visits. Custom invalid/future ranges suppress results until valid. Data table starts collapsed and preserves expansion across filter changes. Its export uses the independently selected cohort.

Import details moved below the primary Sessions metrics, collapsed. Known departed clinicians are treated as expected exclusions; unknown, active missing and ambiguous mappings still warn. Audit labels and original records remain. Overview now exposes the reason a full-period attrition percentage is unavailable; covered-month averages and partial mature evidence remain distinct. The embedded Sessions records/planning view no longer repeats the primary chart; entry, record history, imports and hiring readiness remain.

## Close-rate diagnosis — no calculation change
Current `consult-booking-conversions.ts` automatically attributes a close when the first qualifying observable full-session appointment follows a consultation with the same clinician. It can include a scheduled appointment without attendance. This is explicitly documented in Overview's Definition. The parent's confirmed “meets with that clinician” wording needs comparison with this scheduling-based definition before changing it; no silent behavioral change is made here.

25 of 30 evaluated means 25 closes and 5 evaluated misses. Eight unresolved and one protected referral are outside that denominator; their actual individual reasons were not read. Possible unresolved reasons are open follow-up window, unavailable full coverage, ambiguous clinician or appointment order, same-day date-only order, late observation, or an existing needs-review decision. A referral is the first observable eligible appointment with a different clinician who has no preceding matching consultation. Attribution history retains provenance/legacy reviews; confirmation controls are disabled for the current automatic scheduling measure. Minimal evidence for the eight cases is the existing aggregate journey reason breakdown, appointment/consultation dates and provider mapping, observed/imported timestamp where relevant, and admitted coverage; not a renewed business-rule confirmation.

## Pending screenshot-dependent move
Library reference `libfile_16053d97843c819184139dc919a2c519`, file `file_00000000216081fdb41b7ca9639c0ea7`, exact name `Screenshot 2026-10-25 at 1.44.19 PM.png` was resolved. Native read returned a pointer/metadata, not visible pixels. Resolved-reference preparation succeeded, but the current unchanged helper failed with `download failed` on initial attempt and one bounded retry. No readable local file/pixel inspection occurred. No native Sediment download tool is exposed. Therefore moving the screenshot-identified Overview controls into Settings is pending visual inspection; no transfer bypass or guessed bytes were used.

## Verification and release boundary
- Full applicable domain/dashboard regression: 1,263 passed, zero failed after final functional changes.
- Library TypeScript build and dashboard TypeScript: passed. Dashboard Vite production build: passed (existing chunk-size/sourcemap notices, no build failure). This is not a workspace-wide mobile build claim.
- Money picker component browser harness: passed desktop/mobile 390/320, keyboard month selection, parent-state remount, year boundaries and zero planning writes.
- Full real-component synthetic preview: 23 captures across Overview, Team, Growth, Sessions, Money, Goals and Money/Budget at desktop/narrow widths, long clinician/campaign names, expanded Team/history and progression, custom-date errors, all-history independence, CSV export and 200% Growth zoom. Zero API mutations or browser errors. Growth text sample minimum conservative contrast 4.83:1 (75% light surface composited against black). This sample does not certify every dynamic state across the app.
- Captures were inspected locally, including original Team/Growth and revised Team, Growth and progression. Native tables retain horizontal scrolling with all columns accessible; input controls stay inside their cards.
- Evidence is consumer-local under `/tmp/practice-surfaces-candidate` (final), `/tmp/practice-surfaces-before` (baseline), `/tmp/practice-money-month-picker`. Parent paths are not assumed shared. No live app/browser connection, production writes, imports or deployment occurred.
- Pending before release: parent independent review, screenshot-dependent Overview-to-Settings move, confirmed interpretation of attended versus scheduled consultation closes. The existing scheduling measure is unchanged. No migration, credential or access setup is required for these UI changes.
