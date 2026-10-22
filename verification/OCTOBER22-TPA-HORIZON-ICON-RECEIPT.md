# Refined 5 Horizon Lens: Selected Icon Candidate

User selected refined5, not the earlier original5. Exact Library source:
libfile_dceb00a6bf108191baf83dc4635958a2, tpa-05-horizon-lens-refined.png,
1254x1254 opaque PNG, SHA-256
21890ae5ad2f156e71541fb72b145a9c044fb13f301eedaa8c27e0cb64b9edfa.
The source was downloaded with its Library metadata, inspected before work and
copied byte-for-byte into src/assets/tpa-horizon-lens-refined.original.png.
No generated replacement, tracing, redrawn lettering or artistic reinterpretation.

Base dbcc34377d528bf7e8dfef1dafb4ccb6160f5f48 includes the Data repair and
the prior PDF-loading optimization. This candidate changes only icon assets,
icon/appearance metadata and verification. No app layout, metrics, calculations,
imports, data, parser, dependencies, API, routing, secrets or permissions change.
No production or App Store/account publication was performed by this task.

## Derived Platform Assets

- Browser favicons: 16/32 PNG and 16/32/48 ICO; cache-versioned HTML references.
- Apple touch icon: opaque 180 PNG; PWA 192/256/512 PNG and opaque maskable512.
- Existing legacy/auth SVG endpoints embed the selected 180px derivative. They
  contain no scripts, vector tracing or substituted logo. App.tsx remains unchanged.
- Expo's existing 1024px icon is replaced with an opaque RGB derivative. Web
  favicon uses a 32px derivative. Android adaptive foreground is transparent with
  matching blue backplate; splash color matches. Name/slug/scheme/plugins and all
  other app configuration are unchanged. No native store submission is included.
- Native Converter ICNS includes all ten standard 16..1024 representations,
  transparent rounded exterior and uniform selected-raster scaling. Large icons
  use 82% content scale; 16/32 use 92% optical sizing to improve small lettering.
  No source art or glyph is edited.

The PWA maskable uses 90% source scaling, while Android adaptive uses 68% so the
TPA bounds stay inside their respective safe circles. Outer lens decoration and
line ends can be clipped by system masks; the white TPA and gold sun stay inside.
The production PNG/ICO/SVG/ICNS hashes and sizes are in tpa-icon-manifest.json.

Reproduction (macOS, selected source supplied locally):

```sh
xcrun swift -module-cache-path /tmp/practice-icon-module-cache verification/render-tpa-icons.swift ../tpa-icon-horizon/tpa-05-horizon-lens-refined.png ../tpa-icon-horizon/derived
iconutil -c icns ../tpa-icon-horizon/derived/HorizonLens.iconset -o ../tpa-icon-horizon/derived/converter.icns
node verification/prepare-tpa-icons.mjs
node --test verification/tpa-icons.test.mjs
node verification/tpa-icon-visual-qa.mjs
```

These are local asset-production/QA scripts, not dependencies to install or run
in the publisher. Commit the tested results, not a production image-generation step.

## Checks And Limits

- 1,167 tests passed: existing 1,157 plus ten selected-icon contracts.
- 35 theme/PDF/icon contracts passed; known accepted mobile hashes remain guarded.
- Frontend typecheck and production build passed. Existing JS, CSS and artwork
  hashes are unchanged from the live Data repair: this is not a new theme/layout.
- Six actual local Chromium boards passed (1440/390/320, light/dark). Images decode,
  no horizontal overflow. Small web/native sizes use their actual exported PNGs;
  PWA/Android circles apply at large and small preview sizes.
- Independent source/derivative and six-board review found no blocking fidelity
  issue. TPA is clearest at 24px and up; the sun is faint at 16px. The refined art
  is preserved rather than replaced with a new small-size logo.
- Native ICNS packages and decodes through iconutil into all ten standard sizes.
- No physical iPhone/Android launcher, actual Finder/Dock replacement or App Store
  validation is claimed. Installed PWA icon refresh timing depends on the browser/OS.

## Staged Converter, Not Installed

The selected ICNS is 065da2458907fe16a32fa2ca5b22600eb14d9e19411d02f442d4b70cfcfe9e18.
It is combined locally with the separately tested JSON-suffix correction in a
signed staged Converter. Complete application payload comparison finds only the
native executable and converter.icns changed (outer signature excluded).
The parser remains c664568cfda764cd4de84aae28b84080e3ff22c7e9aedcab00635e85c3ecfa23;
Info.plist and bundled runtime are preserved. The app is still running, so no
replacement/restart or owner report/mapping access was performed. A safe closed-app
checkpoint is required before recoverable installation; do not force quit it.

## Preserving Publisher Handoff

The Data release was integrated as 992d05a309afd723bc292c23372db789e7a9936c,
tree f34a3aa96a50c317b516c92e78d2d6a9ac8f94c6. Its final publication bookkeeping
descendant was not known when this receipt was written. Re-read actual clean
publisher HEAD/tree before integration; do not assume the integration SHA is HEAD.

Verify each modified icon-file preimage against base dbcc3437 and that new paths
are absent. Apply only this reviewed delta as normal descendant commits, retaining
all publisher history, memory/configuration, Data/PDF fixes and mobile readiness.
Run existing 1,157 gates plus ten icon tests, combined theme/mobile tests, and
existing artifact types/builds. Database copy stays OFF; no migration/seed.

After a single coordinated release, verify icon references/versions, every public
icon hash and manifest declaration; source JS/CSS/artwork should stay exact to
the previous Data release. Recheck API/mobile health and both manifests/launch
assets. Read-only UI inspection must show the same layout and data. Do not
perform actual report imports or store publications to test icon changes.
