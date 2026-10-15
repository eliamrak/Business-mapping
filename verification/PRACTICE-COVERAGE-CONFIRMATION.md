# Per-Import Coverage Confirmation Candidate

Publication HOLD. This adds an explicit metadata-confirmation workflow to the externally reviewed daae9bee calculation behavior. All lib/practice/src, dashboard src/lib and the Practice page remain byte-identical to that calculation revision. The new API/component and tools still need external exact-SHA review. No actual source records, metadata, settings or database were changed during implementation/testing.

## Why This Is Needed

The parent supplied production-only read aggregates: four active imports, all report_coverage null; two attendance snapshots with 4,300 rows and observed July 1, 2025-October 12, 2026, and two billing snapshots with 3,293 rows and observed July 1, 2025-October 9, 2026. Those observed bounds do not certify complete reporting. The author did not read, fetch, transfer or upload those records. Under the reviewed strict gate these imports remain stored, but no imported periods or clinical facts can be admitted until source/owner coverage is explicitly established. Valid existing canonical manual periods, if any, remain independent evidence; do not assume they are absent.

The production SQL UI fallback and runbook are frozen separately at d64a50b066914854ca0310ee8331c2d98968843c. Shell DATABASE_URL is known to point to empty development, not that production dataset. No development run can be presented as production acceptance.

## Workflow and Safety

- Imports now has a collapsed editor for each original snapshot, identified by its public kind-hash identity. Start/end and confirmation basis begin blank, even when observed dates or a prior declaration exist. Dates are never inferred or autofilled.
- The user chooses source-report or owner-confirmation basis and explicitly confirms that the report is complete for the whole entered range, including quiet days. Changing dates/basis clears the checkbox. Editing/opening never saves automatically. Future/reversed dates cannot submit. Existing source bounds and any prior declaration remain visible and distinct.
- PUT /api/practice-imports/report-coverage is behind the existing API access middleware. Strict request validation requires public snapshot identity, entered proof, expected prior proof, source basis and literal confirmed=true. Unknown fields cannot request source edits.
- The scoped transaction uses the existing practice/account lock. Missing migration008 fails closed before source selection or mutation; the endpoint never applies a migration. Nonexistent, inactive, cross-practice/account or duplicate public identities cannot mutate history. Legacy eight-character and newer16/64-character source hashes are supported.
- The entered declaration must contain every valid stored source service date and original observed bounds; invalid/contradictory source dates require source review. Dates ending in the future are rejected server-side too. Expected prior proof plus a JSONB compare-and-set prevents stale edits from overwriting a later declaration.
- Only report_coverage is updated. Rows, hashes, counts, observed bounds, active flags, packages and overrides remain untouched. The same transaction writes an audit entry with old/new proof, source basis and authenticated actor; audit failure rolls back metadata. No new patient data, provider roster, identity crosswalk or compensation policy is invented.
- Saving refreshes existing shared import state. Metric gates still independently enforce whole canonical periods, global identity, source conflicts and clinical maturity. A stored coverage declaration is not a promise that every metric is now known.
- No clear-proof operation, source replacement, automatic confirmation or production data change was added. A mistaken declaration can be revised through the same checked/audited workflow; withdrawing proof entirely remains outside this bounded addition.

## Verification

- 627 existing domain/dashboard tests pass; calculation sources remain identical to daae9bee.
- 14 database-free API tests pass (five existing coverage controls plus nine confirmation controls). Includes missing migration, stale expected proof/CAS, global public identity compatibility, scoped/active/duplicate exclusion, invalid/contradictory/future dates, unexpected source edits, failed update and audit rollback.
- Eight isolated audit-tool tests pass. SQL statements are statically SELECT-only/scope-guarded; live SQL/DB execution has not been performed by the author.
- Library/audit-model, dashboard and API typechecks pass. Dashboard and API builds pass with existing bundle warnings.
- 93 synthetic desktop/mobile captures pass: 45 broad workflows,18 complete-period/identity,15 staff,8 selected financial period,2 revenue,5 new confirmation captures. The confirmation harness checks blank dates, disabled submission without basis/checkbox, future-date blocking, checkbox reset, stale rejection, a successful explicit mocked save, zero automatic writes and unchanged source facts. No production APIs or database were accessed. Author inspected blank-form mobile pixels.
- Independent bounded review found no blockers in metadata-only updates, scope/identity/stale/migration guards, atomic audit, or explicit blank-date UX. This is not live PostgreSQL, authentication penetration or production-source acceptance.

Evidence: `/tmp/practice-coverage-editor-confirmation/coverage-confirmation-results.json` and adjacent PNGs; other captures in `/tmp/practice-coverage-editor-{main,contract,staff,period,revenue}/`. Test/build logs: `/tmp/practice-coverage-audit-combined.log`, `/tmp/practice-coverage-editor-domain.log`, `/tmp/practice-coverage-editor-{ui,api}-{types,build}.log`.

## Release Gate

The owner/source must supply exact report coverage, not occupied endpoints. Parent will ask the coverage question separately; no answer has been assumed. Production SQL aggregate checks, corrected-screen review and external exact-SHA acceptance remain outstanding. No main push, publish, bootstrap, migration, credential extraction or patient-data transfer is authorized by this evidence document.
