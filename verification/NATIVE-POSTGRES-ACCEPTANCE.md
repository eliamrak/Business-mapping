# Native PostgreSQL Acceptance

## Final Outcome

Native acceptance passed in the existing disposable Replit environment: all 40 gated tests and all nine annual-goal/staff save-and-restart groups passed. Evidence, hashes, the initial failure and its repair are retained below and in `native-postgres-results.json`. The Mac resource failure remains, but it no longer blocks this bounded acceptance. No production database operation or publication occurred.

## Scope

Close the native-server verification gap for runtime release `f9a9bb997d5ef7c77178c6b97a14c4e7d274745e`. Changes in this work are verification tooling only. No production source behavior, business records, imports, credentials, grants, services or publication are changed.

Required native checks are `hub.integration`, `practice-imports.integration`, `sessions.integration`, `session-goals.persistence`, and the established authenticated annual-goal/staff save-and-restart harness. The last harness must stop and restart both the API and its disposable native PostgreSQL server, retaining exact goal, staff-term, revision and audit/history equality checks.

## Mac Execution Blocker

Native PostgreSQL 16.14 is installed at `/opt/homebrew/opt/postgresql@16/bin`. Fresh `initdb` under `/tmp/practice-native-acceptance.nlT3Jx/cluster` failed before a usable cluster existed:

```text
FATAL: could not create shared memory segment: No space left on device
DETAIL: Failed system call was shmget(key=68224200, size=56, 03600).
```

A second fresh attempt with per-cluster `shared_memory_type=mmap` and `dynamic_shared_memory_type=mmap` also failed at `shmget(key=68224351, size=56, 03600)`. No kernel limits, unrelated servers, shared-memory objects or host settings were changed. Docker and Podman are not installed. This is a resource failure, not an access denial. The four gated native suites and native restart are **not passed locally**.

The new runner's retained Mac preflight at `/private/tmp/practice-native-gated-v33wKx/report.json` likewise marks all four suites blocked and records native binary/version, exact diagnostics and source hashes. No native server started or stop command ran.

## Isolated Tooling

- `native-postgres-fixture.mjs` creates only a fresh, self-owned temporary cluster, binds loopback and a private temporary Unix socket, checks server/data-directory identity, and stops only its captured postmaster. Existing roots, including empty roots, are refused. It accepts no existing database URL.
- Parent PostgreSQL settings and `DATABASE_URL` are removed before loading database clients. Child environments contain only test configuration; reports record removed variable names, not values. PostgreSQL/Node paths are explicit, with the existing PATH retained for Nix tool portability.
- `native-postgres-gated-suites.mjs` generates the current schema into its owned cluster and runs the four exact suites. Tests that need an API use actual routes and the existing synthetic JWT fixture. No production database URL or data is required.
- `authenticated-goal-staff-acceptance.mjs` supports the same native fixture while retaining its PGlite mode and all existing authorization, stale-revision, goal, staff-term, audit and restart assertions. The Money source disclosure is opened before editing staff in the current UI.

## Local Checks So Far

Fixture guard tests: **13 passed**, using executable doubles, not a PostgreSQL server. They cover root refusal, environment sanitization, cleanup after SQL failure/mismatch, ownership mutation refusal and same-fixture restart control.

Embedded compatibility: **nine check groups passed**, final revision7, seven audit rows, eight desktop/mobile captures and no browser errors. A repeat with deliberately invalid `PGSSLMODE`, `PGOPTIONS`, `PGPASSWORD` and `DATABASE_URL` also passed after sanitization. These are PGlite results and do not certify native PostgreSQL. Evidence remains under `/tmp/practice-auth-saves-1oIm5G/results.json`.

## Replit Path Readiness

Read-only inspection of the existing Comp Calculator app confirmed native PostgreSQL16.10 at `/nix/store/bgwr5i8jf8jpg75rr53rz3fqv5k8yrwp-postgresql-16.10/bin`, UID1000, writable temporary storage/shared memory, and Chromium152 at `/repl/tools/bin/chromium`. The app lookup by public URL did not match, but ordinary app listing resolved the existing authorized app. No access denial occurred and no new grant was requested.

This confirms an available isolated execution path, **not a successful native startup or suite run**. Use a disposable temporary checkout of the reviewed test-tooling commit and existing dependencies; leave the development/production checkout and database untouched. Do not publish. If existing fetch/dependency access is denied or unavailable, report the exact action and stop that path rather than obtaining new credentials or routing around the denial.

Final native results appear below. External-provider OAuth, production owner writes and exhaustive production concurrency/crash recovery are not established by synthetic acceptance.

## Reviewed Tooling Checkpoint

Independent review reproduced and then cleared root ownership, parent-environment isolation, cleanup-after-SQL-failure and final-status reporting issues. The reviewer independently exercised cleanup failures with doubles and confirmed that all cleanup actions remain attempted and no cleanup failure reports a pass. Existing authorization/save/revision/history assertion lines remain unchanged.

Final embedded compatibility replay: `/tmp/practice-auth-saves-ecMyCd/results.json`, status `pass`, nine check groups, revision7, seven audit rows, eight captures, no browser errors, cleanup complete. This remains explicitly embedded evidence, not native acceptance.

For disposable native execution, use the installed native binary directory in `PRACTICE_NATIVE_POSTGRES_BIN` and run `node verification/native-postgres-gated-suites.mjs`. Then run `node verification/authenticated-goal-staff-acceptance.mjs` with that same binary directory, the existing Chromium path in `PRACTICE_BROWSER_PATH`, and an existing Playwright package path in `PRACTICE_PLAYWRIGHT_PACKAGE`. Native mode does not require PGlite dependencies. Both tools create and own separate fresh temporary clusters. Use the reviewed temporary checkout; do not point either tool at an existing database or change the app checkout, production configuration or deployment.

