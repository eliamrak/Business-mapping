# Historical Billing On Current Reader

Runtime/test candidate: `046a8e7440474abbcd3b56aa29daa49f8cf8ea2b`, tree `4b1bf18b1d6a11ce2fa2b425ca912b86d12183e1`.
Branch: `codex/historical-billing-current-reader`. Not deployed or activated by this task.

## Scope

Reapplies the historical billing-only registry and ledger on the published legacy-code/zero-code/late-cancellation reader. No converter change, migration, source rewrite, clinician card, forecast inclusion or automatic admission. Historical identities retain the exact source labels, including the `(deleted)` prefix. Unknown future deletion-marked imports still stop for review; already persisted snapshots can be explicitly registered.

Independent review identified an Overall range bug: proof-only bounds could omit older retained unconfirmed billing. The candidate now includes retained billing dates, with a regression test. Historical keep-both approvals now bind a historical UUID instead of inventing a clinician ID. Each approval has exactly one historical or clinician binding; exact charge/source anchors, revision checks, lock, idempotency and original journal entries remain intact.

## Confirmations Already Supplied

The parent relayed owner confirmation of complete attendance and billing reports for July 1, 2025 through October 12, 2026, including former clinicians. Owner confirmed all three exact identities as historical only: `(deleted) Jordan Madison`, `(deleted) Sara Bucksten`, `(deleted) Sarah BruBaker`. Owner authorized keeping both Sara October 3, 2025 charges, $110 and $150. Do not ask these decisions again.

Parent-reported stored package `pkg_34768e42ba3d8ddbc4313632`: exported `2026-10-16T19:59:53Z`, imported `2026-10-16T20:00:55.463Z`; attendance `attendance-101bc22209d8152b` (4823 rows), billing `billing-582927eaaff23946` (3681 rows). Both stored coverage proofs remain null and frozen declarations do not admit them yet. Reported 47 late-cancellation subtype rows are stored. These are coordination facts, not independent real-data certification by the local tests.

## Smallest Existing-UI Path

1. Publish the reviewed exact compatible candidate after preservation checks. Code publication alone does not change identities or admission.
2. In Data & imports, provider/source-set review: retain all six existing clinician mappings exactly. Select Historical billing only for the three exact prefixed labels. Keep original source members active, including all four approval anchors; add the two new sources to the corresponding reviewed attendance/billing sets. Set confirmed bounds `2025-07-01` through `2026-10-12`; include only sources whose entire service-date contents fit those bounds. Save the already-authorized declarations through normal revision-checked UI.
3. Reload Billing charge exceptions. The exact Sara `2025-10-03`, `90837`, $110/$150 case should now permit its existing authorized keep-both decision. Save via normal UI with a note recording that prior owner authorization. Verify the journal advances four to five and the original four entries/anchors are unchanged. No fabricated card or direct SQL write.
4. Reload and independently reconcile historical provider/month charges and October overlap. Current-team clinical/operating admission ends at the completed canonical period through October 7. October 8-12 remains partial evidence; never certify October 8-21 complete. Historical service-date billed charges can include July 1 and October 12 but are not cash, costs, payroll or profit.

If any exact evidence or scope differs, stop that save and report the concrete discrepancy. No reimport is required for already stored source facts.

## Verification

- 693 domain/dashboard tests pass, including full synthetic 4823/3681-row shape, 47 preserved late cancellations, prefixed identities, frozen admission, Overall extent and historical approval binding.
- 45 focused API/audit/former/mapping controls pass. A new API test preserves four approvals, saves a fifth historical approval, confirms idempotency, and makes it stale when its identity is removed; no roster/source/declaration mutation.
- 40 fresh isolated PostgreSQL/API tests pass with synthetic signed Clerk sessions and no real credentials. Evidence: `/var/folders/v1/nrrw04y90g3b9s27scm3_f1r0000gn/T/practice-isolated-api-ATmbpi`.
- Library, dashboard and API types pass; dashboard and API builds pass. Existing nonfatal Vite chunk/source-map warnings remain.
- Actual workspace mounted with synthetic API/auth context: six desktop/mobile states, explicit confirmation/reload, July 1 ledger inclusion, no historical Team card, zero browser errors/overflow. Approval controls require note and confirmation. Evidence: `/tmp/historical-current-reader-render/results.json` and focused mobile PNGs. This is not hosted authentication or real account acceptance.

## Backout And Limits

No production mutations or real file access by this task. Do not roll back to a pre-late-cancellation strict reader: 47 stored subtype rows already make that unsafe. After the first historical approval is saved, a reader must also understand `historicalProviderId`; older approval schemas reject it. Use compatible forward repair/backout code that preserves the journals and subtype support, never delete approvals or strip fields to make an old reader load.

The historical registry remains metadata in its existing scoped audit journal, not a staffing record. Business-table/source preservation, actual five-approval replay and real monthly totals must be verified in the authorized production environment after intentional metadata saves. Existing six-current-clinician legacy SQL is not a combined historical-ledger certification tool.
