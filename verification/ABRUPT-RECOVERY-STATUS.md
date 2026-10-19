# Bounded Abrupt Recovery QA

Status: tooling reviewed and fake guard tests pass; actual native execution is pending.

This is new, optional QA after the completed native PostgreSQL acceptance. It does not repeat that acceptance, publish the app, or certify production recovery.

## Scope

`native-abrupt-recovery.mjs` creates a fresh owned temporary loopback PostgreSQL cluster and synthetic authenticated API children. It prepares two acknowledged workspace revisions, dated staff terms, an attachment, session corrections, full audit history, and the actual 17-table backup. At an explicitly checked idle boundary it kills only its own API child and immediately stops only its owned cluster. It compares all API and SQL state after a same-directory restart, then uses the actual preview/digest/confirmation restore workflow in a separate fresh database inside that cluster. The source database must remain unchanged.

The script strips ambient database credentials/settings before loading PostgreSQL dependencies. Workspace resolver aliases and build-metafile checks reject foreign checkout sources and duplicate database pools. Native commands have a 60-second bound, the work budget is four minutes, and cleanup has an independent 45-second command budget. Cleanup checks directory, marker and postmaster identity before cluster control. Files and diagnostics are retained.

## Validation

Author and independent review found and repaired symlinked-dependency provenance and unbounded-native-command defects. The following command passed 27 tests, with no skips:

```sh
node --test verification/native-postgres-fixture.test.mjs verification/isolated-database-bundle.test.mjs verification/native-abrupt-recovery.test.mjs
```

These use fake native executables or build-only fixtures. They cover ownership refusal, environment isolation, immediate-stop safety, stalled-command termination, independent cleanup, and foreign workspace-source rejection. They do not start real PostgreSQL or demonstrate actual crash recovery. API/schema/model build-only checks also passed.

## Pending Execution

The Mac's previously established native PostgreSQL shared-memory resource exhaustion remains unresolved; no host settings or shared resources were changed. Remote disposable execution has not been attempted for this harness. Messaging the existing publisher task was blocked for lack of explicit destination authorization, so that coordination requires approval before the remote recovery run.

After authorized coordination and review of the exact frozen revision, the existing isolated native environment can run:

```sh
PRACTICE_NATIVE_POSTGRES_BIN=/absolute/native/postgresql/bin node verification/native-abrupt-recovery.mjs
```

Do not supply a production database URL, reuse a database/directory, or run against business records. Inspect `report.json`, process exits, native identities, backup hashes and cleanup evidence. Only an actual passing report establishes this bounded result. An idle acknowledged-commit test is not in-flight transaction, power-loss, concurrent-write, load, or exhaustive restore certification.
