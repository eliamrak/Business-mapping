# Minimal Import Independent Frontend Review

Reviewed 2026-10-22, dirty branch `codex/minimal-import-status`, HEAD `1f510976` (short form `1f51097`). Read-only implementation review; this report is the reviewer's only file change. No commit, database access, API import, owner files, or duplicate browser harness run.

## Current Findings

No remaining findings in the requested frontend scope at the reviewed dirty revision. Follow-up review completed after the handler guards, conditional billing attention link, server conflict message, and 1040px layout changes.

Final edge-guard follow-up: `importPackage` (line 444) and `confirmSnapshotCoverage` (line 578) now return while busy or unconfirmed. Both coverage-form render paths (lines 706 and 740) pass the unconfirmed lock into the form; its disabled fieldset, submit button, and submit-handler check honor that lock. This prevents a coverage PUT from resetting feedback and releasing the pending-import lock before history reload. The guards preserve ordinary confirmed-state behavior. Verified in source; the existing 63-case harness has no dedicated attempted coverage-PUT bypass scenario.

### Closed P1: Unconfirmed overlap save allowed resubmission and a false cancellation receipt

Location: `artifacts/comp-dashboard/src/components/practice/local-retention-workspace.tsx:519`, `:551`, `:695`.

The original finding concerned a 409 followed by a retain/replace save whose acknowledgement was lost: pending actions remained usable and Cancel could falsely claim unchanged history. Both `savePending` and `keepExisting` now return while busy or unconfirmed; all three overlap buttons and the upload picker are disabled while unconfirmed. Successful history GET clears pending and updates saved counts; failed reload keeps the uncertain state.

Closure evidence: independently inspected current handlers and controls, the updated synthetic harness, its fresh **63/63 passing** result, and [locked overlap actions](../../minimal-import-evidence/candidate/overlap-unconfirmed-actions-390.png), [visible uncertain feedback and pending review](../../minimal-import-evidence/candidate/overlap-unconfirmed-390.png), and [GET recovery](../../minimal-import-evidence/candidate/overlap-recovered-390.png). The added mounted flow returns 409, commits retain but responds 500, verifies all actions/upload disabled and no resubmit or cancellation receipt, then GETs four saved sources and verifies pending/error cleared with upload re-enabled. This closes the reported path; it is synthetic evidence, not a real API transaction.

## Visual And Flow Review

Inspected the browser agent's fresh candidate screenshots, including the final centered 1040px desktop layout. Evidence directory: [candidate](../../minimal-import-evidence/candidate/). Earlier transient route-fade screenshots are superseded and are not a remaining translucency defect.

1. **Default Data screen: passes.** [1440px](../../minimal-import-evidence/candidate/data-top-1440.png), [1280px](../../minimal-import-evidence/candidate/data-top-1280.png), [390px](../../minimal-import-evidence/candidate/data-top-390.png), [320px](../../minimal-import-evidence/candidate/data-top-320.png). Upload, status and coverage are readable on opaque surfaces. Four collapsed rows replace the earlier technical band stack. Artwork remains visible around the narrower desktop tool. No upfront exclusion checkbox wall or observed clipping.
2. **Validation and saving: passes within synthetic evidence.** [Checking](../../minimal-import-evidence/candidate/checking-390.png), [saving](../../minimal-import-evidence/candidate/saving-390.png). Distinct checking and waiting-for-server states use indeterminate progress, without invented completion percentages. Invalid files surface an alert before posting.
3. **Acknowledged upload and duplicate: passes within synthetic evidence.** [Saved](../../minimal-import-evidence/candidate/saved-390.png), [duplicate](../../minimal-import-evidence/candidate/duplicate-390.png). Package row counts are explicitly package contents, not newly added sessions. Saved-source counts come from the response snapshots. The latest stay-on-Data assertion passes.
4. **Reload: passes within synthetic evidence.** [Reloaded](../../minimal-import-evidence/candidate/reloaded-390.png). Loaded history is distinguished from a new save. Counts and observed date bounds use fetched history. Last-package time comes from saved package metadata, not the client clock. Observed dates remain separate from verified metric coverage.
5. **Overlap review: passes, including uncertain follow-up.** [Overlap](../../minimal-import-evidence/candidate/overlap-390.png). Keep and Cancel are visible directly after the upload surface. Replacement is disclosed separately. The panel is outside More data tools and displays the server conflict message. Lost-acknowledgement closure is documented above.
6. **Initial-upload uncertain failure: passes within synthetic evidence.** [Unconfirmed](../../minimal-import-evidence/candidate/upload-error-390.png). Error and uncertainty remain visible. Upload is disabled pending successful reload. Copy acknowledges that the save may have completed.
7. **Disclosures and calculations: passes for the inspected surface.** [Calculations at 320px](../../minimal-import-evidence/candidate/calculations-320.png), [billing at 320px](../../minimal-import-evidence/candidate/billing-320.png). Native details/summary controls preserve keyboard operation; the shared harness reports Enter/Space and attention-link opening at all four widths. Mappings, history and technical analysis are collapsed. Coverage dates still require explicit user confirmation; no automatic proof is introduced.

