# Daily average active caseload — review candidate, not installed

Adds `average_active_caseload`, formula `daily-initial-retained-not-inactive-v1`, independently for whole practice and each current clinician over the 3- and 12-month calendar windows. Foundation DTO is v3. Existing `retained_not_ended` remains the distinct common-as-of snapshot; it is not A6's period average.

Numerator: sum of daily distinct retained/not-inactive client counts. Denominator: all calendar days in the requested window, inclusive. A client qualifies only from their third distinct treatment date in the first observed initial episode (successive gaps <=28 days). Each day's latest admitted treatment must satisfy latest date +90 days > day. No future qualification or future provider assignment. A recorded return can restore current activity from its date without becoming a new initial start. Consultations, duplicate visits and approved same-day exceptions retain canonical admission semantics.

Provider membership follows the latest treatment date as of each day. Multiple providers on that date each receive a client/provider pair; the whole-practice count deduplicates the client. Provider averages need not sum to practice average when such sharing exists.

All requested days require final coverage and resolved retention classification for a reported average. Missing days do not become zeros or silently shrink the denominator. Partial observed client-days remain supporting metadata, while value is null. Fully covered quiet days count as zero. Earlier unobserved retention cannot be inferred; this is an imported-history observation, not a claim of complete pre-import client history.

The existing retained-attendance frequency and end-date population calculations are unchanged. A7 remains a separate review decision; this change does not rewire or reinterpret any live A7 proxy or acquisition equation. No UI/API wiring, migrations, persistence, imports or deployment. Parent-supplied real aggregate verification was not copied into source fixtures or independently reconciled here.

Synthetic tests cover daily exposure vs end-date count, third-date qualification, exact inactivity boundary, return, daily transfers, shared-provider deduplication, known zero, incomplete coverage and unresolved evidence. Catalog tests prove distinct 3/12 averages and formula version, including clinician scopes.

Validation: final full regression 1,321/1,321 passed; dashboard TypeScript and production Vite build passed (existing chunk-size/sourcemap warnings); independent read-only review accepted, 19/19 focused tests. No rendered UI changed.
