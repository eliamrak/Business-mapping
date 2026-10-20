# October 20 Attrition and Caption Follow-Up Review

## Outcome and Boundary

**Accepted source checkpoint for the new observed-cohort period attrition capability and Overall activity caption. No blocking source finding remains in this bounded follow-up. Full October 19 actual-data, browser, delivery and native acceptance is not established.**

This is an independent follow-up to [the saved 21-item review](OCTOBER20-INDEPENDENT-21-ITEM-REVIEW.md), not a duplicate full review. The reviewer did not author the new attrition implementation. The reviewed source was dirty/uncommitted over HEAD `655bf5db928057f6df1829181f1c08a0ee3b97af`; the exact SHA-256 manifest below, rather than HEAD alone, identifies this checkpoint. Acceptance applies to those bytes. A later source change needs reconciliation with this manifest.

The only manual write by this follow-up is this new addendum. No runtime source, existing review, fixtures or other document was edited by this reviewer. No production access, actual client/profile inspection, browser interaction, deployment, native app interaction, HEAD change or commit occurred. The parent's renderer remains blocked; server-rendered synthetic component tests are not a new browser/render acceptance run.

## Original Findings Disposition

| Saved finding | Follow-up disposition |
| --- | --- |
| 1: item 15 has no whole-window percentage capability | Closed at source-capability level for an explicitly observed-established-client cohort. Full-window unique count and percentage now share eligible/event sets and actual requested dates. Unknown coverage, censoring or maturity withholds totals. This does not certify every historical client or actual business records. |
| 2: actual protected-payroll human identity | Open. Configured IDs and economic metric bindings still need the authorized real-account trace; no person or amount was inferred here. |
| 3: Overall consultation caption exposes `0000-01-01` | Closed in source and caption fixture. The internal filter sentinel remains unchanged; the primary caption says Overall recorded activity through the actual end date. |
| 4: actual repeated-4 and 43 investigations | Open. The read-only trace handoff is useful preparation, not execution or an explanation of those actual observations. |
| 5: original-note IDs absent from local register | Local documentation gap closed: the reconciliation register now supplies all 21 item IDs plus clarification/instruction IDs and times. These are attributed contemporaneous room-note references, not a newly retrieved verbatim transcript or independently authenticated audio. |
| 6: preservation/backout/public/native evidence | Open. No live preservation, rollback rehearsal, publication or running-wrapper release inspection was performed. |

## Updated Matrix Addendum

These statuses retain the original review's definition: implemented means locally supported behavior, not production or owner acceptance. Unchanged items are carried forward, not freshly re-reviewed in their entirety.

| Items | Prior status | Updated status and limit |
| --- | --- | --- |
| 1, 4, 6, 7, 8, 9, 13, 14, 17, 18, 19, 20, 21 | Implemented | Implemented; original evidence and qualifications carried forward. |
| 15 | Partial | Implemented source capability for whole-window observed-established-client count/percentage. Actual records and current browser presentation remain unverified. |
| 11 | Partial | Partial. Sentinel caption fixed; exhaustive legacy/app-wide help, hover and native accessibility remain outside this follow-up. |
| 2, 3, 5, 10, 12, 16 | Partial | Partial. Actual payroll identity/amounts, actual 4/43 investigations and the requested billing-code workflow evidence remain open as recorded in the original matrix. |

Updated whole-item tally: **14 implemented, 7 partial, 0 wholly missing**. All 21 original items are accounted for above. This replaces the original 13/8 tally only at the stated local/source scope; it does not convert unresolved actual-data or delivery gates into implementation evidence.

## Source and Safety Review

Paths below are relative to `artifacts/comp-dashboard/src/`.

