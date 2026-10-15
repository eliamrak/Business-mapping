# Complete-Period History Review Candidate

Publication HOLD. This replaces the older partial-period, today-boundary and historical-revenue rules recorded in WORKING-FORECAST-REPAIR-ACCEPTANCE.md. The prior reviewed ab812508 candidate is not approval for this replacement. No production publication, database migration or business-record mutation was performed for this work.

## External Identity Blocker Repair

External review blocked b2f077fa for one P2: selected-team filtering hid distinct IDs with the same normalized name on other teams, allowing name-only report rows to claim verified coverage, visits and billed fees. This replacement validates names against all known Context clinician IDs before reporting scope. The coverage helper accepts a separate global identity roster; current-team Imports and financial callers pass it explicitly. Clinical follow-up keeps the full identity roster without name deduplication. The session/billing overlay also resolves selected names against all known distinct IDs before admission. Other-team, former or inactive identities cannot disambiguate name-only rows by being removed. Repeated aliases for the same ID are not a distinct-person collision.

Reporting requirements remain scoped: unrelated uniquely named clinicians do not need complete reports for the selected team's through-date. No identity crosswalk, new provider ID, source value or inferred ownership was invented. Independent bounded review found no remaining issues across cross-team, unassigned and inactive collisions, same-ID aliases and unrelated-provider controls. This is not the required external exact-SHA re-review.

## Contract

- Actual totals and historical averages admit only complete canonical 14-day service periods, anchored January 1, 2026. Current incomplete periods, unverified imported rows and unallocatable partial aggregates are excluded from both numerator and denominator, not filled with zeros or prorated. Source evidence is retained.
- A single explicit report declaration must enclose a whole ended service period. Two partial declarations do not combine into completeness. Invalid/out-of-bounds rows invalidate that report proof. Occupied min/max service dates and upload timestamps are never completeness evidence.
- The working baseline uses whole eligible periods within exactly three calendar months ending at the latest common complete activity period. Gaps are excluded; proved quiet periods are zero. No desired-volume, vacation, growth, attrition or room haircut is applied to that baseline. Planning/scenario behavior remains separate.
- The future begins the day after the latest verified complete activity or billing report, not today or upload time. Activity and billing through-dates remain distinct. Later billing cannot certify missing sessions, and later activity cannot certify missing fees; historical gaps remain unknown rather than forecast-filled. The activity baseline retains its own independently proved cutoff.
- Historical session income uses actual billed fees from admitted complete periods. Future working revenue uses fixed, dated clinician-card fees, not historical billed overrides. Actual expenses/pay still require complete finalized ledger evidence. Billed fees are not cash collections.
- The revenue decision does not choose a new percentage-compensation fee basis. Configured contractual compensation terms remain unchanged. Paid PHONE revenue classification remains unresolved; charge facts are retained and affected treatment-income totals are withheld.
- Imports prominently show Data covers through, separate attendance/billing through-dates, excluded rows and incomplete/gap periods. Details retain full source limits and reconciliation. Quiet derived provider-period scope contains no invented visit rows and is not persisted.
- Excluded partial follow-up never counts as an actual conversion, retained visit or ending. It blocks contrary consultation/attrition absence certification until a complete replacement resolves it. Ambiguous normalized clinician identities cannot select the first ID silently.
- Overall starts at verified imported or canonical manual-period proof, not the first occupied or retained partial service date. Source admission happens before admitted-export billing reconciliation, so retained partial conflicts cannot poison a later full report.

## Evidence

Dedicated synthetic browser harness: `verification/complete-period-contract-render.mjs`. It freezes time, mocks every API and blocks non-read methods. Six scenarios, 18 desktop/mobile captures:

1. Complete September 24-October 7 report plus retained high partial October 8-14: 14 eligible sessions / 14 included days = 7/week. $490 billed actual + $700 future card-fee revenue = $1,190; excluded partial $70,000 never enters actuals.
2. Full October 8-21 replacement: 28 eligible sessions / 28 days. $1,190 billed actual + $700 October 22-28 forecast = $1,890. Original partial snapshots remain byte-equivalent; no API writes.
3. Removing reportCoverage leaves occupied endpoints unverified. No inferred proof from row density or upload date.
4. Duplicate normalized clinician names leave mapped coverage unverified instead of choosing the first ID.
5. Moving that duplicate to team 999 still leaves coverage unverified, zero admitted visits/billing rows, unknown Money and no false $1,190 actual claim. Imports and Money are captured on desktop/mobile.
6. Renaming only the other-team duplicate to an unrelated unique name restores the selected team's October 21 coverage and 28 admitted visits without requiring an unrelated report.

