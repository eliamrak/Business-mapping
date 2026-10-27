# Shared Growth pace card

Separate Growth card in Overview and Growth. Attrition cards and acquisition table/calculator remain unchanged. One shared pure model and parent-owned session inputs keep the two placements consistent. Whole-practice scope is explicit and does not follow an unrelated clinician filter.

## Defensible scenario

Baseline is existing coverage-checked trailing three-calendar-month completed sessions/week; desired workload is current practice desired sessions/week. This is a desired workload target, not a claim about maximum room capacity or every clinician's fill date. Unknown coverage/capacity remains unknown.

User enters monthly growth measured as added weekly sessions per month. Target horizon starts at4months and is explicitly labeled a chosen planning target, not observed data. No positive growth rate is invented. Inputs are session-only, persist across in-app navigation and never save business records.

Remaining weekly workload / target months = required monthly growth. Assumed growth / required growth gives signed pace percentage. Angle =90degrees × percentage/100, clamped to[-90,90]. Positive growth is green, decline red, flat neutral; text also states direction/pace. Over100% preserves numeric pace while capping the angle. Already at desired workload avoids division and shows At target. Zero/negative growth has no fill estimate; invalid/missing inputs have an unknown state. Estimated months = remaining weekly workload / positive assumed growth.

The line is a goal-normalized indicator, not the slope of a historical chart. This feature does not infer a12-month trend, use matured starts-minus-endings as active growth, assume stable client visit frequency, or claim per-clinician fill forecasts. It uses sessions directly, avoiding an unsupported client-to-session conversion. Changing staffing, demand, visit frequency or desired workload can invalidate a constant-growth scenario. A future measured12-month trend needs comparable covered dated workload observations and a separate validated trend model.

## Validation and release

Tests cover100%/four-month calibration, under/over pace, signed negative/zero growth, already-full capacity, missing coverage/capacity, zero capacity, invalid horizon/growth and known zero workload. Synthetic browser checks both placements, shared input state, positive/negative/flat/unknown indicator states, desktop/mobile captures, acquisition calculator and unchanged Sessions comparison. All provider requests remain blocked and business-write requests prohibited in the harness.

Evidence directory: /tmp/practice-growth-bars-final in author cloud environment, not shared parent filesystem. Author does not deploy or touch records; publisher integrates and verifies the installed app. Final check results are appended after completion.

## Approved paired attrition bars

Overview and Sessions now share the same paired-bar component for matured starts/month and endings/month. Each person's3/12-month columns use one maximum over both periods' start/end averages, so relative lengths are comparable counts rather than percentages. Compare mode preserves its clinician chart and adds the scoped paired summaries; each clinician's paired periods share a scale without claiming identical coverage across clinicians. Endings are neutral gray, starts teal; only signed difference text is green/red/neutral. Zero draws zero fill; unknown draws no bar. Visible values, coverage counts, Unknown states, signed difference and not-net-active-growth qualifier remain. No domain calculations changed.

Final gate: 1,294 regression tests passed; dashboard types and production build passed (existing sourcemap/chunk-size warnings). Synthetic browser:47PNGs/31main-view checks,zero browser errors,zero non-GET API requests. Actual desktop/mobile paired bars and positive/negative pace pixels inspected. Existing Growth calculator and Sessions clinician/Compare checks pass. No production deployment by author.
