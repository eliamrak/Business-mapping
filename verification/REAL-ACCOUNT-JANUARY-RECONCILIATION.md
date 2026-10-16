# January Real-Account Reconciliation

Private business aggregates only. No client identifiers, source rows, encounter keys, source hashes or notes are included.

## Scope And Evidence

The authorized cloud worker executed the independently reviewed SELECT in the existing production SQL UI on October 16, 2026. It completed in six seconds with `READY_AGGREGATE_DIAGNOSTIC_NOT_UI_CERTIFICATION`. This local author did not connect to production. Results below are the cloud worker's supplied aggregate evidence, compared there with freshly loaded live screens.

Runtime: main `61fc0384ba016e08decdc22b3640d34bf5dfe635`, asset `index-Chaf82Hs.js`. Diagnostic: audit-only commit `ea951881bfaa202072bdc456563dd9a2d2b3ed0f`, original SQL SHA-256 `0991252864d8f5b56abccf009e3d1081494bcc664098d00cd15b895414725fbc`. Observation date October 16, 2026; service windows January 15-28 and January 1-31, 2026. Later diagnostic extensions are not part of this frozen result.

## Whole Practice

Each value independently computed in SQL matched the captured live display within display rounding.

| Measure | January 15-28 | January 1-31 |
| --- | --- | --- |
| Treatment sessions | 94 | 207 |
| Covered attendance days | 14 | 31 |
| Sessions per week | 47 | 207 * 7 / 31 = 46.741935... (display 46.7) |
| Initial retention, retained/evaluated | 4 / 6 | 10 / 15 |
| Pending initial starts | 0 | 0 |
| Practice consult conversion, converted/evaluated | 5 / 6 | 17 / 21 |
| Pending practice journeys | 0 | 0 |
| Exact-date established client endings | 4 | 7 |
| Mature full attrition months | 0 | 1 |
| Average endings per mature month | Unavailable, no whole month in selection | 7 |
| Covered billing days | 14 | 31 |
| Accepted billed charges (USD) | $15,035 | $33,035 |
| Accepted charge rows | 105 | 238 |
| Valid two-charge exception groups | 1 | 1 |
| Unknown fee groups / stale approvals | 0 / 0 | 0 / 0 |

Admission precedes date clipping: January 29-31 facts count toward January when their January 29-February 11 canonical source period is fully admitted as of the observation date. The shorter selected window does not require the whole source period to lie inside January.

## Clinician Comparisons

All 14 clinician/window rows (six approved clinicians plus Whole Practice for two windows) matched the captured session counts, coverage denominators, retention numerators/denominators and pending starts, attrition denominators, and consultation attribution. All six clinicians had full 14/31-day attendance and billing coverage. The approved roster was Erin Mrakovich, Elia Mrakovich, Natalie Rieke, Michele Teague, Jessica Cockrum and Jessica Yates. No individual totals not supplied in the aggregate handoff are invented here.

Reported nonzero clinician pending-attribution counts also matched the UI: biweekly Elia 2, Natalie 2, Michele 2; January Elia 8, Erin 1, Natalie 7, Michele 5. There were no confirmed clinician closer denominators. These pending-attribution counts are not the practice's pending-follow-up count and do not turn observed practice conversions into confirmed clinician credit.

## Source Integrity And Limits

- Declaration revision 1, two valid frozen source sets, four active snapshots, four billing-approval journal entries, six current consultation-cohort clinicians.
- Zero invalid source dates, unmapped rows, attendance conflicts, cross-encounter billing hash collisions, PHONE charge anomalies or stored multiplicity overrides.
- Exactly one approved two-charge group in each window: Michele's January 21 exception. Both pinned charges are retained; attendance is not multiplied.
- Final cloud preservation checks at 15:04-15:05 UTC were clean: all 11 fingerprints, declarations, existing audit hashes and approvals unchanged. No business-data edits, migration or runtime deployment occurred.
- Billed charges are not collections, payroll or profit. Actual costs, payroll, collections and profit remained unknown in the displayed report; this audit does not certify them.
- This is bounded acceptance of the stated January metrics/windows, not all historical dates, all forecasts, cash accounting, source-report provenance or lifetime-client history.

## Separate Display Findings

Numeric reconciliation found no discrepancy. It did find misleading provenance labels: individual retention appeared unverified despite the admitted selected coverage; January Money was labeled partial; January limitations included global source/forecast warnings. The retention tail explanation is demonstrated by source and synthetic regression only: the frozen production diagnostic did not return excluded-tail diagnostics. Do not call that exact real-account mechanism confirmed without the separately reviewed aggregate extension. Label repairs and their release verification are separate from this completed numeric reconciliation.
