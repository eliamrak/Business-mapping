# Independent Recovered-Decisions Review

## Exact Candidate

Final runtime: `fdb013c336a1209cd0170c918e002a31377519fe`, tree `8513df816868b2496271508c81013629da969e74`. This follows the broad implementation commit `b3eb91e` and a two-line owner-obligation correction. Documentation/evidence commits do not change runtime source.

## Clinical Review

Independent read-only reviewer Pauli reproduced three defects in the evolving implementation: canonical period clipping moved the calendar range, excluded known returns could become false endings, and an unrelated team's later source could shift the selected team's calendar. All were corrected before runtime freeze.

Final bounded review: **97/97 clinical tests passed**, including eleven historical cases. Covered weighted ratios, date/pay-filter independence, original report bounds, true-today later-return evidence, future exclusion, maturity denominators, unrelated teams, quiet coverage, scoped aliases and ambiguous identity guards. No remaining clinical blocker found. Later runtime changes only altered the owner payroll input handoff, not the historical helper/hook.

Stable reviewed helper SHA256: `6294f02e059c5952c0762246f3dbc1b5ba2ea501b4ff5158c49ecf882ee7d5fb`; test SHA256: `0ec70c3967cea3735ad37ada51781e95ce9f1a25e0e72f5c87e76afa00829fd5`. Additional detail: `HISTORICAL-PERFORMANCE-REVIEW.md`.

## Money Review

Independent read-only reviewer Raman reproduced and drove repairs for exactly100% percentage floors with a finite funding solution, absent co-owner nulls, configured tax/reserve obligations, ambiguous payroll budgets with an explicit resolution path, salary subtraction residue, and preservation of real owner-budget costs while excluding inherited owner targets.

Final exact-candidate review of `fdb013c`: **9/9 independent synthetic tests passed**, no remaining finding in the reviewed Money scope. Reviewed runtime files matched HEAD. Tests covered finite/impossible funding, protected salary and material subset mismatches, immutable inputs, yearly/monthly overhead, saved settings and add/remove comparison, full monthly forecast inputs, legacy owner targets and the separate $700 owner obligation. The author separately validates the $700 case through the actual workspace UI.

Reviewer scripts were run only against synthetic local fixtures: `/tmp/independent-money-final.mjs` (`node --test`) and `/tmp/recovered-history-review.mts`. No reviewer accessed production business records, edited source, committed or deployed.

## Limits

These reviews do not certify production business totals, source completeness or authentication. They are separate from author unit/API/build/render acceptance and the existing release task's source preparation, preservation comparisons, publication and live verification. Revenue needed is a labeled funding estimate holding monthly costs and contribution goals fixed; changed staffing or variable costs requires refreshed estimates, not a claim of an optimized session-volume solution. Zero mature covered historical months remains unknown, not a fabricated attrition average.
