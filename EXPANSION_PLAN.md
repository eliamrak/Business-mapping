# EMCounseling Business Hub Expansion Plan

## Product Goal

Implementation checkpoint: see BUILD_STATUS.md for verified scope and remaining
limits. Business categories, assumptions, goals, hiring templates, campaign
methods, KPI definitions and decision responses are user-maintained records.
Code supplies the calculation/validation engines and editing tools, not fixed
practice-specific operating decisions. Advanced searches currently support up
to 500 combinations, three hiring profiles and one campaign per search. PDF
and image uploads are reference documents pending reviewed text extraction.

Expand the existing compensation strategy application into EMCounseling's internal business planning hub. The app should show the latest known operating position, project likely outcomes, compare those outcomes with goals, and model future changes to staffing, compensation, rooms, overhead, and lead generation.

The existing compensation, clinician-sharing, goal, scenario, comparison, profitability, staff-cost, and export functions are protected requirements. Expansion work must not remove or materially change them without explicit approval.

The product must model the business as one connected system, not as separate trackers or dashboards. Every material input should flow through all affected calculations, forecasts, capacity limits, KPI signals, decisions, and goals. Every result must be traceable back to the source data and assumptions that produced it.

## Connected Business Model

The shared calculation engine must represent the primary operating chain:

1. Marketing activity and advertising spend generate leads.
2. Leads become consultations based on scheduling and attendance assumptions.
3. Consultations become clients based on close rates.
4. Clients create sessions based on retention, frequency, and clinician capacity.
5. Sessions consume clinician time and, when in person, room capacity.
6. Completed and collected sessions generate revenue.
7. Revenue funds clinician compensation, payroll burden, operating expenses, taxes, reserves, owner compensation, and profit.
8. Owner compensation and approved distributions contribute to estimated family take-home.
9. Available cash, capacity, KPI signals, and goals inform hiring, compensation, marketing, and facility decisions.
10. Those decisions change future capacity, costs, revenue, profit, and family take-home.

### System Behavior

- A change in any input must recalculate every materially affected downstream result.
- Forecasts must account for time delays such as lead conversion, recruiting, credentialing, onboarding, caseload ramp, collections, and facility expansion.
- The system must identify the binding constraint when growth is limited by leads, clinician capacity, room capacity, cash, or another configured factor.
- Goal solving must work backward as well as forward. A family take-home, profit, revenue, or session goal should calculate the required upstream sessions, clinicians, rooms, leads, consultations, marketing spend, and timing.
- Planning changes from every functional area must combine into the same active forecast.
- Live actuals, budgets, goals, forecasts, and simulated plans must remain distinct while using the same definitions and calculation engine.
- KPI decision automations must evaluate the same connected data in both live and simulation modes.
- Each displayed result must offer a calculation trace showing its inputs, formulas or rules, reporting periods, and assumptions.
- Shared calculations must have one authoritative implementation and automated tests. Screens and reports should consume those results rather than reproducing their own versions.

### Experience Model

- Keep the everyday experience calm and progressive: show the few decisions and metrics needed for the current task, with details available on demand.
- Optimize visual design for sustained daily use: legible table text, adjustable text size and row spacing, light/dark appearance, stable numeric alignment, clear focus states, and no decorative or repeating animation. Use color with labels and preserve readable contrast in every state.
- Approved visual direction: combine concept 2 (Split View) with concept 5 (Control Room). Use Split View's focused organization with Control Room's compact controls, restrained icon treatment, and clear data hierarchy. Support consistent light and dark appearances.
- Use split-pane workspaces for selecting and editing clinicians, budgets, campaigns, and other records. Keep the dashboard and Connected Sandbox full-width when cross-business visibility matters; do not force every task into the same layout.
- Give each core business area its own workspace for viewing its records, editing its assumptions, and managing its settings without exposing unrelated controls.
- Provide a consistent analytics date picker: last 7, 14, 30, or 90 days, this month, last month, quarter, year to date, and an inclusive custom start/end range. Biweekly is the entry cadence, not a restriction on reporting dates.
- In a workspace, apply the selected range consistently to summaries, table rows, charts, totals, averages, and exports. Keep the data-through date visible and preserve the range when switching related views.
- Offer a local Columns chooser with individual checkboxes, sensible defaults, and per-user saved preferences for each table. Hiding a column changes presentation only; metrics remain available to the shared engine.
- Keep the Command Center observational. It summarizes the latest actual, budget, forecast, and goal position but is not the primary place for changing assumptions or running experiments.
- Provide a separate Connected Sandbox for interactive modeling. A user can change an input and immediately see every materially affected output across the business model.
- The Connected Sandbox must show the current active-plan value, proposed value, absolute change, percentage change, and direction for every affected result.
- Visually distinguish direct edits from downstream calculated effects and group affected outputs by clinicians, capacity, marketing, finances, cash, and family take-home.
- Preserve unaffected results in the model but de-emphasize them so the user can understand what changed without scanning the entire business map.
- Never let sandbox edits alter actuals or the active forecast until the user explicitly reviews and applies them.

