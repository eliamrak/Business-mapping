# Working Forecast Candidate Acceptance

Baseline: bd7856013a087b88b357ce8c468df3c7e24bbbc6. This is a review candidate, not a production release.

## Implemented

- Today working forecasts use available per-clinician history within a rolling three-calendar-month window, including quiet calendar weeks. Desired volume, vacations, room limits, attrition and acquisition growth do not modify this working baseline. Long Term Goals retains scenario modeling.
- Imported charges replace the estimated clinician/service-date revenue, with stable-source deduplication and conflict withholding. PHONE charges remain revenue but never treatment-session counts.
- On team is an optional, staged profile setting. Former staff history remains intact. Consultation views currently filter to current-team rows, including historical windows.
- Sessions has one period and contributor control above three cards. Detailed entry/history and metric explanations remain available under collapsed controls.
- Team pay comparisons use working-month earned compensation, not the legacy split-only full-caseload calculator. The persisted team selector now requires explicit confirmation.
- Unverified financial inputs withhold goals, profit or cash as appropriate. An unknown historical cash balance cannot become known merely because later earned profit is known.
- Goal summaries no longer combine unrelated signed amounts into an overall completion percentage. Capital balances, named allocations, recurring goals, losses and completed-actual achievement remain distinct.
- Completed-week/pay-period selectors use completed calendar/service windows. Money forecasts explicitly identify their independent month and imported charges identify service-month windows.

## Pass 1: Implementation and Regressions

- 565 domain/dashboard library tests passed, including new working-window, quiet-day, boundary aggregate, charge replacement/dedup/conflict, unknown staff, delayed collection, off-team history, goal solver and named-fund allocation cases.
- Five API report-coverage tests passed.
- Library, dashboard and API typechecks passed. Dashboard and API production builds passed. Existing sourcemap, mixed-import and large-bundle warnings remain.
- No authenticated database integration suite was run. No production business numbers are certified by synthetic tests.

## Pass 2: Independent Review

Fresh independent reviewer Nietzsche reviewed source and synthetic numeric controls. Six initial findings were repaired and independently rechecked: historical unknown cash propagation, rolling-boundary aggregates, clinician-level billing conflicts, earned-versus-collected recovery, historical unknown staff costs, and historical billing dedup/conflicts.

Final independent result: no remaining defects in those repairs or exact dated fund buckets; 565/565 tests passed. Additional fund controls independently produced $80, $41.2903 and capped distributions of $37.50. Probe: /tmp/practice-pass2-independent.mjs. This review is not a business-data audit.

## Pass 3: Rendered Local Acceptance

All browser checks used isolated Chromium, a frozen synthetic clock, mocked APIs and localhost. No signed-in production browser profile was used.

- render-practice-workspace.mjs: navigation, shared Sessions controls, contributor comparison, compact cards, unknown/ambiguous metrics, goal editing, capital-only status, overhead editing, focused-plan persistence, imports, and desktop/mobile geometry passed.
- staff-configuration-render.mjs: four configuration-shaped rosters plus unassigned/empty sandbox, supplied synthetic pay compatibility and unknown pay states passed. Preference writes were mocked only.
- revenue-repair-render.mjs: 351 synthetic visits over 56 explicitly covered days; October modeled service-date revenue $34,758.035714, imported partial charges $11,440, bridge/detail earned-profit agreement, zero writes and zero browser errors. These are fixtures, not real business numbers.
- Screenshots and JSON evidence: verification/practice-workspace-render/. Sessions desktop/mobile screenshots were visually inspected for framing, readable charts and absence of overlap.

## Consolidated Product Questions

1. Should each clinician's three-month window end at their latest available report (current implementation), or at today even when their reports stop earlier? This changes treatment of later unreported weeks.
2. For current-team consultation metrics, should current-team consultations still count a qualifying treatment with a former clinician? Current implementation filters both consultations and treatment rows to current team; cohort-only filtering would preserve former treatment outcomes.
3. Should imported charges replace estimates per individual visit or for the entire clinician/service date (current implementation)? Partial billing on a date does not prove all visits on that date were billed.
4. When an actual charged fee differs from the configured rate, should percentage clinician compensation follow the actual fee or the contractual configured fee? Current compensation follows configured terms while revenue uses imported charges.

These definitions must be settled before certifying affected live metrics. No invented answers or production values have been persisted.

## Publication and Backout

No deployment or main-branch publication is part of this candidate handoff. Parent independent/live acceptance remains required before publication. No migration, record deletion, historical rewrite, seeded prototype values or real settings changes were performed. The optional onTeam field is backward-compatible with absent values. Backout is a normal code redeployment of the baseline; no database rollback is required for these changes. Any later deliberate user edits remain business data and must not be reverted with code.
