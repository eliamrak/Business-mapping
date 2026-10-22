# Tidal Owned Source — Release Candidate

Base `5cb154e2a9db6d142c83b98f179050316ef57fa7`.
Branch `codex/tidal-owned-theme`; no production publication by this task.
User accepted the dynamic preview and authorized use in Practice on October 22.
No new logo or icon is included; selection is handled separately.

## Runtime Scope And Preservation

Existing presentation declarations reference 22 owned CSS tokens. Their dark
defaults reverse to byte-exact original CSS for all ten reviewed sheets. New
Tidal values apply to the material root, including inherited portal colors.
The token sheet is a normal source import, not a compiled-CSS replacement stage.
The one-time migration script is not part of this candidate/build pipeline.

Workspace TSX differs only by one presentation import, a material attribute and
the material child. Actual calculations, report coverage, retention, observed
conversion, quarterly Budget, saved data, widget state and existing layout are
unchanged. No dependency, schema, API, .replit, artifact contract or icon change.
No synthetic fixture is imported by production code. Verification uses isolated
synthetic data; no real records or mappings were read or written for benchmarks.

TidalMaterial owns one scroll-triggered frame, bounded background translation,
240ms entry transitions, preference-change cancellation and unmount cleanup.
There is no continuous idle loop or external effects service. Reduced-motion
rules are scoped to the owned surface, with static/no-blur fallback behavior.

Exact selected target: Library `libfile_b3e8f8ccd5508191b0b940c01799c59f`,
SHA-256 `7232868869977016749d0caa822708b21cf7912355099559ca7d1fc8e3a95702`.
Original artwork PNG remains immutable:
`72e88725981c904549ec0ba12bedee9ab3684e55ec2aef8c70aaf5049554082b`.
The shipped 1486x1059 JPEG is 434,287 bytes versus 2,048,924 PNG bytes (78.8%
smaller). Same composition/dimensions; independently viewed normal-scale and
focused comparisons accepted gold highlights, tint and fine detail. Pixel mean
absolute channel difference is 1.336/255; PSNR 39.60dB is supporting evidence,
not a substitute for visual review. Normal Vite output emits the hashed JPEG;
the unreferenced archival PNG is not delivered as another runtime image.

## Completed Verification

- Canonical unchanged functional suite: 1,143/1,143 passed.
- Independent source/hooks/token contract: 21/21 passed, no source blocker.
- Browser viewport/motion checks: 16/16 passed, 1440/390/320 widths.
- Browser interactions: eight checks/measurements pass, including real keyboard
  widget reorder/resize/review/save, allocation recalculation, chart hover,
  stable metrics and mid-transition reduced-motion cancellation.
- Frontend TypeScript and normal Vite production build passed. Existing Vite
  sourcemap/chunk-size warnings remain; no new build failure.
- Independent combined full/focused/responsive visual review: final result passed.
  Current two-column layout and unknown values are intentional; no P0-P2 issue.
  P3 frost/elevation and cap-easing polish is optional, not rollout gating.

