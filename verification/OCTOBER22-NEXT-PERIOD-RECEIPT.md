# Known next reporting period

Reviewed base: `1a46ec5a1e15bd2823adea95a04a01ca20ad7783`. This receipt describes source and synthetic acceptance, not deployment or a live declaration update.

## Calendar and behavior

The established biweekly contractor calendar gives October 8–21 inclusive, paid October 22. The September 10–23 / September 24 example supplied by the owner agrees with `family-pay.ts` and `complete-periods.ts`. The owner explicitly described this upload as the next reporting period. The app must not infer dates from occupied appointment days or ask for those known dates again.

Normal uploads show Next full period and its known dates before file selection. Other report retains raw history without extending declared coverage. A saved next-period package displays a pure proposal and an explicit Reconcile this period action; mounting or reading the page never updates declarations. Future next-period uploads acknowledge raw persistence first, then reconcile the exact saved pair when safe. Unknown acknowledgement requires a saved-history reload rather than a repeated upload.

The pure planner preserves all previous declarations and appends combined frozen attendance/billing sets. It checks provider scope, source identity, all earlier carryover facts and their multiplicity, dates, conflicting attendance/billing facts and the existing billing-resolution journal. It does not use source row hashes alone to claim that changed facts match. Already-included uploads do not create another declaration revision. Previously reviewed/excluded sources are not silently enabled by a new automatic proposal.

Package membership is bound server-side to the exact active saved package. Existing import audit receipts now preserve both validated source IDs even when a collection is reused. Legacy packages with exactly two owned sources retain their unambiguous fallback. Missing or inconsistent legacy pair provenance is a specific review exception, never a guessed counterpart. The declarations transaction rederives the proposal under its existing advisory lock and revision compare-and-swap before any write.

## Actual evidence versus synthetic evidence

Structural read-only inspection of the owner's supplied package found 164 attendance rows, including 25 October 7 carryovers (19 shows), and 109 billing rows. It did not contain selected-period proof. Neither those counts nor minimum/maximum row dates establish a complete reporting period; the established calendar and owner's next-period statement provide the intended period instead.

The synthetic fixture proves that 25 matching carryovers are not counted twice. **The actual 25 rows have not been compared with the owner's admitted source history in this local environment.** The read-only live proposal will perform that comparison, expose matched/total counts, and block on changed facts or missing prior evidence. No actual file was uploaded, source declared, resolution approved or business record edited by this work.

## Validation

- 1,211 functional tests, including 29 pure planner tests.
- 77 explicitly named database-free API tests, including 19 next-period handler cases.
- 14 mounted browser checks at 1440, 390 and 320, including keyboard controls, no redundant date-confirmation request, duplicate/Other-report behavior, genuine carryover conflict, stale revision and lost acknowledgement recovery.
- Shared library build, dashboard/API typechecks and both production builds pass.
- Independent source/numerical disposition: `NEXT-PERIOD-INDEPENDENT-REVIEW.md`; rendered evidence: `next-period-render-results.json` and reproducible harness `next-period-render.mjs`.

No database migration, dependency, artwork/icon, clinical metric definition, financial assumption or deployment contract is changed. No real-data fixtures are tracked. Browser emulation is not physical iPhone, native macOS or VoiceOver acceptance.

## Publisher gates

Use only the base-to-reviewed-candidate delta. Re-read the actual clean publisher HEAD/tree, check touched-file preimages against the base, retain a rollback ref, apply with `git apply --check --index` followed by `git apply --index`, and create a normal descendant commit. Preserve all publisher memory/history, `.replit`, artifact contracts and accepted mobile-readiness changes. Do not reset history or copy a development database.

Run the commands in `CLOUD-DEVELOPMENT-HANDOFF.md`. After a coordinated publication verify public assets, API/mobile readiness, and owner Data read-only: eight saved sources (unless legitimately changed by the owner), existing configuration/revisions/journal, prior declarations preserved, expected October 8–21 proposal and actual matched/25 count or a precise exception. Do not click Reconcile or import a real file as a deployment test. Verified coverage remains October 7 until an authorized reconciliation is acknowledged.
