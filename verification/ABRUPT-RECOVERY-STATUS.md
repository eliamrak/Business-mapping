# Bounded Abrupt Recovery QA

Status update October 19: bounded native execution **passed** on frozen `6227adc15b7f80ab1df11ed54eb631183cba8277` after a disposable dependency-link correction only. See `native-abrupt-recovery-results.json`; the initial setup failure is separately retained in `native-abrupt-recovery-initial-setup-failure.json`. Earlier pending-execution notes below are historical and superseded for this covered test, not deleted evidence.

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

## Earlier Pending Execution

The Mac's previously established native PostgreSQL shared-memory resource exhaustion remains unresolved; no host settings or shared resources were changed. Remote disposable execution has not been attempted for this harness. Messaging the existing publisher task was blocked for lack of explicit destination authorization, so that coordination requires approval before the remote recovery run.

After authorized coordination and review of the exact frozen revision, the existing isolated native environment can run:

```sh
PRACTICE_NATIVE_POSTGRES_BIN=/absolute/native/postgresql/bin node verification/native-abrupt-recovery.mjs
```

Do not supply a production database URL, reuse a database/directory, or run against business records. Inspect `report.json`, process exits, native identities, backup hashes and cleanup evidence. Only an actual passing report establishes this bounded result. An idle acknowledged-commit test is not in-flight transaction, power-loss, concurrent-write, load, or exhaustive restore certification.

## Passing Publisher Execution

The first run failed before recovery assertions because the disposable checkout lacked its package-local `lib/api-zod/node_modules` link. PostgreSQL initialized and cleaned up; no application defect or recovery assertion passed in that attempt. Publisher corrected only that temporary link to the already-installed dependencies, preflighted zod resolution, and reran the same frozen source. No source changes, package installation, production operation or publication occurred.

The corrected run used native PostgreSQL 16.10 on owned loopback port 43561 and `/tmp/practice-native-abrupt-kwPVHq/cluster/data`. Command and worker exited 0. At acknowledged workspace revision 2, the idle check found zero active other transactions. The owned source API exited by SIGKILL; PostgreSQL stopped in immediate mode and restarted in the same data directory. API and SQL state, complete audit, attachments, staff terms and session corrections matched exactly before/after. The actual 17-table backup restored through preview/digest/confirmation into a separate fresh synthetic database; the original source database remained unchanged. All three owned API children and PostgreSQL stopped, with no cleanup errors. The real app checkout stayed clean at `d35f1dd3`, tree `8e7626ca8ec3f3939d0ba59814bd6ac64f34d0c2`.

The retained JSON is explicitly a connector-reported compact extraction plus read-only retained-file comparisons, not the original report bytes. It preserves the prior setup failure hashes and separately identifies the backup file-byte hash and canonical backup digest. Publisher's raw passing report SHA-256 is `d0a596bb2dd23ae4b072968d2574c7e5e651a7920c23f166d67ddc526b3c43b4`; before/after files share `c975c40e41fda6d0e8636a1fe601eb3ec4ec7db59121287925557f9673eae286`. The copied compact passing extraction SHA-256 is `6bf6707cebc329c7b949ec4c625a5fcbf8b598d8ba43421c8d54eca376c43842`; the separate setup-failure extraction is `bbed57022ebda468d449ec5d209a44bae93bb8db4b821c8d55c6573868e26538`.

This closes only the bounded idle-commit recovery and tested synthetic restore path. Some of the 17 tables are empty in this fixture; it does not demonstrate crash recovery for every possible populated import/scenario dataset. It does not certify in-flight transactions, power loss, concurrent writes, load, production restore, arbitrary account size, real business totals, or actual screen-reader speech. No live release changed.