### Usability and Workflow Requirements

- Treat usability and functional completeness as build requirements, not a final styling pass. Build and verify complete user workflows in each phase.
- Keep navigation, terminology, date controls, save behavior, and common actions consistent across areas. Preserve the user's selected record, date range, filters, and table preferences when navigating between related views.
- Show essential inputs and results first. Put uncommon settings, detailed assumptions, and calculation traces behind clearly labeled secondary controls; do not require advanced configuration to complete ordinary biweekly updates.
- Make repeated entry efficient with keyboard navigation, sensible defaults, copy-forward, and reviewable bulk entry. Never silently treat a missing observation as zero or a copied value as a new actual.
- Label units, reporting periods, required fields, and editable versus calculated values clearly. Show validation next to the relevant input and explain how to correct it without discarding valid work.
- Make persistence explicit: distinguish draft, unsaved, saving, saved, and failed states. Warn before abandoning unsaved work, preserve input after failures, and provide a safe retry without creating duplicate records.
- Every visible action must either complete its intended workflow or clearly identify an unavailable state. Do not ship placeholder buttons, unexplained disabled controls, or successful-looking saves that have not persisted.
- Provide useful empty, loading, error, and no-results states. Use concise contextual guidance only where needed to complete or recover a task.
- Require review before consequential changes such as finalizing actuals, importing records, approving a proposal, or archiving records. Preview affected records and outputs; retain correction history or provide undo where appropriate.
- Keep color supplementary to text and symbols. Verify contrast, keyboard focus, accessible labels, readable numeric tables, and responsive layouts in both appearances; dense tables may scroll horizontally within their own area without overflowing the page.
- Use one connected calculation system across all views. Simplifying an interface must not remove existing compensation functions, hide important financial consequences, or change a metric's meaning between screens.

### Navigation Map

| Area | Contents |
| --- | --- |
| Overview | Unified dashboard, actual/budget/forecast/goal comparisons, data-through date, and decision signals. |
| Practice | Clinicians, biweekly session tracker, compensation, staff costs, clinician sharing, rooms, and locations. |
| Finances | Flexible budgets, detailed overhead, collections, profitability, break-even, cash, reserves, owner pay, and family take-home. |
| Growth | Lead sources, campaigns, funnels, acquisition economics, retention, and dedicated hiring economics. |
| Plans & Goals | Active forecast, dated events from every area, flexible horizons, goal solving, and saved plan comparisons. |
| Sandbox | Quick experiments, connected impact map, proposal-only and whole-business results, proposal approval, and post-launch tracking. |
| Updates | Biweekly manual entry, document uploads, import review, finalization, audit history, and reports/exports. |
| Settings | If This Then That decision rules, custom KPI definitions, shared preferences, and access management. |

- Each functional area retains its own local settings and assumptions; Settings contains cross-business controls.
- Default sandbox results show key changed outputs, with all affected outputs and calculation traces available on demand.
- The mockups are interface concepts using illustrative data, not production screens or verified practice figures.

### Calculation Ownership and Reuse

