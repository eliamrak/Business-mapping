# Practice cloud development handoff

Established repository: `eliamrak/Business-mapping`, remote `github`. Reviewed base `1a46ec5a1e15bd2823adea95a04a01ca20ad7783`; current work branch `codex/next-reporting-period`. Use the frozen candidate hash supplied with the release response, not a moving branch tip.

## Preservation

The Replit publisher has additional legitimate history and accepted mobile-readiness files. Fetch the established remote, inspect its clean HEAD/tree, and apply only the reviewed base-to-candidate delta after every touched-file preimage matches the base. Make a rollback branch and normal descendant commit. Stop on mismatches; do not force-reset, overwrite unrelated files, change artifact contracts or copy the development database. This release requires no migration or data seed. Agent tests must never upload real packages or confirm real source declarations.

Private import evidence, client reports, local mapping/state files, credentials and native application bundles are not cloud fixtures and must not be added to Git. The native AppKit Converter project remains separate and requires Mac tooling; do not substitute an older parser from this web repository.

## Exact database-free acceptance commands

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts verification/profit-first-planning-input.test.mjs verification/lazy-pdf-export.test.mjs verification/tpa-icons.test.mjs
node --test artifacts/api-server/test/import-overlap-reconciliation.test.mjs artifacts/api-server/test/practice-retain-overlap.test.mjs artifacts/api-server/test/practice-report-coverage.test.mjs artifacts/api-server/test/practice-import-declarations.test.mjs artifacts/api-server/test/practice-import-coverage-confirmation.test.mjs artifacts/api-server/test/practice-next-report-period.test.mjs
node --test verification/tidal-theme.test.mjs verification/lazy-pdf-export.test.mjs verification/mobile-readiness.test.cjs verification/tpa-icons.test.mjs
pnpm run typecheck:libs
pnpm --filter @workspace/comp-dashboard run typecheck
pnpm --filter @workspace/api-server run typecheck
PORT=23894 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/comp-dashboard run build
NODE_ENV=production pnpm --filter @workspace/api-server run build
```

Expected functional/API counts after the deterministic duration follow-up: 1,215 / 77. The third command includes the separately accepted publisher mobile files; this source branch locally tests the other three suites. Do not use a broad API integration command requiring disposable database fixtures against the existing environment.

Mounted UI harness: `node verification/next-period-render.mjs`, 14 checks. It needs Playwright/Chromium and local dependency/assets paths documented in its source; these are environment prerequisites, not permission to download client records. The current Mac evidence is recorded in the adjacent results JSON.

## Existing hosting contract

Keep API production port 8080, `node --enable-source-maps artifacts/api-server/dist/index.mjs`, the existing router/application multi-artifact contracts, web static `artifacts/comp-dashboard/dist/public` and SPA fallback. The explicit dashboard build PORT/BASE_PATH reproduce the current artifact build without changing its injected production environment. Preserve mobile readiness and development-database-copy OFF. One publisher owns publication; no competing deploys or paid Agent invocation.

After terminal success independently verify public JS graph/CSS/art/icons and API/mobile health/manifests, then owner Data read-only. Public authentication compile-time values can change generated JS filenames/bytes; reconcile using served public values rather than assuming an identical local test-key bundle. Never extract credentials or session cookies. Follow actual code provenance and preserved source tree, not content markers alone.

Current-period reconciliation is an explicit owner operation, not a publication test. Preserve raw history, prior declarations, configuration revision, billing journal and source approvals. Report source/test, publication, live read-only evidence and remaining native/device limitations separately.
