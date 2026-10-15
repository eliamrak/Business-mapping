# Confirmed Import Declarations Candidate

This supersedes earlier statements that compensation basis and PHONE policy were unresolved. Historic files and prior audit results remain unchanged.

## Confirmed Decisions

The owner explicitly confirmed these exact source labels into Year 1 Baseline, configuration 1:

| Source label | Clinician ID |
| --- | --- |
| Elia Mrakovich | 9 |
| Erin Mrakovich | 8 |
| Jessica Cockrum | 12 |
| Jessica Yates | 13 |
| Michele Teague | 11 |
| Natalie Rieke | 10 |

These are authorized rollout instructions, not application defaults or automatic seeds. Future-planning copies and the unassigned `Elia` row remain distinct. No shortened-name alias is created.

Coverage is for combined source sets: attendance July 1, 2025 through October 12, 2026; billing July 1, 2025 through October 10, 2026. Select all and only the existing active members of each confirmed set. Never copy that full interval to each partial export's `report_coverage`. New uploads cannot silently inherit or extend a declaration. Canonical 14-day eligibility still excludes incomplete first/last service periods; report cutoff and completed-period cutoff are distinct.

Percentage compensation and practice-earned cap progress use accepted actual discounted charges. Salary/hourly/per-session terms remain independent. Rejected/partial/conflicting billing withholds percentage pay; affected unknown cap progress carries until annual reset. Future working percentage pay uses the same projected card-fee charge as future working revenue; planning uses its configured expected-charge assumption. Neither is actual cash.

PHONE is zero-fee and excluded from treatment counts. Parent's authorized production audit reported all exact-PHONE fees numeric zero, no nonzero/missing/nonnumeric fees. Billing rows do not prove attended consultations. The warning is conditional: future invalid/nonzero charges stay raw evidence and withhold affected financial certification, never silently become zero.

## Implementation

- Strict shared schemas and resolver pin source label, target ID, configuration and target label. Global name ambiguity remains the fallback. This release accepts exact normalized-label candidates, not aliases.
- Additive migration 009 stores one revisioned declaration per practice/account. Missing table: legacy reads work; declaration writes return 503. No runtime DDL.
- The authenticated declarations endpoint validates explicit confirmation, expected revision, target membership/label, frozen active source membership/type and every source date. Metadata and old/new audit save atomically. Source rows, hashes, observed bounds, individual proofs, manual records, packages and planning copies remain unchanged.
- Imports starts blank without confirmed metadata. Changes require an explicit save and checkbox; stale saves cannot optimistically alter metadata. Reload does not write.
- Coverage, reconciliation, clinical snapshots, Money ranges and exact-candidate audit consume the declarations. Quiet-period derived evidence does not persist synthetic visits. Existing status/fee conflict handling remains unknown/review.

## Existing-Environment Rollout

1. Freeze and independently review the exact candidate; show synthetic desktop/mobile screens before publication. Synthetic checks are not real-data acceptance.
2. In the already authorized production environment, record current deployment and source/package/manual/workspace integrity aggregates. Apply only `lib/db/migrations/009_practice_import_declarations.sql`; no force schema push, destructive migration or development-DB substitution.
3. Deploy reviewed code to the existing app. In authenticated Imports, enter the six already approved mappings and two coverage ranges, explicitly selecting existing source-set members. An identical validated API payload is also acceptable through an existing authorized action. No new credentials/execution route or patient-row transfer to this checkout.
4. Verify reload, declaration revision, unchanged individual proof fields, source integrity, distinct future copies, cutoff readouts and conditional PHONE diagnostics. Use an authorized exact-candidate aggregate replay and actual screens before certifying business figures. Short-label zero results do not imply inactivity.
5. Backout: redeploy prior code and preserve migration 009/audit history. Older code ignores declarations and returns to conservative unknown import metrics; do not delete data to back out.

No production migration, declaration save, deployment or business-number certification was performed locally. Parent/cloud worker coordinates existing authorized production actions.

## Evidence

Synthetic suites cover six-provider copies, stale/moved/deleted targets, frozen/subset source sets, independent source kinds, excluded new exports, unchanged source facts, PHONE anomalies, actual discounted percentage pay, rejected fee evidence, carried unknown caps and retained salary. API mocks cover transaction/audit rollback, stale revisions, wrong scope/type and missing migration.

Render evidence: existing 45-capture workflow `/tmp/declarations-main-render/metrics.json`; new five-state declaration workflow `/tmp/import-declarations-render/import-declarations-results.json`, plus focused `declarations-panel-{desktop,mobile}.png`. Tests/build logs use `/tmp/declarations-*`. Final exact totals and independent review outcome accompany the frozen commit. No fixture is a production seed.

Final application candidate: `e03f6432cb3a5332aefbc6bec4da560a7ae98842`, tree `2d46ddf41febe689152f65538d9bc540127d9c8a`. Independent bounded source review reports the rejected-evidence, W2 pre-payday and legacy explicit-count findings resolved, with no remaining blockers in that review. It independently ran 647/647 domain/dashboard tests. Author verification: 647 domain/dashboard, 27 mocked API and 15 audit/mapping tests pass; dashboard/API typechecks and builds pass. Final broad render rerun is `/tmp/declarations-final-main-render/metrics.json` (45 captures), in addition to the five declaration states and focused panel screenshots. These are synthetic results, not production data certification or live deployment verification.
