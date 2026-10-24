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

Return fields: `basis`, `start`, `end`, `observedThrough`, normalized `clinician` or null, `eligibleClients`, `clientsWithUnresolvedEvidence`, `rows`, and `lifetime`. Each row has `session`, `eligibleClients`, `completions`, `reachedPct`, `changePercentagePoints`. Defaults to eight rows; optional `sessions` supports 1–100.

Recommended title: **Observed session progression**. Subtitle must explain first-observed cohort dates, observation cutoff, clinician membership rule, and incomplete-history limitation. Use “clients reaching session” for completions, not total appointment volume. The chart plots `session` against `reachedPct`; tooltips and the table expose counts and denominator. The first change is an em dash, not 0%; empty cohorts use null percentages and an explicit empty state. Percentage-point changes derive from unrounded percentages; round only for display (e.g. one decimal and `pp`). No estimates or illustration counts are inserted.

This change supplies domain logic and tests only. It does not implement a UI, inspect the reference screenshot, or deploy anything. Responsive/interaction QA remains for the UI integration.

`observedThrough` is the requested analysis cutoff, **not** certification of continuous report coverage through that date. Pair it with the coverage pipeline's actual through dates and gap warnings.

## Descriptive client lifetime (implemented)

`lifetime` is returned alongside progression, for exactly the same first-observed cohort and cutoff:

```ts
{
  basis: "observed-first-to-last",
  endingGapDays: 90,
  apparentEndings: ObservedLifetimeGroup,
  ongoingOrCensored: ObservedLifetimeGroup
}
// Each group:
{
  clients: number,
  meanSessions: number | null,
  medianSessions: number | null,
  meanElapsedDays: number | null,
  medianElapsedDays: number | null,
  coverageLimitedClients: number
}
```

Observed sessions include all derived eligible treatment visits through cutoff, across referrals. Elapsed calendar days are the UTC first-to-last treatment date difference (same-day duration zero), not days through cutoff and not inclusive date counts. Mean and median are unrounded; empty groups have null statistics. UI should display both group counts, mean and median for sessions and elapsed days, with units.

`apparentEndings` reuses `periodClientAttritionEvidence` with practice-wide follow-up: at least three distinct treatment dates, the latest eligible treatment at least 90 days before cutoff, and the existing verified follow-up absence and unresolved-evidence safeguards. It does not add the 28-day initial-retention requirement to the separate ending definition. Later returns move the observed last date and may move a client out of apparent endings. Clinician filtering only selects cohort membership, never truncates ending evidence.

`ongoingOrCensored` means **no confirmed apparent ending**, including ongoing/recent clients, fewer than three distinct treatment dates, or uncertain coverage. Do not label all of these clients as known active. This group includes right-censored observations; its mean is an observed-so-far summary, not completed lifetime.

`coverageLimitedClients` counts group members without continuous practice-wide verified evidence from their first observed date through the requested cutoff, or with unresolved evidence through cutoff. This deliberately conservative warning may also occur in the apparent-ending group if the required 90-day ending window is verified but earlier history or later coverage has gaps. It is not a measure of known left-censoring and does not certify history before the first observation. Always display the first-observed-history limitation and existing source-coverage warnings even when this count is zero.

Suggested title: **Observed client lifetime**, with group labels **Apparent endings (90-day rule)** and **Ongoing / censored observations**. Explain that an apparent ending is not a confirmed discharge or guaranteed lifetime; later returns and missing earlier history remain possible. Never call these observed means expected eventual lifetime. No survival estimator is included.
