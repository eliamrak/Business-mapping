# Native PostgreSQL Acceptance

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

Native execution results and remaining acceptance limits must be appended after the actual run. External-provider OAuth, production owner writes and exhaustive production concurrency/crash recovery are not established by synthetic acceptance.

## Reviewed Tooling Checkpoint

Independent review reproduced and then cleared root ownership, parent-environment isolation, cleanup-after-SQL-failure and final-status reporting issues. The reviewer independently exercised cleanup failures with doubles and confirmed that all cleanup actions remain attempted and no cleanup failure reports a pass. Existing authorization/save/revision/history assertion lines remain unchanged.

Final embedded compatibility replay: `/tmp/practice-auth-saves-ecMyCd/results.json`, status `pass`, nine check groups, revision7, seven audit rows, eight captures, no browser errors, cleanup complete. This remains explicitly embedded evidence, not native acceptance.

For disposable native execution, use the installed native binary directory in `PRACTICE_NATIVE_POSTGRES_BIN` and run `node verification/native-postgres-gated-suites.mjs`. Then run `node verification/authenticated-goal-staff-acceptance.mjs` with that same binary directory, the existing Chromium path in `PRACTICE_BROWSER_PATH`, and an existing Playwright package path in `PRACTICE_PLAYWRIGHT_PACKAGE`. Native mode does not require PGlite dependencies. Both tools create and own separate fresh temporary clusters. Use the reviewed temporary checkout; do not point either tool at an existing database or change the app checkout, production configuration or deployment.
