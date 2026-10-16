# Historical Billing-Only Provider Candidate

Current combined-reader handoff supersedes this earlier branch record: see `HISTORICAL-CURRENT-READER-HANDOFF.md`, runtime `046a8e7440474abbcd3b56aa29daa49f8cf8ea2b`. The following verification chronology is historical, not permission to deploy an older reader.

## Scope And Isolation

This candidate is developed on `codex/historical-billing-only`, separately from label-only main `fdbe612` / runtime `3f5ad92`. It supports explicitly confirmed historical billed-charge identities without adding clinician cards, compensation terms, current-team clinical facts, forecast volume or capacity. No real export has been received or imported. No database, declaration, approval, balance, goal, staff or room setting has been changed in production.

The owner's July 1, 2025 boundary is supported as a service-date reporting boundary, including July 1 facts. Historical **reported charges** and report-date completeness are distinct from canonical complete operating periods. The existing current-team actual/forecast engine, clinical admission, pay equations and financial-goal math are not fed historical-provider amounts. When the new ledger is present, the original money panels are explicitly labeled current-team; the new Historical practice billed charges panel supplies current plus confirmed historical provider monthly reporting. It does not certify cash, payroll, costs or profit.

## Explicit Contract, Not A Guessed Export Format

- Imports can classify an exact unmapped source label as Historical billing only, with a stable UUID, explicitly selected frozen billing sources and report start/end dates. There is no automatic classification or seed. The provider must actually occur in the selected active billing sources; every source member's dates must be valid and inside the stated report bounds.
- Any normalized match to an existing clinician card anywhere, including a planning copy or inactive clinician, requires review instead of creating an alias or merging identities. Duplicate registry labels/UUIDs, missing/stale source members and source-bound contradictions withhold certification. A historical UUID cannot later be reused for a different label, even after a deliberate removal.
- Unknown deletion headers (`Deleted`, `IsDeleted`, etc.), unsupported provider/clinician status columns, deletion text in otherwise ignored columns, and deletion-marked provider labels stop CSV import with explicit review guidance. Strict package JSON rejects unknown deletion fields; API and client guards both apply. No marker is stripped or interpreted. Existing stored raw sources are not rewritten.
- The forthcoming file's actual headers, entity semantics and marker values still require inspection. A marker may describe a client, visit, provider or something else. The candidate does not claim native support for that unseen format. The separate converter must preserve the evidence for review rather than silently dropping it. Exact sanitized headers are needed only when a real format must be mapped.

## Storage And Backout

The optional `historicalBillingProviders` field is composed in memory for the new API response and explicit confirmation request. Persistence uses the existing scoped `practice_import_audit` action `confirm-historical-billing-providers`, containing a versioned complete registry snapshot and declaration revision. There is no new table or runtime DDL. The original strict `practice_import_declarations.data` JSON excludes this new field, so old readers continue to parse it.

Registry and declaration confirmation share the existing practice/account advisory lock, optimistic declaration revision and transaction. Audit failure rolls back both. Older clients omitting the new field preserve the existing registry. Journal replay is bounded, validated, scoped, rejects conflicting revisions/identity reuse and never exports client keys. Exact source rows, hashes, approval anchors and clinician records remain unchanged by confirmation.

Backout must retain a compatible reader. The former label-only release cannot parse newly stored late-cancellation subtype rows; the current-reader release `a49372e` cannot parse historical approval entries containing `historicalProviderId`. After those records exist, neither is a safe rollback target. Preserve subtype and historical-approval schema support in any forward repair or feature-disabled backout. Never delete historical records, clear approvals, strip fields or rewrite sources to make an old reader load.

## Reconciliation And Completeness

The ledger reconciles **all retained billing evidence before filtering identities**, including globally conflicting hashes. October 10 overlap collapses once and October 11-12 are added as reported facts. Changed fees, repeated indistinguishable encounters and stale approvals remain unknown, never a latest-file winner. Four synthetic approved-pair controls cover one unequal-fee pair and three equal-fee pairs; exact original anchors are required and approvals do not create visits.

Reported totals cannot silently omit an unconfirmed provider. Unknown/ambiguous provider rows force the practice ledger and monthly amounts unknown with review guidance. The unconfirmed state is visible even before any historical provider is classified. New source membership never inherits frozen proof. A known reconciled reported subtotal can coexist with an Unverified completeness label; missing complete report coverage is not a zero or a complete operating actual.

Source-date proof is checked independently of the canonical 14-day rule. July 1 historical charges remain visible. A separate October 10-12 report does not complete the October 8-21 operating period as of October 16; the existing common complete-period cutoff remains October 7 unless separately supported by later complete evidence. Retain-overlap and replacement remain distinct reviewed import actions. No automatic import or declaration extension is included.

## Verification And Limits