- `lib/period-client-attrition.ts:35`: eligibility uses at least three distinct qualifying treatment dates and activity on at least one date of the exact window. Pre-window established clients active at the window start and clients first established inside it are both considered. The numerator uses the existing validated final-ending events and is asserted to be a subset of the unique eligible set. The percentage is `100 * uniqueEnded / uniqueEligible`; a zero denominator remains unknown.
- `lib/retention-local.ts:1823`: the new exported evidence wrapper reuses treatment classification, deduplication, verified attendance intervals, unresolved follow-up handling and `estimateObservedClientEndings`. Practice identity is unique client identity across providers; clinician identity remains the client/provider relationship. Known later returns remove earlier final endings, including returns after a 90-day gap. PHONE/documentation and repeated same-day rows do not establish three treatment dates.
- `lib/period-client-attrition.ts:40`: full-window coverage must span the requested dates through `end + 90`, with prior establishment coverage checked separately. Immature follow-up, prior gaps, boundary censoring and uncertain later evidence withhold count and percentage. The result explicitly says `cohortQualifier: observed-established-clients` and `allHistoricalClientsCertified: false`; it is not certification of an unseen complete historical population.
- `lib/period-client-attrition.ts:77`: a mature observed portion is separate from the requested full window, retains its actual contiguous start/end dates and is not used to fill the full-window totals. No sum of month-start populations or client-months supplies the denominator.
- `lib/historical-performance.ts:69`: both original 3/12-month reports receive the new output for their unchanged attrition windows. Page admission at `pages/practice-workspace.tsx:874` onward preserves the full identity roster/crosswalk when validating sources; admitted clinical snapshots and original classification/excluded follow-up evidence feed historical reporting. The helper's documented input contract requires that admission; it does not claim to replace identity resolution.
- `lib/overview-historical-capacity.ts:117`: Overview reads full-window total and percentage from the same period cohort. The old covered-mature-month average remains a separate measure. Normalized clinician matching requires one matching result, and missing legacy period output remains unknown.
- `components/practice/overview-historical-summary.tsx:73`: Overview displays matching count and percentage, discloses observed-cohort/coverage limits in details, labels a mature portion with its actual dates and explicitly says it is not the full trailing window. Recent-minus-year attrition differences use percentage points; monthly averages keep their separate mature-month units.
- `lib/practice-period.ts:4` and `pages/practice-workspace.tsx:4639`: `activityPeriodCaption` removes the Overall sentinel from primary text without changing the date filters. The caption test also preserves exact custom dates.

Independent structural check: after removing only the new `periodClientAttritionEvidence` declaration and comments, the TypeScript-printed AST of `retention-local.ts` matches `git show HEAD:<path>` exactly. Existing retention/ending calculations and defaults are therefore unchanged by the reviewed wrapper addition.

## Fresh Verification

Focused command, run without browser/production access:

```sh
node --test artifacts/comp-dashboard/src/lib/period-client-attrition.test.ts artifacts/comp-dashboard/src/lib/retention-local.test.ts artifacts/comp-dashboard/src/lib/retention-local.privacy.test.ts artifacts/comp-dashboard/src/lib/historical-performance.test.ts artifacts/comp-dashboard/src/lib/historical-performance-periods.test.ts artifacts/comp-dashboard/src/lib/overview-historical-capacity.test.ts artifacts/comp-dashboard/src/lib/overview-historical-summary.test.ts artifacts/comp-dashboard/src/lib/practice-period.test.ts artifacts/comp-dashboard/src/lib/complete-report-coverage.test.ts
```

Result: **164 passed, 0 failed, 0 skipped**. Dashboard `tsc --noEmit --incremental false` passed. `git diff --check` passed before adding this report. These are scoped regressions, not a repeated full 21-item review.

The July counterexample was freshly reproduced through the helper and component fixtures: complete June-November attendance, three distinct treatment dates July 2/9/16, as-of November 30, exact July window -> **1 unique eligible client, 1 validated ending, 100%**. The unchanged old July month-start population is **0**, and is not used as the denominator. A November return makes July endings 0 with positive eligible count and 0%. An October 20 observation leaves full July totals unknown while the separately labeled mature portion is July 1-22.

