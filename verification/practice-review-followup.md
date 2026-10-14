# Practice Review Follow-Up

This candidate repairs the review of `9cf1ff6` without changing production records or deploying.

## Integration Changes

- Focus adoption persists in the validated `focusedPlanAdoptions` collection. The ordinary save handler retains approval/baseline and immutable-history protections. Focus appears on Overview and relevant views, with highlights for its selected one or two KPIs. Full operating inputs drive revision detection.
- Practice consult outcomes are independent of clinician attribution: a mature unresolved miss remains in the practice denominator. Clinician misses and closes require manual confirmation; the treatment-start clinician remains a candidate. A client-level selector supports correcting ownership and persists through normal workspace review/save.
- Whole Practice and clinician attrition display mature 90-day endings. Practice clients are unique across transfers; later returns and missing observation coverage remain handled by the validated history calculation.
- Sessions receives shared bounds and contributor selection. Compare renders practice evidence. Calendar-week facts require coverage; biweekly aggregates remain individual period-rate observations, with configured capacity and required-session lines. Rooms uses selected-period recorded in-person facts and reports unknown modality or coverage.
- Goal evaluation uses completed actual evidence before forecast, excludes future periods, and requires complete selected-team active-day coverage. Financial achievement requires actual non-overlapping biweekly observations; monthly-only financial history remains insufficient. Overview reports verified achievements while retaining the goal.
- Overhead sums dated actual expenses into fully covered calendar months, exposes gaps/overlaps, and shows the current month separately as a projection. Fund trajectories use dated balance anchors, distinct recorded points and dotted projected contributions, with explicit assumptions.
- Fresh Today loads saved imports through the shared state hook. Team retention uses the percentage scale already returned by the calculation.

## Reproduction Evidence

Regression tests cover the production save handler with a synthetic database boundary, including save/get/history, idempotency, revision conflicts, consult corrections, legitimate approvals, and rejected forged baselines. Dedicated tests reproduce mature unresolved consult misses, unconfirmed owners, incomplete/future goal evidence, daily import coverage, month overlap and full-month overhead aggregation, dated fund anchors, stale-plan inputs and focus-specific highlights.

The browser harness intercepts all API calls with synthetic records. It verifies fresh import loading, selected-period filtering, real Compare output, unique-client endings, a 50% practice conversion for one conversion plus one mature miss, correction persistence, plan adoption/reload, and the Overview achievement alert. It captures desktop 1280x900 and mobile 390x900 views and checks horizontal overflow and browser exceptions.

Final frozen-code verification: 307 tests passed; library, dashboard and API typechecks passed; production Vite build passed with existing source-map, mixed-import and bundle-size warnings. All 19 render captures passed overflow checks; interaction assertions and browser-exception checks passed. Metrics and PNGs are in `verification/practice-workspace-render/` (local evidence, not production data).

Independent read-only reviewer `01a13afd-1639-7217-8e05-f896cd96a0f7` cleared the original integration failures and subsequent follow-ups. Its final PASS specifically rechecked goal stability with the actual import overlay: October 1-14 stays met after a partial October 15 import and September 30 backfill. The parent still owns release acceptance.

## Data And Backout

No invented preview values are seeded into production. Schema additions default to empty arrays and use the existing JSON workspace/history persistence; no SQL data migration is required. Existing business collections and approved baselines remain intact.

Before any deployment, the owner should retain the existing release and raw workspace/history backup. Rolling the application back does not require deleting records. Preserve the raw new-field JSON because older parsers can omit new metadata on subsequent saves; the existing history snapshots provide recovery evidence.

No deployment or live verification was performed by this worker. Database-backed integration remains unrun because `EMC_TEST_DATABASE_URL` is not configured; the synthetic production-router contract was executed. Final parent release review remains required.
