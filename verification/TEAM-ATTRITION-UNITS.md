# Team Attrition Denominator Wording

## Established Meaning

`estimateObservedClientEndings` in `artifacts/comp-dashboard/src/lib/retention-local.ts` creates one row per fully contained, fully covered mature calendar month. It returns `endingFullMonthDenominator = monthlyEndedClients.length` and `averageClientEndingsPerFullMonth = endingFullMonthClientEnds / monthlyEndedClients.length`, or null without a mature month. Each clinician metric copies those exact fields. This is an average number of client endings per mature calendar month, not a percentage or an exposure-adjusted client-month rate.

The existing Team KPI used that month count but labelled it "observed client-months". Sessions and Compare already use mature months. This separate candidate changes one Team label to "fully observed mature month(s)" with singular/plural handling. It changes no number, formula, observation gap, coverage rule, selected dates, attribution, layout, editor or persisted data.

## Numeric And Rendered Evidence

The synthetic fixture has three distinct clients established in December and ending in January, with complete reporting and mature follow-up. January has three established clients at its start, three qualifying endings, one eligible calendar month and an average of 3/month. Extending the range through February produces the same three endings over two eligible calendar months, 1.5/month. A January 15-31 selection has no fully contained month, so the average remains null, not zero.

- `artifacts/comp-dashboard/src/lib/team-attrition-units.test.ts`: two fixture tests pass and preserve all inputs.
- Full domain/dashboard-library suite: 658 tests pass.
- Dashboard typecheck and production build pass with existing nonfatal Vite notices.
- `node verification/team-attrition-units-render.mjs`: six desktop/mobile captures covering one month, two months and unavailable partial month; labels and unchanged values asserted; zero browser errors/API writes; original workspace/context/source fixtures unchanged.
- Images and JSON are in the existing untracked `verification/practice-workspace-render/` directory (`team-attrition-*`, `team-attrition-units-results.json`).

## Release Boundary

The preceding independently reviewed custom-date release was normally fast-forwarded to established main at `b78d1ac6dfe56f4240db11c5883c3e7d0b40916a`, tree `8904e984d8404d69d30770c5b23a02143f541585`. GitHub's advertised main hash was read back and matched. Its independent review executed dashboard typecheck, seven date/session tests and diff validation; the 28-case browser harness was reviewed but browser captures were not independently rerun.

This label correction is a separate candidate, not a main promotion or deployment. No production read/write, approval application or business-record change is performed. The four live billing exception approvals are untouched. No migration or data rollback is needed; reverting this candidate would only restore the old wording.

## Exact Independent Review

Runtime candidate: `45320e4211cc29ecbc3a97dbe06f9479ef9bc2b0`, tree `e6bf209af62ad5ac899b2bed8f0da76c31741093`.

Independent read-only Newton worker `01a13c09-3ccf-7641-a5bc-5e2a89f4d0f9`: **PASS**, no findings. The reviewer traced the mature-calendar-month denominator, confirmed that only runtime text changes, and independently ran both new tests (2/2) and diff validation. Browser captures were not independently rerun. No reviewer edits, production calls or promotion.

The subsequent verification-only checkpoint pins the read-only audit to this runtime; all 16 aggregate/identity-audit tests pass. Runtime code is unchanged by that checkpoint.
