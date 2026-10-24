# Observed session progression (domain contract)

`sessionProgression(eligibleHistoricalSnapshots, options)` in `artifacts/comp-dashboard/src/lib/session-progression.ts` is a pure, read-only calculation. It does not change the existing three-distinct-treatment-date / 28-day initial-retention calculation or separate 90-day apparent-ending rules.

## Cohort and counts

- Include clients whose earliest **observed eligible treatment visit** is between `start` and `end`, inclusive, and no later than `asOf`. This is not a verified new-client or lifetime-start cohort.
- Pass the full historical eligible snapshot collection from the existing coverage pipeline, before date/clinician filtering. Preserve historical/former-clinician follow-up. Do not pass raw reconciliation records as eligible evidence. Incomplete report periods stay excluded by that pipeline.
- `clinician` selects clients with that clinician on their first observed treatment date. Names use the existing trim/whitespace/case normalization. Multiple clinicians on that date each have membership; clinician cohorts must not be summed. Later internal referrals do not restart the sequence or remove follow-up.
- Count derived treatment show visits across all clinicians through `asOf`, including visits after the cohort window. Reuse `derivedShowVisits` for consultation/documentation exclusion, attendance conflicts, duplicate imports and explicit same-day visit exceptions. Sessions are visits, not distinct dates; existing retention still uses distinct dates.
- Every milestone uses the same number of eligible cohort clients. A completion is a client with at least that many observed eligible visits. Recent/ongoing clients remain included. Unreached milestones mean only “not observed by cutoff,” never dropout, failure, or confirmed ending.
- Missing historical coverage can shift cohort membership and undercount progression. Source coverage is not inferred from observed date spans. `excludedFollowUpEvidence` only contributes a warning count of cohort clients with unresolved evidence through the cutoff; it cannot add visits or support absence claims. Show existing coverage warnings alongside the result.

## UI interface

Return fields: `basis`, `start`, `end`, `observedThrough`, normalized `clinician` or null, `eligibleClients`, `clientsWithUnresolvedEvidence`, and `rows`. Each row has `session`, `eligibleClients`, `completions`, `reachedPct`, `changePercentagePoints`. Defaults to eight rows; optional `sessions` supports 1–100.

Recommended title: **Observed session progression**. Subtitle must explain first-observed cohort dates, observation cutoff, clinician membership rule, and incomplete-history limitation. Use “clients reaching session” for completions, not total appointment volume. The chart plots `session` against `reachedPct`; tooltips and the table expose counts and denominator. The first change is an em dash, not 0%; empty cohorts use null percentages and an explicit empty state. Percentage-point changes derive from unrounded percentages; round only for display (e.g. one decimal and `pp`). No estimates or illustration counts are inserted.

This change supplies domain logic and tests only. It does not implement a UI, inspect the reference screenshot, or deploy anything. Responsive/interaction QA remains for the UI integration.

`observedThrough` is the requested analysis cutoff, **not** certification of continuous report coverage through that date. Pair it with the coverage pipeline's actual through dates and gap warnings.

## Distinct follow-on: descriptive client lifetime

The progression distribution can help describe observed session use, but cannot establish expected eventual client lifetime. A follow-on summary should report count, mean and median for both observed treatment visits and elapsed calendar days from first to last observed treatment (same-day duration zero). Split those summaries using the existing coverage-aware 90-day apparent-ending evidence into apparent endings versus observations with no confirmed apparent ending. The latter includes right-censored ongoing/recent clients and clients with insufficient coverage; retain a separate coverage-unknown flag/count rather than claiming all are known active. Even an apparent ending is not a confirmed discharge or guaranteed lifetime: later returns and left-censored history remain possible. Preserve the existing distinct-date establishment and ending rules, require applicable follow-up coverage, and never call these observed means expected eventual lifetime. No survival estimator is included. This follow-on is not implemented by the progression function.
