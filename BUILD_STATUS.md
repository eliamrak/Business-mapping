# Business Hub Build Status

Checkpoint: 2026-09-20. Working local implementation in all eight areas.
This is a development preview, not a production release or a claim that every
advanced item in EXPANSION_PLAN.md is finished.

## Implemented

- Overview: recorded position, forecast, goals, custom metrics, calculation
  basis, data coverage, observed and forecast decision signals.
- Practice: operating roster, dated compensation, locations, shared rooms with
  weekly schedules, telehealth limits, preserved compensation tools.
- Sessions: flexible dates/columns, scheduled/completed/desired counts,
  cancellations, no-shows, in-person/telehealth, attendance, reviewed corrections,
  source-document links, actor and immutable revision history.
- Finances: editable categories/tags, hierarchical category subtotals, recurring
  and variable budgets, actual expense lines, owner payroll, allocations,
  reserves, family cash flow and coverage-aware budget variance.
- Growth: CPL, CAC, click funnel, historical yield, manual and validated custom
  estimation; funnel actuals; hiring costs/ramp; pay-affordability calculation;
  campaign contribution LTV/payback using forecast, historical or manual costs.
- Plans: 1-60-month forecast, dated events, goals, saved configurable goal
  searches over hiring mixes, start dates, rooms and campaign spend. Searches
  use the shared forecast, run in a worker and draft reviewable sandbox changes.
  CSV export and preserved legacy scenarios/comparisons/growth plans remain.
- Sandbox: layered proposals, individual/combined changes, acquisition cases,
  connected deltas, cash requirement/recovery, simulated rule dates,
  dependencies, reviewed partial approval, immutable approval baseline,
  actual-versus-expected comparison, campaign-specific recorded outcomes,
  initiative lifecycle history and explicit unsaved-draft discard.
- Updates: biweekly/custom periods, review/finalization, correction reasons,
  original attachments, CSV/XLSX mapping and confirmation, reusable mappings,
  import templates, audit history, selectable management PDF reports, hub JSON
  export and owner-only business-data backup/recovery into an empty app.
- Settings: nested AND/OR rules, selected-clinician scopes, prior-period/goal
  comparisons, metric/budget/forecast comparisons, rolling windows, trends,
  date bounds, consecutive periods, multiple reviewable responses, custom KPIs
  with effective-dated definitions, shared assumptions,
  appearance/density/text preferences, owner and restricted entry access.
- Backend: revision guards, idempotent writes, protected management APIs,
  fail-closed authentication, local-only fictional preview bypass, actor history.

## Verified

- 65 unit/model/PDF tests; exact legacy calculation parity over 864 input cases.
- 22 database/API tests: permissions, conflicts/retries, approvals, CSV/XLSX,
  source provenance, legacy sharing/copying/staff/scenarios, full PostgreSQL
  backup/restore comparison, additive migration preservation and atomic
  business-data recovery/rollback/replay checks in disposable databases.
- Library, API and dashboard type checks; API and dashboard production builds.
- Browser saves: budgets, locations, custom KPI, finalized-period correction,
  combined campaign approval, reviewed CSV budget import, saved goal search,
  rolling rules and multiple-response sandbox drafts.
- All eight sections render without page overflow at 1440px and at 320px with
  larger text. Dark/light and mobile rule-dialog checks passed.
- Original compensation formulas, navigation and session workspace preserved.

## Remaining Scope / Limits

- Expansion commit 0227dc0 was pushed to GitHub and fast-forwarded into Replit.
  No production migration, publication or Replit Agent usage has occurred.
- PDF/images are retained for manual review; OCR extraction is not implemented.
- Goal searches are bounded to 500 combinations, three hiring profiles, one
  campaign and one room template per search. Results are feasible within the
  configured model/search, not claims of a global optimum or guaranteed income.
- Custom formulas are bounded arithmetic, not arbitrary spreadsheet formulas.
- Monthly forecasts are not appointment scheduling. Room/weekday limits do not
  model individual appointment collisions. Cash shortages warn rather than
  automatically stopping spending.
- Whole-practice and recorded campaign comparisons are not causal attribution.
- Business-data backups exclude authentication credentials/sessions; browser
  restore accepts at most 14 MB and only an empty app. Full server recovery and
  larger databases use pg_dump, protected secrets and a separate restore target.
- Production owner authentication, production backup/migration review and
  hosted login/persistence checks are required before publication.
- Marketing-category expenses are distinct from operating overhead in actuals
  and forecasts. Actual marketing costs come from finalized financial entries;
  funnel ad spend stays separate. Marketing budget lines add to campaign costs.
- Browser checks are representative, not proof of every legacy control/export.
  Staging, real-schema restore and accessibility checks remain release gates.

See docs/LOCAL_DEVELOPMENT.md for setup, verification and release gates.
