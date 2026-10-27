> Definition superseded by the approved [established-active v2 contract](established-active-definition-20261027.md): third distinct treatment date regardless of early gaps. Historical v1 notes below are retained for audit. No live wiring.

# A7 daily active-retained attendance — prepared, not installed

New metric ID: `daily_active_retained_sessions_per_client_week`.
Formula version: `daily-active-retained-attendance-v1`.
Foundation DTO: `activeRetainedAttendance` (additive to v3).

Numerator: admitted treatment sessions on dates when the client has qualified for initial retention and is active under the existing 90-day inactivity rule. Includes the third qualifying treatment date at end of day; excludes earlier prequalification visits. Uses each day's state, not a fixed end-date survivor cohort. Historical attendance from clients who later ended remains included. Return-day treatment can count when the previously initially retained client becomes active again, without inventing a new initial start.

Denominator: exactly the same daily active client-days used by A6, divided by 7. Quiet active days remain exposure. Rate is zero when positive valid exposure has no sessions; null when exposure is zero, coverage incomplete, or daily classification uncertain. Calendar window, as-of, admitted source provenance and current-roster scope accompany the aggregate.

Whole-practice clients are deduplicated. Clinician membership uses the latest treatment provider(s) on each day; numerator uses actual attending provider. Shared latest-date providers receive separate clinician/client pairs, so clinician exposure can sum above practice exposure. No practice-total allocation or inferred provider splits.

The older `retainedAttendance` / `retained_sessions_per_client_week` covered-subset metric remains separate for compatibility. The current all-attender proxy remains separate. Neither the live A7 proxy nor downstream acquisition, capacity or projection equations are rewired here.

Synthetic validation covers qualification, daily transfers, provider agreement, historical ended clients, quiet exposure, zero exposure, incomplete coverage, and catalog numerator/denominator/version. No actual client records or parent-supplied real aggregates were committed as fixtures. Parent's actual-data reconciliation remains independently sourced evidence, not a cloud author live verification claim.

Equation review is still in progress. No deployment, imports, persistence changes, provider calls or live UI wiring in this candidate.

Final validation: 1,324/1,324 regression tests; dashboard types and production build passed (existing build warnings). Independent read-only review accepted, 22/22 focused tests plus shared-provider/same-day exception probe. No rendered UI changed.
