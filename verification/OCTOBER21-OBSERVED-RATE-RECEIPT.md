# Observed close-rate presentation correction

Base: ac97f05629a2259adf7000410e8114f3b927e929.
Expected publisher: 8b9ca3095326d60ae3f99f7b53a666b54b89f749,
tree 98d1387e002344aa4be7814abed770f403ee8d10.

## Scope

The shared metric now exposes observedConversionRate = 100 * converted / evaluated
when evaluated is positive, otherwise null. Overview, Sessions (selected and historical),
Team, practice benchmarks and differences consistently display Observed close rate.
Evaluated counts, unresolved cases, referrals and completeness status remain separate.
The existing completeness-gated conversionRate and every outcome classification,
cohort, referral exclusion, source-admission rule and retention calculation are unchanged.
No schema, persistence, configuration, migration, import or business-record changes.

Parent-supplied current aggregates imply 28/34 = 82.4% observed for July-September,
with 3 unresolved and 1 excluded referral; annual 116/145 = 80.0%, with 5 unresolved
and 2 excluded referrals. These are aggregate arithmetic checks, not a local raw-record
replay or an assertion that the entire cohort is resolved. Live verification is still due.

## Validation

- Canonical pure suite: 1,122/1,122, no failures or skips.
- Dashboard and API TypeScript checks passed; web and API builds passed.
- Practical synthetic browser acceptance: 24/24 at 1280, 390 and 320px.
  Fixture: 2 closes, 1 miss, 1 mature unresolved, 1 referral; observed 66.7%,
  unchanged completeness-gated rate null. All three views agree. Erin zero evaluated
  remains Unknown. Future full appointment counts without attendance. No writes,
  external requests or browser errors. Results:
  /tmp/practice-oct21-live-call-o33YOK/same-clinician-results.json.
- Existing coordinated workspace synthetic browser acceptance: 26/26 at
  1280, 900, 390 and 320px, including mocked budget/layout persistence;
  /tmp/practice-oct21-live-call-VHjeXU/second-results.json.
- Independent reviewer Banach: no source or representative-render defects;
  independently ran 91 focused tests and checked 320px screenshots. A stale
  source-wiring assertion was corrected, followed by the full passing suite.
- Test log: /tmp/practice-observed-rate-tests.log; web build log:
  /tmp/practice-observed-rate-build.log.

## Reproduction

From repository root:

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts verification/profit-first-planning-input.test.mjs
node node_modules/typescript/bin/tsc -p artifacts/comp-dashboard/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p artifacts/api-server/tsconfig.json --noEmit
node verification/october21-same-clinician-close-acceptance.mjs
```

Web artifact: PORT=23894 BASE_PATH=/ node node_modules/vite/bin/vite.js build
(artifact working directory). API artifact: node build.mjs (API working directory).
On Replit use its established pnpm artifact build contract; preserve injected public
production environment and keep copy-development-database OFF.

## Release and remaining acceptance

Use the accompanying guarded integration helper after fetching the established branch.
It checks publisher identity, clean tree, all affected preimages, candidate identity,
patch hash, unchanged paths and a rollback reference before applying to the index.
Run checks, then make a normal descendant commit of the publisher; do not reset,
cherry-pick over divergent history, migrate, seed, or publish test data.

After one existing-environment publication, verify live source/assets, Overview,
Sessions and Team observed rates/counts at identical dates/scope, zero-evaluated
Unknown, separate unresolved/referral status, retention unchanged and import metadata
preserved. Native macOS/VoiceOver and live publication remain parent-coordinated,
not claimed by this local receipt.
