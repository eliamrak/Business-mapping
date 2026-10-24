# Knowledge foundation — owner-only, disconnected

Implementation base: `e0651beb0f5a832559c11d4dda33f8e69578c0d0`. Independent branch: `codex/knowledge-foundation-20261024`. This source work does not modify the progression release branch, deploy an app, apply database changes, or connect any provider.

## Boundaries and contracts

- Existing Clerk `requireAccess` remains the outer API gate. It now exposes the verified Clerk user ID in server locals. The Knowledge gate additionally requires `owner`, a nonempty verified principal ID, and an explicitly configured `EMC_PRACTICE_ID`. There is no owner-email/default-practice/workspace-ID fallback for Knowledge. Client scope, roles, URLs and approval flags are not accepted.
- `GET /api/knowledge` (and HEAD) returns only the owner's approved, explicitly published versions in the server-bound practice. Mutations return 405; query/body inputs return 400; non-owners fail before reads; unconfigured scope or unavailable tables return 503. Responses are private/no-store. There are no importer, approval, provider, bot or arbitrary-URL endpoints.
- The repository only knows Knowledge resources and versions. SQL joins include both practice and principal; the service independently validates both bindings, resource/version identity, publication pointer, approval metadata, source approval flag, content hash and archived state. Invalid records fail closed. No clinical, financial, reporting-attachment, HR or metrics repository is imported. No LLM/embedding/provider call exists.
- Read response contains approved display DTOs only: resource ID, title/category, selected logical version, normalized content hash, approval time and text blocks. It excludes owner identifiers and private source locators. Frontend query caches are keyed by authenticated user and discarded on unmount; failed reads do not display cached resources.

`lib/practice/src/knowledge.ts` defines strict resource, version, content, receipt and response schemas. Resources default to audience `owner`, no published version and not archived. Resource kinds cover SOP/map/reference/audience/brand. Versions have logical version, schema version 1, derived-view version 1, SHA-256 of validated canonical text-block JSON, creation time, draft/approved state, explicit bound-owner approval identity/time, and source provider/file ID/revision. Source `approvedForImport` defaults false independently of version approval. Source locators are opaque IDs, not fetchable URLs. Google provider is a reserved enum value, not a connection.

Draft versions have no approval metadata; approved versions must name the bound principal and include a timestamp. Selecting a published version is explicit; a newer draft never auto-publishes. Receipts describe staged/unchanged/rejected outcomes with validated matching reasons and do not imply source approval or publication. No write/approval workflow is implemented in this foundation.

Content is deliberately limited to bounded plain-text headings/paragraphs. HTML/control characters and unknown fields are rejected; React renders text nodes, never HTML/iframes. Rich maps, images, provenance links, citations and source-specific normalization remain later work. Private ChatGPT Pages are not treated as an ingestion API.

## Storage (definitions only)

`lib/db/src/schema/knowledge.ts` defines separate `knowledge_resources`, `knowledge_versions`, and `knowledge_import_receipts` tables. Composite primary/foreign keys bind versions and receipts to the same practice/principal/resource; versions default draft and resource audiences default owner. Runtime schema validation is required even for trusted import jobs. No migration, schema push, SQL write, source import or real database read was executed for this work. On an existing deployment without these tables, the read route deliberately returns unavailable rather than creating them.

Database provisioning/migration review, immutable-version writes, source approval workflow, deletion/revocation behavior, recovery/export coverage and auditing retention must be implemented/reviewed before live sync. Existing financial backup formats are unchanged and do not back up these new Knowledge tables.

## UI

Knowledge is a separate Today section, outside reporting documents and financial/clinical import flows. Tabs: Operations & SOPs; Archetypes & Ideal Clients; Copy & Brand Voice; Resources & Visual Maps. Owner/private, disconnected-sync and approved-version-only semantics are visible. All tabs have keyboard navigation. Empty, loading and unavailable/retry states are explicit.

The actual Practice SOP slot remains unfilled. Marriage map and private conflict-cycle are only named planned sources: no real IDs, content, chat links, review notes or old coding-verification policy are included in fixtures. Synthetic references exist only in tests/render harness, never seeded into the app/database.

## Validation and rendered evidence

- `node --test artifacts/api-server/test/knowledge-foundation.test.mjs`: isolated service plus HTTP tests through the real authorization middleware with mocked Clerk/database; no external auth or business data.
- `pnpm test`: existing domain regressions.
- Shared-library/API/dashboard typechecks and API/dashboard production builds are run separately; unchanged mobile failures mean no workspace-wide all-build claim.
- `node verification/knowledge-foundation-render.mjs`: actual component with synthetic/empty data, local Chromium, 1280/768/390/320 widths; tabs/focus, version display, loading/error/retry, no overflow or provider/API requests. Evidence is worker-local `/tmp/practice-knowledge-render`; committed JSON report is shareable through Git. No assumption of shared screenshot paths.

## Remaining live-sync gate

1. Identify a current Practice SOP and approve the three-source pilot inventory/content.
2. Normalize approved conceptual sources to canonical Docs/JSON and define source/version/derived-view mappings. Exclude private chat/review-note material.
3. Explicitly authorize and configure a dedicated service identity with Viewer access only to approved Google folders/resources. Dot's connector grants are not app credentials; no token copying.
4. Review/apply separate Knowledge storage changes and implement an audited importer/approval workflow with idempotency, revocation/deletion handling and permission-filtered retrieval.
5. Validate real-source rendering and owner isolation before deployment/live import. Metrics remain deterministic app queries, outside retrieval.

Foundation source and synthetic checks do not complete the three-source pilot or live-sync milestone.

Rendered inspection: desktop empty-state and 390px synthetic-reference screenshots were viewed directly. No clipping or overflow was observed. Nine browser assertions passed, including keyboard tabs, mobile widths, unavailable/retry states and GET-only fixture assets. Report: `verification/knowledge-foundation-browser-report.json`. These are component-level checks, not live deployment or real-source acceptance.

Final foundation gate: 1,258 existing domain regressions passed; four isolated Knowledge contract/service/HTTP security tests passed; nine synthetic browser checks passed. Shared-library, API and dashboard typechecks passed; API and dashboard builds passed (dashboard retains the existing large-chunk warning). No database-backed integration suite or production/live-source verification is claimed.

## Disabled importer extension

The later [import preparation](knowledge-import-pipeline.md) supersedes the initial storage/normalization limitations above: it adds approval-bound display metadata, current source authorization, synthetic manifest processing, a review-only migration and disposable PostgreSQL/browser session tests. None of those changes enables live sync, applies production migrations or completes the pilot. See that document for the remaining backup/restore and authoritative publication integration gates.
