# Interactive Workflow Acceptance

## Candidate And Bounds

Frozen runtime/test candidate `a5121c47a01a07ff0e6917f8dd75b3c21bc14003`, tree `71f0ec222b5fbfe189ad37bbf0a73ed1c37ad986`, branch `codex/workflow-acceptance`, based on released `7d8ac067`. No push or deployment in this task. All browser data and downloaded files are synthetic. No private client files, real business records, owner browser, credentials, server settings or converter code were accessed or changed.

The mounted browser harness uses actual `PracticeWorkspace`, lead-entry and import components, `customFetch`, production parsers and the actual `Reports` recovery component. Endpoint transport is a revision-aware in-memory fixture, not PostgreSQL. The browser-managed backup attachment is served by the loopback fixture server; ordinary endpoint traffic is intercepted locally. This verifies UI behavior, not backend transaction guarantees. Separately, nine tests mount the actual backup router with a database replacement; those are also not PostgreSQL.

## Completed Checklist

| Workflow | Evidence And Outcome |
| --- | --- |
| Manual leads | Actual year grid entered 100/50/40/10; displayed rates 50%/80%/25%/10%; saved and reloaded. Monthly-detail input subsequently edited via blur, staged Save edits, saved and reloaded to 160. |
| Invalid/discard | Negative edit disables save; Discard restores saved value. Blank counts remain unknown rather than seeded. |
| Failed save | Injected 503 preserves draft and saved data. A changed payload while a prior save is unconfirmed is blocked before another POST. Retrying the original payload succeeds. |
| Delayed response | During a held response, editing and repeated saves are disabled; one server-side fixture commit occurs. The response completes without losing the draft. |
| Interrupted/repeated save | Response lost after fixture commit; retry reuses the same request ID and produces no additional commit. |
| Stale revision | Injected 409 preserves the draft and does not overwrite the concurrent edit. After discard/refetch, a new save retains the concurrent practice-name change. Six intended lead commits total. |
| Import failure/cancel | Invalid JSON issues no package POST. Injected import 503 changes no sources; overlap Cancel adds nothing. |
| Repeated/retained import | Actual file upload and overlap-review UI retain sources. Repeating identical package adds no snapshots. Changed content under the same ID is rejected. |
| Interrupted import | Lost response after fixture commit, then repeat upload, reports duplicate and adds nothing. Five synthetic approvals and declaration revision 2 survive imports and reload. |
| Local JSON download | Actual Blob download contains all displayed snapshots and preserves raw facts. This is the documented partial clinical-history export, not full recovery. No local JSON restore control is exposed by the actual component. |
| Business backup download | Actual attachment click downloads a 17-table synthetic envelope; authentication tables are absent. |
| Recovery refusal | Nonempty app, malformed backup and incorrect confirmation cannot restore. |
| Recovery failures | Expired preview and injected rollback error are visible and retryable; no fixture restoration occurs. |
| Disposable recovery | Exact confirmation restores the reviewed fixture, reloads the component, preserves leads/settings/import facts/declarations and all five approvals, then refuses another restore into the now-nonempty target. Three attempts: expired, failed, successful. |
| Responsive rendering | Twelve 1280px/390px states passed with zero browser errors or document overflow. Tables retain their own horizontal scrolling where appropriate. Author inspected mobile lead and recovery captures. |
| Marketing estimate | Actual Money component shows known dated marketing and available profit despite blank acquisition fields; an undated unresolved campaign shows a distinct partial subtotal, not full profit. |

Final author screenshots/downloads/results: `/tmp/financial-completeness-render-SVJJEr/`. Reproduce with `PRACTICE_PLAYWRIGHT_PACKAGE=/tmp/forge-reviewed-da6f1d2c-stage/package.json node verification/interactive-workflow-acceptance.mjs`. Machine results are retained as `INTERACTIVE-WORKFLOW-RESULTS.json`.

Initial harness failures were corrected as fixture/transport errors: unsupported display-only treatment metadata, stale observed bounds, attempting to feed retained-overlap data into an unused legacy local restore parser, exact HTTP-prefix text matching, attachment routing, and waiting for the old document rather than completed reload. None was presented as a verified application defect or used to weaken production parsers.

