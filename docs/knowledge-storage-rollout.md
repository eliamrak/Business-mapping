# Knowledge atomic runtime and recovery gate

This is a review-only runbook. No production migration, restore, provider connection, grant or private-source import was performed. The actual pilot sources remain private staged drafts with retrieval disabled. Test fixtures do not approve those sources.

## One publication authority

`createKnowledgeRuntime` shares one `KnowledgePipelineStore` between staging, activation and reads. The production read route uses this runtime; its server configuration capability currently returns `null`, so it remains disabled, returns no documents and performs no pipeline-store read/write. There is no request parameter, environment-only toggle, importer endpoint, scheduler or provider implementation that enables it. Existing Clerk/owner route checks still run before the reader. An enabled configuration is used only in isolated synthetic tests.

An enabled runtime reads the exact active manifest from `knowledge_pipeline_states`, validating the configuration pin, master history, current source grants and tombstones on each read. It never falls back to the three relational foundation tables or uses them as a second publication authority. Those tables plus `knowledge_source_authorizations` are retained for compatibility/history; direct edits there do not publish or revoke the new runtime. All new runtime publication/revocation must use the atomic state/configuration path. Do not run legacy and pipeline readers side by side or dual-write them. A future administrative interface must use the same authority.

PostgreSQL JSONB can reorder object keys. Structural equality checks now ignore object-key order while exact approved manifest/master byte hashes remain unchanged. The actual database stage/activate/read test exercises this round trip. The runtime withholds stale source snapshots until a display/expiry policy is separately reviewed; transient failure remains distinguishable from revoked state internally.

Source-access approval, Knowledge snapshot publication, and marketing campaign approval are different decisions. An approved Knowledge source may contain an explicitly labeled **draft ad example**. Its source/publication approval does not approve that example for campaign use. The synthetic recovery test preserves “DRAFT AD EXAMPLE — Not approved for campaign use.” verbatim. No campaign approval or external publishing workflow exists here.

## Disposable proof

Run with an existing supported PostgreSQL installation:

```
PRACTICE_NATIVE_POSTGRES_BIN=/path/to/postgres/bin node --test verification/knowledge-storage.test.mjs verification/knowledge-recovery.test.mjs
```

These scripts erase inherited database connection variables in the test process and create fresh owned loopback clusters. Recovery uses `pg_dump --data-only --column-inserts` with an explicit five-table allowlist, then `psql --no-psqlrc --single-transaction --set ON_ERROR_STOP=1` into the second migrated disposable cluster. They stop both clusters afterward. Synthetic dump/report files remain under `/tmp/knowledge-recovery-evidence-*`; stopped synthetic cluster directories also remain under `/tmp/knowledge-source-*` and `/tmp/knowledge-restored-*` for inspection.

The proof covers owner/practice isolation; the real HTTP read router with synthetic server locals (Clerk transport itself is covered separately by the foundation tests); no caller-owned scope or HTTP mutation; default-disabled behavior; actual staged publication and transaction rollback; duplicate notification; exact recovery of every row in all five tables; a failed restore rolling back every inserted row; retained immutable masters, tombstones and cache removal; denied replay after recovery; and a second owner's valid restored publication without first-owner leakage. It is not a production recovery drill or live provider verification.

## Later production migration — requires separate reviewed execution

1. Keep the runtime configuration `null`/disabled and stop any future Knowledge writer. Confirm the exact reviewed commit, PostgreSQL version, target identity, current schema, existing rows, privileges and source-grant inventory. Do not infer the target from an ambient database URL. This runbook authorizes no access setup.
2. Confirm a secured backup destination, access controls, retention and a tested recovery target. Inventory all five tables: `knowledge_resources`, `knowledge_versions`, `knowledge_import_receipts`, `knowledge_source_authorizations`, `knowledge_pipeline_states`. Existing financial exports do **not** cover them. Include the reviewed migration/schema, current server configuration version and approval-epoch/pin inventory in the protected recovery package; never commit credentials or private content. Backup configuration is evidence, not permission to reinstate access.
3. For an existing Knowledge schema, the following command pattern makes a consistent Knowledge-only data snapshot. `KNOWLEDGE_BACKUP_CONNECTION` and `KNOWLEDGE_BACKUP_FILE` must be supplied by an explicitly authorized operator through the approved secret/path mechanism; these are placeholders, not configured credentials. If the tables do not yet exist, record that fact and follow the separately approved platform pre-migration recovery procedure instead of pretending this dump succeeded.

