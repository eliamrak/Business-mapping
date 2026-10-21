# Practical same-clinician close correction

Governing instruction: Sentinel_15211baa7a3c81918a5756c865682ece, October21 21:25:36UTC: consultation, followed by a scheduled full session under the same clinician, marks a close. This supersedes the strict booking-event interpretation in held candidate f42940e51941157c3c16a8e20d7dfc8a7e011684 and its scheduling receipt/harness. Do not publish prepared strict publisher commit d19b2761974bd6d86220ee0b61be54353f3a6e8d by itself.

## Calculation and evidence

- An identifiable consultation followed by the first chronological recorded qualifying full-session appointment under that same clinician establishes a close. Attendance is not required. Existing completed full sessions are usable evidence; cancelled/no-show full appointments also establish scheduling existence. A manual closer confirmation, booking-created timestamp or immutable audit history is not required.
- The operational sequence is appointment-date order, not guessed booking-event order. Multiple providers on the same first appointment date and same-day date-only consultation/session ordering remain unresolved. A later transfer does not rewrite the first observed full-session outcome. A consultation occurring after an appointment was already observable cannot retroactively claim that scheduling close.
- Existing one-calendar-month follow-up remains explicit: an appointment within that dated window qualifies; a later appointment can qualify when observed on the schedule by the deadline. A beyond-window appointment observed only later has uncertain timing, not an invented failure. Observation/import time is never labeled a booking-created time.
- Cross-clinician referrals are excluded from converted and missed counts, including practice same-clinician close-rate denominator. They are counted separately as referrals excluded. A different provider receives no same-clinician close without their own preceding consultation. Practice clients count once, not once per duplicated export or provider.
- Positive pairs remain usable when coverage is incomplete. An absence requires the existing admitted complete follow-up proof. Mature unresolved outcomes suppress affected percentages instead of producing false100%; known converted/evaluated/pending counts remain separate. Immature follow-up remains pending and excluded. Missing data is not zero.
- Retention still requires three completed qualifying treatment sessions with the existing28-day initial-gap rule; PHONE, cancellations and no-shows do not count toward that threshold. Session actuals, compensation, Budget, cash estimates and attrition equations are unchanged.

## Positive source path, identity and scope

`scheduled-appointment-sources.ts` maps existing attendance observations with the established full-roster provider resolver and saved declarations. It preserves client-ID case, source identity, source observation time and recorded statuses. It invents no appointment IDs, clinicians or timestamps. Classification-only attendance/billing sources receive the same alias mapping so billing-only PHONE evidence remains usable.

These in-memory positive snapshots have report/quiet-coverage proof removed. They can establish observed consultation/session pairs, including current partial periods and future Show appointments already observed by as-of; they cannot certify missing appointments. Completed-service admission remains separate for actuals, payroll, retention and attrition. Unknown/stale/ambiguous providers produce timestamped unresolved evidence rather than false absence. Different resolved IDs sharing an observed canonical label are withheld, while unused roster copies do not erase valid mapped evidence. As-of filtering happens before collision detection so future imports do not alter an earlier result.

Overview, Sessions and Team use the same consultation-period results and same-clinician definition. Positive scheduling observations are not hidden behind complete-service-period history gates. Consultation dates come from the consultation result, not a different clipped retention/capacity window. Other metrics retain their prior clipping/coverage semantics. Legacy manual values are preserved; recorded evidence establishes closes automatically and old confirmation controls stay disabled/absent for this measure.

## Verification

Canonical command:

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts verification/profit-first-planning-input.test.mjs
```

Final run1117 passed, zero failures/skips: `/tmp/practice-same-clinician-final-tests.log`. Dashboard/API typechecks and both builds pass. No dependencies installed; no SQL migration, seed, API/import schema change or business-record writes are required.

Independent code review reproduced and repaired provider-ID/name collisions, lost alias PHONE classification, future-source exclusion/collision leakage, and clipped Overview consultation dates. Final scoped code gate clear:101 focused tests plus independent synthetic reproductions passed. Independent visual review cleared24 captures, then rechecked the final320px disclosure fix and referral counters. No remaining blocking findings in reviewed source/captures. Native Mac/VoiceOver remain unverified.

Current harness: `node verification/october21-same-clinician-close-acceptance.mjs`;24/24 pass at1280/390/320 across Overview/Sessions practice, Elia, Erin, Team, and an identifiable future full appointment. Portable receipt `verification/OCTOBER21-PRACTICAL-CLOSE-RESULTS.json`; screenshots `/tmp/practice-oct21-live-call-o9sRAA`. Existing second-walkthrough26/26 regression passes at `/tmp/practice-oct21-live-call-0ySc89`. Both use isolated synthetic loopback routes; mutation requests, external calls and browser errors are empty. Earlier receipts are retained, not counted as final passes.

Synthetic counts, not business values: January has4 consultations,2 same-clinician closes,1 covered non-conversion and1 excluded referral, hence2/3 =66.7%. A future Erin full appointment yields1 close/100% with0 completed treatment starts. No synthetic values were seeded or uploaded.

Bounded full-component scale probe:4823 attendance and3681 billing facts across6 snapshots, synthetic only. One paired run measured startup7345ms for this source versus6600ms for held f42940e5; Money562/547ms, Sessions980/959ms, first Team5762/5710ms respectively. Later navigation remained comparable; idle commit delta0 and no browser errors/writes. This exposes roughly0.75s extra startup work in that fixture, not a production-latency guarantee or a statistically established benchmark. Receipts `/tmp/practice-full-scale-Hl90iM/results.json` and `/tmp/practice-full-scale-nWR1a2/results.json`; no speculative performance refactor was mixed into the metric correction.

## Real-data acceptance and preserving release

Actual business counts are not certified from source inspection or synthetic fixtures. Existing retained attendance/billing observations and confirmed mappings now suffice for identifiable historical same-clinician pairs; no new EHR booking audit is required for those positives. Future appointments require an identifiable qualifying appointment actually present in the source. Old aggregate treatment-start totals alone cannot determine same-clinician matches. Use the existing authenticated reader to collect current-window same-clinician closes, evaluated, pending, referrals and coverage per clinician and practice. Do not request client identifiers or new connections merely to replay already stored observations.

Expected prepared publisher HEAD d19b2761974bd6d86220ee0b61be54353f3a6e8d, tree0acab021b06ece6085f6f9ab1c67f59b1383e08d, parent940646e44fb6879dd0dd8cd959794b5f176a6fa4. Live remains the previous layout release per parent handoff. Reverify clean publisher identity and exact affected-file preimages from f42940e5; stop on mismatch. Integrate the reviewed follow-up delta normally on top of d19b276, preserve every unaffected tree entry, keep a preintegration rollback branch, run canonical tests/types/artifact builds, then make a normal descendant commit. Do not reset or replace publisher history.

Preserve .replit, artifact contracts, publisher memory, all stored records, six import identities and existing configuration/revision/journal/mappings. Keep copy-development-database OFF. Root coordinates publication and read-only health/asset/UI verification. Confirm useful same-clinician counts and excluded referrals on existing data without Save/import approval actions; compare unchanged Money, retention and imports metadata. Source backout requires no data deletion/restoration. No deployment or real-account acceptance is claimed by this local receipt.
