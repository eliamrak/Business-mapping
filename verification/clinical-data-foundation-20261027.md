# Shared clinical data foundation — review handoff

## Existing source of truth (retained, not duplicated)

- Server storage: practice_import_packages, practice_import_snapshots, practice_import_declarations and practice_import_audit. GET /api/practice-imports returns practice/account-scoped history behind requireAccess; browser state is loaded from this API. This is not a browser-only dataset.
- Existing raw/client/session fields are retained. Client IDs are source identities, not guessed/fuzzy-matched persons. sourceRowHash and snapshot ID/sourceHash retain import provenance. Logical session keys use the existing sameDayVisitKey plus an ordinal for explicit allowed same-day visits.
- completeReportCoverage admits canonical provider/service-period evidence and removes conflicts. buildImportedSessionOverlay and completeServicePeriodState supply the final manual/import conflict-suppressed calendar proof. derivedShowVisits supplies treatment-only deduplication and existing same-day exceptions.
- currentPracticeClinicians resolves the current configured roster. Full historical team snapshots still supply practice-wide retention/ending follow-up, so internal transfers cannot manufacture new clients.

## Incremental implementation

New `clinical-data-foundation.ts` exposes:

1. `derivePracticeClinicalMetrics`: canonical read-only application entry over authorized workspace/context/import inputs. Reuses the above admission pipeline; returns aggregate DTO plus admission counts. No new database, endpoint, auth scheme, cache, scheduler or migration.
2. `buildClinicalObservationIndex`: internal reusable client/visit index, stable logical session keys and final coverage. Contains identifiers and must stay within the authorized processing boundary; never publish/log it or send it to advertising providers.
3. `clinicalDataFoundation`: aggregate-only calculation over admitted historical input with explicit provider scope, start/end and asOf. No client IDs appear in its result. Existing initialRetentionEpisode helper is exported unchanged so the 28-day rule is not independently reimplemented.

The DTO carries contract version, observation window, provider membership basis, snapshot source hashes, classifier references, override count, unresolved-evidence count and actual bucket denominators. Persisted source/config revisions remain owned by the existing import store; this change does not invent a cache identity or an audited historical database snapshot.

## Explicit metric contracts

- A4: distinct client IDs per fully covered Monday–Sunday week wholly inside the selected attendance window, then arithmetic mean across those weeks. Partial boundary weeks are excluded and their day count is reported. Missing complete weeks are unknown, not zero. Known quiet weeks are zero.
- A5: direct distinct client IDs per fully covered calendar month, then arithmetic mean. Never A4 × weeks. Weekly and monthly clients are deduplicated practice-wide; sessions retain permitted same-day exceptions.
- Weekly A4 may cover fewer calendar days than A2's whole-window sessions/week baseline. Do not divide unlike-period averages and label the result an exact frequency.
- A6: observed initial-retained clients not currently 90-day inactive at the explicit asOf. Initial retention remains three distinct treatment dates with gaps <=28 days. It is not merely establishment (three dates with arbitrary gaps). Latest observed treatment-provider membership determines the selected current-roster population; tied same-day provider membership counts a client once if any selected provider is present. Other population definitions require review, not a silent change.
- Latest admitted treatment determines current inactivity. A client returning after a verified historical 90-day gap may be not-currently-ended, but the historical return flag is separate; it does not create a new initial start, confirm discharge/re-enrolment, or reclassify a failed initial episode as retained. No future visit or future third qualifying date contributes to an earlier cutoff.
- A6 reports known retained-not-ended, ended, uncertain, not-initially-retained, and returned-after-verified-gap counts separately. Its qualified value stays null for uncertain classification or incomplete recent follow-up. Historical initial qualification and ending/return proof all use the final conflict-filtered intersection across historical providers. Source history remains first-observed, not certified first-ever lifetime history.
- Proposed retained attendance frequency: admitted treatment sessions while retained/not-ended divided by covered retained client-days / 7. Quiet days remain in the denominator; the third qualifying date is included, the first two are not; client membership is assessed on each day, without looking ahead. Covered/requested days and uncertain client-days accompany the result. This is a NEW derived metric, not the current all-attender-month proxy, and is not wired into acquisition formulas.
- asOf is a service-date cutoff applied to the supplied current source version, not a claim to reproduce what the database knew on a historical import date.

## Scope and review gates

No production data was read here or embedded in fixtures. The browser reader owns actual A4/A5/A6 aggregation; this commit does not claim independently reconciled live values. Raw imports, mappings, records, existing retention definitions, UI, and downstream Growth calculations are unchanged. No deployment requested from this author.

Next review must approve population membership and retained-frequency use before any downstream substitution. Existing authorized API/server boundaries must remain in place when exposing this computation; the pure function is not an authentication boundary. New caching/persistence would require source/config revision invalidation design; none is added here.

## Supporting helper (separate branch, no merge needed for foundation)

Exact-source offline helper built from 9865635faf427df7f9a10c479042c10493984a18:
- branch codex/read-only-count-helper-20261027
- artifact commit ceb1fbe4cdb601e35fc1c3e9879e39aa1e6d411b
- verification/read-only-count-helper-9865635.mjs
- 612692 bytes, SHA256 097b3536cb6e961f926477254f0611bd7a26e7b8e15de42d3bb7b3594d35e823
- import/empty-input/immutability smoke passed; no actual records included.

## Validation

- Full domain/dashboard regression: **1,312 passed**, zero failed (`/tmp/clinical-foundation-full.log`).
- Dashboard TypeScript: passed (`/tmp/clinical-foundation-types.log`).
- Production dashboard build: passed (`/tmp/clinical-foundation-build.log`); existing chunk-size/sourcemap warnings only.
- Independent read-only review: **10/10 focused tests passed** after final-coverage correction; no remaining concrete blocker in this scope.
- No new visual surface, so no new screenshot or live browser action is claimed. No imports, record/config writes, production migration or deployment.
