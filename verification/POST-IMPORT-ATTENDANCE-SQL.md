# Post-Import Attendance SQL

Run `verification/post-import-attendance-reconciliation.sql` as one SELECT in the existing authorized production SQL viewer. No shell/JS production process, development DB substitution, deployment, import or record save is needed.

It fixes the as-of date at October 16, 2026 and selected window at September 17-October 16 inclusive. Those are the dates associated with the reported `144 sessions / 21 days`; no result amount is hardcoded. It also reports the September 24-October 7 canonical period and the uncompleted October 8-12 tail.

The query inherits the already reviewed post-import source/declaration/approval gate: one scope, revision 2, six current mappings, three exact historical-only providers, three retained sources per kind, complete frozen July 1, 2025-October 12, 2026 bounds, five bound approvals and the captured first-four event fingerprint. Historical-only providers never become current clinical cards or zero-activity clinical coverage.

## Compare

Require `release_scope_ready=true`, `attendance_scope_ready=true`, `stored_approval_events=5`, and `original_four_match_baseline=true`. For `selected_30_days` / `whole_practice`, require `comparison_ready=true` before comparing `verified_imported_treatment_visits`, `included_calendar_days`, and `verified_weekly_pace` to the UI. A result of 144 and 21 implies 48/week; this must come from production facts, not the synthetic fixture.

`clinician_1` through `clinician_6` follow the sorted existing mapped clinician IDs (the established current roster order), without outputting IDs or provider names. Whole Practice uses days common to all six, not summed provider-days. Exact daily imported facts are clipped after full canonical source-period admission; no manual aggregate is prorated.

Cross-export same client/mapped provider/date shows count once. PHONE and documentation are excluded; numeric `4` is treatment, including billing-linked legacy rows with an obsolete consultation flag. Changed per-source attendance status sets withhold the affected provider's entire canonical period. Whole Practice then uses common remaining days, but conflict-affected scopes do not certify a UI comparison because manual fallback is intentionally not inferred by this SQL.

Any stored same-day multiplicity overrides or conflicting source-hash payloads withhold certification rather than silently ignoring them. If an unsupported override gate fails, report it; do not remove an approved override. Unknown/malformed scope similarly fails closed. October 8-21 cannot be complete as of October 16; tail-only verified visit/pace values stay null rather than zero.

Source inventory reports row counts and late-cancellation counts only. No private client/provider/source keys, hashes, notes or rows leave the query. No billed-fee, cash, payroll or profit certification is claimed.

## Synthetic Evidence

`node verification/post-import-attendance-reconciliation.test.mjs` uses a fresh disposable loopback PostgreSQL cluster with invented inputs and no production credentials. It runs the historical release-gate controls and then independently constructs 126 six-provider daily shows plus 17 distinct extra shows and one numeric-4 show: 144 visits, 21 days, 48/week. A second export doubles raw counted show rows to 288 but not visit totals. Additional PHONE/documentation and 47 late-cancellation rows add no treatment shows. Tests cover a billing-linked blank code, status-conflict period withholding and unaffected providers, incomplete October tail, unsupported overrides, privacy and rollback immutability. These values are mathematical fixtures, not replacements for real business values.

Independent reviewer found no actionable findings at SQL SHA-256 `02dd1ec661c0a590d8ea00d14d81b3c80980b56eeee702644afc0a335a2d1417`. It reran the supplied fixture in fresh local PostgreSQL and separately checked null client/hash/status, hash collisions, overrides, reversed row/source order and internal-identifier exclusion. It did not access production; the actual production result and captured baseline still require the authorized SQL viewer run.