- Preserve and reuse the current clinician production, compensation, employer burden, practice-net, overhead-allocation, fully-loaded-profit, break-even-session, compensation-comparison, and required-net-per-clinician calculations.
- Extend existing calculations with collected-revenue rates, processing fees, actual session history, cancellation assumptions, and dated terms rather than creating parallel versions.
- Treat the calculation registry as the sole owner of formulas used by live dashboards, forecasts, proposal sandboxes, KPI automations, exports, and plan comparisons.
- Define each metric once with its inputs, units, period basis, actual-versus-forecast behavior, and missing-data policy.
- Do not create a new metric when an existing metric can be extended or displayed in another context.
- Add regression tests before changing current calculation behavior.

## Operating Model

- Biweekly reporting periods are the primary update cycle.
- Owners and authorized staff can enter structured figures manually.
- CSV, spreadsheet, PDF, image, and screenshot uploads can be attached to a reporting period and used as entry aids.
- Structured, reviewed values remain the source of truth; uploaded documents do not silently overwrite business data.
- Every dashboard and forecast displays its data-through date and distinguishes actual, estimated, forecast, budget, and goal values.
- No client names, clinical notes, diagnoses, or other PHI are required.

## Core Areas

### 1. Command Center

- Current position as of the latest finalized reporting period.
- Revenue, sessions, clinician capacity, payroll, overhead, profit, cash, leads, consultations, conversions, advertising, and room utilization.
- Actual versus budget versus forecast versus goal.
- Biweekly changes, year-to-date totals, and rolling 12-month projections.
- Clear warnings for capacity constraints, goal gaps, and assumptions that have become stale.
- Keep the dashboard focused on monitoring and navigation. Detailed settings, assumption editing, and experimental controls belong in their corresponding workspaces or the Connected Sandbox.

### 2. Reporting Periods

- Draft, reviewed, and finalized states.
- Period start, period end, data-through date, owner, notes, and attachments.
- Quick-copy values from the previous period.
- Audit history for edits and finalization.
- Completed periods remain historically stable while corrections are recorded.

### 3. Flexible Budget and Overhead

- User-created income, expense, payroll, marketing, facility, reserve, and other categories.
- Unlimited category depth through parent-child relationships.
- Categories can be renamed, reordered, archived, tagged, or extended without deleting history.
- Monthly and biweekly budget, actual, committed, and forecast amounts.
- Fixed, variable, recurring, and one-time line items.
- Optional association with a clinician, room, location, campaign, or reporting period.
- Recurring templates with start and end dates.

### 3A. Business Money Flow and Family Take-Home

- Map collected practice revenue through payment fees, clinician compensation, payroll burden, operating expenses, taxes, reserves, owner compensation, profit, and retained cash.
- Support flexible target-allocation buckets inspired by the existing Profit First-style workbook without locking the business into fixed categories or percentages.
- Keep business profit, owner payroll, owner clinical compensation, distributions, tax reserves, benefits, and household take-home as distinct concepts.
- Provide a traceable waterfall from gross collections to business cash retained and estimated cash reaching the family.
- Show biweekly, monthly, annual, actual, budget, forecast, and goal views using consistent calendar conversions.
- Allow allocation targets to change by effective date and verify that the complete allocation reconciles to 100% or clearly shows an unallocated amount.
- Compare target allocations with actual spending and cash transfers.
- Let users define which owner-controlled cash flows count toward household income and apply explicit withholding or reserve assumptions.
- Forecast how hiring, compensation, sessions, rates, overhead, taxes, and profit distributions affect family take-home.
- Keep every derived amount traceable to its source revenue, expense, compensation term, allocation rule, and reporting period.

### 4. Clinician Operations and Economics