## Runtime Defects Corrected

### Configured Marketing

The previous blanket campaign/hiring guard nullified historical marketing after budgets had accrued. It did not inspect required spend inputs independently of acquisition inputs. The correction accrues active dated campaign spend plus configured optional other costs, independent of lead/conversion fields. Blank optional other cost is no configured additional cost, matching the existing forecast. Applicable recurring marketing budgets remain additive; a campaign association alone does not mean an agency service duplicates ad spend. Missing optional first-bill references do not block calendar accrual.

The source-derived September 24-October 7 regression uses $850/month from January 1, an additional $500/month from October 1, and $972/month of dated recurring services. It returns $949.4559139784946 configured marketing. It does not claim this is reconciled paid spend. Unlaunched hiring profiles are templates, not incurred marketing expense; enabled unsupported hiring events still withhold affected profit. Unknown acquisition rates do not invalidate a known expense budget.

For genuinely unresolved marketing, a separate `surplusBeforeUnconfiguredMarketing` deducts all known dated costs and known marketing. Full `profit`, allocations, cash and goal achievement stay unknown. No family salary subset is deducted twice. The subtotal is separately labelled in Money/Overview and never substituted into the profit metric or recorded actuals.

### Full Business Recovery

The published business-backup allowlist omitted four durable import business tables. Fresh-app restoration could succeed without source facts, declarations or approved exceptions, and an import-only target could pass its emptiness check. The existing documented full-business recovery contract required repair.

The corrected allowlist includes `practice_import_packages`, `practice_import_snapshots`, `practice_import_declarations`, and `practice_import_audit`, including archived rows and exact journals. Export ordering handles the declarations composite key; sequence handling never assumes its nonexistent `id`. Schema checks, emptiness checks, locks and transactional inserts cover all 17 tables; packages precede snapshots. Authentication exclusions remain unchanged. Old 13-table backups are explicitly rejected as incomplete, not silently treated as full recovery. No schema migration or business-data mutation is part of shipping this reader/route change.

## Tests And Independent Review

- Author: 745/745 domain/dashboard tests; 49/49 database-free API tests, including nine actual-backup-router tests; dashboard/API TypeScript and builds; twelve rendered states; diff checks pass. Existing Vite large-chunk advisory remains. Local dashboard asset: `index-HgBOmZWD.js`.
- Independent reviewer Meitner (`01a14bd5-212e-7234-a55b-89561a7f70e4`) verified the exact candidate commit/tree and runtime fingerprints, passed 50 focused tests, and reported no concrete findings. Browser reruns and actual PostgreSQL constraints/locks/sequences were outside that review.
- Author unit/route tests cover explicit legacy rejection, import-only target refusal, schema/lock expansion, declaration composite key handling, all five approvals, archived records, settings/declarations, rollback and exact restored-table equality with an in-memory database replacement.
- New PostgreSQL integration assertions are in `artifacts/api-server/test/hub.integration.test.mjs`, with `backup-fixture.mjs`. They add durable-import fixture rows to fresh recovery, import-only refusal, full restored-table equality and repeated-import approval preservation. These new assertions have not been executed against PostgreSQL locally.

## Remaining Checklist

- [ ] Run the **new 17-table recovery assertions** against the disposable PostgreSQL environment in Replit. Parent reports prior baseline PostgreSQL/API suites passed there; that is not automatically acceptance of the newly expanded recovery route. No Mac cleanup is requested.
- [ ] Release coordination reviews/publishes this exact candidate if approved, then verifies fixed-window configured marketing/profit and recovery availability. No deployment occurred locally.
- [ ] Any fresh real-account authenticated workflow acceptance remains a separate live check, not a claim from these synthetic interactions. No private client import or production restore is requested or necessary.

No new owner interview, exact bank reconciliation, SEO/Ads planning or unrelated completion gate is proposed. Logs: `/tmp/practice-interactive-workflow.log` and `/tmp/practice-workflow-*`. Existing untracked `verification/practice-workspace-render/` was preserved untouched.
