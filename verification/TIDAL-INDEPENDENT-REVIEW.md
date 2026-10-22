# Independent Tidal Source Review

Reviewed branch `codex/tidal-owned-theme` against baseline
`5cb154e2a9db6d142c83b98f179050316ef57fa7`. The implementation is uncommitted and
the main task was working concurrently. Findings below describe the inspected
source hashes, not a future revision. This reviewer wrote only this report and
`verification/tidal-theme.test.mjs`.

## Findings

No open code finding remains in the final inspected source snapshot. Both earlier
findings were fixed by the main task and pass their unchanged behavioral contracts.
The final pure code gate passes; rendered fidelity and performance acceptance are
separate and remain with the main task.

## Resolved During Review

**P2: Reduced-motion overrides escaped the owned surface (fixed by the main task).**
The original global `*,*::before,*::after` selectors applied through the eagerly
imported workspace even when Tidal was unmounted. Final CSS scopes every motion
selector to `.pw-app[data-material="tidal"]`, its descendants and pseudo-elements.
The source test now requires that owned root at the beginning of every selector,
rather than merely finding the attribute somewhere in the selector. It also
verifies the restored mobile crop (`64% top`, `auto 1100px`) and reduced-motion
artwork override (`transform:none!important`, `will-change:auto`). All pass.

**P3: Preference changes could orphan an outstanding animation frame (fixed by the main task).**
   `artifacts/comp-dashboard/src/components/practice/tidal-material.tsx:16` clears
   `frame` whenever `paint()` runs. The preference-change listener calls `paint()`
   directly at line 25 while a scroll frame can still be queued. Cleanup at line 33
   then sees zero and cannot cancel that frame. Reproduction: mount, queue scroll,
   change reduced-motion preference, unmount, flush the frame queue. One callback
   remains and mutates the detached artwork once. It can also allow two outstanding
   frames if another scroll occurs before the first callback. Cancel any pending
   frame before directly painting, or distinguish scheduled paint from immediate
   paint so the handle remains trackable. The initial regression test failed;
   this was a bounded cleanup defect, with no demonstrated business-data impact.
   During review the main task added cancellation/reset at lines 24-25 before
   directly painting. The same regression test now passes on the final snapshot.

No P0/P1 finding was identified in this scoped source review. This reviewer made
no component, CSS, artwork or harness edits outside the two authorized review files.

## Verification Result

Run from this checkout:

```sh
node --test verification/tidal-theme.test.mjs
```

Latest result: **21 tests, 21 passed, 0 failed, 0 skipped; exit status 0.** This is
the original 20-test gate plus one independent JPEG-reference/metadata check.
Earlier runs reproduced both issues (18/20), then verified the cleanup fix (19/20).
No test is marked expected-failure or relaxed to hide a source defect. The Node VM executes the actual hook bodies after in-memory
TypeScript erasure with mocked React hooks, DOM, media query and animation-frame
interfaces. PostCSS parses CSS without transforming files. No browser, application
build, server, production endpoint, dependency installation or publication was run.

Passing evidence:

- All 22 dark defaults match an independent literal original-hex contract.
- Replacing each `var(--pw-tone-*)` with the parsed dark default reproduces the Git
  baseline byte-for-byte for all ten named stylesheets: `practice.css`, `hub.css`,
  `practice-workspace.css`, `practice-approved.css`, `historical-period-values.css`,
  `metric-comparison.css`, `overview-historical-summary.css`, `percentage-kpi.css`,
  `profit-first-planning.css`, and `section-widget-grid.css`. Three have no applicable
  substitutions; their unchanged bytes are still checked. The test never imports
  the migrator's mappings or executes its `--apply` path.
- Workspace TSX is byte-exact to baseline after allowing only the single material
  import, outer `data-material="tidal"`, and declared `TidalMaterial` child with
  the mode/section/visible-tool key. Business logic is unchanged by this comparison.
- Retained app PNG hashes strictly to the immutable selected-artwork constant
  `72e88725981c904549ec0ba12bedee9ab3684e55ec2aef8c70aaf5049554082b`.
  The earlier local review also verified the selected preview and generated source
  image against that same value. Their provenance is recorded in the receipt;
  the portable suite no longer reads those external directories.
- The material CSS references exactly `../../assets/practice-tidal-art.jpg` for its
  artwork background, resolving relative to the CSS source. The file is 434,287
  bytes, has JPEG start/end markers and bounded frame metadata, and is smaller
  than the retained PNG. JPEG frame and PNG header dimensions both equal 1486x1059.
  This checks reference, file identity and metadata, not pixel decoding/fidelity.
- Tracked differences and untracked files are restricted to the ten presentation
  sheets, workspace TSX, material component/CSS, tokens, artwork, explicitly
  enumerated Tidal verification support files, and exactly two pre-existing
  publisher-history memory paths described below. No schema, production API,
  dependency manifest or lockfile change was found. The main task's new synthetic
  fixture, preview server, render-acceptance script, encoding check and performance
  script, interaction harness, fidelity-board harness, and forthcoming source
  receipt are explicitly allowlisted as review support, not executed or certified
  by this review. The JPEG derivative is also explicitly allowlisted; the original
  PNG remains required and hash-checked.
