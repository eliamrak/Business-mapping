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
