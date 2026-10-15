# Admitted History Performance Repair

Runtime repair candidate: `7e097b37c271fcac18394e48ef96d0e0f844a8f2`, tree `4e3ebf8f65fbd31ad735ef82ef03a6590e68b5b5`. Four application files only; verification artifacts and exact audit pin are delivered separately. No schema/API/declaration changes.

## Reproduction

Production status comes from the parent/cloud worker, not a local production connection: release ac639b00 admitted the approved revision-1 declarations; sign-in succeeds, but DOM reads/clicks stall. Source/account records were not transferred here.

Synthetic fixture matches volumes only: 4,300 attendance rows, 3,293 billing rows, four snapshots, 36 roster rows including configuration copies, six confirmed mappings, two frozen source sets, and 107 manual periods. A distinct-client variant exercises 4,300 invented client identities. No fixture is a production seed.

Frozen source baseline is `254c21cbd9559b54bae295831ef2a380e81fbbf8`, runtime identical to the reviewed/deployed tree. Matching-scale Node probes reproduced coverage admission around 1.75-1.92 seconds and admitted-overlay construction around 4.35-4.57 seconds, before accounting for the page's additional calls.

## Bottlenecks and Repair

1. `completeReportCoverage` cloned the entire raw snapshot for every clinician/period and discarded the cloned rows. It also repeatedly resolved labels and scanned source rows. It now caches resolution within the invocation, indexes each source once by clinician/canonical period, clones metadata only, and deep-clones each admitted row slice. Original row references used for admission/reconciliation remain intact.
2. `buildImportedSessionOverlay` rebuilt the complete billing-backed PHONE index for every attended row. It now creates the unchanged classifier once per invocation. PHONE meaning, fee reconciliation, overlap decisions and source identities are unchanged.
3. The page rebuilt selected/month/year financial reports on every render. Those reports and Overview client flow now have input-complete React memoization before loading returns. Period/data/declaration/workspace changes invalidate the memo; tab navigation and idle state do not. No persistent/global cache or worker changes are introduced.

Candidate Node timings: coverage about 44-51 ms, overlay about 133-140 ms, one financial range about 141-143 ms. The distinct-client variant remained similar for these stages. These timings are local synthetic observations, not live production latency promises.

This also explains why admitting declarations can expose the slowdown: previously ambiguous providers were skipped before expensive overlay work; a valid crosswalk admits those rows and activates the repeated PHONE scans and source cloning. The synthetic reproduction establishes that CPU amplification exists at the supplied volume, not that it explains every live symptom.

## Manual Overlap Diagnosis

The displayed 1,871 conflicts were taken from the raw pre-admission overlay. Individual partial exports have null proof, so that diagnostic naturally sees uncovered manual windows even though their combined source set is confirmed. The page replaced the admitted overlay's entire diagnostic with this raw diagnostic, mislabeling raw uncertainty as the post-admission result. Its full-window-unknown sentence was unconditional, even when actual admitted conflicts were zero.

The repair uses the already calculated admitted manual overlap/replacement/conflict counters and shows unknown-window wording only when admitted `conflictedManualSessions` exist. Raw attendance/billing counts and raw status/fee diagnostics remain available. This is a presentation/attention-counter correction, not new source precedence or a claim that every real overlap is resolved.

Existing precedence, unchanged: `rangeFullyCovered` allows explicitly complete admitted attendance to replace a fully covered manual aggregate in the derived view only. Original manual records remain stored. If any portion of that manual window lacks admitted proof, the original aggregate remains conflict evidence; uncovered counts are not prorated, invented or added to imported visits. There is no separate manual-versus-import precedence toggle. Complete provider/source-set confirmation is the proof gate already approved by the owner; no new authorization is needed to display that existing rule correctly. A genuinely uncovered window needs enclosing provenance or independently allocatable source evidence, not a blanket override.

The source-set cutoff and completed-period cutoff remain distinct. The reported 152 eligible sessions/22 included days is a selected-period slice, not a certified full-history total. The parent's one fee conflict/four ambiguous fee encounters are independent of PHONE and manual overlap; this repair neither selects winners nor changes those records.

Parent's live financial readback confirms recorded fees through October 7 and future estimates beginning October 8. The selected-window combined revenue includes both components; it is not recorded charges or cash. No finalized financial periods means actual clinician costs/profit, collections and allocations remain unknown. Frozen-versus-candidate financial equality is tested at scale for that same September 16-October 15 date window, including the October 7/8 boundary and unknown actual cost/collection states. Real amounts remain in authorized parent evidence, not synthetic fixtures.

## Verification and Rollout Limits

- `node --test verification/practice-scale-regression.test.mjs`: exact coverage/overlay value equivalence to frozen source for clean and fee/status-conflict cases; all source records unchanged. In the 107-manual fixture, admitted manual conflicts are zero while raw pre-admission conflicts are positive. A deterministic clone bound proves no full-source cloning and at most one admitted-row copy per source row.
- `node verification/practice-scale-performance.ts`; optional `PRACTICE_SCALE_DISTINCT_CLIENTS=1` for the distinct-client stress distribution.
- `verification/practice-scale-render.mjs`: synthetic API-only browser profile, 7,593 imported rows plus 107 manual records, idle stability, six responsive tab switches, no unchanged financial recalculation, changed-period invalidation, desktop/mobile captures, zero writes and unchanged source inputs.
- Local browser runs reached readiness in approximately 2.6-3.6 seconds; tab navigation approximately 250-550 ms. No infinite financial recomputation loop reproduced in this fixture. It does not prove that all production delay has the same cause.

Evidence: `/tmp/practice-scale-regression.log`, `/tmp/practice-scale-performance.log`, `/tmp/practice-scale-distinct-performance.log`, `/tmp/practice-scale-render/scale-results.json`; broad regression `/tmp/scale-main-regression/metrics.json`. Independent bounded review found no blocker in the targeted changes and independently passed the three scale regressions, 53 focused tests and dashboard typecheck.

Author verification: 647 domain/dashboard tests, 27 mocked API tests, 15 audit/mapping tests and 3 full-scale frozen-reference regressions pass. Dashboard/API builds and typechecks pass. Rendered checks cover 45 existing workflow states, 4 full-scale desktop/mobile states and 5 explicit-declaration states. Full-scale browser reported no writes or input mutation, stable idle/tab financial call counts, changed-period invalidation, 2,585 ms cold readiness and 253-549 ms navigation in the final run. Its maximum startup long task was 1,677 ms: this is a substantial reduction, not a claim of zero main-thread work or physical-mobile/live latency certification.

No production reads/writes, migration, declaration saves, main promotion or deployment were performed for this repair. Do not reapply migration 009 or resave the approved declarations as a performance workaround. Parent/cloud worker must review the exact candidate, deploy deliberately, then verify live navigation/DOM responsiveness, admitted manual counters, unchanged fee-review diagnostics and preservation fingerprints. Acceptance remains pending that live check.
