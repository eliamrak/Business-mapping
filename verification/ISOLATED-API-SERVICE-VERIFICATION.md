# Isolated API Service Verification

Runtime candidate: `58949e42c294dae368820f2fe21341156ed0067a`, with frozen runtime `42c4b33b6826ceb36da54606e7e4639b53147d28`. Only verification tooling and one test fixture changed during this check. Historical billing remains on `codex/historical-billing-only`, separate from main and production.

## Reproduce

Run `node verification/run-isolated-api-tests.mjs` from the repository. Requires installed PostgreSQL tools (`initdb`, `pg_ctl`, `psql`, `pg_dump`), Node, corepack/pnpm and the existing dependencies. The script creates a new temporary PostgreSQL cluster listening only on loopback, pushes the checked-in Drizzle schema into a new empty database, and runs synthetic fixtures. It constructs a credential-free child environment rather than inheriting database, Clerk or cloud credentials. It does not connect to any existing database or use production records. No dependencies are installed.

The runner intentionally exits nonzero while original suites fail. Do not interpret the separate synthetic-owner result as current Clerk authentication verification.

## Results

Final evidence: `/var/folders/v1/nrrw04y90g3b9s27scm3_f1r0000gn/T/practice-isolated-api-CTRgIw/`, containing `results.json` and five suite logs. A durable summary is checked in as `isolated-api-service-results.json`. The runner records actual Git HEAD, launches suites asynchronously with immediately tracked process groups, terminates descendants on timeouts, and shares SIGINT/SIGTERM cleanup; abrupt host/process death still cannot guarantee cleanup. Interrupt/timeout paths were source-reviewed, not fault-injection tested.

| Suite | Result | Meaning |
| --- | --- | --- |
| Hub, unchanged | 0/13, before-hook failure | `/api/auth/login` returns 401; the current API uses Clerk and no longer implements this legacy password-login route. All 13 bodies are blocked, not 13 separately reproduced product defects. |
| Practice imports | 8/8 | Real import routes and disposable PostgreSQL; synthetic owner/practice middleware already used by this suite. Not authentication coverage. |
| Session-goal persistence | 1/1 | Actual production persistence helpers and PostgreSQL constraints, synthetic records only. |
| Sessions, unchanged with current API | 0/12 | Test requests provide no current authentication; private routes reject them. Does not establish 12 separate session logic defects. |
| Sessions, explicit synthetic-owner adapter | 12/12 | Actual production router and PostgreSQL: validation, idempotency, concurrent writes, revisions/history, team isolation, annual goals, deletion safeguards and share-token lifecycle. Authentication is explicitly substituted only in the verification process. |

The first unchanged import run was 5/8. The consultation-metadata test incorrectly selected the first attendance snapshot from an already-populated practice and left its November package in that same practice. This also changed a later isolation count and made the later November overlap fixture conflict. Giving only that consultation test its own synthetic practice fixes all three failures without changing any assertions or runtime behavior. Earlier raw evidence is retained at `/var/folders/v1/nrrw04y90g3b9s27scm3_f1r0000gn/T/practice-isolated-api-fpA8np/`.

Final cleanup confirms `clusterStopped: true` and `syntheticDatabaseDeleted: true`. The API children exited. No business records, declarations, approval anchors, production schema or production environment were touched.

## Remaining Gates

- A current, authorized Clerk test-authentication fixture is needed to execute the unchanged full Hub suite and authenticate the unchanged Sessions suite. Do not restore a production password bypass or borrow production credentials to make them pass.
- These existing service suites do not independently certify the new historical-provider journal flow against a real export. The candidate's mocked route, isolated SQL, domain and rendered synthetic evidence remain separate scopes.
- Actual forthcoming export headers and deletion-marker semantics remain unverified; real-file acceptance and independent historical monthly reconciliation remain pending.
- No historical candidate merge or deployment occurred. The separate label-only release has cloud-worker-reported acceptance within the frozen January scope, including the final preservation check; that does not certify historical billing or whole-account cash, payroll or profit.
