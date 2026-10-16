# Legacy Code And Cancellation Candidate

Frozen implementation: `a915dd3e73725f2ab1038886785f2e4ddb27fba1`, tree `b8679235e144c50a6c21042846ad72d7b5b11b9f`, on `codex/historical-billing-only`. Main and the accepted label release are unchanged. No deployment, installation, real-file access or real import occurred.

## Implemented Semantics

| Original code | Meaning | Default minutes | Treatment visit |
| --- | --- | --- | --- |
| `1` | Intake, same default as `90791` | 75 | Yes, if attended |
| `30001` | Coaching | 60 | Yes, if attended |
| `30002` | Coaching | 90 | Yes, if attended |
| `30003` | Men's intensive consultation | 25 | No; separate consultation |
| `4` | Billed phone treatment, not literal `PHONE` | 30 | Yes, if attended |
| `2` | Documentation fee | 0 attended minutes | No |

Every billed row keeps its original code and actual fee, including documentation, paid consultation and cancellation charges. Historical $135 coaching pricing is not a fee default. Missing fees remain errors. Documentation uses a semantic zero duration rather than an invalid zero entry in the existing positive-only configurable-minutes map. Existing stored maps and raw source facts are not rewritten.

Shared Practice classification governs treatment/consultation separation, retention, imported session counts, billing-linked older attendance flags, billing reconciliation, duration fallback and the distinction between free PHONE anomalies and paid code30003 consultations. Matching code4 treatment remains treatment even with a separate documentation fee on that client/day. Old/new consultation metadata alone cannot create a fee conflict for a confirmed numeric code. Ambiguous actual amounts/encounters still require review; this does not create or rebind billing approvals.

Converter source and synthetic tests are now retained under `tools/practice-converter`. Previously imported raw facts are interpreted using the confirmed code definitions; they are not edited. New duration defaults are exported only when their legacy code is present, preserving the existing golden package and ID for unrelated reports.

## Cancellation Path

The installed converter already accepted exact `Late Cancelled`/`Late Canceled`. Its 21 synthetic tests and signature passed; an independent focused installed-parser test retained $150/$175 cancellation charges with zero shows. That exact installed app was opened for owner retry without reading reports or mappings. An older registered build or different raw status remains a hypothesis only.

A separate downstream gap was reproduced by source inspection: Practice's direct raw attendance CSV parser rejected the late alias and omitted attendance billing codes. The candidate accepts the known late aliases, preserves the original code and adds `cancellationSubtype: "late_cancelled"` while retaining canonical `status: "cancelled"`. Converter output, strict client package validation, strict API validation, durable snapshot reload and local backup roundtrip preserve that detail. A late subtype paired with show status is rejected. No late cancellation becomes attended, no-show or clinician cancellation.

This new optional field is a paired-reader change. Older strict importers reject it; do not install/export with this candidate converter ahead of the paired reviewed Practice runtime. Existing packages without the field remain supported. A code rollback does not erase stored JSON, but subtype-bearing sources require a compatible reader for full review. Preserve originals, mappings, audit history and source/approval anchors; do not rewrite stored rows or silently strip metadata to back out.

The owner's original rejection remains **unreproduced**. Files entered into the converter were not delivered here. Retry the exact opened installed copy and obtain the exact remaining error text without client details if it persists.

## Verification

- 687/687 domain/dashboard tests passed, including four converter-backed semantic and inverse regression tests.
- 21/21 repository-local converter tests passed, including unchanged golden package/ID, cancellation charge preservation and privacy checks.
- 38/38 isolated service tests passed: Hub16, imports9, annual-goal persistence1, authenticated Sessions12. Imports includes actual synthetic CSV conversion, strict HTTP import, database reload, all original codes/fees, late subtype, idempotency and contradictory-subtype rejection.
- Final service evidence: `/var/folders/v1/nrrw04y90g3b9s27scm3_f1r0000gn/T/practice-isolated-api-y7OPmf/`. Its JSON records exact candidate SHA and confirms the temporary cluster stopped and database files were deleted. Durable summary: `isolated-api-service-results.json`.
- 27/27 source-pinned aggregate/mapping/label/historical tests passed with the audit pin updated to this runtime and converter-source guard included. No production audit was run.
- Library, API and dashboard types passed; API and dashboard builds passed. The aggregate typecheck wrapper could not find a bare `pnpm` executable, so its constituent library/API/dashboard checks were run successfully through corepack. Dashboard build required explicit `PORT`/`BASE_PATH`; its known nonfatal sourcemap/chunk warnings remain.
- Independent reviewer Newton passed the exact frozen SHA/tree, reran 81 focused Practice tests, all21 converter tests and both app typechecks, and confirmed no runtime drift. All five synthetic review findings were fixed and covered.

In the end-to-end fixture, $650 in actual billed fees survives, including documentation25, paid intensive consultation60, coaching151 (not assumed135), and late cancellation35. Four attended treatment visits remain; documentation and consultations do not inflate them. The billed-time calculation assigns documentation zero and the correct legacy durations. Financial billed revenue remains650, not cash collections or certified profit.

## Remaining Release Gates

Native packaging, signing, rendered retry and installation of this new converter candidate remain unperformed. The original installed app is unchanged. Real export/header/marker compatibility, the actual reported error, independent real-source reconciliation and paired deployment acceptance remain pending. Keep this combined historical/legacy branch separate; no merge or deployment is authorized by these synthetic passes alone. Hosted Clerk/cookie/refresh and remote revocation remain outside the offline auth fixture scope.