The mobile navigation consumes substantial vertical space, so the full attention area requires scrolling. Text itself remains readable and controls fit; this is not a new blocking defect in this patch. Screenshots do not establish screen-reader speech, focus recovery after every async update, or exhaustive accessibility compliance.

## Rechecked Repairs And Scope

- Parent `practice-workspace.tsx` removes only `setSection("rooms")` from imported-location backfill. Room staging, staged labels, review state and message are retained. Calculations alone become a collapsed disclosure. The updated exact-byte guard reconstructs precisely those changes rather than accepting arbitrary parent edits.
- The previously hidden overlap panel is now a sibling immediately after the upload section. Technical consolidation no longer hides that decision.
- Final attention changes inspected in source: the billing link requires conflicting/ambiguous billing, stale approvals, or PHONE fee anomalies; the coverage review label ignores periods that have not ended. Fresh browser assertions verify that a fixture without billing exceptions has no billing attention link at 1440/1280/390/320px, while the Billing exceptions disclosure remains operable. Positive billing-attention conditions were checked in source, not exercised with a new conflicting-billing fixture. These changes introduce no additional finding.
- Restore UI in `components/hub/reports.tsx` reloads the page after server success; startup history loading then supplies displayed counts. No `onPersisted` callback exists in the reviewed checkout. No restore was executed and no broader restore guarantee is claimed.
- Raw source retention, clinical admission calculations, numerical reconciliation and server transaction semantics belong to the parallel numerical/API review. This frontend review does not certify them.

## Verification

Reviewer ran `node --test artifacts/comp-dashboard/src/lib/import-feedback.test.ts`: **3/3 pass**.

Reviewer ran `node --test verification/tidal-theme.test.mjs`: **21/21 pass**, including the updated exact parent-byte guard.

Follow-up reviewer reran both commands together: **24/24 pass** (3 feedback and 21 theme tests).

Inspected the browser agent's refreshed [candidate/results.json](../../minimal-import-evidence/candidate/results.json): **63/63 pass**, zero runtime errors, including the new overlap lost-acknowledgement path and post-conditional-link assertions. The completed run reports only isolated mock API requests (7 package POSTs and 12 history GETs). Reviewer inspected the 1440/1280/390/320px default screens, saved/reload/error, billing/calculations, and the new locked/recovered overlap screenshots; no additional readability or clipping defect was observed.

After the final import/coverage edge guards, reviewer ran `node verification/data-import-readability.mjs` against the current source: **63/63 pass**, zero runtime errors. The initial sandbox attempt could not bind localhost; the approved retry completed using the harness's ephemeral loopback mock server and external-request blocking. Refreshed results and screenshots are in the same candidate directory. Rechecked locked overlap actions, recovered saved history, and the 320px screen from that run. No frontend/API source or harness edits were made.

Disposition: **accepted within the requested frontend/code and visual scope; no remaining findings**. Real API persistence, actual eight-source history, server deduplication/transaction behavior, and numerical reconciliation remain outside this report's certification. Screen-reader speech, exhaustive focus recovery, and broader accessibility compliance are not established by these checks. Only this review file was edited by this reviewer; no commit or real API action was performed.
