# Paired Repair Release Handoff

## Exact Scope And Hashes

Deploy **only** reader commit `0e11ab484b1eee36a717d90ddef12ba06feab41f`, tree `49e2f765ef72851d93ad85b6866565a727fe7a21`, from `codex/legacy-code-paired-repair`. Its runtime extraction is `c0e8cb1`; the remaining commit adds tests/release tooling. Verification-only followups do not change that pinned reader.

Baseline: GitHub main `fdbe612fb0dec4b6b97f15d627df0c868001b0ec`, same runtime as accepted labels `3f5ad92c5bebedc2d740b9ebb8c88b84abf2f689`. Accepted Replit publish commit `51f78b079f97059f6924df7b56e412e76b3bfdab`, tree `31f3e68473dc7e448c7b895870bc96c33b1f5755`, deployment `c71ffb1d`, live asset `index-D-r6F-4l.js`.

Do **not** deploy combined `a915dd3e73725f2ab1038886785f2e4ddb27fba1`, its historical parent `42c4b33b6826ceb36da54606e7e4639b53147d28`, or `codex/historical-billing-only`. They contain the gated historical-provider registry/ledger and unseen-export compatibility work. The extracted reader has none of those features, deletion-marker changes, UI or dependencies. Database files, Pages/components, declaration schema and coverage helper are unchanged against main. The historical-feature commit is not an ancestor of this reader.

Converter parser SHA-256: `4a9d2960dfa2fe33f92488f38a5b5dd6583565aae50dd93590e82ba94b99a5fa`.

Signed candidate native binary SHA-256: `db30a0ec718277bcc889079a810b1d36135c8ed09546be1e4bca2c705f23cdcf`. Original native baseline: `a8ccf4f6b896ff182cbaada93fbbd8d0fabcead78e8e6c7fc8119990c40bada4`. Difference is signing only: temporary unsigned copies compare equal. Original installed parser remains `a6d6fd2254295c0ea69c16bb54dee7ce70bdd68f1bceb4a32fc0365e1a34cbd3`.

Candidate bundle: `/var/folders/v1/nrrw04y90g3b9s27scm3_f1r0000gn/T/practice-paired-release-94fp8e/Practice Converter.app`. Adjacent `manifest.json` records these hashes, exact reader, signature and bundled-Python roundtrip proof. Reproduce with `node verification/package-paired-converter.mjs 0e11ab484b1eee36a717d90ddef12ba06feab41f`. It only writes its own temporary copy, never installs. Installed native-baseline drift aborts packaging. The existing ad-hoc signing policy/entitlements are unchanged; notarization is not claimed.

## Schema And Compatibility

There is **no SQL migration, dependency change, seeding, credential change, new access grant or business-data edit**. Do not run database push/migrations. Preserve current production Clerk configuration; synthetic Clerk keys are local-test-only and must never enter production.

An optional `cancellationSubtype: "late_cancelled"` is added to existing attendance JSON; it is valid only with canonical `status: "cancelled"`. Strict older importers reject it. Existing packages lacking the field remain supported. Compatible reader must be live and verified before new converter installation/export. Stored source rows, hashes, mappings, approval anchors and declarations are not rewritten by deployment.

Shared semantics: intake1=75 minutes; coaching30001=60, coaching30002=90; intensive consultation30003=25, separate from treatment and not assumed free; numeric4=paid phone treatment30, not literal PHONE; documentation2=zero visits/attended time with actual charges retained. Original codes and actual fees remain. No $135 or other fee is invented.

Existing legacy rows may acquire corrected derived classifications without any data mutation. Inventory them before release; independently reconcile any changed displayed metric instead of forcing a match. Unseen real exports, deletion semantics, historical-provider mapping and real-file acceptance remain gated. They are **not required to deploy this extracted code-only repair**, but this release does not authorize a real import or certify the owner's files.

## Reader-First Execution

