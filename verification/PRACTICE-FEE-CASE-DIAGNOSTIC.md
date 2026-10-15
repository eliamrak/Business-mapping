# Read-Only Fee Case Diagnostic

Run `practice-fee-case-diagnostic.sql` as one SELECT in the already authorized, verified production SQL UI. No production call was made by the author. Do not change scope, merge rows, select a winner, save attendance exceptions, or modify declarations while investigating.

Source of truth: `lib/practice/src/hub/billing-evidence.ts`, `reconcileBillingEvidence`. It connects rows transitively by exact normalized encounter identity (internal client ID, normalized professional label, date, normalized billing code) OR a nonblank exact source-row hash. Different payloads in one component set `conflicting`; this is broader than same-hash conflicts. Multiple distinct hashes within one source, missing-code repetitions, or missing identity set `ambiguous`. Both flags can be true for one component: one plus four does not establish five distinct cases.

`summarizeReportedBilling` in `artifacts/comp-dashboard/src/lib/reported-billing.ts` counts those group flags as `conflictingHashCount` and `ambiguousEncounterCount`. Imports' `rawBillingEvidence` uses all active raw billing snapshots without an eligible-period or date filter. This query deliberately matches that scope; its cases are not actual income, attendance, cash or source-coverage certification.

The separate Matching diagnostics UI is attendance-versus-billing visit reconciliation. It is not an itemized fee-conflict viewer. Same-day attendance exceptions also do not authorize choosing conflicting billing payloads or summing ambiguous charges.

## Output

Only professional clinician labels, service-date tokens, numeric fee variants, normalized codes, structural flags/counts and anonymous source provenance are returned. Client keys, row hashes, whole-source hashes and raw JSON remain internal to the SELECT. Source provenance includes query-local ordinal, import timestamp, observed bounds (not proof), raw row count, distinct-row-hash count and payload-variant count. Keep even this professional/date/fee output private.

- `ui_fee_conflict_count` and `ui_ambiguous_encounter_count` should reproduce the displayed counters; `distinct_flagged_case_count` reveals overlap between them.
- `feeConflict` with multiple fee variants exposes competing amounts without choosing one. A kind-marker disagreement can also conflict with only one fee value.
- `sameHashDifferentPayload` distinguishes a true row-hash collision/reused identity from ordinary encounter-level payload disagreement.
- `multipleRowHashesWithinSource` shows why a repeated encounter is ambiguous even when all fees match. Source counts/row counts show whether repetition is within one export or merely across exports.
- Different codes normally remain separate encounters; a hash link can join them into one conflicting component. Encounter-identity and visit-kind variant counts expose that structure without returning client identities.

## Bounds and Limits

Exactly one active practice/account pair is required. At most 20 active billing sources, 10,000 raw billing rows, 20,000 connected-component reachability pairs and 50 flagged cases are reported. The reachability CTE has a hard 20,001-row sentinel; exceeding any bound yields STOP and null counters/cases, never a truncated diagnostic. Missing/wrong required row types also yield STOP. No extra access, extensions, DDL, temporary tables or database functions are installed.

For a connected component spanning different encounter identities with both missing and present codes, the application's first-row rule depends on JavaScript locale sorting. The query refuses this case rather than approximating that sort. A STOP status requires source/model review, not removing the guard. Service-date token shape is disclosed, not calendar validity certification. Whitespace normalization follows the existing source convention; this is a bounded diagnostic, not a new general-purpose production reconciler.

Three tests verify SELECT-only/scope/privacy/bounds, overlapping counter semantics, and transitive hash/encounter grouping against the existing JavaScript function. They do not execute PostgreSQL or certify live schema compatibility. Independent bounded SQL review is requested separately. After execution, compare counters first; if they differ from the current UI, stop before interpreting or resolving individual cases.
