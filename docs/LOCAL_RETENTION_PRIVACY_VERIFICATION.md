# Local Retention CSV Privacy Verification

Date: 2026-10-13
Branch: `local-retention-csv-workspace`

## Scope

This verifies the local-only retention CSV workspace with synthetic data only.
No real client data, production credentials, or business records were used.

## Real Browser Component Harness Evidence

The real browser harness is:

```sh
# One-time isolated dependency install outside the repo.
mkdir -p /tmp/local-retention-browser-harness
cd /tmp/local-retention-browser-harness
npm init -y
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright --no-save

# From the repository root.
PLAYWRIGHT_PACKAGE_DIR=/tmp/local-retention-browser-harness \
  node scripts/local-retention-browser-privacy.mjs
```

The harness starts a local Vite server for
`artifacts/comp-dashboard/test-harness/local-retention-browser-harness.html`,
which renders the actual React `LocalRetentionWorkspace` component. It launches
Playwright against a local browser executable, exercises real browser file input
selection and blob download behavior, and captures browser network requests
during the package import and CSV import/export/restore operations.

Latest run:

```json
{
  "status": "passed",
  "url": "http://127.0.0.1:4397/test-harness/local-retention-browser-harness.html",
  "browserExecutablePath": "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  "packageFlow": {
    "operationRequests": [],
    "browserSinkEvents": [],
    "stableSummary": "Coverage2026-10-01 to 2026-10-20Attendance rows4Billed rows4"
  },
  "csvFlow": {
    "operationRequests": [],
    "browserSinkEvents": [],
    "stableSummary": "Coverage2026-10-01 to 2026-10-15Attendance rows3Billed rows2"
  },
  "downloadedBackupBytes": 1993
}
```

This is isolated component-harness evidence. It does not boot the full
authenticated dashboard shell; auth is bypassed by rendering the local-only
component directly. That is intentional for this privacy check because the
component does not require auth and no business records should be touched.

Assertions:

- The golden local import package is imported through the actual browser package
  file input.
- Synthetic attendance and billing CSVs are imported through actual browser file
  inputs after a page reload.
- Backup export is captured through actual browser download handling.
- Backup restore is exercised through the actual backup file input.
- Invalid duplicate and overlapping backup restores throw in the browser flow
  before replacing the existing component state.
- Browser network requests captured after page load and during the operations
  are exactly `[]`.
- Instrumented browser sinks (`fetch`, `XMLHttpRequest`, `navigator.sendBeacon`,
  `WebSocket`, `EventSource`, `localStorage`, `sessionStorage`, `indexedDB`) are
  exactly `[]`.
- `localStorage.length` and `sessionStorage.length` remain `0`.
- Synthetic row tokens from both flows, such as `CID-browser-alpha`,
  `pkg-synthetic-october-v1`, `client-alpha`, `Dr Browser`, `Dr Lane`, room
  labels, and billing codes do not appear in captured request or sink payloads.
- Backup export JSON contains the synthetic rows by design, but stays in the
  browser download path.

## Node Sink-Trap Harness Evidence

The reproducible harness is:

```sh
node --test artifacts/comp-dashboard/src/lib/retention-local.privacy.test.ts
```

It installs Node-level browser-style traps for:

- `fetch`
- `XMLHttpRequest`
- `navigator.sendBeacon`
- `WebSocket`
- `EventSource`
- `localStorage`
- `sessionStorage`
- `indexedDB`

It then exercises the same parser/backup functions with synthetic attendance and
billing data. This is useful supporting coverage for sink behavior and failed
restore state preservation, but it is not browser evidence.

Assertions:

- Captured browser request/storage sink calls are exactly `[]`.
- Synthetic row tokens such as `CID-privacy-alpha`, `Dr Synthetic`, room labels,
  and billing codes do not appear in captured sink payloads.
- Backup export JSON contains the synthetic rows by design, but remains local to
  the harness.
- Failed duplicate and overlapping backup restores throw before replacing the
  existing harness state.

## Full App Evidence

Static inspection of the local retention workspace component and retention
library found no direct use of request or browser persistence APIs:

```sh
rg -n "fetch\\(|customFetch|localStorage|sessionStorage|navigator.sendBeacon|XMLHttpRequest|indexedDB|WebSocket|EventSource|/api" \
  artifacts/comp-dashboard/src/components/practice/local-retention-workspace.tsx \
  artifacts/comp-dashboard/src/lib/retention-local.ts
```

The full authenticated dashboard shell was not driven in this pass. The real
browser evidence is from the isolated component harness described above, plus
static full-app inspection of the component/library used by the shell.

## Deployment Readiness Notes

The local retention CSV changes are ready for independent review against the
dashboard package: focused tests, aggregate library tests, dashboard typecheck,
and documented dashboard build pass.

Remaining unrelated blocker: root workspace typecheck still fails in
`artifacts/comp-mobile` (`app/scenario/[id].tsx` route parameter typing and
`hooks/useColors.ts` theme casting). Those failures predate and are outside this
local retention CSV work, but they remain a release-process blocker if deployment
requires a green root `pnpm run typecheck`.