Replacement results and images: `/tmp/practice-global-identity-contract/complete-period-contract-results.json` and `complete-period-*.png` in that directory. Without PRACTICE_RENDER_OUTPUT, the harness defaults to `verification/practice-workspace-render/`. The 45-capture broad workflow regression, 15-capture staff regression, eight-capture period regression and two-capture revenue regression also passed. Period fixtures show billed January/February income and profit $33,035/$31,370, total $64,405, without an unsupported practice benchmark. Revenue fixture uses explicit August 13-October 7 coverage: 43.875/week and November card-fee revenue $31,797. These are invented test fixtures, never production seeds.

Coverage/clinical/core/financial regressions include: halves do not prove a period; partial rows cannot override complete manual evidence; a full replacement advances actuals without deletion/double counting; quiet provider periods keep observation maturity; incomplete follow-up blocks false misses/endings; Overall excludes unverified earlier rows but includes proved manual history; clinician ordering cannot change aggregate coverage; activity/billing mismatch preserves known billed facts without overlapping forecast.

## Verification Result

- 627 domain/dashboard tests pass, zero failures. Five database-free API coverage tests pass.
- Library, dashboard and API typechecks pass. Dashboard and API production builds pass. Existing bundle-size, mixed-import and sourcemap warnings remain; no new build failure.
- 88 synthetic desktop/mobile captures pass across the five harnesses above. Dedicated contract, period and revenue probes report zero API writes and zero browser errors. The broader workflow/staff harnesses exercise mocked edits only, with existing local Clerk-loader warnings handled by the harness. Navigation geometry and horizontal overflow assertions pass. Author inspected the repaired cross-team Imports mobile pixels as well as the earlier Imports/Money captures.
- Independent bounded reviews reproduced and drove repairs for false consultation/attrition absence, lost quiet-period scope, duplicate-name mapping, manual-only Overall bounds, order-dependent aggregate pruning and billing/activity boundary mismatch. A reviewer who did not implement the financial repair independently verified its final mismatch cases (including a separate $437 probe), canonical boundary validation and unchanged activity baseline: 29 focused tests pass. Another reviewer independently rechecked attrition/source plumbing, including Overview. These are source-state reviews, not external exact-SHA release clearance or real business-number certification.
- Replacement logs: `/tmp/global-identity-tests.log`, `/tmp/global-identity-api-tests.log`, `/tmp/global-identity-types.log`, `/tmp/global-identity-build.log`, `/tmp/global-identity-contract.log`. Contract evidence: `/tmp/practice-global-identity-contract/complete-period-contract-results.json`; broad: `/tmp/practice-global-identity-main/metrics.json`; staff: `/tmp/practice-global-identity-staff/configuration-roster-results.json`; period: `/tmp/practice-global-identity-period/working-period-repair-results.json`; revenue: `/tmp/practice-global-identity-revenue/revenue-repair-results.json`. Source regressions are in complete-report-coverage.test.ts, import-derived-sessions.test.ts and practice-financial-range.test.ts; fixtures retain raw-input equality and inverse controls.

## Reproduce

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts
node --test artifacts/api-server/test/practice-report-coverage.test.mjs
corepack pnpm run typecheck:libs
corepack pnpm --filter @workspace/comp-dashboard run typecheck
corepack pnpm --filter @workspace/api-server run typecheck
PORT=4318 BASE_PATH=/ corepack pnpm --filter @workspace/comp-dashboard run build
corepack pnpm --filter @workspace/api-server run build
PORT=4318 BASE_PATH=/ VITE_LOCAL_PREVIEW=true corepack pnpm --filter @workspace/comp-dashboard run dev --host 127.0.0.1
PRACTICE_PREVIEW_URL=http://127.0.0.1:4318 node verification/complete-period-contract-render.mjs
PRACTICE_PREVIEW_URL=http://127.0.0.1:4318 node verification/render-practice-workspace.mjs
PRACTICE_PREVIEW_URL=http://127.0.0.1:4318 node verification/staff-configuration-render.mjs
PRACTICE_PREVIEW_URL=http://127.0.0.1:4318 node verification/working-period-repair-render.mjs
PRACTICE_PREVIEW_URL=http://127.0.0.1:4318 node verification/revenue-repair-render.mjs
```

## Release Limits

No invented business values were imported. No persisted schema or migration changed. Derived filters/clones leave manual records, report rows, source hashes, legacy metadata and backups intact; backing out the source revision does not require deleting data. Legacy reports without explicit coverage remain unverified. Stored metadata has no authoritative provider roster, so an absent provider cannot be assumed to have zero visits. No authenticated database integration or live business-number certification was performed.

The replacement must receive independent exact-SHA review and the user must see corrected screens before any publication. Local source reviews and synthetic tests are evidence, not production-data certification. Main and the existing live deployment must remain unchanged for this review handoff.
