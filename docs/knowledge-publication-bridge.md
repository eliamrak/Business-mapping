# Disabled owner publication bridge

Prepared after transport checkpoint `e1d4fd8fefa1cbc583a3307c3b8a6c66cc68e4c9`. This implements the app-side approval/pin advancement that was previously only a protocol proposal. It does **not** install an external connector, create publishing credentials, approve actual sources, configure Google, or enable production publication.

## Endpoint and identity

The existing `/api` Clerk `requireAccess` boundary protects `POST /api/knowledge/releases`. The route independently requires owner role and derives principal/practice from authenticated server locals and deployment configuration. It never accepts ownership, audience, approval, policy or authoritative pin fields from the body or query string. Browser cookie writes require JSON and `Sec-Fetch-Site: same-origin`; anonymous, data-entry, cross-site and caller-scoped requests are rejected. This is not an external-token authentication scheme.

The production route is constructed with **null bridge** and the read runtime still has **null configuration**. An authenticated owner receives 503 publication-unavailable; no mock/provider fallback occurs. Missing provider, disabled policy, absent policy version or missing explicit permission-age configuration also makes the internal bridge unavailable. The same-origin browser guard intentionally does not provide an external dot authentication path.

## Candidate request

```
{
  "requestId": "<unique UUID for this approved update>",
  "expectedRevision": 0,
  "entries": [
    {
      "resourceId": "<already registered resource UUID>",
      "fileId": "<already registered file ID>",
      "sourceRevision": "<exact proposed source revision>",
      "version": 1,
      "masterHash": "<SHA-256 of the proposed canonical master bytes>"
    }
  ]
}
```

This is a shape example, not actual resource registration. The entries must exactly cover the current approved registered set; unknown, duplicate or missing resources/files reject before provider access. Hashes/revisions in the request are candidate constraints, not authentication or source policy. Owner authentication plus the request authorizes publication of exactly those bytes under the existing private policy; source JSON claiming approval cannot publish itself. Server time, owner binding, private audience and manifest approval metadata are created by the bridge. Existing master/schema/approval-state requirements remain; source drafts do not become approved automatically.

The source adapter still verifies current authority and exact owner/folder/type/revision/content under server-approved registration. All masters must validate against the constructed manifest. Release metadata displayed by the runtime uses the approved manifest timestamp. Source-access approval, Knowledge publication and campaign approval remain separate; draft campaign examples retain their labels.

## Atomic authority and replay

Set `publicationMode: owner-bridge` only in a later reviewed server configuration. It requires a fixed `publicationPolicyVersion` and fingerprints the full source/identity/grant-epoch/lease policy independently of the changing release pin. A policy change—even without changing its version—invalidates existing bridge reads and requires explicit policy reconciliation. This endpoint cannot add sources or expand audiences. Policy reconciliation itself is not implemented or authorized here.

Validation/staging and activation execute on an isolated snapshot. A single generation-checked store operation then commits the owner approval record, approved manifest pin/bytes, active content, immutable history, projection cache and idempotency receipt together in `knowledge_pipeline_states`. It does not update an environment variable or dual-write another publication store. The reader uses that same atomic snapshot and validates policy fingerprint, actor, revision, manifest hash, masters, current grants and freshness before returning content. Configured-pin mode remains the backwards-compatible disabled fixture path; direct runtime stage/activate helpers cannot bypass bridge mode.

A predecessor conflict returns 409 and commits no candidate. Two concurrent successors have one CAS winner. Identical concurrent attempts may give one 409; retrying the identical request ID/body returns the recorded outcome without another write. Reusing an ID for different content/predecessor rejects. An old successful receipt does not reactivate content, renew a permission lease or override revocation; it reports historical publication outcome only. A later release can supersede it. The 1,000 retained-request cap fails closed with a maintenance-required error; no automatic pruning weakens replay protection.

Source denial/staleness discovered while validating a failed proposal is persisted through the same CAS so previously published denied content cannot remain available. This security update does not advance the approval pin, revision or candidate masters. Other valid old resources can remain readable under their existing approval and lease. Malformed/partial candidate data never partially publishes a new release. Time spent validating must remain within the explicit lease and the existing five-minute stage ceiling; invalid/backwards clocks or expired authority reject publication.