```
pg_dump --dbname "$KNOWLEDGE_BACKUP_CONNECTION" --data-only --column-inserts \
  --no-owner --no-privileges \
  --table public.knowledge_resources --table public.knowledge_versions \
  --table public.knowledge_import_receipts --table public.knowledge_source_authorizations \
  --table public.knowledge_pipeline_states --file "$KNOWLEDGE_BACKUP_FILE"
```

4. Verify artifact integrity and restore to a **fresh isolated approved recovery target** first. Apply the exact migration there, then restore with errors aborting the entire transaction:

```
psql --no-psqlrc --dbname "$KNOWLEDGE_RECOVERY_CONNECTION" --set ON_ERROR_STOP=1 \
  --file lib/db/migrations/20261024_knowledge_foundation.sql
psql --no-psqlrc --dbname "$KNOWLEDGE_RECOVERY_CONNECTION" --single-transaction \
  --set ON_ERROR_STOP=1 --file "$KNOWLEDGE_BACKUP_FILE"
```

Compare all five tables, immutable master hashes, pins, epochs, tombstones and scoped readable outputs. Confirm failure rollback and constraints. The migration installs the trigger function omitted by table-only data dumps. Legacy approved rows missing required publication metadata may fail the immutable approval trigger on restore; resolve an explicit reviewed quarantine/recovery plan before rollout, never disable integrity checks ad hoc or fabricate approvals.

5. Only after successful recovery review, a separately authorized operator may apply the same migration to the confirmed production target with `psql --no-psqlrc --set ON_ERROR_STOP=1 --file ...`. The migration contains its own `BEGIN/COMMIT`; do not wrap it with an extra transaction option. Constraint validation failure rolls back the migration; do not delete malformed rows just to make it pass. The script seeds no source approval or identity.
6. Validate the disabled read path and schema before any enablement. Current provider permissions/source approval must be freshly reconciled against restored state: an old backup can predate revocation. Never enable retrieval merely because a restored pin/approval existed historically. Missing current authority remains denied. No real-source read/import is permitted until the external-access gates below are satisfied.

## Rollback and recovery

If migration fails, retain its error/evidence and confirm transaction rollback. If application validation fails after a successful additive migration, keep the runtime disabled and retain the new tables/constraints; do not drop Knowledge tables or revert to the legacy reader as a fallback. Preserve the failed-state snapshot for reviewed diagnosis. No automatic destructive down migration exists.

For data recovery, restore into a fresh isolated database/schema first, compare and review as above, then use a separately approved platform cutover plan. Do not merge a dump into nonempty production tables or bypass immutable triggers. Keep retrieval/writers disabled through cutover and reconcile current permission denials/deletions/unapprovals before reopening. Backup availability never implies external-source authorization.

## Remaining gates

- Select the actual current SOP; normalize the three-source pilot, explicitly approve source access and exact Knowledge publication bytes, and keep draft marketing examples labeled as drafts.
- Explicit setup approval for a dedicated Viewer-only service identity, approved folder/file allowlist and narrow credentials. Dot's connector access is not app access; no token copying.
- Implement/review the actual read-only provider adapter and current permission/unapproval classification; wire a protected configuration capability only after approval. No new SDK or spending is required by this preparatory code.
- Review production schema/backup/restore/cutover, retention and payload-size limits; satisfy the operator recovery drill above before real writes. The disposable drill is supporting evidence, not approval to run production commands.
- Independent review of this integration and later real-source owner-isolation/render verification. Slack, AI providers, shared ACLs and campaign publishing remain out of scope.
