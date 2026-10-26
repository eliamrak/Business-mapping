# Correct the compounded Practice glass layer

Base: `94b93c86fb47b5943e7e9800b9bfa92ffe7215d7`. CSS-only runtime correction; no records, calculations, imports, native wrapper, or dependencies changed.

The previous implementation's 50% cards sat over a 75% page backing: effective coverage was 87.5% before blur. This correction removes both the page fill and its extra backdrop blur. The card is now the single 50% glass layer, with transparent nested cards.

## Readability tradeoff

Keeping the existing dark ink over the darkest artwork requires local protection. Controls, disclosure labels, dense prose, tables and chart plots have local light reading surfaces. Standalone staff rows are protected too. Headings and other ink retain a restrained light halo. These do not cover the whole card or page; artwork is visibly exposed between and through cards. Colors, typography, dimensions, controls and metrics are unchanged. Reduced-transparency mode still restores solid surfaces and removes the halo. This is not a claim that every text pixel over arbitrary artwork has a certified contrast ratio.

## Verification

- 1,271 domain/dashboard tests passed; dashboard TypeScript passed.
- Final production Vite build passed (existing sourcemap/chunk-size notices).
- Synthetic loopback browser only; no shared browser, real records, or API writes.
- Browser harness asserts transparent page/no page blur, 50% top-level card fills, transparent nested fills, unchanged element opacity, local staff reading surface, and solid reduced-transparency fallback.
- Existing keyboard, viewport, filter, export, disclosure, overflow and interaction checks retained. Removed the old invalid assumption that a 75% backing still exists from contrast verification; body text protection is reported honestly as local reading surfaces/halo, with interactive contrast measured separately.
- Actual before/after pixels reviewed, not just CSS alpha. Comparison uses the previous 94b93c8 captures in `/tmp/practice-opacity50-final/` and final candidate captures in `/tmp/practice-single-glass-final-reviewed/`. The latter contains the browser report and 31 desktop/mobile captures. Paths are consumer-local, not assumed shared.

No deployment performed. Publisher should apply this focused commit to the current composed web release and have the Mac worker verify the live URL in Practice.app after publishing. No native rebuild is needed for this web-CSS correction.

Final pixel comparison (same dimensions, percent of pixels changing by >10/255 in any RGB channel): overview-1280.png 65.83%, team-390.png 68.57%, growth-320.png 51.26%. Mean absolute channel differences: 56.53, 60.63, 53.47. These quantify visible change, not contrast certification.
Final browser run: 31 captures, 144 card samples, zero browser errors/writes/viewport-overflow failures. Interactive text minimum ratios: Overview 6.477:1, Settings 6.164:1. Final pixels inspected: desktop Overview and mobile Team, plus progression/chart preview.