Policy is rechecked immediately before CAS. Current preparation assumes a reviewed server policy configuration; policy/grant changes must not be introduced as unrelated unsynchronized writes across live instances. Before live policy administration, reconcile policy version/fingerprint and state generation through one controlled deployment/transaction boundary. Readers fail closed on a changed policy fingerprint, rather than silently carrying old publication approval into a new policy.

## Recovery and storage impact

No new table or migration is added: the atomic JSON state gains a `publication` record containing policy version/hash, server-derived approving principal/time, revision, manifest hash and request receipts. Existing five-table backups include it. Recovery tests now publish through this bridge in real disposable PostgreSQL, roll back a later publication transaction, restore all five tables, read the restored bridge-approved content, and retry the same request without an additional generation/write.

This is synthetic recovery evidence, not permission for production writes. Restored approvals remain historical until current source grants/policy are reconciled. Existing migration, backup and rollback gates remain in [the rollout runbook](knowledge-storage-rollout.md).

## Future chat-driven connector contract

The intended user workflow is an explicit chat update → dot updates the canonical source through its separately authorized source connector → dot submits this exact candidate release through a supported authenticated app publication capability → the app validates and atomically publishes. The user does not manage imports, hash environment variables or deployment pins.

The app-side domain and browser-owner endpoint are now implemented, but **dot has no authenticated publication connection to this endpoint**. Installing/registering an MCP/plugin, granting OAuth/publisher access, creating tokens/keys, or reusing/copying Clerk cookies or dot connector credentials is not authorized by this work. A future connector must use verified supported authentication, bind the publishing principal to the existing owner/practice on the server, and obtain explicit approval for any persistent publishing access. Do not bypass the browser-origin guard merely to make a remote caller work; review a distinct authenticated connector route/auth policy.

The external connector must use a **separately approved, down-scoped Knowledge-only credential/OAuth grant**, never a full owner Clerk session/token. Its audience and permission must be accepted exclusively at the Knowledge publication boundary and restricted to the registered practice/resource policy. It must not authenticate clinical, financial, HR or other app routes, and the server must not exchange it for an unrestricted owner session. Existing Clerk owner authentication remains appropriate only for the internal app action. Team read-only assistants must receive no publish scope and must not inherit the publisher credential; read and publish principals/grants must stay separate. These credential audience/scope enforcement tests and the external authentication path are still an explicit integration gate. No such credential, OAuth grant or publisher identity has been created here.

The future connector must prepare a complete candidate bundle and persist a stable request ID while retrying. A 409 predecessor conflict requires fetching the latest release and reconciling the requested update; do not silently rebase different content. A duplicate-success response is an acknowledgement of historical publication, not a current-access guarantee. A 503 unavailable response means stop—never substitute mocks, an owner token, or a broader grant. Errors indicating source/policy changes require the corresponding explicit approval/reconciliation, not changing the request audience or ownership.

Concrete Google source-reader composition is still disabled. Its per-release byte/revision constraints must come from this authenticated candidate under the fixed source-registration policy, not manual per-edit environment changes or source-declared approval. No live adapter configuration or source IDs are wired here. Actual canonical SOP/map/cycle normalization and source publication approval remain outstanding. Current actual pilot sources remain private staged drafts with retrieval disabled.

## Validation and remaining gate

Synthetic tests cover actual owner middleware and HTTP route, role/origin/ownership denial, disabled/no-provider behavior, full bundle validation, independent server approval pin, partial/tampered sources, stale/changed authority and policy, conflict/replay/idempotency, concurrent CAS, revoked-content replay, pin-integrity checks, and disposable transaction/recovery behavior. No real Clerk/Google/data connection was used.

Next gate: independent review of this bridge; actual project/service identity/Viewer source setup; approved current SOP and canonical source registration; reviewed source-authority policy; concrete reader composition; and explicitly approved supported dot→app authentication/connection. No endpoint enablement, external grant, real source approval, production migration or deployment is part of this handoff.
