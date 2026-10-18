# Known Zero Owner Distributions

## Candidate and Release Hold

- Branch: `codex/owner-distribution-known-zero`
- Base: `02591d43e90ab3514ea093514389a91aaf058094`
- Runtime candidate: `520e82932a6eb2c950f131159142a282875bf109`
- Runtime tree: `1419d3684dd506a3e01722e65610f069d26b19f4`
- Local only. No push, deployment, business-data edits, migration, live/private read, backup, or restore performed. Navigation-only main remains the separately coordinated release.

## Bounded Fix

In `lib/practice/src/hub/engine.ts`, a forecast's exactly zero aggregate distributions now implies zero `ownerDistributionsPretax`, even without a household allocation bucket. Positive unattributed distributions still return null. Existing downstream uncertainty guards still override both aggregate and owner amounts to null when compensation, staff costs or collections are unknown. Coverage and historical/future composition remain unchanged; a missing historical segment cannot be replaced by the future zero.

No Goal labels, targets, stored settings, historical ledger amounts, fee calculations, cash totals, or aggregate distributions changed. The calculation trace explains the zero exception. The financial-session-goal regression now recognizes a known zero owner target as available but still withholds a positive unattributed target.

## Verification

- Full `npm test`: **749 passed, zero failed** (four new tests).
- Four focused forecast/goal/composition suites: **55 passed**.
- Dashboard TypeScript no-emit check: passed.
- Dashboard production Vite build: passed with existing sourcemap/mixed-import/large-chunk warnings.
- Whitespace diff check: passed.
- Existing synthetic navigation/access regression: seven states, no browser errors, writes, backup or restore requests.
- New Goal browser regression: six desktop/mobile states at 1280x900 and 390x900, no browser errors or horizontal overflow, no writes or external requests. Actual PracticeWorkspace and Goal rendering with loopback fixture APIs; not a live owner session or production auth test.
- Visually inspected mobile known-zero Goal, desktop positive-unattributed Goal, and mobile missing-coverage page. Target and dated pre-tax captions unchanged. Known zero is `$0`; unavailable estimates remain `--` and do not claim recorded achievement.

The browser fixture intentionally starts with quiet recent history, giving a known zero distribution. Its positive control adds twenty synthetic October treatment shows and a high synthetic fee to establish positive modeled profit despite inherited fixed salary assumptions. Clearing only that isolated fixture's storage between cases avoids retained fixture history. No invented values are submitted to any app.

## Reproduction and Evidence

```sh
node verification/owner-distribution-zero-verification.mjs
```

The comparison script substitutes the base engine source using `git show` while leaving unchanged runtime dependencies shared. Nine scenarios compare every registered output: only the owner metric changes in zero-fallback, reserve-only and non-household-zero cases. Positive household amounts, positive unattributed amounts, unknown staff costs and unknown prior receipts retain their previous meanings. Complete absence of report coverage and mixed historical `0` / `50` / `null` controls also pass. [Numeric results](owner-distribution-zero-results.json) identify the exact candidate and tree.

After a fresh dashboard build, reproduce browser checks using this machine's existing Playwright installation:

```sh
env PRACTICE_PLAYWRIGHT_PACKAGE=/tmp/forge-reviewed-da6f1d2c-stage/package.json PRACTICE_RENDER_OUTPUT=/tmp/owner-zero-goals node verification/owner-distribution-zero-render.mjs
```

[Browser results](owner-distribution-zero-evidence/results.json), [mobile zero](owner-distribution-zero-evidence/owner-known-zero-detail-390.png), [desktop positive unattributed](owner-distribution-zero-evidence/owner-positive-unattributed-detail-1280.png), and [mobile missing coverage](owner-distribution-zero-evidence/owner-missing-coverage-390.png).

## Independent Review

Reviewer **Kant**, agent `01a14c65-3b94-73b0-998d-d99c9a5900c4`, confirmed the exact runtime candidate/tree against the base: **no findings or review blockers**. Independently reran all 55 focused tests and the full unit suite, ten additional synthetic controls, and the nine-scenario comparison script. Confirmed all other registered values match the base and existing uncertainty guards preserve null. Reviewer did not independently rerun TypeScript, build or browser checks; no production data accessed and no edits made. Review is of code/synthetic correctness, not certification of the live October Goal or real business values.

Reviewer subsequently inspected the supplemental browser harness and saved six-state results: no additional findings, positive-profit fixture assertion confirmed, same exact runtime commit/tree reconfirmed. Browser execution was not independently repeated.

The live October Goal can still correctly show `--` if another historical or future segment lacks coverage or attribution. This fix removes one independently reproducible zero-handling defect; it does not fill missing model data or relabel estimated progress as recorded achievement. Parent coordination is required before any push or deployment.