- Completed, cancelled, no-show, scheduled, and desired sessions by clinician and reporting period.
- Provide a biweekly session tracker as a primary operating input, with monthly and rolling-period summaries.
- Allow custom date ranges and preset reporting windows independent of the biweekly update cycle.
- Make session table columns configurable, including scheduled, completed, desired, cancelled, no-show, average completed sessions per week, attendance, utilization, and relevant financial outputs. Keep clinician identity visible and remember preferences per view.
- Label average-session units and denominators explicitly. Default weekly average to completed sessions divided by calendar days in range / 7, including partial weeks; distinguish an individual clinician average from team total and average per clinician. Account explicitly for clinician active dates and missing observations.
- Aggregate actual dated observations when available. If only biweekly totals are available and a requested range cuts through a period, identify that limitation and offer whole-period totals or explicitly labeled estimates; never silently present prorated totals as exact actuals.
- Calculate attendance and cancellation assumptions from selectable historical windows, while allowing a clearly labeled manual assumption for new clinicians or unusual periods.
- In-person and telehealth session counts.
- Available clinical hours and utilization.
- Session rate, collection assumptions, compensation model, payroll burden, and non-clinical pay.
- Compensation terms and pay-rate changes with effective dates.
- Production, compensation, fully loaded cost, contribution margin, break-even volume, and practice net.
- Current, desired, and forecast values remain distinct.

### 4A. Hiring Economics

- Keep detailed hiring assumptions and calculations in a dedicated hiring area while surfacing their useful outputs in clinician, budget, capacity, forecast, signal, and dashboard views.
- Include recruiting, credentialing, onboarding, training, pre-caseload payroll, supervision, software, equipment, marketing, room, and caseload-ramp costs.
- Calculate cash required, affordable hire date, break-even date, required sessions, required leads, expected contribution, room effect, and family-take-home effect.
- Extend the current compensation comparison into an explicit affordability solver for the maximum supportable salary, hourly rate, session rate, or compensation split under selected business goals.

### 5. Rooms and Capacity

- Locations, rooms, available operating blocks, and capacity assumptions.
- In-person demand consumes room capacity; telehealth does not unless configured otherwise.
- Utilization by room, location, clinician, and period.
- Required rooms for target session volume.
- Identification of the next limiting factor: leads, clinician capacity, or room capacity.

### 6. Lead Generation Funnel

- Flexible lead sources and campaigns.
- Advertising spend, leads, consultations scheduled, consultations attended, clients closed, and first sessions completed.
- Support channel-specific forecasting from cost per lead plus funnel conversion rates, or directly from customer acquisition cost when that is the stronger known assumption.
- Provide a selectable estimation method for each source, campaign, proposal, and effective date.
- Initial methods should include cost per lead plus funnel conversions, direct customer acquisition cost, impression/click funnel, historical yield, and manual expected volume.
- Allow validated custom formulas built from registered marketing KPIs when the standard methods do not fit a future strategy.
- When acquisition cost is entered directly, calculate expected clients from spend and infer expected leads only when a compatible close-rate assumption is also available.
- Allow cost per lead, consultation rate, attendance rate, close rate, and acquisition cost to vary by source, campaign, date range, and assumption set.
- Clearly label entered, calculated, and inferred funnel values.
- Cost per lead, consultation rate, attendance rate, close rate, acquisition cost, and estimated downstream sessions and revenue.
- Revenue and contribution lifetime value based on retention and session frequency, LTV-to-CAC ratios, and acquisition-cost payback with the selected lifetime-value basis clearly identified.
- Report revenue ROAS as collected revenue divided by ad spend.
- Report contribution ROAS as incremental contribution after care-delivery costs divided by ad spend.
- Report net campaign ROI as incremental contribution less all campaign costs, divided by all campaign costs.
- Distinguish attributed results from incremental results. Incremental estimates compare the active-plan baseline with the proposal or observed campaign result after accounting for expected non-campaign volume.
- Required leads, consultations, and ad spend for a session or revenue target.
- Manual attribution is acceptable; no external marketing integration is required initially.

### 7. Forecast and Goal Solver

- Forecast from finalized actuals plus current-period pace and future assumptions.
- Solve backward from monthly or annual session, revenue, practice-net, owner-pay, or profit targets.
- Estimate required clinicians, clinician mix, average caseload, rooms, leads, consultations, close rate, and advertising spend.
- Model hiring ramp time, credentialing delay, caseload ramp, compensation changes, fee changes, cancellations, collections, and overhead growth across a two-year planning timeline.
- Report infeasible plans and identify the binding constraint.

