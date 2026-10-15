# Observed Revenue Forecast Repair

Base: `f5acbdb1c7ca42fdc0665712286261c280cc4774`. This candidate changes forecast calculations and displayed sources only. No migrations, business-record writes, configuration switches, import uploads or production actions were performed.

## Confirmed Defect

November $61,542 is configured full-capacity revenue, not reported fees:
`15610 * (30/7) * (48/52.1786) = 61542.47143464945`.
Sparse imported visit dates were filled using desired weekly sessions, inflating the baseline, then the actual-view wrapper shifted to November. No duplicated billing rows were needed to reproduce the screenshot.

## Repair

- Actual-view forecasts start in the current month and use observed session averages only. Explicit plans retain their independent assumptions.
- Imported visit dates never become the averaging denominator. Complete report coverage certifies calendar-day averages; unverified visits produce a labeled 56-day calendar-window estimate, not a coverage claim. Missing clinicians remain unknown instead of receiving desired sessions. Completed, contained manual reports retain period averages; historical fallback exposes its actual dates.
- Forecast revenue uses modeled sessions and configured dated fees. Imported fee facts are not mixed into this projection. Nonprojection billing behavior remains intact.
- Full-month Money flow uses a uniform observed baseline, not actual visit-day counts plus estimated missing days. Payroll retains prior-month service dates paid by current-month checks.
- Planned/inactive clinicians do not suppress active-team forecasts. Dated active days bound observed per-clinician demand, including someone who worked earlier in the month and has left.
- Money shows deduplicated imported charged fees independently of draft/null financial periods, including PHONE fees and signed adjustments. Missing months are not zero; partial October is not extrapolated. Source conflicts invalidate affected totals.

## Verification

- 517 domain tests pass; 5 DB-free API report-coverage tests pass.
- Library, dashboard and API typechecks pass; dashboard and API production builds pass. Existing sourcemap/chunk-size warnings remain nonblocking.
- Independent Newton review: no remaining scoped blockers; 73 focused tests plus the 517-test suite pass. Independently verified $2,800 cross-month payroll, planned-clinician exclusion, fallback dates, and mixed-team active-day demand (7 + 31 sessions, $6,900). No source/data mutations by reviewer.
- Main rendered harness: 49 desktop/mobile captures and assertions pass.
- Read-only aggregate-shaped render: 351 synthetic visits / 56 days = 43.875/week; October modeled revenue $32,857.23 in both Money paths, not $61,542. Reported recent-three-month charges $32,323.33/month; all-nine-month charges $32,744.33/month; October partial $11,440 through October 9. Zero mutation requests and zero browser errors. Synthetic service dates/client identities; not a certification of the full real-account forecast.
- Evidence: `verification/practice-workspace-render/revenue-repair-results.json`, `revenue-repair-desktop-top.png`, `revenue-repair-mobile-top.png`, and full-page counterparts. Reproduce with `PRACTICE_PREVIEW_URL=http://127.0.0.1:4318 node verification/revenue-repair-render.mjs` against local preview. All APIs are mocked; non-read API methods are blocked.

## Deployment / Recovery

Candidate is not deployed by this author. Parent owns existing-environment deployment and live read-only verification. No schema/backfill is needed; code rollback to f5acbdb restores the prior release without changing business data. Full authenticated PostgreSQL API suite is not available locally and is not claimed. Do not certify real October totals without the complete dated source configuration.
