# Bounded Startup Performance Follow-Up

This is a local reviewed candidate, not a new publication. It follows reviewed source/receipt `1d08466fd11b5422eca8ed8078203abe69d6d220`. The existing live publisher has the same application source, with its two retained memory files and publication bookkeeping history preserved separately.

## Changes

- Reuse already-prepared attrition evidence for the exact practice/clinician and requested window. Each mature portion still prepares evidence for its own shortened window. No formula, scope, source admission, maturity, null handling or ending rule changes.
- Defer historical compensation-per-session work until a Team card requests that clinician. A reader-scoped map caches results for unchanged immutable report inputs; existing React memo dependencies replace the reader when those inputs change. No global cache or semantic state is introduced. The original earnings calculator body remains byte-identical.

## Verification

- All984 root/domain/handler tests pass, zero failures/skips; `/tmp/practice-oct21-startup-regression.tap`.
- Dashboard types and production build pass; `/tmp/practice-oct21-startup-build.log`. Existing sourcemap/mixed-import/chunk warnings remain.
- Independent review accepts the exact five modified files: `OCTOBER21-STARTUP-PERFORMANCE-REVIEW.md`. Reviewer ran52 focused tests,1200 frozen-baseline attrition comparisons and31 earnings parity/cache controls. No correctness blocker found.
- Same full-component synthetic fixture:4823 attendance and3681 billing facts plus four overlapping older sources, for6423/4881 raw rows across six snapshots; six selected providers in a36-row copied-team roster and107 manual records. No owner data, authenticated service or production writes.
- Frozen before: `/tmp/practice-full-scale-BBboZM/results.json`; after: `/tmp/practice-full-scale-wwJsNz/results.json`. Exact rendered body text matches for initial Overview, Money, Sessions, Team and return Overview. All source fixture objects remain unchanged; zero writes/external requests/browser exceptions.
- `/tmp/practice-startup-before-after-parity.json` retains display-text SHA256s and verified comparisons. There are zero earnings calls before Team; six calls after two Team visits; the second Team visit takes461ms and reuses the cache. Instrumented workspace and historical function counts do not change during the idle interval.

## Measured Trade-Off

| Same-fixture measurement | Before | After |
| --- | ---: | ---: |
| Largest startup workspace render |5184ms|3943ms|
| Loaded Overview, including1500ms settle interval |7133ms|5883ms|
| First Team navigation, including200ms settle |487ms|1221ms|
| Second Team navigation, including200ms settle |473ms|461ms|
| Attrition instrumented total at readiness |1218ms|792ms|

The startup render improves23.9% in this paired run; loaded-Overview elapsed time improves17.5%. Earnings work is deferred to first Team navigation, not eliminated. Substantial synchronous startup work remains, and this single-machine fixture does not establish the cause or resolution of every observed8-40second live wait.

The reusable local harness is `startup-performance-render.mjs`. Use `PRACTICE_SCALE_REF=1d08466fd11b5422eca8ed8078203abe69d6d220 node verification/startup-performance-render.mjs` for frozen before-source and omit the variable for current-source. It needs the existing isolated Playwright/Chrome setup. `__perfCalls.PracticeWorkspace` measures function renders; production React Profiler commit callbacks are disabled, so zero `commits` is not used as evidence. Numeric/DOM parity and idle conclusions use the rendered text and instrumented function counts.

Earlier attempts are retained: a synthetic non-null location triggered the pre-existing room-review flow rather than Overview readiness; after fixing that fixture, a separate pre-October19 source comparison measured2823ms main-thread work but its navigation check failed due mixed-version CSS pointer interception. Neither failed harness is presented as an app hang or a passed navigation test. No live repair is inferred from those failures.

## Release Limits

Apply only this follow-up delta to the current publisher source, retaining its parent history, memory files, artifact configuration, deployment URL, credentials and data. No schema migration, import approval, source/goal/pay rewrite or new spending is needed. Re-run the integrated types/tests/build, retain fingerprints and publish only through the existing environment after the parent's readiness decision. The historical4/43 investigation, wider performance goals and macOS acceptance remain separately reported.
