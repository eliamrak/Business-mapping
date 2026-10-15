# Explicit Provider Crosswalk Preparation

Status: design preparation only. Parent requested explicit owner confirmation; approval remains pending. No proposed mapping is persisted, activated, or used by this increment.

## Corrected Source Audit

The authorized named production lookup reported the source label `Elia Mrakovich`, not `Elia`. The exact `Elia` row is unassigned and must not be treated as the owner's actual clinical identity. Earlier empty results for that shorter exact label say nothing about the full source label's activity. Do not prefix-match or combine them.

Run `practice-requested-source-audit.sql` as one SELECT in the existing authorized SQL UI. It returns only exact-full-source-label aggregates by attendance/billing, global/selected-team candidate counts, and explicit pending-identity status. It does not return names, person IDs, client fields, dates, fees or raw records. Counts are before overlap/status reconciliation, PHONE linkage, date filtering, and source-completeness admission. They are not visits, retained clients, conversion rates, actual income, or certified person attribution. A STOP status invalidates interpretation of all counters. This query has not been executed by the author.

## Proposed Confirmation Surface

In Imports, add a provider mapping review table with source label, source kinds, selected configuration, chosen roster row/ID, and confirmation status. Present all candidates including same-name rows in other configurations; highlight selected-team membership without choosing a row automatically. Blank/unconfirmed is the initial state. Require an explicit selection per source label plus a final confirmation showing the complete set and its practice/configuration scope. No save on page load, navigation, typing, team change, or importing a file. Report coverage remains a separate action.

The parent-reported six-row Year 1 Baseline configuration is a proposed confirmation set, not proof of copy lineage. Keep the exact proposed IDs/names in the authenticated confirmation UI and authorized parent evidence, not a built-in seed/default. Do not turn these production-specific candidates into application constants.

## Proposed Metadata Contract

No such crosswalk currently exists in `clinicians`, `practice_import_packages`, `practice_import_snapshots`, or the strict workspace schema. Main-roster copying discards source IDs. Scenario source IDs link only scenario rows to main-roster rows. Neither an added unknown JSON key nor a name heuristic can safely activate a crosswalk.

Use a dedicated versioned, practice/account-scoped mapping record, with source namespace (the current converter's provider-label field, not an invented external provider ID), exact source label plus the established normalized key, target clinician ID, selected configuration ID (nullable for Unassigned), confirmation actor/time, evidence basis `owner-confirmed`, revision, active/archive state, and prior revision history. Keep source labels intact; do not rewrite import rows, clinician labels, business goals, manual records, or scenario copies. No canonical-person merge is implied.

API write requirements: existing authenticated scope; explicit confirmation; expected-revision compare-and-swap; transaction/audit; selected configuration and target membership validation; reject duplicate normalized source keys with differing targets; reject missing/deleted targets; no implicit aliasing, cross-practice fallback, or migration-on-read. Loading an approved mapping must not create another confirmation. A target label/configuration change or absent target flags review rather than silently retargeting. No mapping may certify report dates or fill missing coverage.

Resolver requirements: source kind/namespace and practice scope must match; use only a confirmed, valid mapping for that source label before the conservative global-name fallback. Unmapped or conflicting labels remain unknown. Use the same resolver in complete-period admission, imported/manual reconciliation, clinical attribution, clinician cards, financial ranges and audit output. Keep encounter identity/dedup and actual closer credit unchanged. Different same-name people remain distinct IDs. Changing selected team must not carry an incompatible mapping into the new team.

## Implementation Gate and Checks

After explicit approval, implement metadata/API/UI/resolver together with additive migration/backout, never just weaken the global ambiguity check. Cover six proposed rows with synthetic names/IDs only: no automatic initial selection, cancellation/no writes, stale revision, wrong scope/team, missing target, within-team collision, normalized-key collision, renamed source, mapping archive, duplicate encounters, and global-copy ambiguity resolved only by confirmed mapping. Verify desktop/mobile review screens and independently review before any existing-environment deployment. Restore to unknown safely on backout while retaining mapping audit history and business records.