### 8. Embedded Planning

- Preserve the existing scenario engine, calculations, and ability to build multi-year growth plans, but replace the confusing scenario-builder workflow.
- Embed planning controls inside the business area they affect rather than organizing the product around one scenario or one two-year plan.
- Allow dated events for hires, compensation changes, room additions, locations, overhead, utilization, rates, and marketing from their corresponding screens.
- Recalculate revenue, sessions, compensation, payroll burden, overhead, room demand, lead demand, and goal progress after every change.
- Combine events from every area into unified forecasts for a selected time horizon.
- Allow optional saved plans and comparisons without forcing the user to understand scenario terminology.
- Keep planning assumptions separate from live actuals while allowing approved assumptions to become the active forecast.

### 9. Proposal Sandbox and Plan Promotion

- Provide a dedicated Connected Sandbox, separate from the Command Center, for modeling a campaign, ad-spend change, growth strategy, hire, compensation change, building, location, office, room, or combined expansion proposal.
- Support quick spreadsheet-style exploration as well as named, saved proposals. A user should not need to create or understand a formal scenario before testing a change.
- A single proposal can contain multiple linked changes: for example, increase Google ad spend, increase Meta ad spend, hire a clinician, adjust pay, and add a room within the same growth push.
- Represent each proposed change as an independently editable item with its target, assumptions, effective dates, and enabled state. Let users add, remove, and temporarily exclude items while retaining their entered assumptions.
- Keep channel-specific budgets and funnel assumptions separate. Calculate Google, Meta, and other sources independently before combining demand and applying shared clinician capacity, room capacity, costs, and cash constraints once.
- Disabling a proposed change restores that target's active-plan assumptions; it does not silently eliminate the existing channel, staffing, or budget. Model an actual shutdown or reduction as an explicit change.
- Compare the active plan, individual changes alone, and the combined proposal. Do not assume the combined financial result equals the sum of isolated results, because changes share costs, capacity limits, and dependencies.
- Support dependencies and shared dates between proposed changes, such as a marketing increase dependent on a hire or additional rooms becoming available. Flag conflicting changes to the same target and date instead of silently applying whichever was edited last.
- Make channel-overlap and attribution assumptions visible so combining campaigns does not silently count the same clients or incremental revenue twice.
- Save, compare, approve, and track the grouped proposal as one initiative, while retaining its individual changes and supporting reviewed partial approval with dependency checks.
- Keep editable assumptions in a clear input area and update all dependent outputs immediately after an edit.
- Provide an impact map grouped by clinicians, sessions, rooms, leads, revenue, compensation, overhead, cash, profit, and family take-home.
- Highlight direct input changes separately from their downstream effects, including active-plan value, proposed value, absolute variance, and percentage variance.
- Let users filter the impact map to all affected outputs, key outputs only, or one business area.
- Explain why an output changed through a calculation trace back to the edited input.
- Let each proposal define its own assumptions, costs, dates, ramp periods, lead funnel, client cohorts, retention, sessions, rates, staffing, rooms, and expected financial results.
- Let proposal assumptions vary by channel, including cost per lead, customer acquisition cost, consultation rate, attendance rate, and close rate.
- Support both spend-to-leads-to-clients models and direct spend-to-clients models, with inferred values visibly identified.
- Allow each channel in the same proposal to use a different estimation method and normalize all methods into comparable expected leads, clients, sessions, revenue, contribution, and cash results.
- Reuse the shared business calculation engine so sandbox results include clinician compensation, payroll burden, processing fees, operating costs, capacity limits, taxes, reserves, profit, cash, and family take-home.
- Show proposal-only results and the proposal's incremental effect on the current active plan.
- Evaluate the proposal against clinician availability, room capacity, cash, KPI rules, and other binding constraints.
- Support conservative, expected, and optimistic assumption sets without changing live data.
- Show monthly cash required, break-even date, cumulative cash position, return on spend, expected clients, sessions, collections, contribution margin, and goal effects.
- Require explicit approval before a proposal can affect the active plan.
- On approval, convert proposal assumptions into dated plan events while preserving the approved proposal as a versioned baseline.
- Support partial approval, such as approving a pilot period or selected components instead of the full proposal.
- After launch, connect actual reporting-period results to the approved proposal and compare actual versus expected costs, leads, conversions, clients, sessions, revenue, capacity use, and profit.
- Allow an active proposal to be continued, adjusted, paused, completed, or stopped while retaining its history and variance record.
- Prevent draft, rejected, and simulated proposals from altering live actuals or the active forecast.

