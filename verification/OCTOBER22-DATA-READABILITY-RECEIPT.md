# Data Readability And Converter Package Filename Repair

Base a3b7e140c1d972c6ebba76b0b5b795eee904da41. Existing publisher before this
repair: c8e19f2a25fce8aa5586152f88122cbace258e84, tree
bc6b905e9e9fa342477d08ddb6bb4bbfbb8bb74a. Reverify before integration.

## Confirmed Causes And Bounded Changes

Data's dark text appeared over the artwork because the local import workspace,
nested coverage/provenance disclosures and session calculations had no opaque
reading surface. The billing approval textarea used a hard-coded dark fill with
inherited dark Tidal ink. The native file-selector button also had a dark fill
and dark text. A scoped opaque reading band now covers Data's two roots; normal
theme tokens style fields and the file selector. The artwork, parallax and all
other screens' layout remain intact. No clinical or financial equation changes.

The provided attachment was 64,432 bytes, valid JSON, package format
emc-practice-local-import-package, version 1. The existing pure package validator
accepted its two collections with zero warnings. Its supplied filename omitted
.json. The previous filename predicate rejected it before parsing. This
investigation did not submit the attachment, call a production import endpoint,
or change any saved snapshots, provider mappings or records. No private rows or
identities are copied into this repository, fixture, report or screenshot.

The file reader now checks nonempty size, the same 10 MB maximum and valid JSON
content rather than a suffix. The unchanged importLocalPackage validation still
runs before any import API request, including the overlap path. The file picker
is intentionally not extension-filtered, so the system chooser does not hide a
valid extensionless package. Accessible label: Upload converter package; help
states JSON and the size limit. Arbitrary JSON and forbidden identifying fields
remain rejected. Malformed JSON gets a clear message without echoing its contents.
No schema relaxation, automatic overwrite or automatic coverage confirmation.

Current navigation remains Data & imports -> Complete package -> Choose File.
Converted history backup is a download, not the upload control. The incoming file
is the Converter package, not the original source CSV/XLSX reports.

## Verification

- 1,157 functional/source tests passed, including ten new file-reader cases.
- Frontend typecheck and normal Vite production build passed.
- Fifteen isolated browser checks passed, with synthetic imports only. Loaded,
  fully expanded provenance/coverage, billing notes, all diagnostic/summary tables,
  calculations, empty state, malformed JSON, wrong envelope, filename without
  .json, busy upload, overlap review and server failure are covered.
- At 1440, 390 and 320px, 538 sampled enabled/visible text/field elements per
  width have no contrast failures below 4.5:1 in the expanded Data views. Page
  overflow checks pass. This computed flat-surface check supports, not replaces,
  visual review; it is not a full assistive-technology or real-device certificate.
- Screens use only the existing synthetic fixture and synthetic billing cases.
  No owner exports were submitted to the test server. All nonlocal browser
  requests are blocked. Only in-memory synthetic upload endpoints accept writes.
- Existing lazy-PDF graph remains intact, with no PDF modules on initial load;
  the exact artwork JPEG remains unchanged.

Commands:

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts verification/profit-first-planning-input.test.mjs verification/lazy-pdf-export.test.mjs
node node_modules/typescript/bin/tsc -p artifacts/comp-dashboard/tsconfig.json --noEmit
node verification/data-import-readability.mjs
```

The browser harness uses the already-installed local Chromium and an immutable
previous CSS baseline under /tmp; it is a local synthetic verification tool,
not a new publisher dependency. Original source/import fixtures and raw user
data remain outside the new tests.

## Guarded Publication

Apply only the reviewed delta on the verified publisher HEAD as a normal child
commit. Preserve all existing mobile readiness/PDF commits, configuration, memory
files and stored data. No migration/seed or database operation is required.
The theme scope guard registers only the explicit new Data follow-up paths;
existing hash guards for accepted mobile files are unchanged.

Run 1,157 tests, existing type/build contracts and combined theme/mobile checks.
Keep development database copying OFF. Publish once only after independent
rendered/code review. Verify served JS/CSS against the reviewed public-input
build and unchanged JPEG, API/mobile readiness and read-only Data readability.
Do not submit an owner's report to production as a smoke test. The owner controls
their actual import and any explicit overlap/coverage decisions.

Public-input candidate entry: index-BPlrhiWR.js, 2,054,561 bytes, SHA-256
e7f2f4efb4be8cf254c6e07a8279783075c17b6c909ddbc9d2d577f236e5269b.
Candidate CSS: index-D1mTuAZA.css, 287,142 bytes, SHA-256
9b92cc7d8528a0fb8ad92bfa5f6f8e2b7ee3fbd8778893d088844fecb1fe5a18.

## Separate Converter Follow-up

The native save dialog previously only suggested a .json name; it did not enforce
the content type. A separate prepared source fix constrains JSON, shows the
extension and appends .json to dated names if needed. It preserves the parser,
icon and data, refuses an unexpected normalized-path overwrite, and is not part
of this web patch. No running owner Converter is restarted/replaced by these
tests; native installation requires a safe closed-app checkpoint.
