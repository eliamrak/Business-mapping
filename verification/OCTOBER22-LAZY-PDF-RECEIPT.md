# Deferred PDF Runtime: Reviewed Follow-up

Base: f55d10ff4513f6e99f4258e5cfcc2ae65b99eb40 (owned Tidal theme).
Runtime scope: only components/tabs/export-tab.tsx. No business calculations,
API/schema, dependency/lockfile, theme, icon, mobile route or hosting config change.

jsPDF and autotable now load inside each existing export action, following the
existing management-report dynamic-import pattern. A type-only import preserves
document annotations. All three report construction bodies are byte-identical
to base. While loading, all PDF buttons disable; finally restores availability.
Errors appear in a role=alert message advising refresh before retry, because a
failed ESM chunk fetch can require a new document. No rejected-promise cache is
introduced. No automatic app reload or business-state mutation is performed.

## Verified Results

- Canonical functional suite: 1,143/1,143 passed.
- New source contracts: 4/4 passed.
- Synthetic browser checks: 19/19 passed, including all three reports, optional
  scenario selection, 390/320 widths, deferred network requests, held-load busy
  state, failed-chunk alert/unlock and refresh recovery.
- Four generated PDF comparisons (three reports plus selected-scenario summary)
  match baseline byte-for-byte after normalizing random document IDs only, using
  the same fixed clock. Tests use synthetic clinicians, budgets and staff only.
- Desktop baseline/candidate PNGs match exactly, SHA-256
  7df1464fb420163cb95d6ba1f42a2f45b499a350b563276649bfabebf652584d.
- Frontend TypeScript and Vite production build passed. Existing sourcemap and
  large-chunk warnings remain. The eager/dynamic PDF conflict is eliminated.
- Independent code and rendered review passed with no blocking finding.
- Tidal motion/token suite: 21/21 passed after registering the exact seven
  separately reviewed PDF follow-up paths in its source allowlist. No broad
  directory exemption, theme assertion or numeric check was removed. The old
  theme-only allowlist correctly rejected the new follow-up before registration.

Local commands:

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts verification/profit-first-planning-input.test.mjs verification/lazy-pdf-export.test.mjs
node node_modules/typescript/bin/tsc -p artifacts/comp-dashboard/tsconfig.json --noEmit
node verification/lazy-pdf-build.mjs
node verification/lazy-pdf-export-acceptance.mjs
```

The build measurement uses the previously verified public-input baseline under
/tmp/practice-tidal-public-repro-fKvp4n; the browser harness uses the existing
isolated local Playwright installation. They are local verification scripts, not
new production dependencies or portable publisher commands. The canonical tests,
source contracts and normal artifact build remain the publisher gates.

## Actual Production Build Byte Reduction

Same public production Clerk key/proxy as the previously byte-matched live build:

| Initial HTML JavaScript graph | Before | After |
| --- | ---: | ---: |
| Raw bytes | 2,477,372 | 2,054,220 |
| Local gzip representation | 711,138 | 573,406 |

Initial decoded JS saves 423,152 bytes (17.08%). Gzip representation saves
137,732 bytes (19.37%), but managed hosting still serves uncompressed text on the
measured connection; this does not claim compression was enabled. Startup roots
are the actual HTML scripts and static imports. Rollup also emits a conditional
goal-search worker as an entry: it is not part of initial navigation and is not
counted on either side. An earlier conservative sum included that worker on the
candidate side and is superseded by this HTML-root measurement.

No jsPDF/autotable module appears in the initial static graph. The PDF chunks are
deferred, not deleted. First export pays their loading cost; later exports reuse
them. This is measured byte reduction, not a measured whole-app readiness gain.
It does not attribute the earlier roughly 30-second cloud authenticated wait.

Public-config candidate output: index-B7gAhgjg.js, SHA-256
6fb33e687a48fa7008974d0ac2e07fdd0fd91890e592ece891579b37bae93c3d.
The exact reviewed CSS hash remains
a2c3598288b289d2bfe6acbc1a00acb13a73ba52a8623430d20facc6d1fcabd6;
JPEG remains
3b479d3bb3fff6da660eb17b6dc4f54f84ba5f138f5fb768b9343e0de30a95de.
No artwork-quality or material-effect reduction.

## Preserving Publisher Handoff

Last reported publisher HEAD: 029487aff26bfe0d4652c39d4765d87208a083b4;
tree d50c1d7a936221791d331182ad7ba10a91d2ed9d. Recheck before applying.
Preserve the mobile readiness patch, all publisher commits, .replit, artifact
TOMLs, memory files and records. Only apply this reviewed runtime delta plus
its new verification files; do not replace history/tree with the local theme base.

Fetch the reviewed branch through existing github remote, verify the runtime
preimage equals the base blob, and git apply --check before applying. The new
verification paths must be absent, or stop and reconcile. Create a normal child
commit of the verified publisher HEAD, run the combined canonical/source tests
(expected 1,147), existing artifact type/build gates, and retain DB-copy OFF.
No migration/seed or record edit is required or permitted for this release.

After a single coordinated publication, reconcile actual served entry/static
graph and deferred PDF chunks; source-identical public configuration can change
filenames but not be assumed without verification. Recheck API/mobile readiness,
unchanged CSS/JPEG and scoped owner read-only overview/records. PDF output and
failure tests must remain synthetic/local: do not export sensitive owner records
to prove this patch. The independent public cache/compression investigation is
separate; no speculative hosting change is included.