### 10. KPI Signals and Decision Events

- Provide a Decision Automations section in Settings using an If This, Then That rule builder.
- Use an extensible KPI registry so newly added business metrics can become rule inputs without rebuilding the automation system.
- Allow custom calculated KPIs built from existing metrics using validated formulas, units, aggregation rules, and effective dates.
- Let users tag selected KPIs as decision signals and define flexible condition groups using AND, OR, and nested logic.
- Support conditions across selected records, such as all selected clinicians exceeding 80% session utilization for a defined number of reporting periods.
- Support all selected, any selected, average, sum, count, percentage, change, trend, and comparison scopes.
- Support thresholds, ranges, ratios, dates, missing-data checks, rolling windows, consecutive periods, and comparisons with budgets, goals, forecasts, or prior periods.
- Distinguish observed signals from forecast signals.
- Estimate when a threshold is likely to be reached using the active forecast and display the expected date or date range.
- Use an extensible event registry so new response-event types can be introduced as the business grows.
- Attach one or more recommended or planned response events, such as begin recruiting, hire a clinician, add a room, increase marketing, review compensation, request review, or create a custom decision event.
- Account for lead time between a signal and its operational result, including recruiting, credentialing, onboarding, and caseload ramp.
- Show signal status as healthy, approaching, triggered, acknowledged, or completed.
- Allow rules to be named, described, grouped, enabled, disabled, duplicated, tested, and versioned.
- Evaluate the same rules against live data and planning simulations while clearly identifying simulated results.
- Never let simulation results modify live data unless the user explicitly applies them.
- Signals create alerts and planning events; they do not automatically hire, spend, publish, or change live business data.

### 11. Uploads and Assisted Entry

- Accept CSV, XLSX, PDF, common image formats, and screenshots.
- Store the original attachment with its reporting period.
- CSV/XLSX: preview rows and map columns before import.
- PDF/image: extract proposed values into a review screen when practical.
- Require human confirmation before extracted values become structured records.
- Record the source attachment and user for imported values.

### 12. Access and Audit

- Owner and data-entry roles initially, with expandable permissions.
- Permission boundaries for compensation, owner pay, profit, and other sensitive figures.
- Record who created, edited, reviewed, and finalized each reporting period and material assumption.
- Avoid PHI and clinical records throughout the application.

## Calculation Principles

- Store inputs and calculate outputs; do not store duplicate derived totals unless needed for immutable snapshots.
- Use effective-dated terms for rates, compensation, and recurring costs.
- Preserve actuals separately from budgets, forecasts, goals, and scenarios.
- Forecasts must expose their assumptions and last refresh time.
- Apply consistent period normalization so biweekly, monthly, quarterly, and annual views reconcile.
- Add automated regression tests for all existing compensation calculations before changing shared calculation code.

## Delivery Phases

### Implementation Checkpoint: 2026-09-20

All eight business areas now have a working local implementation at `/hub`,
alongside sessions at `/practice` and preserved compensation at `/`. Shared
forecasting, financials, campaigns, rooms, layered proposals, reviewed CSV/XLSX
imports, rules, authenticated roles and audit history are built. Local model/API
regressions and a disposable-database restore rehearsal passed.
`BUILD_STATUS.md` distinguishes delivered scope from remaining advanced items;
not every roadmap bullet below is complete. Real-schema staging verification
and release approval are still required. No GitHub push or Replit deployment
has occurred.

Local setup, API contracts, limitations, and release gates are documented in
`docs/LOCAL_DEVELOPMENT.md`.

### Phase 0: Baseline Protection

