# Exact Two-Charge Exceptions

## Scope And Status

Implementation candidate only. No production database reads, writes, approval requests, migration, deployment or main promotion were performed in this implementation task. All browser and numeric fixtures are synthetic.

The owner explicitly approved keeping both charge rows for these four cases:

| Clinician | Service Date | Charge Pair | Owner Confirmation |
| --- | --- | --- | --- |
| Michele Teague | 2025-11-19 | $135 + $150 | "They both are. this was a clinician error. Allow it this once" |
| Erin Mrakovich, not Cockrum | 2026-08-10 | $175 + $175 | "Both should be kept. This is an except again." |
| Michele Teague | 2026-01-21 | $150 + $150 | "another exception" |
| Michele Teague | 2026-07-23 | $150 + $150 | "yea exception" |

The charge pairs total $1,235. This is not a certified whole-practice total or a claimed change from an already-known prior total. These approvals do not establish extra treatment visits, cash receipts, finalized expenses or profit.

## Storage And Backout

- No schema migration. Each approval appends `accept-billing-charge-exception` to existing `practice_import_audit` under the authenticated practice/account scope and actor.
- Each append contains its own contiguous journal revision, exact case token, two original source-row anchors, internal existing de-identified client key, pinned clinician ID, date/code/kind, amounts, confirmation time and owner note.
- Persisted version-1 provider/coverage declarations remain unchanged, including revision 1. Raw snapshots, hashes, package provenance, manual history, attendance overrides, future planning copies and compensation settings are not changed.
- The API transaction uses the existing scope advisory lock. A stale revision or changed token cannot save. A valid retry is a no-op, not another event.
- Original conflict and ambiguity signals remain visible separately from unresolved counts. Missing anchors, unsupported third charges, changed amounts, cross-identity hash collisions, duplicate approvals or remapped/renamed provider targets withhold the affected charges.
- Exact and overlapping reimports retain two approved charge slots at most. An equal-amount pair requires two distinct source hashes within an original source. No proration or inference of multiplicity is introduced.
- Reverting the application to the prior release leaves journal events and original data intact. The prior code ignores this new action and returns to conservative unresolved billing. Do not delete the journal, rewrite source rows, or add billing fields to strict persisted declarations.

## Later Production Application

Only after independent review and the deployment gate, the already-authorized cloud operator can apply these existing owner decisions in the authenticated live app. There is no need to ask the owner to approve these four tuples again.

1. Record the deployed runtime SHA and the existing preservation fingerprints. Verify the original declaration revision, mappings and frozen source sets are unchanged. Do not run a migration or copy development data into production.
2. Read `GET /api/practice-imports/billing-resolution-candidates`. Candidate output contains provider/date/code/amounts, source counts and opaque token, not client IDs or source hashes.
3. For each approved tuple above, require exactly one matching candidate with `canAccept: true`, no stale evidence, and the correct clinician mapping. Do not guess an unknown billing code, source hash, client key or alternative clinician. If there are multiple matching candidates or no eligible pair, stop that case and report the ambiguity.
4. Send `POST /api/practice-imports/billing-resolutions` with the candidate's exact `caseToken`, current **billing journal** `expectedRevision`, `confirmed: true`, exact `clinicianLabel`, `serviceDate`, two `amounts`, and an `approvalNote` quoting the corresponding owner confirmation. Do not PUT declarations or change coverage. Refresh the journal revision between approvals; on a fresh journal the four successful appends advance 0 to 4 while declarations stay at 1.
5. A repeated valid request returns `resolutionStatus: duplicate` and does not append. On 409, reread and verify the exact evidence; never overwrite or force a stale approval.
6. Reload. Verify four accepted cases, accepted fees $285/$350/$300/$300, unresolved counts reduced only for these cases, original source signals retained, and **no change** to attendance/session counts or coverage cutoffs. Check Imports and Money agree under the same complete-period admission rules. Costs, collections and profit remain unknown where no finalized actual evidence exists.
7. Recheck preservation fingerprints. Use the read-only aggregate audit pinned to the reviewed runtime source when a numeric comparison is needed. It reads this separate journal inside a repeatable-read/read-only transaction and always rolls back; it emits aggregate counts and fees, never anchors or client keys.

The older fee-case diagnostic SQL deliberately reports raw source conflicts/ambiguities. Its raw counters can remain one conflict/four ambiguities after all four approvals; those are not the new unresolved counters.

## Verification

- 656 domain/dashboard-library tests pass, including exact amount pairs, reimport ceilings, changed anchors, cross-identity collisions, provider remapping, percentage compensation and unchanged one-visit attendance.
- 33 import API tests pass, including four sequential journal approvals, stale concurrent revision rejection, GET with no writes, duplicate submission/reimport idempotence, mapped provider checks, audit rollback and preservation of declarations/source rows.
- 3 full-scale frozen-reference checks pass with 7,593 source rows and 107 manual overlaps; no-approval calculations remain identical to the frozen reference.
- 45 existing workspace desktop/mobile states and 5 new billing-exception states pass without horizontal overflow or application exceptions. The latter exercise four synthetic approvals, one rejected stale request, explicit note/checkbox requirements, no automatic writes, and reload persistence.
- Library, API and dashboard typechecks pass; API/dashboard production builds pass. Existing Vite sourcemap/chunk-size notices remain nonfatal.
- Runtime candidate: `54a8d48dcf5ad646d2f0d5537fee41defb1a8519`, tree `a07d31fb8e448767f5a4649138aff18956f0777a`. A separate verification-only commit pins the aggregate audit to this exact runtime; all 16 aggregate/identity-audit tests pass with that pin.
- Independent bounded review PASS on that exact runtime: 42 focused tests, all 33 mocked import API tests, dashboard typecheck and diff validation. The reviewer reproduced a provider-remapping inconsistency in the initial implementation; derived mapping validation and inverse tests now fix it. No remaining findings in that review. Broader suites and rendered checks above were run by the coordinator, not claimed as independently rerun.

Reproduce with the repository's Node/corepack pnpm commands and `verification/billing-resolution-render.mjs`. Browser output remains under the existing untracked `verification/practice-workspace-render/` directory; no business data is in those artifacts.
