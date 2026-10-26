# Growth acquisition table and planning calculator

Separate child of matched-starts comparison commit df5f93a. One compact table is first in Growth; campaign creation, costs, lead entry and existing campaign assumptions remain below unchanged.

## Recorded and observed values

Table contains matured starts/month, apparent endings/month, matched flow balance, reported leads/month, reported lead-to-booked-client ratio, net active additions, assumed lead-to-matured-start conversion, estimated required starts and estimated required leads. Each row has a visual circle. Counts/unknowns are unscaled; only a labeled percentage ratio/assumption has an arc. Value, Plan and Gap columns keep related information adjacent. Required-minus-observed starts is the only computed gap; no goal denominator is invented for other rows.

Uses whole-practice historicalReports, not a clinician-scoped Overview projection. Starts/endings use identical covered mature months. Reported lead totals require complete exact-month whole-practice funnel records without overlapping periods, mixed source/practice rows or clinician-scoped rows. Missing, incomplete or ambiguous records remain unknown. Booked clients/leads is explicitly an aggregate ratio, not measured lead-to-matured-start conversion. Ratios with zero leads or more booked clients than leads stay unknown. Existing campaign assumptions are not used as if they were measured clinical conversions.

## Interactive estimates

Plan inputs: target net additional clients/month, expected monthly endings (empty uses observed average if available), and assumed lead-to-matured-start conversion percentage. Inputs start blank; no illustrative facts/default goals are stored. Session-only state persists across tab navigation but writes no business record and does not replace an existing saved goal.

Required matured starts = goal + expected endings. Estimated leads = ceil(required starts / assumed conversion fraction). Missing/invalid input, zero conversion, or missing endings without an override means unknown. Zero target and zero endings are valid. Large/nonfinite results do not render an invented integer. The user can explore assumptions even when recorded linkage is missing.

Important semantic limit: evaluated matured starts include retained and mature non-retained clients. Starts have not already had endings deducted, so the formula does not double-subtract. But apparent endings require established treatment history, and reactivations/transfers are not reconciled by this balance. Actual net active additions remains unknown. The scenario is explicitly a planning balance, not guaranteed active-client growth. One client may appear in both observed categories.

No Google/Meta connection, SDK, credential, provider call, import or clinical-data transmission is introduced. Future ad-reported leads must remain separate from linked actual treatment outcomes. Measurement details are below the table.

## Verification and handoff

Synthetic tests exercise matched-month semantics, known zero/unknown, maturity and scope, aligned funnel totals, ambiguous/incomplete/duplicate periods, no fabricated cohort conversion, invalid/zero assumptions, rounding, and the explicitly entered illustration: +5 target + 8 expected endings = 13 starts; at assumed25%,52leads. This illustration exists only in synthetic tests, never as a factual/default app value.

Browser harness covers table/rings, keyboard input, period selection, target persistence across tab navigation, live scenario recomputation, all main tabs, desktop/390/320px, Growth zoom, reduced transparency, and zero API writes. Captures/report: /tmp/practice-acquisition-table-final in author cloud environment, not shared parent filesystem. Full regression/types/build results are reported in handoff. No live data reconciliation or deployment performed. Single publisher owns integration and installed-app verification.

Final gate: 1,285 tests passed; dashboard TypeScript and production build passed (pre-existing sourcemap/chunk-size warnings). Final synthetic browser run produced42PNGs/31main-view checks, zero browser errors and zero non-GET API requests. Actual desktop/mobile calculator pixels inspected after correcting inherited nowrap/tiny table-header rules. Inputs recompute the 13/52 synthetic example, and session assumptions survive navigation. No publication by author.
