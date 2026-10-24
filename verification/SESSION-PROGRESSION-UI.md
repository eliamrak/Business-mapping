# Observed session progression UI — test candidate

Domain base: `db34cd60b1c7d429f504b2f04e83c2f714fdc45c`.

## Scope
- Add a wide Sessions widget immediately after Retention/Attrition, using the existing shared cohort period, selected clinician identity guard, historical eligible sources, classification evidence and same-day exceptions.
- Preserve all existing retention, ending, coverage and import rules. No backend/schema/authentication/data edits.
- Five reference-layout columns, line chart of actual percentage reached, constant cohort denominator, first-row change unknown, percentage-point units, bounded horizontal table scrolling.
- Separate observed mean/median sessions and elapsed first-to-last calendar days for existing-rule apparent endings versus ongoing/not classifiable as ended. Explicit coverage-limited counts and unfinished/left-history limits.
- CSV contains only aggregate counts and descriptions, not client IDs or source rows. Quoted escaping and text-cell formula protection are covered by tests.

## Local verification
- `node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts`: 1,257 passed; zero failed/skipped after supplying missing existing-version dependencies in a disposable local fixture. Earlier 1,255/2 run failed only for unavailable jspdf/express/papaparse and is superseded by this complete run.
- Strict targeted TS check of the component and its imported domain: passed.
- `node verification/session-progression-render.mjs --build-only`: actual component/domain fixture bundled, not browser-verified.
- `git diff --check`: passed.
- Dependency lockfiles unchanged. Full dashboard project types/production build need verification in the existing complete dependency environment; mobile package build is not claimed.

## Synthetic rendered QA
Run from the repository root, with installed Playwright and Chromium supplied explicitly when defaults do not apply:

```sh
PRACTICE_PLAYWRIGHT_PACKAGE=/path/to/playwright/package.json \
PRACTICE_FULL_CHROME=/path/to/chrome \
PRACTICE_PROGRESSION_EVIDENCE=/tmp/practice-progression-render \
node verification/session-progression-render.mjs
```

Optional `--build-only` writes the built HTML/JS/CSS without starting a server/browser. Optional `--serve-only` serves the owned synthetic fixture for a separate authorized cloud browser. `PORT` defaults to 4173. The normal run serves and drives the actual TSX plus real domain logic, records cases/captures and console errors, checks GET-only fixture requests, then stops its owned browser/server. It does not load accounts or production endpoints.

Visual/interaction QA remains blocked locally; see `design-qa.md`. This is a handoff for testing, not a release-ready claim. Compare actual saved-cloud captures with the inspected owner screenshot before publication.

## Saved-cloud integrated verification (2026-10-24)

Supersedes the earlier local renderer blocker above. Exact candidate fetched: `00cbf94336c2b8ed57a7a341b37963b4d1a722e5`, tree `337e55d1468fd23b6b3affb7107a5fc82596c3b4`, then tested with the focused fixes in this commit.

- Final `pnpm test`: **1,258 passed**, zero failed/skipped, after all code and test changes.
- Dashboard project typecheck passed; `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/comp-dashboard build` passed (existing large-chunk warning).
- Real-component synthetic Chromium harness: **16 checks passed**, zero page/console errors; GET-only local fixture assets, no business/API requests. See `session-progression-browser-report.json`.
- Checked 1280px desktop, 768px, 390px and 320px; table scroll containment, both themes, empty/ambiguous/unresolved cases, date and clinician changes, Overall and Compare props, repeated milestones, tooltip, aggregate download and keyboard disclosure.
- Fixed actual failures: hidden Recharts tooltip coordinates caused overflow after resizing; workspace CSS reset removed the table scroll minimum. Also corrected Overall's sentinel date label in UI and export; restored heading size against global CSS. Harness resolves installed Vite/esbuild under strict pnpm without adding dependencies.
- Independent code review found no remaining blockers. Mobile and desktop dark screenshots were visually inspected by the verification worker, but that worker could not inspect the original reference. Parent must perform independent reference comparison.
- Local screenshots and report: `/tmp/practice-progression-render/` in the verification worker only. Library batch upload failed at hosted-app discovery (`network`) before saving files. No Library IDs or cross-worker file availability are claimed.
- Workspace-wide all-build is **not** passed: unchanged `comp-mobile` errors remain in `app/scenario/[id].tsx` lines 40, 88, 170 (TS2345/TS2322) and `hooks/useColors.ts` line 21 (TS2352). Dashboard succeeds separately.
- Full authenticated app/release acceptance is not established by this isolated component harness. No deployment performed.
