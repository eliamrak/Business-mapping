# Practice card background alpha — 2026-10-26

CSS-only runtime change on the existing `codex/money-month-picker-20261025` author branch, based on remote-verified `ed2b94d3211acf848f2596806f302038d58a7111`. No business logic, imports, records, credentials, or deployment changed. The separate Knowledge and contrast worktrees remain untouched.

Card backgrounds now use 50% alpha. Text, charts and controls do not receive container opacity. Legacy gradient cards and Money/import cards use the same surface rule. Nested card fills are transparent so they share one card layer. Layout, typography, semantic colors, controls and chart styles are unchanged. Existing page-level readability backing remains 75% in Tidal; this is intentionally separate from the 50% card fill. Non-blur fallback stays solid, as do reduced-transparency/forced-color fallbacks.

## Validation

- Full domain/dashboard regression: 1,271 passed.
- Dashboard TypeScript and production Vite build passed. Existing sourcemap/chunk-size notices remain.
- Isolated cloud Chromium with synthetic local API responses only: 31 captures across Overview, Team, Growth, Sessions, Money, Goals, Settings and imports; 1280/390/320 widths, long content, nested cards, 200% Growth zoom, keyboard interactions, reduced transparency.
- 144 visible card samples: expected 50% background alpha; 36 nested samples transparent; sampled card and content opacity remains 1. No legacy background gradients in sampled cards.
- Sampled conservative text contrast minimum 4.828:1, using the unchanged page backing over black. Interactive samples: Overview minimum 6.477:1, Settings 5.303:1. These are sampled checks, not a claim of exhaustive contrast certification for every legacy semantic color.
- No page overflow in tested widths, no browser errors, no API writes. Reduced-transparency card is solid with no blur.
- Actual pixels inspected: Overview desktop, Team mobile, Growth narrow mobile, Money mobile. Text/controls remain legible; no new layout defect observed.

Consumer-local captures and report: `/tmp/practice-opacity50-final/` (31 PNGs and `report.json`). These paths are not assumed shared with the publisher. Harness: `verification/practice-surface-render.mjs`.

## Release boundary

GitHub author branch and `main` were checked before editing; main remains `7f54613a9ace519cb587b5b72af739cd7a5087ef`, not the composed publisher source. The previously parent-reported publisher checkpoints `ff94ff30`/`5ff8af7` are not exposed by the available GitHub branch refs. Do not replace the publisher checkout with this author tree: integrate the focused CSS/harness commit onto the latest composed publisher source and verify there before publishing. No shared browser or Mac dependency; all authoring and QA occurred in the cloud.
