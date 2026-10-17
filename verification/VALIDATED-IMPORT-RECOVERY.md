# Validated Durable-Import Recovery

## Frozen Candidate

Runtime/test commit `b4dc474c4862445958ec1e8c371a332de38563c0`, tree `9e8279e1b48d8115d941f42514900198b4fc1014`, branch `codex/validated-import-recovery`. Based on the reviewed workflow candidate `021b2466`; marketing computation and UI runtime are unchanged. No push, deployment, migration or real-data action occurred.

## Review Blocker And Repair

The external reviewer reproduced a malformed declaration (`mappings: "broken"`) accepted by preview and restoration. The old route validated workspace JSON but not durable import JSON, allowing a successful insert followed by a failing import reader. The resulting nonempty target then correctly refused another restore, trapping an unreadable recovery.

New `src/lib/import-backup-validation.ts` validates every durable-import scope and archived record before preview-token creation, and again inside the locked restore transaction before any insert. The preview retains a deep clone rather than caller-owned nested objects. The production import reader and recovery validator share declaration and approval-journal parsers, preventing drift in their structural/readability invariants.

Validation covers package/settings types and limits, snapshot fact types/counts/date containment/report proof, primary/scoped uniqueness, package foreign-key/scope relationships, declaration schemas/revisions, contiguous approval revisions and unique IDs/tokens, historical registry schemas/revisions and scoped journal consistency. Malformed records outside the currently configured scope are not silently accepted. The PostgreSQL test explicitly configures `EMC_PRACTICE_ID=synthetic-backup` and checks actual `/practice-imports` readability after recovery.

Archived sources, signed adjustments, blank/unclassified billing-code strings, deleted-prefix historical labels and stale approval anchors remain unchanged and readable. Recovery does not invent service classification or require old approvals to have current active anchors. Multiple historical scopes remain separate; they are not remapped to the target scope. Arbitrary alias admission policy is deliberately outside this P2 correction: tightening historical compatibility beyond reader invariants needs separate compatibility evidence, not revival of an unsupported-alias production finding.

## Version And Compatibility

Full 17-table exports now explicitly use **`emc-business-data-v2`**. Current recovery requires v2 and the matching database schema signature. Both old 13-table v1 files and the unpublished earlier 17-table v1 candidate are refused with an explicit matching-earlier-release message; no automatic partial restoration occurs. Existing files are not rewritten or deleted. The Reports component passes the selected backup through unchanged, so no UI persistence format or database schema migration is needed.

## Verification

- Author: 745 domain/dashboard tests pass; 133 database-free API tests pass, including 93 actual backup-handler contract cases. API TypeScript/build and diff checks pass.
- Malformed cases cover the exact reviewer declaration reproducer, broken historical registries, journal gaps/duplicate IDs/tokens, invalid snapshot arrays/facts/settings/proofs/counts/scopes and invalid archived data. Every case is checked at preview and independently against a malformed cached preview: no INSERT and no populated target.
- Valid restoration is loaded through the actual `GET /practice-imports` handler with a database replacement, confirming five approvals, historical registry, declarations and active source facts in the configured synthetic scope. Stale and multi-scope cases are readable and retain their facts.
- Independent reviewer Meitner (`01a14bd5-212e-7234-a55b-89561a7f70e4`) verified the exact commit/tree, independently passed 122 API tests including all 93 contract cases, plus 69 focused domain/dashboard tests, and reported no blocking findings. No PostgreSQL or browser rerun was claimed by that reviewer.
- Author mounted-component browser harness: 13 desktop/mobile states, six synthetic lead commits, three restore attempts, zero browser errors, no document overflow, five approval entries retained. Includes v2 downloads, malformed-declaration refusal before any restore action, expiry/error retries, disposable restoration and nonempty refusal. These use fixture transport and the production validator; they are not PostgreSQL tests.
- Final captures/results: `/tmp/financial-completeness-render-5kNUBj/`; machine results copied to `VALIDATED-RECOVERY-RESULTS.json`. Author inspected the malformed-import refusal capture. Existing owner/production browser sessions were not used.

## Isolated PostgreSQL Handoff

Fresh actual PostgreSQL acceptance of this corrected v2 route remains pending. Use the existing Replit disposable cluster, never production credentials, private records, a production port-forward or production restoration. The complete Hub suite uses a loopback schema-source database, creates its own `emc_hub_test_*`, copies schema only, seeds synthetic data, runs recovery, then drops the test database. Role needs CREATE/DROP DATABASE; `pg_dump`, `psql` and Node must be available. Clear inherited production credentials; the suite supplies synthetic Clerk credentials and binds its API to loopback.

From the exact candidate checkout, build API with `corepack pnpm --filter @workspace/api-server build`, then run the whole `artifacts/api-server/test/hub.integration.test.mjs` with `EMC_TEST_DATABASE_URL` set only to the disposable loopback schema source. Do not filter away shared setup/state. The new assertions include malformed-content rejection, v1 refusal, 17-table equality, rollback, composite-key handling, sequences and configured-scope import readability after recovery.

To make backend source available without violating the no-push hold, generated patch `/tmp/practice-recovery-b4dc474-api.patch` contains the cumulative API source/test difference from published `7d8ac067` to this candidate. SHA-256: `afbcea135a18a49ad76e1dc89d258bd63585f0a2be2dfdc158abd80cdd0393bb`. Reverse apply-check against the local candidate passed. Apply it only in the isolated test checkout at that exact base, first using `git apply --check`. It covers API dependencies/tests needed for the PostgreSQL gate, not the unrelated frontend marketing changes.

Logs: `/tmp/practice-recovery-validation-*`. Push and deployment remain on hold until corrected review and the actual PostgreSQL gate pass. No additional owner inputs are requested.
