# Isolated API Service Verification

Runtime candidate: `58949e42c294dae368820f2fe21341156ed0067a`, with frozen runtime `42c4b33b6826ceb36da54606e7e4639b53147d28`. Only verification tooling and one test fixture changed during this check. Historical billing remains on `codex/historical-billing-only`, separate from main and production.

## Reproduce

Run `node verification/run-isolated-api-tests.mjs` from the repository. Requires installed PostgreSQL tools (`initdb`, `pg_ctl`, `psql`, `pg_dump`), Node, corepack/pnpm and the existing dependencies. The script creates a new temporary PostgreSQL cluster listening only on loopback, pushes the checked-in Drizzle schema into a new empty database, and runs synthetic fixtures. It constructs a credential-free child environment rather than inheriting database, Clerk or cloud credentials. It does not connect to any existing database or use production records. No dependencies are installed.

The current runner uses fresh offline RSA-signed Clerk session fixtures against the actual built API. It does not replace Clerk middleware or `requireAccess`, and no synthetic-owner adapter remains. It exits nonzero on any suite failure. Earlier adapter results below remain historical evidence only.

## Current Auth Verification

All four service suites now pass: Hub **16/16**, imports **8/8**, session-goal persistence **1/1**, authenticated Sessions **12/12** (37 total). Evidence: `/var/folders/v1/nrrw04y90g3b9s27scm3_f1r0000gn/T/practice-isolated-api-17Sz6z/`; the durable JSON summary is `isolated-api-service-results.json`.

`test/synthetic-clerk.mjs` generates a new 2048-bit RSA keypair in memory. Only its public key reaches the disposable API through the installed SDK's supported `CLERK_JWT_KEY` environment setting. Tokens are signed RS256 sessions, not fabricated request auth objects. Fixture issuer/publishable-key host ends in `.invalid`, the secret is explicitly fake, telemetry is disabled, and unexpected remote-user lookups target loopback port 1 rather than Clerk. The actual app, Clerk token verification, authorization middleware, database invitation lookup, role/origin policy and route handlers run unchanged.

The obsolete `/auth/login` and password-cookie assumptions are replaced with signed bearer sessions. All 13 preexisting Hub behavior tests run, including audit attribution, restricted data entry, foreign-origin rejection and backup/recovery against disposable data. Three added tests exercise malformed/wrong-key/expired/not-yet-valid/pending sessions, unsigned private access, spoofed synthetic headers, owner-email normalization, a signed uninvited second owner, invitation/disabled access, and missing/foreign origins without mutation. Invited owners intentionally share the single-practice Hub; this is not a claim of multi-tenant Hub isolation. Sessions now supplies a fresh fixture bearer token and actual app origin, and explicitly verifies unsigned rejection first.

Independent reviewer Newton reported no blocking findings: actual Clerk/app boundaries are exercised, private keys remain in memory, and supplied evidence records successful cleanup. Review was source inspection and syntax validation, not an independent repeat of the service run.

Remaining authentication scope: browser cookie transport, hosted login/proxy/refresh, real issuer/key configuration, remote email lookup and Clerk-side revocation are not certified by these offline bearer fixtures. No real credentials, production records, runtime changes, merge or deployment were used. Abrupt process death and signal/timeout cleanup paths retain the earlier documented limits.

## Prior Baseline Results

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

- The former auth-fixture blocker is resolved for offline bearer-session verification above. Hosted/cookie/remote Clerk behavior remains outside this check; no production password bypass was added.
- These existing service suites do not independently certify the new historical-provider journal flow against a real export. The candidate's mocked route, isolated SQL, domain and rendered synthetic evidence remain separate scopes.
- Actual forthcoming export headers and deletion-marker semantics remain unverified; real-file acceptance and independent historical monthly reconciliation remain pending.
- No historical candidate merge or deployment occurred. The separate label-only release has cloud-worker-reported acceptance within the frozen January scope, including the final preservation check; that does not certify historical billing or whole-account cash, payroll or profit.