Canonical commands from root:

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts verification/profit-first-planning-input.test.mjs
node --test verification/tidal-theme.test.mjs
node node_modules/typescript/bin/tsc -p artifacts/comp-dashboard/tsconfig.json --noEmit
```

Frontend build from `artifacts/comp-dashboard`:
`PORT=23894 BASE_PATH=/ NODE_ENV=production node node_modules/vite/bin/vite.js build`.
Production publisher must retain its verified artifact build/run routing; this
command supplies required build variables, not a replacement production server.

## Measured Performance — Not Real Phone Or Deployment Results

One paired final harness trial, same deterministic data, gzip text and explicit
harness cache. Cold is a new browser context; warm is a second navigation in the
same context. Values vary between trials; do not claim a statistically established
speedup from these single pairs. Both runs had zero runtime errors.

| Condition | Unchanged base | Tidal |
| --- | ---: | ---: |
| Desktop cold usable | 508ms | 468ms |
| Desktop warm usable | 391ms | 495ms |
| Desktop scroll p95 / 90 frames | 17.8ms | 16.9ms |
| Simulated mobile cold usable | 7.151s | 7.413s |
| Simulated mobile cold artwork complete | n/a | 8.173s |
| Simulated mobile warm usable | 2.144s | 2.278s |
| Simulated mobile scroll p95 / 90 frames | 18.5ms | 18.4ms |
| Simulated mobile input update | 784ms | 807ms |

Mobile simulation: Chromium 390px, touch mode, 4x CPU, 150ms latency,
200,000 download bytes/s. No scroll frames exceeded 50ms. Tidal tab responses:
desktop 132-350ms; simulated mobile 401-1281ms. Cold transfer 1,471,471 bytes
versus 1,031,018 base; warm 114,663 both. Input measurement includes Playwright
fill/blur and the next frame; it is not an INP field statistic. Cold simulated
load and throttled input cost remain disclosed limitations, largely shared with
the base. There is no real iPhone/GPU/thermal/production-cache guarantee.

`verification/tidal-performance.mjs` preserves the protocol/results shape.
It uses only a newly launched synthetic browser; never an owner's browser profile.

## Publication And Post-Deployment Gates

1. Root coordinator rechecks current publisher HEAD/tree/clean status and builds
   a normal descendant from the reviewed delta. Do not reset publisher history,
   overwrite memory/config files or run migration/seed tasks.
2. Preserve .replit, every artifact TOML and the two known publisher memory files
   byte-for-byte. Preserve current read-only workspace/import revision/source
   fingerprints. Copy-development-database must remain OFF.
3. Run theme tests before adding the separately reviewed mobile-healthcheck
   delta (which intentionally lies outside this theme's source allowlist).
4. If included, apply mobile readiness commit
   `e30725e54b0e6e324e07966683561371e18858db` separately against its exact preimage;
   run its 32 exact-source tests. No artifact is removed or reconfigured.
5. Re-run canonical tests, frontend types/build and existing API build/type gates
   required by publisher. Normal publication once; record terminal artifact
   results, not merely a transient Live banner.
6. Public read-only: health API, JS/CSS/JPEG refs/bytes/hashes; reconcile only
   verified public bootstrap config differences. If health patch is included,
   `/comp-mobile/healthcheck` must return 200 ready true and both manifests/launch
   assets must remain reachable. Healthy web alone is not whole-platform success.
7. Authorized owner UI read-only: same known scope/period, Overview rings/markers,
   paired periods, Sessions 90-day chart, Money/Budget/Goals and layout controls.
   Verify six snapshots/config/revision/source fingerprints unchanged. Do not
   save, fill financial inputs, approve mappings or seed production fixtures.
8. Measure post-deployment cold and warm navigation, public transfer sizes,
   scrolling frame consistency and reversible section/period changes. Report
   actual cache conditions; if cold/authenticated isolation is unavailable, say
   so instead of calling a warm navigation cold. Collect aggregate timing only,
   not private rows. Compare to the pre-publication read-only baseline where
   available. Benchmark input edits only in the isolated fixture, never records.
9. If a material responsiveness regression is observed, investigate before broad
   completion claims. Preserve artwork/material depth; use asset delivery,
   scheduling or scoped reuse fixes rather than deleting the design.

## Remaining Native Checks — No Permission Grants

Safari 26.6.2 driver starts outside sandbox, but standard session creation
explicitly refuses because Allow remote automation is disabled. It was not
enabled; no Safari session was created and the driver was stopped. VoiceOver,
macOS WKWebView and a physical iPhone remain unverified.

Small manual phone check after publication: open the existing app in Safari;
scroll Overview down/back for readable frost/no exposed edges; tap Sessions then
Money/Budget and back for responsive controls/retained scope; check chart tap and
phone rotation/text enlargement. With Reduce Motion already enabled (or manually
chosen by the owner), confirm no parallax/entry movement. No business edits needed.
On the Mac, use an existing Safari/Practice window for keyboard focus, meter/help
reading and VoiceOver if desired; do not grant Accessibility or enable automation
to turn an unverified result into a pass.
