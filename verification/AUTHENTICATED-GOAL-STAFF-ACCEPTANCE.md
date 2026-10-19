# Annual Goal and Staff Save Acceptance

## October 19 Native Verification

The native PostgreSQL gap in this historical record is now closed for the covered save paths on release `f9a9bb9`. Reviewed tooling `1d25b28` ran the established assertions against disposable native PostgreSQL 16.10 in Replit: nine groups passed, revision 7 and all seven audit/history rows survived the API and database restart, and eight screenshots had no browser errors or overflow. The four gated native suites also passed 40 tests. See `NATIVE-POSTGRES-ACCEPTANCE.md` and `native-postgres-results.json` for exact hashes, the repaired test-pool identity defect, cleanup and limits. No production record or publication changed. The earlier PGlite evidence below retains its original method and bounds; it is not relabeled as native evidence.

## Candidate and Bounds

- Branch: `codex/authenticated-goal-staff-acceptance`.
- Runtime/test candidate: `c42ea46ab50fd98604afed4ad12cad1f600c3ee6`.
- Tree: `4d4bdffc14e8f277d8a029e1f56333c68258a79f`.
- Final test-hardening candidate: `dea1d592f467940871f5172ccd6127d32ba6ba2b`, tree `f3d51b8a0a9f50b7f5f6a34eae7782e1dad44add`. Runtime/UI is identical; guards refuse reused database paths and check all tracked build inputs.
- Base: released-source candidate `68ef208494e3856021c3015d63daf5be084c7afa`; test-only setup commit `b22b60f` precedes the scoped UI correction.
- Local only: no push, deployment, production connection, business-record edits, real client data, account invitation/access grant, bank/payroll record request, import or restore.

Existing evidence was read first. `INTERACTIVE-WORKFLOW-ACCEPTANCE.md` checks leads/imports/recovery with fixture transport. `staff-configuration-render.mjs` checks roster/pay displays with mocked endpoints. Neither established these annual-goal and staff-rate/timing saves through server authorization and durable SQL. The checks below are new and bounded.

## Environment

Native PostgreSQL 16 `initdb` failed before creating a usable cluster: host System V shared-memory allocation was exhausted (`shmget`, 56 bytes, "No space left on device"). No kernel settings or other processes/resources were changed. No production database or schema dump was used.

Fallback: temporary **PGlite 0.5.10 / PostgreSQL 18.6 WASM**, filesystem-backed under `/tmp`, with **pglite-socket 0.2.13** bound only to loopback. The API uses its unchanged `pg` pool, Drizzle schema/routes and transactions over the PostgreSQL wire protocol. Schema was generated from this repository's Drizzle definitions into the fresh synthetic database. This is not an in-memory endpoint replacement or mocked SQL query implementation.

The actual Clerk Express middleware and `requireAccess` verify fresh locally signed RS256 JWTs using the existing synthetic-Clerk test fixture. Only the disposable API process trusts that public key; no external accounts or invited-user rows are created. The API environment is whitelisted, with synthetic owner/practice identity and remote Clerk lookup redirected to an unavailable loopback address. The real `Access`, `PracticeWorkspace`, `customFetch`, review/save and inline staff controls are mounted. Frontend Clerk identity hooks are fixture presentation, and the browser supplies the locally signed Bearer token. **Google OAuth, Clerk frontend/session issuance, production cookie/session behavior and real owner-account acceptance are not tested.**

App/browser requests stay on loopback; public registry package installation was test-runtime setup only. Test dependencies are outside the repository and are not production dependencies. PGlite's single-backend/multiplexed socket behavior does not certify native PostgreSQL concurrency, lock contention, recovery or version compatibility. See the [PGlite documentation](https://pglite.dev/docs/) and [socket architecture/limitations](https://pglite.dev/docs/pglite-socket).

## New Checks

| Path | Executed Result |
| --- | --- |
| Server authorization | Missing/invalid JWT returns 401; valid but uninvited synthetic identity returns 403; configured synthetic owner returns 200. Actual unauthorized POSTs cannot advance workspace revision or audit. Wrong-origin POST returns 403. |
| Annual Goal | Today Goals: edit owner target from synthetic 120000 to 144000, keep Annual, Review changes, Save changes, reload. SQL/API retain `amount:144000,basis:annual`; UI goal line is $12,000 monthly. Legacy business-goal target remains unchanged. Missing financial coverage remains `--`, not fabricated actual progress. |
| Staff annual defaults | Money > Edit dated money sources > Support staff pay: save hourly22 and hours12 for All2026, reload. Exactly one Jan1-Dec31 term holds those fields. Original staff-table rate18/hours10/weeks48 remain unchanged. |
| Staff dated override | Save hourly24 starting Oct16, reload, explicitly select that date. Two terms only. Oct15 uses22; Oct16 uses24 and inherits12hours from the annual default. No legacy staff-row mutation. |
| Scope regression | After a dated override exists, choose annual scope: field must show its own22 rather than24. Save annual24 even though24 equals the other scope's value; it must not be suppressed as unchanged. Then save annual26 and reload: annual field26, Oct16 field24, two independent terms. |
| SQL and history | SQL workspace JSON equals API snapshot. Seven exact revisions/audit rows, all attributed to the verified synthetic owner, for fixture setup plus six real UI saves. Stale revision409 preserves saved data and adds no history. |
| Durable restart | Terminate the API child process, close the embedded SQL instance and storage, reopen the same filesystem database in a fresh SQL instance, launch a new API process, reload the UI. Goal, basis, both rate terms, original staff row, audit and revision all survive. |
| Rendering | Eight 1280/390 captures, no browser exceptions or horizontal document overflow. Author inspected annual Goal mobile, dated staff mobile and annual-scope-after-restart desktop screenshots. |

