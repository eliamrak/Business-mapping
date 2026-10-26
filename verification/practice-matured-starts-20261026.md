# Matured starts beside monthly endings

Parent: 0c08d02841f57dd3bce1c54b0d130ea4d01d32ca. Author branch: codex/money-month-picker-20261025. No deployment or business-record mutation.

## Semantics

The existing app calls initialRetentionDenominator “mature initial client starts”: retained plus mature non-retained starts. Retention resolves at three distinct treatment dates within the existing 28-day initial-gap rule; a shorter episode resolves after covered 28-day follow-up. This is not retained-only, all recent starts, or a newly invented maturity threshold.

The comparison reuses initialRetentionEpisode/initialRetentionWindowCovered and the exact monthlyEndedClients month list. It uses first-observed treatment date for start-month membership and preserves full-history sequencing. Practice identity is unique across clinicians; clinician scope is the existing relationship scope. Consultations/documentation/duplicates and same-day rules continue through the existing derivedShowVisits pipeline. No existing retention, 56-day inactivity or 90-day ending calculations change.

All selected ending months must also have resolved initial-start follow-up. If not, starts and difference are unknown rather than selecting a different subset. Covered zero months remain zero; no covered months is unknown. Difference is calculated from raw totals divided by the shared month count before display rounding. It is not a sum of rounded means.

UI adds Matured starts / month and Starts minus endings / month beneath each existing ending average. Essential qualifier: Evaluated first-observed starts; not net active growth. Existing covered-month counts and full-window unknown behavior remain. Detailed definition is available to assistive technology. A client can occur in both categories, imports can omit earlier history, and mature non-retained starts need not ever qualify for established-client endings.

## Marketing assessment — no Marketing code changes

For a deliberately defined starts-minus-endings planning target G, the conditional estimate is ceil(max(0,G + expected monthly endings) / lead-to-matured-start conversion), with conversion strictly positive and all inputs on compatible scopes/cohorts. This is an estimate, not an exact lead requirement. Starts have not already had endings subtracted, so there is no arithmetic double subtraction. However, evaluated starts include early non-retained clients, while endings require established treatment history: this balance cannot be labeled additional active clients.

The current funnel schema stores aggregate leads, scheduled/attended consults, booked clients and first sessions, with no lead-to-treatment-client identity linkage or matured-start outcome cohort. operating-plan.ts currently estimates booked-client conversion from at least three complete recorded periods (up to six), otherwise campaign assumptions. It uses modeled replacement clients plus capacity-fill clients, not this new monthly comparison. The clinical close metric is scheduled same-clinician follow-up, not mature treatment retention. Dividing unrelated calendar totals or reusing that close rate would be unsupported.

Smallest safe future Marketing UI: a separately defined target and conditional Estimated leads / month, plus its named conversion basis and coverage period. Measured mode needs linked, matured lead cohorts and comparable source coverage; otherwise keep it unknown or explicitly use an owner-supplied planning assumption. True net active-client acquisition also needs consistent active-cohort entries/exits, reactivations and clinician transfers. No new provider/import action is required or performed in this source change; actual evidence availability is still a gate.

## Verification

Synthetic tests cover retained and mature non-retained starts, non-contiguous shared months, out-of-period and earlier starts, zero/unknown, incomplete coverage, unresolved follow-up, 28-day maturity, duplicate dates, rounding, practice/clinician/date integration, source immutability and UI data binding distinct from the retention window.

Full suite: 1,280 passed. Dashboard types and production build pass (existing sourcemap/chunk-size warnings). Browser harness uses isolated synthetic responses and blocks external requests/writes. Captures/report: /tmp/practice-matured-starts-verified in author cloud environment; not a shared parent path. Initial render attempt found the previous dev server stopped; restarted the local preview and reran. No live counts reconciled.
