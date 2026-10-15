# Displayed Metric Traceability

Runtime candidate: 8562219. Inventory, not certification of real business numbers. All 42 registered keys in lib/practice/src/hub/metrics.ts appear below. Clinical displays and embedded legacy tools follow separately. Synthetic test coverage is not proof that production inputs are complete.

## Common Source Rules

Forecast rows are calendar months for the selected saved team, with dated clinician/staff terms. Today uses working-session-pace.ts: available per-clinician history within three calendar months, calendar-week denominator, quiet days included, no desired-volume fill, no vacation/growth/attrition/room haircut. Long Term Goals uses the separate planning model. Missing baseline history withholds the working forecast. Boundary-crossing aggregate counts are unknown, not prorated.

Imported actual fees replace the configured-fee estimate for a matching clinician/service date. Stable identical hashes count once; differing payloads for the same identity withhold affected fees. Negative fees remain signed adjustments. Billing is not proof of cash or full service-day coverage. See the unresolved granularity/compensation questions in WORKING-FORECAST-ACCEPTANCE.md.

All following forecast arithmetic is in engine.ts unless stated otherwise. Ratios with absent/zero denominators return null, not achievement. Financial unknowns propagate to dependent metrics; historical unknown cash remains unknown after later earned profit recovers. Registered labels can describe modeled quantities: they do not make forecast rows imported actuals.

## Registered Metrics

| Key | Unit and basis | Source / limitation |
| --- | --- | --- |
| sessions | sessions/month | Working observed weekly pace times active calendar days/7; planning allocation otherwise. |
| activeClinicalHeadcount | people | Active dated selected-team clinician profiles; not a currency target. |
| capacity | sessions/month | Configured dated clinician capacity; diagnostic, not a working-forecast limit. |
| utilization | percent | Allocated sessions / clinician capacity. Not measured appointment occupancy. |
| unservedSessions | sessions/month | Planning demand minus served allocation; working baseline is not capacity-capped. |
| roomCapacity | in-person sessions/month | Dated active configured room slots. No rooms means unknown. |
| roomUtilization | percent | Modeled room use / configured room capacity; not observed occupancy. |
| requiredRooms | rooms | Rounded-up modeled in-person demand / capacity per room; missing room basis is unknown. |
| leads | leads/month | Campaign model inputs and dated budgets, not imported PHONE clients. |
| clients | new clients/month | Modeled campaign/organic acquisition. Working revenue is not increased by this model. |
| consultations | consults/month | Modeled leads and consultation assumptions; separate from observed consult journeys. |
| revenue | dollars/month | Session-fee estimate plus matching imported service-date overrides; billing conflicts withhold. |
| collections | dollars/month | Revenue times collection percentage and configured delay/opening amounts. Modeled, not reconciled receipts. |
| clinicianPay | dollars/month | Dated split/cap/salary terms and active service days. Owner clinical proceeds can remain business income. |
| employerBurden | dollars/month | Configured employer burden on modeled clinician compensation. |
| staffCost | dollars/month | Dated staff salaries or hourly terms plus employer burden. Missing terms withhold profit. Explicit zero is known. |
| overhead | dollars/month | Dated recurring budgets/events and configured overhead; actual expense summaries are separate. |
| marketing | dollars/month | Dated modeled marketing cost. Not inferred from consultation counts. |
| adSpend | dollars/month | Modeled advertising subset of marketing. |
| cpl | dollars/lead | adSpend / modeled leads; no positive denominator means unknown. |
| consultationPct | percent | Modeled consultations / leads. Not the observed Growth funnel unless explicitly labeled there. |
| closePct | percent | Modeled acquired clients / attended consultations. Not confirmed clinician attribution. |
| attendance | percent | Configured assumption, not a measured attendance rate. Working volume is not haircut by this assumption. |
| fees | dollars/month | Modeled collection percentage/fixed transaction fees with delay/opening transactions. Dependent unknowns withhold. |
| profit | dollars/month | Revenue plus other income minus earned clinician/burden/staff/overhead/marketing/fees/owner payroll and burden. Not cash. |
| ownerPayroll | dollars/month | Separate configured/dated owner payroll, not automatic duplication of owner clinical revenue. |
| ownerClinicalPay | dollars/month | Clinical compensation classified as owner under configured terms. Not distributions. |
| taxReserve | dollars/month | Positive modeled cash-surplus dated tax allocation plus explicit tax budgets. Not tax liability certification. |
| reserves | dollars/month | Dated reserve allocation plus explicit reserve budgets. Not a recorded fund balance. |
| distributions | dollars/month | Dated distribution buckets capped by available cash after tax/reserves. |
| ownerDistributionsPretax | dollars/month | Household-marked share of actual modeled distributions; other owners excluded. Missing household mapping is unknown. |
| coOwnerSalaryPretax | dollars/month | Mapped co-owner gross salary. No payroll-tax subtraction in this pretax goal. |
| retainedCash | dollars/month | Cash profit minus tax/reserve/distribution allocations. May be negative; not all attributable to a named fund. |
| cash | dollars | Opening modeled balance plus cumulative retained cash; any unknown prior balance propagates. |
| familyTakeHome | dollars/month | Mapped estimated net W2 pay plus household distributions, or explicit configured legacy family-pay path. Not pretax owner goal. |
| breakEvenSessions | sessions/month | Average modeled contribution formula for diagnostics. Not the nonlinear incremental Financial Goal solver. |
| cac | dollars/client | Modeled marketing / modeled new clients. Not demonstrated acquisition causality. |
| ltv | dollars/client | Average fee times configured sessions/client/month and retention months. Assumption-based, not measured cohort lifetime. |
| roas | ratio | Modeled revenue / marketing in scenario model; withheld in Today working forecast. |
| contributionRoas | ratio | Modeled revenue less clinician pay, employer burden and fees / marketing; withheld in working forecast. |
| netRoi | percent | Modeled contribution after marketing / marketing; withheld in working forecast. |
| runway | months | Nonnegative modeled cash / negative monthly retained cash, only while burning cash and balance known. |

