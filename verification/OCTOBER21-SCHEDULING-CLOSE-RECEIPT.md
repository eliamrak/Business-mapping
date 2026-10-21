# Scheduling-based close-rate correction

Authority: user Sentinel_681eda2d606c81918f724756e103c80b and confirmation Sentinel_4d4f778d8450819197883e04ed3448a7, October21: close happens when the client schedules their first treatment appointment, credited to that scheduled clinician. This supersedes attendance-based wording. User resumed local work with Sentinel_ef1b640bf9188191adad38df2465120d. Base reviewed source: 5dd0f129df3f9442173105bc831b9fd2859bda98.

## Behavior

- Booking-event time, not appointment date or attendance, determines qualification within the existing one-calendar-month consultation window. A later appointment, subsequent cancellation or no-show does not undo a qualifying booking.
- First scheduled clinician receives one close automatically when immutable event chronology, original clinician and complete preceding booking history establish that attribution. No separate closer confirmation is required. Later transfers/attendance do not reassign original close credit.
- Practice counts one known qualifying booking per consultation journey. A known booking with uncertain first provider can establish a practice close while clinician credit remains unresolved. Internal referrers are not failed closes.
- Explicitly complete client booking history through the deadline can establish a mature absence, even with zero booking events. Attendance coverage cannot establish booking absence. Multiple possible missed owners remain unresolved for clinician metrics.
- Same-day booking versus date-only consultation cannot establish order. Conflicting event identities, tied first clinicians, missing timezone, invalid dates, incomplete prefixes and future evidence are handled conservatively. UTC instants/day boundaries match the app's calendar policy; no local booking timestamp is invented.
- Known converted/missed/evaluated subsets and pending counts remain separate. A mature unresolved outcome suppresses the affected rate rather than presenting a partial denominator as100%. Immature pending cohorts remain excluded from evaluated outcomes. Missing counts are not displayed as zero.
- Overview, Sessions and Team use the scheduling calculation consistently for practice/clinician comparisons. Existing attendance-based helper remains explicitly labeled a legacy diagnostic, not a scheduling rate. Observed treatment starts remain a separate on-demand count.
- Legacy closer/missed-owner values are preserved, but cannot create missing booking timing or original provider evidence. Their old editor controls are disabled in scheduling mode; review flags remain available and do not invent outcomes.
- Retention remains three completed qualifying treatment sessions, with existing28-day initial gaps and PHONE exclusion. No retention equation, import classification, compensation or Budget changes.

## Actual source limitation: not a completed production booking-data integration

Current imported attendance/billing rows retain service date, provider and terminal attendance status. They do not retain booking-created time, immutable booking/appointment identity, original scheduled-clinician history, upcoming scheduled appointments or complete booking-history coverage. Converter reconciliation can use appointment identity/time upstream, but those are not booking-created timestamps and are not retained as the required booking facts.

Completed treatment proves a booking occurred; it does not establish when it was booked or the original scheduled clinician. Old manual closer confirmations lack that timing too. Consequently the existing attendance-only production source will show booking close rates as Unknown for both practice and clinicians. This is a truthful consequence of the newly confirmed metric, not a certified scheduling conversion extracted from existing visits.

The new calculation accepts explicit in-memory booking evidence; no producer/importer/API/store was added or silently populated. Minimum additional trustworthy source is: client/consultation link, immutable booking identity, timezone-qualified booking event time, original scheduled clinician, appointment date and service classification. Complete client booking-history coverage is required for absence and first-event proof. Actual consultation time is also needed to resolve same-day ordering. No bank, cash or payroll information is relevant or requested. A later source integration must preserve existing source IDs, review lineage and real records.

## Verification

Canonical pure regression command (includes the previous1065 tests):

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts verification/profit-first-planning-input.test.mjs
```

Focused module cases cover booking-before-deadline/appointment-after-deadline, booked without attendance, cancellation/no-show, different consultant/scheduled provider, transfers, normalized duplicates, conflicting IDs, ties, partial prefixes, empty complete ledgers, same-day uncertainty, UTC offsets, future events, legacy overrides, immutable inputs, mature-unknown rate gates and immature-pending controls.

Final canonical run:1089 passed, zero failed/skipped, `/tmp/practice-booking-followup-final-tests.log`. Focused booking module:22 passed, including booking-versus-three-completed-retention separation. Dashboard/API typechecks and both builds pass; no new dependency installation.

Independent numerical review reproduced and repaired a P1 partial-denominator100% case. Final recheck: one known close plus one mature unknown gives null practice/associated-clinician rates, with converted1/evaluated1/pending1/missed0. Known booking with uncertain provider retains practice close only. Independent visual review cleared six representative Overview/Sessions captures at1280/390/320; static synthetic captures are not native Mac acceptance.

`verification/october21-booking-close-acceptance.mjs` uses an isolated synthetic loopback app and fresh browser. It checks practice/Elia/Erin Overview and Sessions, Team paired clinician summaries, unknown rings with no numerical aria value, missing-source labels, no overflow, unchanged evidence, zero mutation requests and disabled legacy confirmation controls. Existing second-walkthrough26-check layout/persistence regression also passes. No production data or external network is accessed by these harnesses.

Final booking harness:22/22 pass, `/tmp/practice-oct21-live-call-kYoNJk/booking-results.json`; portable receipt `verification/OCTOBER21-SCHEDULING-CLOSE-RESULTS.json`. Legacy controls are absent or disabled and their limitation is explicit; no confirmation action is enabled. Existing26-check regression: `/tmp/practice-oct21-live-call-x5EPbc/second-results.json`. Earlier failed/stale-expectation receipts remain preserved and are not counted as passes.

Dashboard/API typechecks and their existing builds are required. Replit canonical artifact commands remain unchanged; no dependencies, SQL/schema migrations, seeds, runtime routes or database changes are needed. Build warnings about existing sourcemaps/chunks remain nonfatal. Canonical database-backed API suites are separately gated and are not required pure-release substitutes.

## Preserving publisher handoff

Expected publisher HEAD940646e44fb6879dd0dd8cd959794b5f176a6fa4, treecac0e7e539cef5d60dbd4697cd5fdd6b9ac170ff. Reverify current clean identity before integration; stop on mismatch. Fetch only established GitHub remote. Apply the reviewed delta from5dd0f129 to the follow-up candidate onto that publisher descendant, with exact affected-file preimages and patch digest checks, preserving every unaffected tree entry. Retain a preintegration rollback branch and make a normal descendant commit after tests. Do not reset publisher history or push publisher-only commits to GitHub.

Preserve .replit, multi-artifact contracts, publisher memory/history, all business records and current import/configuration/journal metadata. Keep copy-development-database OFF. No record restoration is needed for source backout. Root coordinates publication; this receipt alone is not a deployment claim.

Postpublication read-only checks: new asset provenance/health, unknown booking rates with concise reason on attendance-only records, separate observed starts, identical practice/clinician definitions, unchanged retention/Budget/payroll/import metadata, usable desktop/mobile layouts and disabled legacy confirmations. Do not Save, approve imports or edit records for live acceptance. Reliable real booking rates remain blocked on the specific missing source above; native Mac/VoiceOver and owner review remain separate acceptance gates.
