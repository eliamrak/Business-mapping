# Offline concrete transport and future publication contract

Prepared after checkpoint `c691d35b06504b974b31055b6664289d60318058`. This is not a configured Google integration or the completed low-maintenance workflow. Production remains hard-disabled; no source registration, actual identity, credential, API enablement, grant, live call, migration or deployment occurred.

## What is concrete now

`google-transport.ts` implements Drive v3 metadata GET, JSON media GET and plain-text Docs export GET through injected HTTP. URLs are built only from validated registered IDs at `https://www.googleapis.com/drive/v3/files/{id}` or its `/export` suffix. There are no configurable API hosts, arbitrary URL calls, redirects, cookies, write methods, ACL listing or changes scheduler. Field masks/export MIME are fixed. Request/response timeouts include token issuance and body consumption; streaming byte limits apply before accumulation. Provider errors are reduced to enumerated codes and never retain response bodies, tokens, request URLs or exception causes.

These requests follow [files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get) and [files.export](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export). No SDK dependency is required for this REST transport. Authentication remains a separately supplied capability: Google recommends using its client libraries for service-account authentication instead of hand-building JWT exchange logic. This code does not parse keys, sign JWTs or invent a credential mechanism. [Google service-account authentication](https://developers.google.com/identity/protocols/oauth2/service-account).

## Exact server configuration contract

`googleTransportSetupSchema` requires:

| Field | Contract |
| --- | --- |
| `enabled` | Defaults false; true is accepted only by the explicitly constructed internal test/future capability. Production never constructs it. |
| `expectedServiceAccountEmail` | Exact dedicated `<service-account-id>@<project-id>.iam.gserviceaccount.com`; no actual value has been registered. |
| `expectedReaderPermissionId` | Exact independently resolved Drive permission identity for that service identity. Do not substitute the Clerk owner or workspace ID. |
| `scope` | Exactly `https://www.googleapis.com/auth/drive.readonly`. No write scope or ambient owner grant. Scope approval/setup remains pending. |
| `permissionMaxAgeMs` | Explicit approved freshness policy, 1–86,400,000 ms. No production default/SLA. Must be the same approved policy used by runtime configuration. |
| `timeoutMs` | Explicit 1–30,000 ms per transport operation. |
| `registration` | Existing strict Google adapter configuration: approved file/folder/source-owner/reader IDs, source kind/MIME mapping, Drive version, raw and master hashes, byte cap ≤500,000, and Docs publication envelope if applicable. |

The concrete token-source call is `getToken({ serviceAccountEmail, scope, signal })`. Its result must declare the exact identity/scope and unexpired token. Only a future reviewed issuer may provide this capability. These declarations are **not cryptographic introspection of an opaque access token**; the issuer must enforce provenance through an explicitly pinned service identity and official authentication mechanism. There is no fallback to ADC, `GOOGLE_APPLICATION_CREDENTIALS`, owner tokens, dot connector tokens, browser storage or Google login. Tests inject obviously synthetic tokens only.

The implemented environment acknowledgement is `PRACTICE_KNOWLEDGE_GOOGLE_ENABLED=false` (or unset). Any other nonempty value is rejected by `googleProductionSetupState`; it cannot enable the route. No credential/config-file environment variable is read. After project/identity setup approval, a reviewed deployment configuration capability must supply the typed settings and a platform-managed issuer/secret reference. Do not add raw keys to environment examples, code, browser bundles or source fixtures. Choosing keyless explicit identity versus a protected service-account credential is still a deployment decision blocked on the actual Google Cloud/project/platform information.

## Authority policy: preserved gate and narrower possible alternative

The existing adapter requires verified Viewer-only/restricted authority. The concrete transport returns **unknown** for `authority()` and therefore cannot make that adapter import anything. No policy has been silently weakened and no collaborator enumeration or privilege increase is requested.

A successful authorized read, together with independently registered owner/folder/type bindings, may be sufficient evidence for the dedicated service's **own read access**. It does not prove that no other collaborator or public link has access, nor does it prove the account could never write under a different credential. A read-only OAuth scope limits this transport's capability; it does not certify the whole file ACL. Google's file permissions field is conditional and shared-drive ownership differs. [Drive file metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).

A possible lower-maintenance policy would explicitly require only `service-read-access + registered-private-app-audience`, while treating external sharing as an owner-governed source policy. That would need a distinct authority mode/schema, approved threat-model decision, tests for wrong identity/owner/folder, denied reads, lease expiry and policy-mode confusion, and independent review. It must never manufacture `visibility: restricted` from missing ACL data. This alternative is **not implemented or approved**. Until the owner chooses that narrower requirement or a supported current authority verifier exists, the conservative gate stays closed. Broader privileges are not a default solution.

The proposed successor contract should separate `appAudience: owner` (server policy), `effectiveServiceAccess: read` (verified identity plus current successful registered-file read/export), and `sourceSharingVisibility: unknown | owner-attested-restricted` (separate privacy evidence with provenance/expiry). It must include policy version/approval epoch, exact source binding and permission-check time, and never accept those trust claims from source JSON. This is a design proposal for independent approval, not an accepted schema: the current literal `visibility: restricted` gate remains unchanged. Full collaborator enumeration is not necessary for the proposed own-read policy; no extra sharing/admin grant should be requested just to enumerate collaborators.

## Outage recovery correction

A fetch client can throw `TypeError` for a network outage, while UTF-8 decoding can also throw `TypeError`. These are now separated at the client/stream boundary. Metadata, download, export, authority and stream exceptions normalize to transient unavailable results; decoder/parser/schema/integrity failures remain content rejection. Tests exercise valid version 1 → metadata/download/stream outage → healthy read using the same manifest, version and approval epoch. No tombstone is created for the outage, runtime returns no content while stale, and successful full revalidation restores the original approved version.

HTTP 401 can be token expiry/configuration; 403 can be quota, API/app/domain policy, or access failure; 404 can mean absent or inaccessible. None alone proves an owner deliberately revoked approval. These results mark the source unavailable/stale and withhold all runtime reads until successful revalidation under the same registered identity/bindings. There is no automatic privilege request or silent fallback credential. Explicit source unapproval, confirmed trash/deletion, separately verified revocation and source-integrity violations retain their distinct tombstone/reapproval behavior. Current unknown privacy-authority remains a conservative policy refusal, not a claim that the owner revoked a source. [Google Drive error reasons](https://developers.google.com/workspace/drive/api/guides/handle-errors).

The internal `network-error` status covers transport/auth/service uncertainty; it does not assert the root cause was the network. No retry loop or scheduler is enabled. An operator fixes credential/service availability where necessary; an ordinary transient outage then permits revalidation of the same approved release instead of forcing a new content version.

## Ordinary chat edits must not require manual imports or pins

There are two separate approvals:

1. **One-time source policy:** verified app practice/owner, permitted publisher identity, fixed source/folder/owner/type allowlist, private app audience, permitted categories, payload limits, freshness policy and revocation rules. Source additions, owner/folder changes or audience expansion require an explicit policy change.
2. **Per-release publication:** exact canonical resource versions/bytes and derived metadata approved for Knowledge publication within that policy. Draft campaign examples may remain explicitly labeled drafts. Neither source approval nor Knowledge publication constitutes campaign approval.

Static registration revisions/hashes and `approvedManifestHash` are useful test pins, **not the finished operating workflow**. A Drive change or a source document declaring itself approved cannot update the authoritative pin. Successful Drive reads prove neither publication intent nor chat authorization.

For ordinary chat-driven upkeep, the intended sequence is: dot updates the canonical source through its separately authorized connector; dot submits an authenticated release request bound to the established private source policy; the app verifies that publishing identity and its authority for the server-derived practice/owner; the app fetches the allowlisted bytes read-only, validates source version/hashes/schema; then it commits the approved release and active manifest pointer atomically. The user edits through chat and does not manage import files, pins or deployment variables.

**An authenticated dot→app publication connector (or equivalent independently verified owner-controlled publication authority) is still required. None is installed or implemented here.** No existing dot connector token can simply be reused by this app. A claimed actor, approval flag, audience or hash inside the source is not this trust evidence. The connector would need explicit setup approval, a supported authenticated transport, server-side publisher-to-practice/owner mapping and a scoped publication permission. The caller must not choose its own ownership binding.

Before that future connector is accepted, its protocol/storage implementation must prove:

- Request identity and approval evidence originate in the authorized publishing channel, independently of source content. Approval can be emitted by dot for a chat-authorized update under the once-approved publishing policy; how that evidence is authenticated is a setup gate, not a field we trust today.
- Every request carries an idempotency key, expected predecessor release and exact candidate hashes/version mapping; it cannot add sources or widen audience implicitly.
- Publication authorization, new pin and the active manifest/cache pointers commit in **one** database transaction/CAS authority. The current externally supplied configuration pin must move into that reviewed release-authorization boundary; do not update a config variable and database row separately.
- Two different concurrent successors to the same predecessor have one winner; the loser rereads and requires a newly validated successor. Identical retries return the recorded outcome; conflicting reuse of a request ID is rejected.
- Incomplete bundles, revoked policy, changed owner/folder, denied/expired source checks, stale releases, mismatched content and policy changes during staging publish nothing. Approval of a release cannot restore a revoked source without an explicit new grant epoch.
- Recovery preserves accepted request IDs, publication approvals and revocations; restored historical approval never bypasses reconciliation with current policy.

Those connector/transaction tests are **future acceptance requirements**, not claims about tests already run. Existing atomic staging/replay/recovery tests cover the data pipeline beneath this missing authenticated approval/pin-advancement layer. No new publication endpoint or source-approval grant is added in this task.

## One-time external setup checklist

- Resolve Google Cloud availability and the exact approved project/platform; explicitly authorize service identity and API enablement.
- Choose and configure the dedicated credential/issuer mechanism with the approved read-only scope; share only approved sources/folder as Viewer. No domain-wide delegation, owner impersonation or connector-token reuse by inference.
- Register actual resource IDs and resolve source-owner and service permission IDs; verify supported metadata and export behavior as that identity. Select the actual current SOP and approve canonical private source publication separately from draft marketing examples.
- Resolve the authority-policy decision above without automatically requesting broader access; select an explicit freshness SLA and operational revalidation mechanism.
- Authorize/design the authenticated publication connector so ordinary chat edits advance approved releases automatically, with no user-managed pin changes.
- Complete independent review, protected configuration wiring, production recovery/migration review and separately approved live validation/deployment. Current code remains disabled until these gates are satisfied.
