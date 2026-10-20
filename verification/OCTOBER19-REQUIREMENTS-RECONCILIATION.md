# October 19 Requirements Reconciliation

Audit opened October 20 against source `7f54613a9ace519cb587b5b72af739cd7a5087ef`.

## Authority and Failure

The parent recovered the October 19 contemporaneous room notes, including the user's 14:09:03 UTC instruction to build the full repairs list and start implementation. These requirements were already requested on October 19, not newly invented on October 20. The October 18 derived checklist and its passing tests did not cover this later scope. The selector was not just a misunderstanding of an earlier ambiguous default/year option: October 19 items 6, 14, 18, 20 and 21 explicitly required simultaneous comparisons.

Original-note source messages include `Sentinel_0fad7bd98c408191bced82aae9a13830` (item 6), `Sentinel_3dbb59b6c6188191ae5923018cec1133` (item 14), and the messages listed below. This document does not claim access to a raw audio transcript. The parent subsequently forwarded three filtered batches containing all items 1-21 and clarifications, resolving the initial middle-payload truncation. Those contemporaneous notes, not the older derived checklist, govern acceptance.

## Acceptance Matrix

Statuses below describe the pre-repair source, not certification of business numbers.

| Original note | Requirement | Initial finding / Follow-through |
| --- | --- | --- |
| 1 | Compact Money allocation table, squared dividers; bring goals and allocations together | Partial. Existing table remains large; goal controls remain separated. Compact presentation repair in progress; colocation still to audit. |
| 2 | Fix Goals text/button overflow and confusing organization; Owner Erin, Co-owner Elia | Layout unverified at target sizes; identity/funding mapping requires cross-screen audit. A table was proposed, not mandated. |
| 3 | Erin owner payroll protected before optional goals; Elia distributions not protected; warnings never block sandbox edits | Existing protected-salary implementation present. Exact identity mapping and all downstream labels still to verify; do not relabel alone. |
| 4 | Current allocation ($/month) = current percentage x displayed estimated billed income; not cash | Missing label: component still says Current estimate. Repair in progress; retain billed-income basis. |
| 5 | Current allocation beside Budget needed, dollar gap and required percentage; quarterly editable tax-planning estimate / 3; normalized saved opex; configured Erin, therapist, admin pay | Missing labels; existing tax funding model needs audit because current 3% allocation cannot establish liability. Missing tax estimate must not become zero. |
| 6 | Sessions both trailing periods inside each historical card, no toggle | Missing. One historicalPeriod state selects one result. Dual unchanged-engine calculations and card integration in progress. |
| 7 | Plain Close rate headline, supporting sample size and pending in details | Missing: Consult to treatment conversion headline remains. |
| 8 | Shared top Sessions scope, remove redundant independent consultation selectors; investigate Compare scroll jump | Missing redundant selector removal; underlying state is shared but duplicated controls persist. Interaction test required. |
| 9 | Retention and average monthly attrition stacked compactly in one area; shrink consultations and pending | Missing compact composition. |
| 10 | Simple consult count / became clients / close rate / pending; investigate repeated 4 counts; actionable attribution only | Missing simple summary. Actual records have not been read for this repair, so specific repeated-4 explanation is unverified. Preserve safeguards and confirmed-versus-candidate distinction. |
| 11 + clarification | Short primary labels; help works hover/focus/tap; deeper How these numbers are calculated collapsed by default | Partial disclosures exist, extensive primary diagnostic prose remains. App-wide audit and keyboard/mobile tests required. |
| 12 | Desired sessions editable; historical earned/session read-only from billed records; Session fee plain label; verify billing-code editing | Existing fee and desired-session editors are present. Editable expectedSessionRevenue was mislabeled Avg. earned/session; now explicitly a future revenue estimate. Read-only historical compensation/session helper under test. Billing imports retain per-row code/discounted charges; the inspected clinician/terms configuration has no billing-code-specific fee schedule editor. Do not claim such an editor exists or turn code-duration mappings into fee settings. |
| 13 | Compact consistent cards and numeric fields; responsive Money/Goals/Sessions/Team; no tiny targets or overflow | Pending rendered checks; substantive composition required, not padding-only change. |
| 14 | Expand simultaneous historical comparisons to Team and other summaries; compact side-by-side, correct units and differences; missing is not zero | Missing throughout shared single-period path. Dual display integration in progress. |
| 15 | Overview Attrition total count and percentage, matching period/eligible denominator, optional definition | Missing: Retained-client departures label and count-only display persist. Do not substitute monthly average or invent a unique-client percentage. |
| 16 | Understand consultation-to-treatment funnel; investigate ambiguous 43; distinguish booked/attended/onboarded only where supported | Missing: standalone New treatment starts remains. Read-only source investigation must precede explanation of real 43; synthetic tests cannot certify that number. |
| 17 | Remove detailed Current team financial estimate and Named goal status from Overview; relocate useful content, preserve saved assumptions/goals | Missing: both detailed cards still rendered. Keep the simple monthly-surplus summary. |
| 18 | Compact Overview retention/close/attrition with both periods and shared definitions | Missing: single selected period and extensive primary prose. |
| 19 | Keep Estimated monthly surplus; normalized comparisons instead of unsupported standalone totals | Partial: surplus remains; selected-window sessions do not provide historical baseline. Exact strip direction was still under discussion and refined by 20-21. |
| 20 | Last 3 and 12 months side by side; normalized activity units; session utilization with historical assumptions disclosed | Missing. No paired desired-capacity comparison. |
| 21 | Desired sessions/week is capacity, NOT rooms/theoretical maximum; actual weekly pace and percent full, clinician/practice totals | Missing paired display. Example 17/23 = 73.913% is an acceptance fixture, not production seed data. |
| Historical purpose clarification | Show recent-minus-baseline direction with compatible rates/averages; detailed series optional | Missing paired comparison. Avoid green/red judgments where meaning is ambiguous; label units explicitly. |

Unspecified reporting-period concern remains deferred per original implementation-request note. SEO/Ads work is outside these repairs.

## Delivery Reconciliation

Public HTML loads `index-B5r4xObK.js`; read-only public GET returned SHA-256 `cda7aa9f342081b07597e3d7f1e0b0ece3f0ed3495a1be2fb2b807f0ba445c95`, matching October 19 publication evidence. That bundle contains the historical selector. Thus this omission exists in the published web release, not merely an inferred native cache problem.

Installed `/Users/eliam/Applications/Practice.app` is an online WKWebView shell with no embedded frontend bundle and the same hosted start URL. Its running in-memory web release has not been inspected or reloaded. Native version `1.0.0 (1)` is not a web release identifier. See `OCTOBER20-MACOS-RECONCILIATION.md` for native artifact provenance limits and safe coordinated verification.

No production records have been changed. New local helper/component tests use synthetic evidence only. Source, tests, independent review, web publication and running macOS acceptance must be reported separately. Existing passing tests are not proof of these omitted product requirements.
