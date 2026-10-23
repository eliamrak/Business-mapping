# Financial Budget Independent Review

**Accepted for the bounded dated-Budget planning correction. No blocking finding
identified.** Reviewed against `0e69b86842f1216f9accc1f911218f96d75d1f2d` on
`codex/financial-fixed-date-20261023`. This is a review of a synthetic local
planning calculation, not validation of real financial records or publication.

## Numerical Finding And Correction

The reported double proration is confirmed by the implementation and deterministic
October tests. An active October 16-31 clinician produces 16 modeled sessions and
$1,600 of modeled billed revenue. A $10/session Budget line and 10% revenue line
already accrue to $160 each in the daily forecast. Applying the 16/31 active-month
fraction to those monthly session/revenue totals again yielded $165.16129032 rather
than $320. The reviewed fix reuses the matching dated per-line forecast amounts.

Configured processor costs remain $48 percentage fees plus $4.80 transaction fees.
The corrected Operating expenses need is $372.80, rendered as $373; the old
incorrect value rounded to $218. Modeled clinician pay remains $960 and modeled
profit $267.20. These are estimates of billed/planning activity, not bank cash,
collections, invoices or tax filings.

An independently authored probe uses different rates: $15/session plus 12.5% of
$1,600 produces $240 + $200 = $440. It executes the real forecast and planner,
verifies the untouched input graph after calculation, detects stale Budget amount
changes, verifies source-array/item detachment and confirms unrelated event
metadata does not change costs/payroll. No application source was edited by this
reviewer.

## Guard And Data Semantics

- The optional `estimatedBudgetMonth` is an in-memory function/component input,
  not a Workspace schema field or persisted setting. The workspace passes it only
  at the reviewed Today Money and Goals Budget-backed planning call sites.
- Reuse requires matching forecast/month boundaries, source Budget ID and amount,
  cadence, start/end, category, archived and planning-only fields. Enabled
  `budget.amount` events for the line must match; per-session/revenue cadences
  additionally require their corresponding monthly volume to match the effective
  planning inputs, including saved overrides.
- A matching own per-line value of zero remains zero. Missing/null/nonfinite/
  negative amounts cannot certify a known cost. Missing volume remains Unknown.
  A stale/missing basis for a partial-month variable line or dated amount-event
  line yields Unknown and an explanatory reason instead of guessed proration.
- Event-free full-month variable costs and ordinary fixed cadence lines retain
  their existing fallback calculation. Fixed-date tests cover fresh edits,
  month/period mismatches, missing lines, volume changes, dated price changes,
  quarterly/annual accruals, zero/unknown distinctions and missing tax planning.
- Original Budget and event arrays and their objects are cloned. Changing live
  Budget amounts or unrelated event metadata does not change the stored basis.
  `budgetEstimate.month` intentionally shares the function's returned `months[0]`;
  it is newly computed output, not an alias to persisted workspace/context input.
  No current caller mutation was found. This is not a deep-frozen or independently
  immutable copy of all returned forecast output; no such claim is made.
- Scenario mode does not consume the dated Budget basis. No clinician-cap,
  payroll, fee, campaign, event execution or forecast engine implementation was
  changed. Existing salary protections and import isolation pass their tests;
  fixed-date salary testing confirms the configured salary is counted once and
  imported billed charges do not rewrite planning revenue or processor costs.

The basis is an internal forecast result, not a security validator or provenance
proof for arbitrary externally supplied data. Comparing relevant event arrays
conservatively invalidates reordered/changed event metadata; safety falls back to
Unknown where daily reconstruction is required. That behavior does not create a
false known cost.

## Source Boundaries

The independent workspace guard now removes only two exact anchored new prop
lines before applying the existing literal mobile restoration. The remaining
workspace still must reproduce approved `72dc5fb` bytes and the unchanged older
Tidal history chain. Negative probes reject modified financial props, appended
unrelated logic and prior navigation/tool-handler mutations. Original mobile CSS,
modal, contributor, focus-disclosure and destination checks remain in place.

The cumulative gates add only these financial paths:

- `artifacts/comp-dashboard/src/pages/practice-workspace.tsx`
- `artifacts/comp-dashboard/src/lib/profit-first-planning.ts`
- `artifacts/comp-dashboard/src/lib/money-planning-forecast.ts`
- `artifacts/comp-dashboard/src/lib/financial-fixed-date.test.ts`
- `verification/FINANCIAL-BUDGET-INDEPENDENT-REVIEW.md`
- `verification/OCTOBER23-FINANCIAL-BASELINE-RECEIPT.md`

The two library diffs were reviewed directly: optional input type and guarded
per-line consumption in the planner, and the one-line returned forecast basis.
No blanket library, API or core exemption was added. Negative path probes reject
another financial module and the core forecast engine. The exact three readiness
hashes and two publisher-memory paths are unchanged; the separate publisher
pre/post preservation guard still protects all five established files.

## Verification And Limits

The new final fixed-date test was inspected: it transpiles the actual React
planning component in memory, uses the real planner and real React server
rendering, and asserts the Operating expenses row contains $373 rather than $218.
Popover/unsaved hooks are explicit stubs. Its saving callback throws if invoked,
and the original input graph must remain unchanged. This is useful output-wiring
evidence, not DOM interaction, browser geometry or dirty-form acceptance.

Independent final command:

```sh
node --test verification/mobile-shell.test.mjs verification/tidal-theme.test.mjs artifacts/comp-dashboard/src/lib/financial-fixed-date.test.ts artifacts/comp-dashboard/src/lib/money-planning-forecast.test.ts artifacts/comp-dashboard/src/lib/profit-first-planning.test.ts artifacts/comp-dashboard/src/lib/unsaved-navigation.test.ts
git diff --check
```

Final result: **90/90 tests passed; no failures, skips or expected failures.**
This includes 10 fixed-date cases (including actual-component SSR), 45 existing
forecast/planning cases, 11 mobile/scope/independent financial tests, 21 retained
Tidal checks and three existing unsaved-navigation cases. `git diff --check`
passes. Ordinary fixed monthly and dated annual/quarterly controls, explicit
tax-null behavior, salary counted once and non-Budget/scenario behavior pass.
The owner separately reported
146 broader financial tests and UI typechecking passing; those broader runs are
not independently claimed here. No browser, production service, real-data source,
publication, persistence or authentication operation was run by this reviewer.
This new financial review does not repeat or extend the earlier mobile screenshot
parity claims to the corrected Money/Goals numeric output.

## Reviewed Runtime SHA-256

```text
profit-first-planning.ts   c81145aa58a3a46813f73b42ef5d9ac6451b008983b263e8fba754e5d92e3039
money-planning-forecast.ts e8d318eaddd64779192d63ed76743f45b664247eccf638b295cd4f7d2e4a2eb4
practice-workspace.tsx     184aecc109c15aebe7c8b353e2963a4a318c66eb9c8c2019abf514866e0c4aeb
```

These identify the reviewed concurrent source snapshot. Rerun the gates before
freezing a later source revision.