1. Cloud worker `01a1405e-7b01-73da-9fa4-f4b95af950e5` must acknowledge handoff through the parent's working cloud channel. The local send-message tool returned **thread not found**; no deployment request was delivered. Do not imply coordination or publication already occurred.
2. Inspect the established Replit project and active source/asset; stop for unexplained drift or local changes. Record all four SELECT-only statements in `paired-repair-preservation.sql` before release. Compare against the accepted11 fingerprints, declaration revision1/hash, four exception events, prior/full audit hashes. Record subtype rollback gate and legacy-code impact inventory. No source rows/client identifiers leave the viewer. The SQL was parsed/executed on an empty disposable schema, not production.
3. Fetch the extracted branch and inspect **exact pinned reader**. Use the existing normal merge/release workflow, no force reset or historical-branch merge. Confirm the resulting source tree equals the pinned tree. Keep GitHub main unchanged unless separately coordinated. Use existing frozen dependency/install/build settings. Python3 is needed for converter-backed synthetic tests, not the production reader runtime; check its availability instead of installing anything implicitly.
4. Run existing release checks, then publish the existing Practice app. Record actual deployed commit/tree, build ID and fresh asset. Local asset `index-tm6tx2l1.js` is evidence of a successful local build, not a promise of the production asset name under its existing build configuration.
5. With the existing authorized owner browser session and same-origin request, POST **unchanged** `paired-reader-reject-only-probe.json` to `/api/practice-imports/package`. It deliberately has rowCount2 with one row. Required response: **400** with exact error `Attendance coverage and row count must match its rows.` This proves the subtype passed strict schema and then rejected before any DB transaction. A generic400,401 or403 is not proof. **Never correct/retry it into a valid package.** Source review and an independent mocked-route test confirmed zero DB queries; isolated service regression confirmed no saved snapshots.
6. Verify desktop/mobile behavior and both frozen January ranges/all7 scopes, labels and reported charges ($15,035/105 and $33,035/238 charge rows) against the accepted baseline, subject only to independently reconciled legacy-code effects. Keep known recent coverage unknown. Run all preservation SELECTs again; no hashes, declarations or approvals should change. Restore the original Overview/30days view. Record explicit compatible-reader PASS before converter installation.
7. Only after that PASS, check that the installed Converter is closed. Do not kill it or discard loaded work; ask owner to close it safely if active. Verify candidate signature/hashes again, preserve the existing app as a unique timestamped recoverable backup, stage/verify the candidate and replace the app with rollback on copy/verification failure. Do not touch `~/Library/Application Support/Practice Converter`, mappings, backups, reports or exports. Verify final signature/parser hash and run the installed parser with synthetic files and a temporary state directory. Reopen only the exact installed path for user retry.

## Rollback

Before any new subtype-bearing source is imported, production's subtype gate should remain zero. If reader publication fails, do not install the converter; restore the accepted reader using the normal existing deployment rollback and verify the accepted asset/behavior and unchanged preservation hashes.

After converter installation, restore its saved old app only while closed. Leave private data/mappings untouched. If any subtype rows have arrived, do **not** silently downgrade to a strict old reader, strip metadata, clear audit/approvals or rewrite rows. Keep the compatible reader and forward-fix, or use an independently reviewed compatibility backport. In this task no real import is permitted, so no new subtype source is intentionally introduced.

## Verified And Remaining

Author: extracted676/676 domain tests,38/38 isolated service tests,21 converter tests on the same reviewed parser, library/API/dashboard types and both builds pass. Final source `0e11` service evidence: `/var/folders/v1/nrrw04y90g3b9s27scm3_f1r0000gn/T/practice-isolated-api-BL1LKW/`; cleanup and empty-schema preservation SQL checks passed. Followup reject-only probe also has a service regression. Independent reviewer passed exact reader/tree,23 focused extraction/approval-preservation controls, both app types, packaging hardening, SELECT-only SQL and an independent14-control reject-only probe test with zero DB calls.

Signed temporary bundle and bundled-Python CSV-to-package-to-reader roundtrip pass: $650 actual charges and four treatment visits, original codes and late subtype preserved. Installed app remains unchanged.

**Current blocker:** parent must relay the pinned handoff through the cloud worker's available messaging channel and return compatible production-reader/preservation evidence. Local messaging cannot address that cloud task. No further owner file or goal amount is needed for code-only release preparation. Converter safe-close is checked only after production compatibility PASS. Actual user rejection remains unreproduced; obtain exact error text without client details if retry still fails.

Deployment, live reader/probe/preservation, native rendered retry and converter installation are not claimed as complete.
