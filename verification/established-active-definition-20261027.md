# Approved A6/A7 establishment definition — prepared, not installed

A6 formula `daily-established-active-v2`: qualify from the third distinct admitted treatment date across observed history, regardless of early gaps. On each calendar day, count the established client while latest treatment date +90 days > that day. An actual return reactivates from its date. Qualification and provider membership never use future dates. Average = established-active client-days / all days in the 3- or 12-month window.

A7 formula `daily-established-active-attendance-v2`: treatment sessions on those same established-active dates / (the same A6 client-days /7). Includes the third qualifying treatment date; excludes earlier visits. Whole practice deduplicates clients; each clinician uses global qualification and latest-provider membership as of each day, with actual-provider treatment numerator. Shared-provider pairs remain explicit.

Foundation DTO v4 changes the prepared A6/A7 formulas. Early initial retention (3 dates with <=28-day gaps), `stateAt`, the legacy end-date initial-retained population and `retainedAttendance` stay separate and unchanged. Positive admitted dates establish the new qualification even if historical gaps lack absence proof; unknown historical attendance is never inferred. Daily values still require covered observation dates and no unresolved classification; confirming an ending requires covered absence. Incomplete windows are unknown, not zero.

Tests cover long early gaps, qualification across providers, no future qualification/attribution, 90-day boundary and return, consult exclusion and same-day exceptions. The user approved this active definition, not the whole acquisition model. No live A6/A7 wiring, downstream equation changes, deployment or raw-record changes. Real aggregate figures supplied by the parent are independently sourced evidence, not author-reconciled production counts or test fixtures.

Validation: 1,327 regression tests, dashboard types and production build passed. Independent review accepted, 25 focused tests. Existing build warnings only.
