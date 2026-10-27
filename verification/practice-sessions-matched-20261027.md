# Sessions matched-starts visibility correction

Base author source35621091d4816fb460a3938bb15f849ff180778b; parent reports publisher4c7fc8a9a617d06fdd4aa9a6f9c5f861fed60e4e live. No deployment or production records touched.

Root cause: the prior comparison was wired into OverviewHistoricalSummary and Growth, but Sessions renders a separate historicalValuesFor/historicalMetricFor path in practice-workspace.tsx. That path passed only the ending average and collapsed coverage prose. Missing visible starts were not a data-coverage branch.

Correction threads the existing maturedStartsComparison through the already scoped historicalMetricFor result into an always-visible MaturedStartsSummary above Counts and coverage. Applies to Whole Practice, uniquely resolved clinician, available-history windows, and Compare mode rows. Unknown/ambiguous/no-history paths receive no fallback practice result and render Unknown for both starts and difference. Existing ending rings stay intact. No calculations, period selection, Growth calculator or records changed.

The existing matched comparison uses the same covered mature months and established28-day initial-episode maturity definition, including retained and mature non-retained starts. The difference remains explicitly not net active growth. Known zero remains zero; missing/partial unresolved comparison is not inferred from13 or7.6 ending averages.

Verification: dedicated rendering tests cover positive/negative/zero/unknown with no disclosure hiding; existing source-contract test updated to require the summary before collapsed Counts and coverage. Browser checks target the actual Sessions Attrition card, not Overview: two visible summaries, clinician mode, six scoped summaries in Compare with two clinicians plus practice, restoration to Whole Practice, desktop/mobile screenshots. Existing Growth interactive scenario and full app harness continue to pass without business-write requests. Full regression/types/build results recorded in final handoff.

Evidence: /tmp/practice-sessions-matched (author cloud only). Actual mobile/desktop pixels inspected. Synthetic values are0.3/0.2 ending averages, not live reconciliation; actual Mac13/7.6 screenshot scope was supplied by parent. User's screenshot path is not accessible here and was not claimed inspected locally. Publisher must perform live/installed-Mac acceptance after integration.

Final result: 1,288 tests passed; dashboard TypeScript check and production build passed (existing sourcemap/chunk-size warnings). Browser report: 44 PNGs,31 main-view checks,zero browser errors,zero business-write requests. The scoped Sessions assertions and existing Growth calculator example pass. No deployment by author.