- 683 domain/dashboard tests pass, including 11 new historical-ledger/identity/marker controls.
- 39 mocked API controls pass, including registry separate-journal persistence, strict-JSON backout compatibility, stale/rollback/older-client preservation, identity collisions, source bounds, deletion-marker preflight and permanent identity reservation after removal.
- Eight updated former-billing/overlap controls pass, including four synthetic pinned pairs and frozen source membership. Exact-candidate aggregate replay additionally exposes only historical dates/amounts/counts, not client/source keys.
- On this branch, the legacy six-clinician SQL diagnostic explicitly stops once a historical-provider registry journal exists. Its current-roster charge projection must not be mistaken for the new historical ledger total. Independent real-source historical reconciliation remains a pre-import acceptance step; application aggregate replay alone is not independent proof.
- Dashboard/API typechecks and builds pass. Existing nonfatal Vite source-map/chunk-size warnings remain.
- Synthetic browser workflow passed 59 desktop/mobile states, including unconfirmed-provider withholding, explicit historical choice, confirmation/reload, July 1 inclusion, monthly combined fees, separate current-team totals and no new Team card. Two additional element screenshots were visually inspected at mobile width for readable provider confirmation and the new ledger. Evidence `/tmp/former-billing-render/metrics.json` and adjacent screenshots. This mocks API/auth; it is not real account acceptance or authentication verification.
- Broad `test:api` is **not** a full pass: four environment-guarded suites require `EMC_TEST_DATABASE_URL`, `DATABASE_URL` or `EMC_TEST_API_URL` pointing to isolated test services, which are not configured here. No production database was substituted. The 39 applicable mocked API controls pass separately.
- Frozen-candidate independent review and source-pin results accompany delivery. Real-file compatibility, real import, durable real-DB/API integration and post-import business-number reconciliation remain unperformed.

Frozen runtime: `42c4b33b6826ceb36da54606e7e4639b53147d28`, tree `561ec65232b707c98c9b7f3fce19d6e1be7ee821`. Independent reviewer Newton reports PASS/no remaining blockers in the reviewed scope and no runtime drift. Its independent checks included 35 domain/API controls, six aggregate privacy/read-only controls, dashboard typecheck, and 18/18 isolated PostgreSQL tests for the final legacy-scope guard. Author final source-pinned audit/mapping/label/former suite passes 27/27. Render captures were authored, not independently rerun. Subsequent commits update verification pins/docs only; main stays unchanged.

## Separate Label-Only Production Handoff

The prior label release remains independently deployable at runtime `3f5ad92c5bebedc2d740b9ebb8c88b84abf2f689`; main `fdbe612` has that same runtime plus verification-only commits. Do not deploy this historical branch merely to release those labels.

1. Last supplied deployed baseline is `61fc038` / `index-Chaf82Hs.js`, with clean preservation at 15:04-15:05 UTC. At 16:08 UTC the authorized cloud worker completed the reviewed production provenance SELECT at `d8d67f8` with READY and unchanged January numbers, declaration revision 1 and four approvals. They are proceeding with **only** frozen `d8d67f8` / runtime `3f5ad92`, excluding this historical branch. A completed publish/new asset has not yet been supplied locally.
2. The reviewed extension (SQL SHA-256 `5d07ce2ead9db42f71ff0fad1465936701b461d17710c28a422d63df2a67e31a`) now establishes the actual tail cause: all 14 selected-retention flags are true; all six legacy clinician flags are false. All excluded partial follow-up is after admitted attendance coverage: Erin 6, Elia 4, Natalie 4, Michele 5, Jessica Cockrum 2, Jessica Yates 2; Whole Practice deduplicates to 22. Zero original gate/PHONE anomalies remain. The source/synthetic explanation is therefore production-confirmed for these scopes. If any later selected flag is false, investigate genuine gaps rather than forcing a verified label.
3. Publish the reviewed label-only runtime, without any migration, import, metadata save or historical registry confirmation. Verify January full-month/partial-selection labels and separation of selected limitations from global forecast/history context, with safe-unknown inverse checks.
4. Recheck the frozen January table: 94/207 sessions, 4/6 and 10/15 retention, 5/6 and 17/21 practice conversion, four/seven exact endings, null versus one-mature-month attrition, $15,035/$33,035 charges, 105/238 accepted charge rows. Preserve all 11 original fingerprints, declarations and four fee approvals. See the separate scoped real-account report for limits.

## Historical Candidate Release Gate

Review and deploy code independently before enabling a real import. No schema migration or owner business-number edit is required just to publish code. Do not confirm historical identities or change coverage merely to make a screen pass. After a real report arrives, inspect its sanitized format/marker semantics, use the existing review/retain workflow, explicitly confirm the exact billing-only identities and frozen report bounds, then independently reconcile provider/month totals, October overlap and every approval binding in the authorized environment. Preserve unknowns, original source history and rollback metadata throughout.
