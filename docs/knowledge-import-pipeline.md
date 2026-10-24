# Disabled Knowledge import preparation

This extension is preparatory source code. No route, scheduler, provider SDK, connection, credentials, source IDs, grants, real content or production database changes enable it. The existing read-only Knowledge UI remains disconnected. Its SOP slot is still unfilled. Synthetic approvals in tests are fixtures, not approval of any Practice source.

## Contract and boundaries

`artifacts/api-server/src/knowledge/import-contracts.ts` defines strict owner-private semantic masters (document, map or cycle), an approved manifest, source metadata and server-only configuration. `import-pipeline.ts` accepts verified server role/principal context and a separately configured practice. These are internal capabilities, never request-body ownership fields. `KnowledgeSourceAdapter.readFile` accepts only allowlisted opaque file IDs; there is no URL fetch method. The approved parent, provider owner, Viewer principal, restricted visibility, source revision and source bytes/hash must match. Links are bounded HTTPS provenance values; the pipeline never follows them or renders executable links. Source instructions remain inert text.

The server configuration defaults disabled, empty and unapproved. It requires an independently approved exact manifest hash and explicit per-source approval epoch. Source-supplied approval labels alone cannot authorize publication. Current source/file grants must be provided later through a reviewed configuration workflow. Private Page URLs are provenance, not ingestion APIs. Dot connector grants are not app credentials.

A manifest stages all members before any publication. Activation revalidates staged bytes, schema, scope, hashes, source grants, resource versions and manifest revision. Stages expire after five minutes; activation preserves the actual verification timestamp rather than claiming a new permission check. The whole scoped state—active pointers, semantic master history, projections, cache, receipts and tombstones—is replaced with one generation-checked database statement. A conflicting writer fails and must reread/revalidate. Duplicate notifications recheck access but do not add duplicate activation receipts. Partial bundles cannot publish. New configuration pins withhold the previous bundle until the new one activates.

Semantic masters retain their exact approved bytes separately from derived plain-text projections. Projection order is semantic content first, then display text and link labels. NFKC/case/whitespace normalization deduplicates identical text, first occurrence wins; it does not perform fuzzy semantic merging. Immutable resource/version hashes prevent replacing a retained version. Retrieval also hashes retained active manifest bytes against the current server-approved pin, then binds each returned resource/file/revision/version to its exact manifest entry and retained immutable master bytes. Self-consistent replacement of active content and its local hashes cannot substitute unapproved content; missing or mismatched authority is withheld. Source revision IDs are opaque; monotonic manifest and resource versions establish ordering.

Explicit denial, deletion, unapproval or source metadata mismatch tombstones the affected source/resource and removes active/cache entries. Restore needs a newer approval epoch and resource version. Removing a source from configuration immediately withholds it and the next processing pass persists the tombstone. Network failure instead preserves previously verified content with `stale: true` and its old permission-check time. It never restores a tombstone or certifies current access. A future provider adapter must distinguish permission/unapproval from transient failure reliably; it must not use an old content snapshot as current authority.

## Approved-read fixes

Foundation versions now contain title, category and a publication hash covering those fields plus content. `listKnowledge` returns that approved version metadata; draft edits to resource metadata cannot change approved output. Current `knowledge_source_authorizations` state and epoch must match every version read. One revoked source authorization suppresses every version tied to that source. The snapshot `approvedForImport` field alone no longer grants access. Missing legacy fields/authorization fail closed.

Browser queries are partitioned by Clerk principal, cancel abandoned requests and hide resources on sign-out or errors. The synthetic browser test deliberately ignores transport cancellation: delayed owner-A responses still cannot appear for owner B or after sign-out. Future sharing requires explicit ACLs in addition to these practice/principal filters.

## Storage and migration review

`lib/db/migrations/20261024_knowledge_foundation.sql` is an additive, transactional migration candidate, not an applied production migration. It creates the three foundation tables if absent, adds nullable title/category/publication-hash columns for legacy rows, and adds source-authority and atomic pipeline-state tables. Application contracts require publication metadata; legacy rows remain unreadable until an explicitly reviewed new version is created. No backfill, identity, grant or approval is fabricated. The Drizzle definition describes valid new versions with required metadata; migration nullability deliberately quarantines old rows.

Composite foreign keys bind versions and receipts to the same resource/practice/principal. An approved-version trigger prevents updates/deletes; revocation is a current-authority/tombstone change, not historical content mutation. Pipeline rows bind JSON scope/generation to their columns with explicit JSON types and a predicate required `IS TRUE`; JSON null, missing fields, wrong types and mismatches are rejected with SQLSTATE 23514. The earlier CHECK accepted all-null and individually-null bindings; all four cases were reproduced in disposable PostgreSQL before correction. `pipeline-store.ts` implements atomic compare-and-swap. Database ownership itself is not application authentication; only verified server code may hold this capability. The pipeline store is **not yet wired** to the foundation's relational read repository: a reviewed publication/read integration must preserve the single atomic authority rather than introduce an uncoordinated dual write.

A disposable native PostgreSQL test applies only this migration to a new loopback cluster, checks both FK boundaries, immutable approvals, actual store concurrent insertion/update, cross-owner reads, state-binding rejection and transaction rollback of the whole publication/cache. It never uses inherited database URLs. Run:

```
PRACTICE_NATIVE_POSTGRES_BIN=/path/to/postgres/bin node --test verification/knowledge-storage.test.mjs
node --test artifacts/api-server/test/knowledge-foundation.test.mjs artifacts/api-server/test/knowledge-import-pipeline.test.mjs
node verification/knowledge-session-render.mjs
node verification/knowledge-foundation-render.mjs
```

The storage test explicitly skips without the native binaries; a skip is not storage verification. Evidence from this run uses installed PostgreSQL 17 in a disposable `/tmp/knowledge-db-*` cluster, stopped afterward.

## Required before real writes or live sync

- Select the current Practice SOP; normalize and explicitly approve all pilot sources and exact manifest/version content. No pilot acceptance is claimed.
- Separately authorize a dedicated Viewer-only service identity and folder/file allowlist; implement/test a read-only provider adapter without copying owner tokens or broadening scopes.
- Review migration against the actual deployed schema, privileges and recovery plan. Existing financial backups exclude Knowledge. **Add all five Knowledge tables and immutable master/source-authority state to backup/export and demonstrate restore on disposable storage before any real writes.** Set retention/size limits for histories, receipts and tombstones without resurrecting revoked data.
- Wire one authoritative atomic publication/read path; add real-adapter permission-change handling, bounded stale-read policy, audit/operational recovery and revocation invalidation across any future shared caches. No live scheduler or sharing is enabled here.
- Independent review, approved migration/deployment, and real-source owner-isolation/render verification remain separate gates. No production-ready, live-import or deployment claim is made.