- Inventory and test existing calculations and workflows.
- Establish the approved Split View / Control Room interface foundation and shared control behavior before expanding screens. Validate a complete clinician selection, session-entry, save, and reload workflow before extending the pattern to other areas.
- Add production-safe authentication and permissions.
- Disable automatic demo seeding in production.
- Establish database migration, backup, and rollback procedures.
- Add a release checklist for GitHub, Replit sync, database migration, verification, and publishing.

### Phase 1: Reporting and Flexible Financials

- Reporting periods, attachments, flexible categories, line items, recurring templates, and audit fields.
- Manual biweekly entry and monthly rollups.
- Budget, actual, forecast, and goal comparisons.
- First version of the Command Center.

### Phase 2: Sessions and Clinician Operations

- Biweekly clinician session entry and desired-session targets.
- Actual-versus-target utilization and clinician economics.
- Compensation terms with effective dates.
- Integrate operational data with existing compensation calculations.

### Phase 3: Rooms and Capacity

- Locations, rooms, schedules, telehealth, occupancy, and capacity constraints.
- Required-clinician and required-room solvers.

### Phase 4: Leads and Marketing

- Lead sources, funnel metrics, campaigns, advertising spend, and conversion forecasts.
- Required-lead and required-ad-spend solvers.

### Phase 5: Unified Forecasting and Embedded Planning

- Rolling forecast engine with planning controls embedded throughout the app.
- Hiring, compensation, budget, room, and marketing events combined into one forecast.
- Proposal sandbox with isolated assumptions, constraint checks, plan-impact comparison, and explicit approval into the active plan.
- Approved-proposal baselines and actual-versus-expected tracking after launch.
- Simple baseline and alternative-plan comparisons.
- Constraint analysis and goal recommendations.

### Phase 6: KPI Signals and Decision Events

- Extensible KPI and event registries plus an If This, Then That rule builder.
- User-defined thresholds, nested condition groups, scopes, comparisons, and time windows.
- Current and forecast trigger detection.
- Expected trigger dates, operational lead times, and attached response events.
- Live and simulation evaluation with clearly separated results.
- Rule versioning, testing, signal alerts, acknowledgement, and completion tracking.

### Phase 7: Import Assistance and Reporting

- Spreadsheet mapping and reusable import templates.
- Reviewed extraction from PDFs, images, and screenshots.
- Expanded exports, management reports, and data backup downloads.

## Release Workflow

1. Make changes locally in Codex without using the Replit Agent.
2. Run type checks, calculation tests, API tests, production builds, and responsive UI checks.
3. Commit and push the reviewed change to GitHub `main` or an agreed feature branch.
4. In Replit, fetch and fast-forward from the GitHub remote using Git commands.
5. Apply reviewed database migrations and run production smoke checks.
6. Publish through Replit and verify the live URL, health endpoint, persistence, and key workflows.

This workflow should use no Replit Agent credits. Replit hosting, database, storage, and deployment charges remain separate from Agent usage.

### Completion Gate

- For each delivered feature, verify the ordinary task end to end, including creating or editing data, saving it, reloading it, and seeing the correct downstream calculations and totals.
- Test invalid inputs, missing data, failed saves, duplicate submissions, imports where applicable, and navigation away from unsaved edits. Verify that users can recover without losing valid work or corrupting history.
- Test keyboard operation, focus management, light/dark appearance, and desktop/mobile layouts. Check for overlapping text, clipped controls, inconsistent units, and unnecessary steps.
- Run regression checks for protected compensation and related workflows. A feature is not complete because its screen looks finished.
- Obtain explicit release approval before pushing, syncing Replit, applying production migrations, or publishing. Prototype interaction checks do not substitute for production calculation, persistence, or workflow tests.

## Initial Success Criteria

- Existing features and calculations continue to work.
- A biweekly reporting period can be entered and finalized in under 15 minutes.
- Categories can be changed without code changes or historical data loss.
- The dashboard clearly distinguishes actuals, forecasts, budgets, and goals.
- The app can answer how many sessions, clinicians, rooms, leads, consultations, and advertising dollars are required for a selected target.
- Every forecast can be traced to visible assumptions and current source data.
