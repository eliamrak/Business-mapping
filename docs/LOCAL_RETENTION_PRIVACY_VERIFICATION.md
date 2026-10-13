# Local Retention CSV Privacy Verification

Date: 2026-10-13
Branch: `local-retention-csv-workspace`

## Scope

This verifies the local-only retention CSV workspace with synthetic data only.
No real client data, production credentials, or business records were used.

## Isolated Harness Evidence

The reproducible harness is:

```sh
node --test artifacts/comp-dashboard/src/lib/retention-local.privacy.test.ts
```

It installs browser-style traps for:

- `fetch`
- `XMLHttpRequest`
- `navigator.sendBeacon`
- `WebSocket`
- `EventSource`
- `localStorage`
- `sessionStorage`
- `indexedDB`

It then exercises synthetic attendance CSV import, synthetic billing CSV import,
backup export, backup restore, invalid duplicate backup restore rejection, and
invalid overlapping backup restore rejection.

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

The full live dashboard file-picker flow was not browser-driven in this pass
because this checkout does not include Playwright, Puppeteer, JSDOM, Happy DOM,
or Testing Library, and the Codex browser runtime tool was not available to this
task. The evidence above is therefore isolated harness evidence plus static
full-app inspection, not a live full-app browser trace.

## Deployment Readiness Notes

The local retention CSV changes are ready for independent review against the
dashboard package: focused tests, aggregate library tests, dashboard typecheck,
and documented dashboard build pass.

Remaining unrelated blocker: root workspace typecheck still fails in
`artifacts/comp-mobile` (`app/scenario/[id].tsx` route parameter typing and
`hooks/useColors.ts` theme casting). Those failures predate and are outside this
local retention CSV work, but they remain a release-process blocker if deployment
requires a green root `pnpm run typecheck`.
