# Production SQL-Only Reconciliation

Use `historical-production-reconciliation.sql` as one SELECT in the established production SQL viewer. No development database substitution, shell access, extra deployment, runtime change or data save is required. This replaces the unavailable production-process JS replay for this bounded check.

The query is intentionally gated to the confirmed production state: one practice/account scope; declaration revision 2; six unchanged clinician mappings; exactly three historical billing-only labels; three unique active sources per kind with stored/array counts equal; exact frozen July 1, 2025 through October 12, 2026 source sets; and five distinct bound approval entries. It validates historical labels against all clinician cards, including other configurations. Missing metadata and NULL approval validity fail closed.

The first-four full-event fingerprint is pinned to the publisher's captured unchanged baseline `cc19f8c6dd2eec520b459206a632561c`. This baseline is coordination evidence supplied by the authorized publisher, not locally obtained production data. If the baseline or any scope gate differs, totals are withheld. Do not loosen the gate to force a result; report the discrepancy.

## Read The Result

- Require `release_scope_ready=true`, `original_four_match_publisher_baseline=true`, and five stored approvals.
- `full_history` supplies the selected full-history totals. `monthly` supplies all 16 calendar selections, including quiet proved zero months and October's explicit partial-calendar flag. These are reported service-date charges, not cash, pay, costs or profit.
- Each window has whole-practice, current-team and three historical contribution scopes. Historical slot order is Jordan, Sara, Sarah, based on the exact confirmed normalized labels. No client keys, provider source strings, hashes, notes or source rows leave the query.
- Require zero unresolved/stale groups for every claimed amount. Source-hash collisions reconcile globally before window/provider projection; affected totals stay unknown. Exact original charge anchors and per-source amount multiplicity govern approvals. Equal-fee approved pairs retain two charges; ordinary cross-export duplicates count once.
- October 10/11/12 and October 8-12 appear separately. The attendance output is explicitly raw encounter/status-overlap diagnostics, not certified treatment-session counts. October 8-12 is never presented as a completed operating period. Keep the separately verified current-team cutoff October 7.
- Compare source inventory with the six retained source baselines and the latest 4823 attendance / 3681 billing input counts, and preserve the 47 subtype rows. Original business/source/manual fingerprints remain a separate preservation check, not inferred from these totals.

This SQL is an independently implemented conservative billing diagnostic reviewed against the combined reader. It does not replace actual source-file verification or certify unknown costs. It may withhold more broadly on malformed scope. Production aggregate values must be observed from the authorized SQL UI, not assumed from fixtures or earlier current-team UI amounts.

## Verification

Run `node verification/historical-production-reconciliation.test.mjs` only in a local environment with PostgreSQL binaries and permission to start a disposable loopback cluster. The test creates synthetic schemas/fixtures, substitutes only its own synthetic first-four fingerprint in memory, and stops/deletes the cluster afterward. It never uses `DATABASE_URL` or production credentials.

Author controls pass 16 monthly selections, independently calculated $1580 synthetic full history, three historical slots, original four plus fifth approval, equal approved amounts, October deduplication, stale fifth evidence, global hash collisions, malformed coverage, all-roster historical collisions, NULL approval-kind withholding, fingerprint mismatch withholding and privacy. Independent reviewer also passed equal $110/$110, excess per-source multiplicity and cross-encounter hash-collision controls. No production access occurred locally.