## Other Displayed Measures

| Display | Window, scope and evidence | Primary source / tests |
| --- | --- | --- |
| Sessions/week, period total, practice benchmark | Shared selected period and contributor; calendar-day denominator times seven. Imported visit facts do not prove absent days; strict rates require coverage, labeled estimates remain distinct. | session-trend.ts; session-trend.test.ts; working-session-pace.test.ts |
| Imported/manual history rows and desired goals | Imported daily actuals stay actual-only. A desired value is shown only when explicitly provided; overlapping manual/import evidence retains conflicts without invented prorating. | import-derived-sessions.ts/test; session-goals.ts/test |
| Initial retention | Three treatment sessions with initial gaps at most 28 days. PHONE excluded. Retained/evaluated and pending counts accompany rates; normalized clinician identity, ambiguous IDs unknown. Historical selected-team treatment evidence retained. | retention-local.ts/test |
| Attrition/endings | 90-day mature observation with later returns handled. Monthly averages use mature contained months, not all events in an overlapping custom month. Exact ending-date totals remain distinct. | retention-local.ts/test; practice-overview.test.ts |
| Practice consult conversion | One de-duplicated client journey, one calendar-month window, current-team scope even for historical periods. Pending journeys excluded until mature. Current-team treatment-outcome scope remains a product question. | retention-local.ts/test; practice-scope.ts/test |
| Clinician confirmed close | Manual confirmed closer credit, not merely a treatment-start candidate. Internal referrals are protected. Missing confirmation stays pending; ambiguous identity is unknown. | retention-local.ts/test; render-practice-workspace.mjs |
| Manual lead funnel and campaign readiness | Schedule=scheduled/leads; show=attended/scheduled; consult close=booked/attended; overall=booked/leads. Incomplete monthly funnels cannot establish complete acquisition pace. | operating-plan.ts/test; lead-flow-rates.test.ts |
| Rooms demand/headline | In-person only, selected period with coverage; active rooms as of min(selected end,today), excluding future/expired/planning rooms. All-modality financial goals are not room-demand targets. | session-trend.ts/test; practice-workspace.tsx; room render checks |
| Imported charged-fee monthly averages | Service-month signed charges; latest three elapsed reported months and all elapsed reported months, explicit denominator. Current partial month separate; missing months not zero or coverage proof. | reported-billing.ts/test; revenue-repair-render.mjs |
| Money earned-profit bridge/detail | Identical working-month earned costs. Scheduled paychecks are a separate timing view. Projection allocations use cash surplus, historical nonprojection allocation basis is explicitly distinct. | money-flow.ts; money-flow.test.ts; money-flow-reconciliation.test.ts |
| Recorded overhead | Full completed service-month expense totals; unknown/incomplete months excluded with reason. Fixed dollars or percent target preserves chosen form with calculated equivalent. | practice-money-visuals.ts/test |
| Fund balances/contributions/ETA | Recorded dated balance distinct from projection; blank balance explicitly assumed zero. Exact named dated allocation, not all retained/reserve cash. Missing contribution means no ETA; ending allocation cannot imply perpetual funding. | practice-money-visuals.ts/test |
| Owner/co-owner/profit goals | Editable monthly or annual targets; pretax owners separate from estimated take-home. No combined signed completion percent or capital stock as annual expense. | financial-session-goal.ts/test; calculations.test.ts; practice-overview.test.ts |
| Achieved goal | Requires one completed actual biweekly window, sufficient coverage and correct metric evidence. Unverified imported visit days cannot certify whole days. Goal retained after achievement. | completed-goals.ts/test |
| Financial required sessions | Incremental forecast solver with explicit clinician mix, dated salary/cap/expense transitions, no historical charges as future free revenue; missing staff/capacity/allocations withhold certification. | financial-session-goal.ts/test; operating-plan.ts/test |
| Today Team pay cards/comparison | Same working-month dated engine compensation, including salary overrides; contributions before shared overhead, not legacy annual split-only output. | team-builder-tab.tsx; clinician-impact-tab.tsx; staff-configuration-render.mjs |
| Legacy Current Reality | Recurring-flow progress explicitly separate from capital balances. Zero recurring target means No recurring target, not Goal Achieved. | calculations.ts/test; capital-only render assertion |
| Long Term Goals/Sandbox impact and search | Assumption-based scenario engine with explicit focus/search bounds, dated scenario changes, feasibility/unknown states. Not a current operating forecast or validated causal prediction. | hub.test.ts; focused-plan-persistence.test.ts; focused-plan-alternatives.test.ts; plan-focus.test.ts; operating-plan.test.ts |
| Calendar labels and Overview annual summary | Last four completed Monday-Sunday weeks or biweekly service windows; rolling selections separate. Overview next12 months begins current month, not recorded YTD. Money retains labeled independent forecast month. | practice-period.test.ts; render-practice-workspace.mjs |

## Verification Limits

565 synthetic domain/dashboard tests and five API coverage tests passed; fresh independent review rechecked the six repaired numeric defects plus dated fund buckets. Rendered acceptance covered 45 main-workspace, 15 roster/pay and two revenue captures. See WORKING-FORECAST-ACCEPTANCE.md for exact commands, evidence paths and four consolidated product questions.

Not independently certified: actual business pay terms, completeness of supplied billing/attendance reports, cash collection reconciliation, marketing causality, tax estimates, real fund contributions/deadlines, and every possible scenario/custom-formula interaction. The break-even diagnostic remains an average-cost measure; only the dedicated incremental solver establishes financial session goals. No authenticated database integration suite or new live deployment verification was run.