Final run: **9 check groups, revision7, 7 audit rows, 6 successful UI POSTs, 8 captures, zero browser exceptions**. [Machine results and exact build digest](authenticated-save-evidence/results.json).

## Real Bug and Narrow Fix

Independent source review and the authenticated baseline run reproduced a pre-existing scope mismatch. With annual22 plus Oct16 override24, the selector resets to annual after reload but the field read `staffMemberAt(flowHorizonDate)`, showing24. Saving targets the annual term instead. Entering24 is incorrectly suppressed by `InlineNumber`'s unchanged-value guard, so the annual default cannot be changed to that value. Baseline regression failed with **expected22, actual24** in `/tmp/practice-staff-scope-before.log`; it ran the unchanged base runtime with the extended test assertions, not the repaired runtime.

`staffPayAtEditScope` now reads the scope that `patchStaff` will save: annual/default Jan1-Dec31 or the explicitly selected date. Annual editing excludes same-year dated exceptions, including a Jan1 exception, while preserving earlier inherited terms. Dated editing uses the existing dated resolver. Four new pure tests cover annual/date values, Jan1 exceptions, missing/earlier defaults, salary/hours and source immutability. The component uses this helper only for editor fields.

No payroll equations, forecast values, effective-term precedence, persistence schema, backend authorization, source staff rows or timing labels changed. The selector is a **next-edit scope**, not a persisted preference; after reload the test explicitly selects a date to inspect its saved override. No claim is made that the selector remembers the previous choice.

## Verification and Reproduction

- Full domain/dashboard suite: **753 passed** (749 existing plus4 new scope tests).
- Dashboard TypeScript: passed.
- API TypeScript: passed.
- API and dashboard builds: freshly rebuilt by every acceptance run; existing Vite sourcemap/mixed-import/large-chunk advisories remain.
- Harness refuses uncommitted runtime changes and records candidate/tree plus API bundle SHA-256, preventing stale-bundle attribution.
- Original harness review findings were repaired: exact fresh-build provenance and explicit complete audit-row/revision checks, not vacuous `every()` assertions.
- Socket adapter shutdown needs a short detach-callback drain before closing its WASM instance. This is test infrastructure, not an app defect. Initial connection-string and numbered-nav locator mistakes were also corrected as harness issues, not reported as product bugs.

Using existing dependencies in this local test environment:

```sh
env PRACTICE_ACCEPTANCE_RUNTIME=/tmp/practice-auth-persistence-4neqcH/runtime node verification/authenticated-goal-staff-acceptance.mjs
```

On another isolated machine, install `@electric-sql/pglite@0.5.10` and `@electric-sql/pglite-socket@0.2.13` into a fresh `/tmp/.../runtime` directory and set that path. Playwright runtime/executable paths can be supplied with `PRACTICE_PLAYWRIGHT_PACKAGE` and `PRACTICE_BROWSER_PATH`. All synthetic database files and captures go to a newly generated `/tmp/practice-auth-saves-*`; existing database paths are refused. Final author output: `/tmp/practice-auth-saves-1BGYBF/`.

## Independent Review

Reviewer **Kierkegaard**, agent `01a15066-19dd-7040-80f6-1b491ee170fd`, independently identified the real staff read/write-scope bug and reviewed the narrow repair. Exact runtime/test commit `c42ea46` and tree above were confirmed: **no blockers**. Reviewer inspected the complete nine-check/seven-audit/eight-capture run, not an independent execution. Both original harness findings (stale build attribution and potentially empty audit checks) are closed.

Reviewer also confirmed exact final `dea1d59` test-hardening commit/tree, no blocking findings, runtime/UI identical to reviewed `c42ea46`. The author subsequently reran it successfully with the same nine check groups, revision7/audit7, eight captures and zero browser errors; final results identify `dea1d59`. Native PostgreSQL and external-provider sign-in were not claimed by either review. No production access, edits, push or deployment by the reviewer.

## Release Boundary

This closes the previously missing **synthetic-JWT-authenticated, durable embedded-SQL** exercise for the stated annual-goal and staff paths, and repairs the reproduced scope editor failure. Real external-provider sign-in, production owner writes and native server-PostgreSQL acceptance remain unverified here. None requires the owner to perform technical QA, repeat imports or supply financial records. No new SEO/Ads or product scope is included. Release coordination and live verification remain separate; no push/deployment occurred.