Additional independent arithmetic probe: 80 generated synthetic practice/provider histories, checked by a separate daily-state eligible-set calculation. **28** certifiable practice/clinician set/count/percentage comparisons matched; **212** left-censored controls correctly remained unknown. Practice uniqueness, clinician scope, PHONE/documentation exclusion and duplicate dates were included, and all inputs remained unchanged. The initial probe incorrectly expected every generated history to be certifiable; it was corrected to account for the specified left-censoring guard. That initial assertion failure was not a product defect.

Tests also cover inclusive day-90 boundaries, active-before-window clients without in-window visits, partial exact dates, multiple providers, transfers/later returns, incomplete or contradictory coverage, quiet provider-specific proof, uncertainty/future rows, zero endings, zero denominator, frozen evidence, explicit mature-portion dates, missing legacy output, identity withholding, and percentage-point versus monthly units. No additional blocking source/math issue was established.

## Accepted Source Fingerprints

SHA-256 at the reviewed dirty-source checkpoint. `src/` means `artifacts/comp-dashboard/src/`.

| File | SHA-256 |
| --- | --- |
| `src/lib/period-client-attrition.ts` | `90b0427baf01550890cc302ab37f47b2028076888d3d490841faa42154f27b84` |
| `src/lib/period-client-attrition.test.ts` | `b42dbc6cfc7482a1017434dcbbc06bae4f677285c476a8c7116274b3aac5fede` |
| `src/lib/retention-local.ts` | `d94339cc8f97ca2520c7bdc05635a442d61b53cb55bdf5e6bf3be1d574d6ae2e` |
| `src/lib/historical-performance.ts` | `7ae8980a61540746637a71ed532bcfce6b22b76db0483d33686f3547c0e9ca44` |
| `src/lib/historical-performance-periods.test.ts` | `3c1bfe18f79924b23ba3101cf5efbf8653104fa132fb43b5520e50c787063f83` |
| `src/lib/overview-historical-capacity.ts` | `13a8e6b99e1c7bf33ba347d4e60f9a7ae42c324d1de9a519de61e0446c6f4805` |
| `src/lib/overview-historical-capacity.test.ts` | `ba0af1e5b18e4b266fe462ceb5660f3636b5e1b6295f0ebdd7745355a399a547` |
| `src/lib/overview-historical-summary.test.ts` | `8ad9079522c9fc4e10279c67edd77a3d885207902a41ce382e1b810caac13d73` |
| `src/components/practice/overview-historical-summary.tsx` | `81edd829840f10ffd20658d5f64e88f557c3e4c91c1fe9a74f4f5058fd49599d` |
| `src/lib/practice-period.ts` | `125855f11be3c87d9079943746ec8d4ea3cba2deee3adb22045a6b207f4b3509` |
| `src/lib/practice-period.test.ts` | `3f4c32435313a51f17eb9236d0c3c65102f788813f2f13947ec0170f142f1630` |
| `src/pages/practice-workspace.tsx` | `d7db6643dbbbd1b6fde70249ed8c29148e7c2b7d7fe6a3111325120b4566766e` |
| `verification/OCTOBER19-REQUIREMENTS-RECONCILIATION.md` | `6f84996871ea27d5c58e1f226343a9ae9e8154f808e624b6a418595b3e276043` |
| `verification/OCTOBER20-READONLY-SOURCE-TRACE.md` | `b72ed8b9a579e6a4f0a919cf694fd511bfd45bbc93393c52ecf210250eaf9536` |
| Original saved `verification/OCTOBER20-INDEPENDENT-21-ITEM-REVIEW.md` | `d85fbdcc8d6451afa78d44b9cabecec570134a700a67e2c82abd14a35deb36ae` |

## Remaining Acceptance Gates

The [read-only source trace](OCTOBER20-READONLY-SOURCE-TRACE.md) documents a route for the parent's authorized reader; it does not establish that the reads happened. Actual recipient identity and configured amounts, real 4/43 source reconstruction, the billing-code workflow question, broader help/accessibility evidence, current browser rendering, live preservation/backout, publication and running native asset remain separate gates. No actual-data or full-21-item acceptance is granted by this addendum.