## First Native Run and Demonstrated Test Defect

Replit's native PostgreSQL16.10 started successfully for reviewed tooling `d90310a`. The corrected isolated invocation used Node24.13.0 with an empty inherited environment and explicit PostgreSQL, Python and Node paths. The temporary checkout reused installed dependencies by symlink; the app checkout remained clean at `d35f1dd3dbeadd45e6948287f00e1ac97b434e77`.

| Suite | Result |
| --- | --- |
| hub.integration |17/17 passed; exit0|
| practice-imports.integration |10 individual cases passed; file-level teardown failed; exit1|
| session-goals.persistence |1/1 passed; exit0|
| sessions.integration |12/12 passed; exit0|

The runner report at `/tmp/practice-native-gated-eMSKpk/report.json` has SHA256 `ec613ab2ed72dfe4b07f54b9d722bd313ed312abf0d2ae8b20cdc0c11574ac14`. API and owned PostgreSQL processes stopped. Overall result is a failure, not a pass.

Retained bundle inspection proved that the import test compiled two identical-source database modules with different identities: the route's `@workspace/db` resolved through linked dependencies into the app checkout, while its exported cleanup pool came from the temporary checkout. Thus `pool.end()` drained the wrong pool. Forced disposable-database removal then caused two late PostgreSQL termination errors. No import assertion failed, and no production database was involved.

The narrow test repair pins `@workspace/db` and its schema to the disposable checkout, uses asynchronous esbuild to support that resolver, and asserts exactly one owned database module before loading the bundle. A symlinked-dependency regression proves distinct route/cleanup objects before the fix and identical objects after it. Independent review also bundled the actual route and verified one owned module; no assertions or asynchronous errors were suppressed. This changes test infrastructure only, not the production route or database pool implementation.

The native save/restart harness was not run in the first operation because Playwright was absent. That dependency blocker was not an access denial. A free, isolated public-registry install now pins Playwright1.64.1 under `/tmp/practice-playwright-runtime-20261019`, with scripts/audit/funding checks disabled, no browser download, and no production settings or credentials. Its lock records integrity `sha512-HCrVhHr5QQuwYoswEUGTb7gGp522yflbv/ST8nF4sFWGuLjQCt17Q/EubpGGSNKYn1tsTCPZxqHhHCfVURu7UA==`. A headless about:blank smoke test with the existing Chromium passed with zero external requests. The app's package files and dependencies remained unchanged.

## Successful Native Rerun

The native acceptance gap is closed for the covered release paths. On October 19 the existing isolated Replit environment ran reviewed commit `1d25b281e239e1c9ec01e86433f702a6af574618`, tree `7eff53f672f6167626c7f0518219ad4269818b73`, with production runtime/build inputs unchanged from `f9a9bb9`. The source was clean. All six local tooling/test SHA256 values matched the retrieved report exactly.

| Suite | Native Result |
| --- | --- |
| hub.integration |17/17 passed; exit 0|
| practice-imports.integration |10/10 passed; exit 0; no late teardown error|
| session-goals.persistence |1/1 passed; exit 0|
| sessions.integration |12/12 passed; exit 0|

Total: 40 native tests, zero failures or skips. The native runner and API build exited 0. The hub suite includes expanded 17-table reviewed recovery, owner/restricted-entry boundaries, signed identity checks, idempotency/revisions, attachments and audit/history preservation. This is fresh native execution, not a carry-forward from earlier pure or embedded tests.

The established annual-goal/staff harness also ran against a separate fresh native PostgreSQL 16.10 cluster and exited 0 with status `pass`: nine check groups, revision 7, seven audit rows, eight desktop/mobile captures, zero browser errors or horizontal overflow. Missing/invalid JWTs returned 401, uninvited identities and wrong origins were refused, and stale saves returned 409 without changing revision/history. The 144000 annual goal, annual 26/hour and 12 hours/week default, independent dated 24/hour term, unchanged source staff row, SQL/API equality and all audit actors/history survived a full API and native PostgreSQL stop/start.

Both clusters bound only to 127.0.0.1 and their private temporary Unix sockets. Start/stop event times and directory/port identities are retained in `native-postgres-results.json`. Cleanup completed; no PostgreSQL, Chromium or test API process remains. The synthetic data directories are retained for evidence. The real app checkout remained clean at `d35f1dd3dbeadd45e6948287f00e1ac97b434e77`; no production database operation, reimport, credential/grant change, service creation or publication occurred.

Original retained reports:

- `/tmp/practice-native-gated-qhbj1g/report.json`: SHA256 `aa90e84dd4e411d0e3f9d85c7dab76a8c1bfc7f66a574099e2c51ec83c98d5da`.
- `/tmp/practice-native-accept-1d25b281/goal-staff/results.json`: SHA256 `228287daffec180b64a510b852cc4b859342b83ad8e4039b52aed7bca43fea59`.
- `/tmp/practice-native-accept-1d25b281/goal-staff/cleanup.json`: SHA256 `b5aa805da95bbdb4a811de8584963a4b91550e0ecdc075f875ffc9f3c92bf7d3`.

The compact repository JSON is a labeled read-only extraction, not a byte-for-byte copy of those complete reports. Earlier connector requests timed out and status requests were bounced while the agent was busy; no duplicate run was queued. Reports were retrieved after completion.

## Remaining Limits

The Mac shared-memory resource failure remains, but it no longer blocks this native acceptance because the existing Replit disposable path succeeded. This is bounded synthetic authorization and native persistence/recovery evidence. It does not certify external-provider OAuth, production owner writes, every business metric/input, screen readers, production load, or abrupt crash recovery. No owner technical QA, financial records or repeat import is required to close the gap verified here. No SEO/Ads work was started.
