# Visible Reader Compatibility Gate

Reviewed follow-up reader: `67500ad8e1bb05e3b13b8b194473f42fbbc64104`, tree `4d0cc7faba49433fc7c519eff3d916e73af31ac5`, branch `codex/legacy-code-paired-repair`.

Parent reports the0f6 reader published at19:36 with asset `index-C_clH6Yf.js`. Direct top-level capability navigation was blocked by the browser tool (`ERR_BLOCKED_BY_CLIENT`), not an observed application403. Do not inspect the chrome-error page or bypass restrictions. Do not upload a test package or make a hidden POST.

## Supported Visible Path

Publish this small UI follow-up through the normal reviewed release workflow. In the existing authorized app session: Overview → **Open Imports** → expand **Reader status**. Normal application rendering uses the existing authenticated client to GET `/api/practice-imports/capabilities` with `cache:no-store`; there are no uploads, token reads, source edits, POSTs or business writes.

Required state: **Compatible**. Expanded details must show protocol `legacy-codes-late-cancellation-v1`, package version1, late cancellation Supported, code0 Unconfigured, and0 distinct from00000. The UI validates the entire capability response, including all six code definitions. Missing/old/HTML/wrong-duration/contradictory-zero responses cannot certify compatibility. Loading is Checking; invalid data is Unverified; HTTP/network errors are Unavailable. The refresh icon triggers another normal GET and clears stale success while checking.

Exact production source/build provenance plus this visible response, the prior full-pipeline tests and preservation PASS are the compatibility gate. The endpoint/API, calculations, database files, converter parser and native bundle are bitwise unchanged from reviewed0f6; only the status component, its validator, Imports mount and tests are added. No historical-feature bundling, migrations, dependencies or business-data changes are introduced.

## Verification

- 679 domain/dashboard tests passed; final validator regression, dashboard typecheck and final production build pass. Existing nonfatal build warnings remain.
- Mounted synthetic preview passed Checking/Compatible/Unverified/Unavailable/retry-Compatible, desktop1280 and mobile390, no horizontal overflow, zero writes and no browser errors. Evidence `/var/folders/v1/nrrw04y90g3b9s27scm3_f1r0000gn/T/reader-status-render-YwaWW0/`.
- Independent review passed exact67500ad/tree, validator tests and typecheck, and independently exercised8 mounted desktop/mobile scenarios. Its initial contradictory-zero finding was corrected and retested. Evidence `/var/folders/v1/nrrw04y90g3b9s27scm3_f1r0000gn/T/reader-status-independent-eMr7iq/metrics.json`.
- Local screenshots used an isolated synthetic loopback component preview, not production or an authenticated user browser. They do not establish live compatibility or preservation.

The prepared converter remains parser SHA256 `c664568cfda764cd4de84aae28b84080e3ff22c7e9aedcab00635e85c3ecfa23`, native SHA256 `161bae575af70f0f7f8e29f30696ac5a97554df9e4a2966764fd4598daa32b10`, at `/var/folders/v1/nrrw04y90g3b9s27scm3_f1r0000gn/T/practice-paired-release-p8ONEm/Practice Converter.app`.

Owner confirmed converter closed at19:34. Recheck process closure when installation starts; do not ask again unless reopened. Do not install until parent confirms production Compatible and preservation PASS. Preserve a timestamped old-app backup and all private mappings/data; verify final signed hashes, synthetic installed-parser export and exact installed launch path. No new real import is part of this task.