- Section changes cancel previous transitions, repeated equal section keys do not
  restart them, and unmount cancels transitions and restores the prior root theme.
- Initial reduced-motion suppresses entry animation and parallax; enabling it
  dynamically cancels active transitions and resets artwork transform to `none`.
- Ordinary scroll coalesces pending frames; ordinary unmount removes listeners and
  cancels the pending frame. The separate preference-change race now passes after
  the main task's fix, including zero queued callbacks and zero detached paints.
- All reduced-motion selectors are owned-root scoped; the restored mobile artwork
  crop and static reduced-motion artwork rules are present with the expected values.

## Publisher Portability Review

The narrow portability edits were rerun locally: **21/21 passed, exit status 0**.
Only the retained app PNG is read by the immutable-hash test. It uses the same full
SHA-256 constant; there is no optional-file check, fallback hash, or skipped test.
Neither `../tidal-preview` nor `../generated_images` is required by this suite.
The ten CSS byte comparisons, independent 22-color contract, exact workspace-byte
comparison, motion tests, JPEG reference/size/dimension assertions, and production
schema/API/dependency exclusions are unchanged.

The scope allowlist now includes these exact legitimate support paths:

- `verification/tidal-interactions.mjs`
- `verification/tidal-fidelity-board.mjs`
- `verification/tidal-motion-tour.mjs`
- `verification/OCTOBER22-TIDAL-OWNED-RECEIPT.md`

`verification/tidal-token-migration.mjs` was removed from the allowlist after its
removal from this runtime branch; reintroducing it would fail the scope gate.
Its separate audit copy is not read or executed.

Exactly `.agents/memory/MEMORY.md` and
`.agents/memory/release-evidence-temp-files.md` are separately identified as
existing publisher-history differences from `5cb154e2`. This is a filename-only
exception for those two paths, not permission to edit them or evidence their
contents are preserved. The publisher's separate before/after hash guard must
preserve both. All other memory paths and all unexpected runtime paths still fail.
This local checkout does not exercise those publisher-history differences.

No JPEG exact-hash acceptance was added: rendered fidelity approval is still a
separate gate. The JPEG snapshot hash remains recorded below, and its reference,
metadata, dimensions, and exact byte count remain tested.

The suite requires the Git baseline object `5cb154e2` and the checkout's installed
TypeScript/PostCSS tooling (resolved relative to its dashboard/Vite packages).
There is no developer-machine absolute path in the test. It was not run on Replit
here; the publisher should rerun the same command on its exact source before
publication. No publisher operation or protected-memory write was performed.

## Fallback And Integration Limits

The current token sheet defines dark values on `:root` and Tidal values on both
`:root[data-practice-material="tidal"]` and `.pw-app[data-material="tidal"]`.
The local selector supplies light tokens before the mount effect runs; restoring
the previous document attribute restores portal/global inheritance on unmount.
Current static imports ensure defaults are included for legacy consumers. Several
uses have no literal fallback, and nested fallbacks such as
`var(--pw-edge, var(--pw-tone-border))` also require the token sheet. A future
standalone entrypoint or lazy import split must retain this dependency; byte-exact
reversal alone does not prove those alternate bundles include defaults.

The root attribute also intentionally changes token inheritance for portals and
any simultaneously mounted consumers outside `.pw-app`. Only single-owner mount
and restoration were verified; overlapping material instances are not exercised.
No visual contrast, screenshot fidelity, native Safari capability, stacking,
responsive layout or actual React DOM rendering claim follows from these tests.
The main task owns build/render checks. A `.pw-content` transition animates its
ancestor opacity and transform; transformed containing-block/stacking behavior for
embedded fixed-position tools remains a browser integration risk to inspect,
not a confirmed defect from this source-only review. The selector excludes direct
`[hidden]` content, and the observed workspace uses that attribute for inactive
integrated-tool content.

The main task reported JPEG encoding mean absolute channel difference 1.336/255
and PSNR 39.6 dB. Those pixel metrics and the `sips` quality-96 conversion were
not independently rerun here. They do not establish rendered equivalence; the main
task's PNG/JPEG render comparison must complete before accepting the derivative.
The performance benchmark is in progress elsewhere; no speed or rendering-quality
conclusion is made by this pure source gate.

## Source Snapshot SHA-256

```text
tidal-material.tsx     b17218baa26ac1cad2d843dc908d1b8bce1a1f61ef727ebbe12e65d2e811b2a7
tidal-material.css     e1d93d11262c3e1c09053f82604506c59cd111eb7cb8365246e8ecc3db92075b
practice-tokens.css    fdbff4c16d59fd07023c0e7993bc5904a036b220ad416456338afeedb20e533b
practice-workspace.tsx cf6addd941e9ae330e69542d0fdd94c6d61166343cb8c893344212f17b5ac7da
practice-tidal-art.jpg 3b479d3bb3fff6da660eb17b6dc4f54f84ba5f138f5fb768b9343e0de30a95de
```

No source-code blocker remains in this scoped review. Remaining work belongs to
the main task: rendered JPEG fidelity comparison and build/render/performance
acceptance. The mobile healthcheck
preview remains separate, unchanged by this review, and unpublished.
