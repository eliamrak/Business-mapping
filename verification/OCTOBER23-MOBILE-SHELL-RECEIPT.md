# Practice mobile-only shell repair

## Authorization and boundary

The owner approved a compact mobile header, tucked-away navigation, one clinician
selector and secondary actions behind a menu, explicitly leaving desktop as is.
Base: `72dc5fb7da9e7dce7dcb0eb57697edcb790083d7`.

The actual supplied iPhone screenshot showed desktop navigation, utility links,
page actions, view tabs and the whole roster expanded before any Overview metric.
The later `practice-approved.css` mobile rules explicitly re-expanded those groups.
This is a responsive composition defect, not missing business data or an assumed
stale PWA.

## Change

- At 760px and below, a compact brand/menu row replaces the expanded header.
- An accessible Radix modal navigation sheet retains Today, Long Term Goals,
  Sandbox, the six Practice sections, Data & imports, Settings and Reference layout.
- Existing action buttons remain intact behind a mobile disclosure. Alternate
  page views remain available through its View selector.
- Overview and Sessions use native clinician selectors, sharing the original
  contributor state. Sessions Compare remains an explicit selectable option.
- Original desktop navigation, actions and contributor buttons remain in place.
  New wrappers use `display: contents` outside the mobile breakpoint.
- The real unsaved-navigation guard is retained on actual destinations, including
  the portaled sheet. Opening or closing navigation does not discard edits.

No domain calculation, API, schema, dependency, stored setting, import, source
admission, billing approval, artwork, icon, mobile artifact or hosting changes.
No real-record writes or new native permissions.

## Evidence recorded so far

- 1,344 canonical functional/mobile tests passed (1,335 existing plus nine new).
- 251 database-free API tests passed.
- Library declarations, dashboard and API typechecks, and both production builds passed.
- Nine independent mobile source/component tests passed. The strict workspace
  contract strips only literal reviewed mobile additions and reconstructs exact
  approved base bytes. Existing calculation/command bodies cannot drift.
- Existing theme/PDF/icon contracts pass with the exact new mobile paths declared.
- All 16 desktop comparisons (Overview, Sessions, Team, Money, Growth, Goals,
  Budget, Data at 1024 and 1440) have zero changed pixels.
- Actual synthetic mobile Overview, Sessions, Budget and open navigation pixels
  inspected. Header is approximately 61px; first Overview KPI starts at 249px.
- Library phone previews: `libfile_d8eea95d123c8191bb2cf4765d55c84b` (390px),
  `libfile_5431b76bd31c819188fe426b41198f75` (320px).

All 55 final browser interaction checks passed with zero browser errors: modal
focus trapping, Escape/focus return, destinations and selected state, workspaces,
utilities, reference link, action disclosure, clinician/Compare selection and
synthetic 200% text enlargement. The 760 to 761px check confirms drawer closure
and removal of modal scroll/pointer locks. Forty before and forty after PNGs
are retained. Initial harness-only Settings failure was the missing synthetic
Clerk identity boundary, not a production-auth change. The initial focus assertion
ran before Radix deferred close autofocus; the bounded focus check passes.
The final interaction receipt supersedes initial `after/checks.json` failures:
`/tmp/practice-mobile-shell-acceptance/interaction-recheck/checks.json`.

Independent verdict: accepted, no blocking defect, with reviewed source hashes in
`MOBILE-SHELL-INDEPENDENT-REVIEW.md`. No app source changed after that review.

Local web build (public-production configuration can change JS literals):

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `index-FBtq5fvo.js` | 2097891 | `aecdeb5d34dbce9fe7ba1f49c3d476de3d917f78b560d9ba474e44b0b034350c` |
| `index-DRAqG8Dh.css` | 293697 | `618d50267c9b11235cb9ec95418a3fda85de88fc8deb7ab4aed7f7f3514dfeab` |

Tidal JPEG remains `3b479d3bb3fff6da660eb17b6dc4f54f84ba5f138f5fb768b9343e0de30a95de`;
icons and deferred PDF loading retain their existing exact contracts. Standard
Vite source-map/chunk-size warnings did not fail the build.

## Reproduction and limits

`verification/mobile-shell-acceptance.mjs` runs the real workspace with the existing
synthetic fixture plus six synthetic clinicians. It rejects writes and external
requests. Capture inputs freeze the clock, timezone, locale and reduced motion.
Before/after PNGs and checks are retained in `/tmp/practice-mobile-shell-acceptance`.

This is isolated Chromium viewport/touch emulation, not physical iPhone Safari,
VoiceOver or native WKWebView acceptance. No permission was granted or bypassed.
Text enlargement doubles computed text/control sizes; it is not native browser
zoom. Dirty-form cancellation was not browser-tested; the real unsaved guard and
destination markers were independently unit-tested. Desktop screenshots use the
same frozen synthetic context before and after, at desktop widths, not a native
desktop-app certification. Existing small dense metric labels were not redesigned.
Publication and authenticated owner acceptance remain separate from local tests.
