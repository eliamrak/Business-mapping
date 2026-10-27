# Automatic Growth follow-through

Separate pushed UI checkpoint: 2576fdb21ea8f816f6744ab4aa2db4c8c209201a, tree 8643b28434014cff45b24f67351d2aea52a26253. Team nonclinical glass and action padding; one Sessions close summary with accessible selected-period details. 1,294 regressions, types/build and synthetic browser passed before this Growth change.

## Root causes and source findings

The former Growth UI deliberately left growth, net-client goal and conversion inputs empty; the manual scenario was not wired to history/capacity. A three-month selector hid twelve-month evidence. This implementation removes those mandatory blank inputs and shows both histories together. Horizon remains an editable session-only planning target (initial four months), not a recorded fact.

Attendance/consultation records carry client IDs and join consultation to scheduling, attendance, establishment and retention. Marketing funnel rows have period/source/campaign/clinician totals, not lead/client identity. Their attachment ID is provenance, not client linkage. `acquisition-funnel.ts` now admits complete validated source/clinician breakdowns as well as a practice total, rejecting mixed totals, duplicate/overlapping source ownership and overlapping/incomplete periods. Missing booked-client totals do not erase independently available leads.

Matured starts count evaluated first-observed starts, including retained and mature non-retained outcomes under the existing 28-day rule. They do not exclude later apparent endings. A client can occur in both flows. Their difference is a flow balance, not reconciled active-caseload change. All existing metric definitions remain intact.

## Automatic model

- Current roster comes from `currentPracticeClinicians`; departed/archived clinicians cannot inflate desired capacity or block current-roster coverage. Historical practice flow counts remain intact, separately disclosed as a historical mix assumption.
- Covered monthly treatment attendance: existing consultation/documentation exclusion, deduplication and explicit same-day exceptions. All configured current clinicians require admitted calendar coverage; unverified months are excluded, not zero.
- Weekly workload = treatment visits × 7 / calendar days. Regression of monthly weekly workload against calendar-month index estimates growth; gaps retain their true calendar spacing. At least two covered months are needed.
- Both pace columns use the same baseline: latest up-to-three covered monthly weekly averages within available twelve-month history. Baseline dates and coverage counts are disclosed; it is not a live caseload count.
- Capacity = configured current desired sessions/week. Horizon and capacity gap determine required weekly workload growth per month. Fill time = gap / positive observed workload trend. Zero/negative trends explicitly say not filling. Already full is explicit. Endings are NOT subtracted again from this net observed attendance trend.
- Attendee-month frequency = admitted visits / sum(unique attending clients in each covered month × days/7). This includes quiet days within each attendee month but excludes whole months without a visit. It is a planning proxy, not the load of all active/retained clients and not lifetime sessions.
- Required client equivalents = required weekly-workload growth / positive observed attendee frequency. Gross matured-start planning target = these equivalents + observed monthly apparent endings. The proxy assumes future entrants have the observed attendance mix; matured starts are not all continuing clients. Reactivation, early losses, staffing and frequency changes can invalidate that assumption.
- Lead requirement = gross target / (matched mature-period starts / reported leads). Ratio can exceed one; it is labeled per 100 leads, never a cohort probability, never clamped or shown as a percentage arc. Values retain one decimal; no premature integer rounding.
- Flow/lead months are older mature months; workload uses covered recent calendar months. Counts and exact month lists distinguish these bases. Missing specific denominator produces a concise reason. No campaign settings or business records are changed.

## Benchmarks and lifetime

Verified primary source: https://onlinelibrary.wiley.com/doi/abs/10.1002/cpp.70258 (Oh et al., 2026), abstract: 12,988 adults in one US digital network, 27.8% attending fewer than three sessions. Approximately 72.2% reached a third. This does not validate the app's 28-day rule or supply a scheduled-close/90-day-ending target. Added reference context under Goals details only; owner values preserved, no universal default.

Existing lifetime panel already shows sample sizes, mean/median treatment visits and first-to-last spans, separates apparent 90-day endings from ongoing/uncertain observations, and excludes consultation visits. It groups client histories, not separate return episodes. No duplicate UI, episode segmentation, invented long-term threshold, or expected-lifetime claim was added. Earlier import gaps remain a limitation.

## Release boundaries

Synthetic source/test/browser data only. No real-record reconciliation, imports, configuration writes, integrations, credentials or deployment. Parent owns independent review and single-publisher release. This is an aggregate planning estimate, not an individually linked marketing funnel or guaranteed capacity forecast.

## Final validation

- Full regression: **1,302 passed**, zero failed (`/tmp/automatic-growth-final-tests.log`).
- Dashboard TypeScript: passed (`/tmp/automatic-growth-final-types.log`).
- Production dashboard Vite build: passed (`/tmp/automatic-growth-final-build.log`); existing sourcemap/chunk-size warnings remain.
- Full synthetic app browser: 31 checks, 48 screenshots, zero browser errors, zero API writes (`/tmp/practice-automatic-growth-final/report.json`). Includes desktop, 390/320px mobile, clinician/Compare, controls, keyboard close-details expansion, horizon persistence, glass surfaces, no horizontal overflow and existing campaign/import functions.
- Additional real-component positive-data browser: automatic lead estimate, horizon recalculation, both histories, missing and already-full modes, widths 1280/390/320 (`/tmp/practice-growth-positive/report.json`). Built with the actual production CSS. No provider or app connections.
- Actual pixels inspected: full-app Growth pace desktop and acquisition mobile; positive-data pace 390px and table viewport320px; existing Team and close-details views from separate checkpoint. Full-page Chromium backdrop screenshots can contain compositing blanks; viewport captures confirmed the visible content is intact.
- Independent read-only reviewer accepted the corrected current-roster wiring and ran **13 focused tests**. No remaining concrete blocker; aggregate-model limitations remain documented.

Capture files are consumer-local `/tmp` artifacts, not shared parent paths. No live counts independently reconciled. Publisher must review/integrate the exact commit and perform live acceptance; no deployment has been performed here.
