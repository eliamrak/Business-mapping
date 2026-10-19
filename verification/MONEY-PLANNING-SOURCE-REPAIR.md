# Today Money Planning Source Repair

## Diagnosis

The parent reported an authenticated read-only live check: six clinician observed averages were available, but Money's top planning fields were Unknown and its source month remained September. The selected-date historical/forward estimate below it was populated. Those production values are parent-provided observations, not locally certified totals.

The planner called general `forecast(moneyFlowWorkspace, modelContext)` rather than the observed projection path. It omitted both the proven per-clinician pace map and `useImportedBillingActuals:false`. Imported fee ambiguity or rejected whole-day replacements could therefore null revenue and compensation, cascading to employer costs, owner clinical pay and processing. Missing baseline alone does not explain all these nulls. Matching a partial summary date against raw month starts could also fail and select the stale stored forecast start.

## Narrow Repair

Runtime `686ac859827358cec939cd0003b6d5c6ed1f3d06`, tree `fdee7c15ff4a4565552efe11bac8c12595fc8d77`:

- New `moneyPlanningForecast` uses existing complete-period observed-projection rules, then forecasts the full current calendar month with the resulting clinician pace map, working-forecast semantics and imported billing replacement disabled.
- The current-month scenario is explicitly labeled. It is neither a historical billed-charge report nor paid payroll, bank cash or completed-goal evidence. Selected-date reports and their actual/forecast boundary are unchanged.
- Existing dated compensation, budgets, processing and employer costs remain in the engine. Sandbox/Long Term Goals drafts retain their existing forecast behavior. Annual overhead, inherited owner-target exclusion, protected salary and explicit saved overrides remain separate and unchanged.
- Missing common activity proof still withholds the forecast; desired session cards do not fill the gap. Quiet fully covered clinicians remain zero. Observed clinician basis and forecast warnings are exposed in a collapsed disclosure.
- No engine equations, persistence schema, source facts, imports, approval metadata or business records changed. No migration/backfill is needed. Backout to the preceding compatible release preserves optional `moneyPlanning` and saved plans.

## Verification

- `npm test`:792 passed. Selected API preservation suites:133 passed. Dashboard typecheck and dashboard/API builds passed, with existing Vite advisories only.
- Three new tests reproduce six synthetic clinicians with observed pace, stale September settings and ambiguous imported fees. The raw forecast is Unknown; the repaired full October scenario has the expected numeric revenue/payroll/fees. Missing one provider's proof remains Unknown; covered zero and source immutability pass.
- Independent read-only review:53/53 tests, plus delayed-collection and partial-salary controls; no actionable blocker. Missing opening cap contribution retains the engine's existing assume-zero warning and does not certify actual cap position.
- Actual workspace browser: six desktop/mobile captures at1280/390px. Overview recognizes all six observed averages; Money displays expected synthetic October income53320 and populated pay/fee inputs after navigation and reload; custom activity dates do not alter the monthly scenario. Removing one provider's proof restores Unknown. Zero browser errors, zero API writes, no page overflow. Evidence: `money-planning-source-render/results.json`.
- Broader14-state workspace acceptance also passes with an explicit observed-attendance fixture: persisted goals and over100% floors, owner-budget preservation, Sandbox isolation, historical controls and clinical navigation. Evidence: `money-planning-source-broad-results.json`.

These fixtures do not infer or certify the parent's live35185/20872 selected-period estimates. Their units, dates and basis differ from a full current-month planning scenario. Existing-environment publication, preservation comparisons and authenticated live owner verification remain separate release evidence.
