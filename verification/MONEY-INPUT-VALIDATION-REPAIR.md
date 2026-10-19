# Money Numeric Draft Preservation Repair

## Frozen Runtime and Scope

Initial R08 runtime and permanent handler regressions: `a522a8a892e081cac463a4b5e8acdb9e9d6c44eb`. Current reviewed runtime, including the browser-reproduced R09 disclosure correction: `e9a2c6c638b423afd3cd46cfdf74138cdd09a7e9`, tree `23acd7dec844256a3b78103f1394a3bf8977bcb5`. Later fixture-reset and navigation-assertion commits change verification only. This work has not changed immutable recovery checkpoint `6227adc`, been pushed or deployed, or accessed real records.

The maintained task is R08 in `PRACTICE-REPAIR-UPDATE-REGISTER.md`. Scope is one component's input/draft validation, not financial equations, schema, baseline percentages, source imports, backend authorization or persistence protocol. No migration/backfill is needed.

## Confirmed Reproduction

At `6227adc`, editing saved monthly revenue 10000 to -1 or a business-profit percentage floor 150 to -1 and blurring stages null without an alert. The parser conflates invalid text with an intentional blank. The component's callback stages that unintended Unknown; actual persistence still requires the parent's review/save. A synthetic transpilation of the actual TSX reproduced the defect, including schema/JSON round-trip. No production write was performed.

## Repair and Acceptance

- Blank, valid finite nonnegative input and invalid input are distinct. Dollar fields retain the existing maximum of 10 billion; percentage floors remain finite/nonnegative without a 100% cap.
- Negative, nonfinite, over-limit money and browser-sanitized empty `badInput` edits retain prior valid local planning values and invalid drafts, with stable labels, field alerts, `aria-invalid` and associated descriptions.
- Any field error blocks grouped staging. A valid intermediate preview hidden by subsequent invalid text cannot leak into a staged save when another field blurs. Other valid drafts and all outstanding validation messages remain intact until correction.
- Intentional blank still stages null, explicit zero stays zero, corrected valid values stage through the existing callback, and valid floors above 100% remain editable/saveable and visibly infeasible when appropriate.
- Monthly estimates, scenario floors, preset funding goals and custom funding goals share these rules. Unsaved invalid drafts remain protected by the existing dirty-navigation mechanism.

## Actual Checks

Author checks on the frozen runtime:

- `node --test verification/profit-first-planning-input.test.mjs`: **50/50 pass**, no skips.
- `npm test`: **792/792 pass**, no skips.
- Dashboard TypeScript check and production Vite build pass. Existing sourcemap-location, mixed jsPDF import and chunk-size warnings remain; they are not new failures.
- `git diff --check` passes.

Independent reviewer Gauss (`01a15480-c916-7798-a377-13f19300c0f4`) reviewed the exact commit against `f1a2537`, confirmed both owned files matched the commit, and found no remaining issue in scope. Independent replay passed **50/50 component-handler** and **24/24 planning model/source** tests, dashboard TypeScript and diff checks. The author's broad unit suite/build were not independently rerun. The prior register review also corrected a native test/suite count, made optional recovery QA explicit, and added the complete retained Long Term contract.

Current component SHA-256: `b1e98d4bce6791cf5a79a1f3fb4fe74b64fe269016b52d2e4cf788c7596911da` (initial R08 was `81fa2ab6c5265ce945413bc0841aa2b965a6e994b4590bf792304816188304bf`).
Handler-test SHA-256: `e8b157c8a905464fc8738b2dd347dae220187f5cfe2ac97da1fddd03d3051211`.

## Browser Outcome and Remaining Release Gates

The handler fixture executes actual transpiled TSX and calculation/schema code with synthetic hooks/events, not a DOM or real scheduler. After the publisher completed its exclusive native recovery run and stopped all owned processes, serial real-React browser verification was performed separately.

`verification/profit-first-planning-input-render.mjs` now passes **28/28 desktop/mobile cases with 28 captures**, zero browser errors, GET-only owned loopback requests and no production access. Actual native incomplete-number keystrokes, field alerts/AX descriptions, invalid grouped-staging protection, correction, explicit blank/zero and >100% floors pass. This fixture uses an actual component and synthetic parent callback, not a database save. Reproduce serially with existing installed browser/dependencies:

```sh
node verification/profit-first-planning-input-render.mjs --run
```

Default invocation remains build-only and does not start a server/browser. Supply existing Playwright/Chrome paths when needed. Passing report: `/private/tmp/profit-first-planning-input-render-zGgUPx/results.json`, SHA-256 `8c21649da62c458fbc43a40b169612d6b6a4732d03a4767af51be66811f8ebf0`. Author visually inspected the mobile invalid-estimate capture; this is not exhaustive visual/AT certification.

The first browser run passed nine cases then exposed R09: resolving an Unknown to a known value auto-closed the cost-details section while its input was active. The narrow state correction opens for newly missing inputs but does not auto-close on resolution; explicit close/reopen remains available. Both desktop/mobile disclosure regressions pass. A separate test-only reset/remount race was repaired by waiting for the fixture epoch. Initial reports remain failed, not upgraded by the later pass.

Independent review of exact R09 source and passing browser evidence found no remaining finding; reviewer replay passed 50 handler/24 model tests and types/diff. It verified 28 cases/captures, source/tree and CSS hash without rerunning a browser or visually inspecting captures.

Integrated `recovered-live-decisions-render.mjs` also passed **14 desktop/mobile states**, four synthetic intercepted Hub saves, reload and Sandbox isolation, with source facts unchanged, zero browser errors and no document overflow. Its obsolete Rooms tab-role assertion was updated to the already-reviewed Growth navigation button, not worked around in runtime. Report: `/tmp/recovered-live-decisions-K8kCzU/results.json`, SHA-256 `6876d28b765f101fb9c99c12d506361bf61e5212e50e332188349579738e4fc0`. These are not real-record persistence operations. Actual screen-reader speech and fresh provider authentication remain unverified.

The subsequent existing keyboard/draft suite passed **32/32**, and native Chrome zoom/AX checks passed **39/39 with 42 nonblank captures**, both without browser errors. Reports are `/tmp/financial-completeness-render-ko9vXi/results.json` and `/tmp/practice-semantics-zoom-T2ctHm/results.json`. `money-input-validation-results.json` retains compact results, source/report/capture hashes, the two failed browser attempts and the separate recovery evidence pointer. Runtime is unchanged from the reviewed R09 source; no API/library/schema files changed from the recovery checkpoint.

Local scoped render/regression/build gates are now passed. Before release, retain the exact combined candidate, review any subsequent source edit, retain a recovery point, and repeat established five fresh read-only preservation comparisons/16 fingerprints. Publish once through the sole existing release task only after parent coordination, and separately record public assets/health plus authenticated read-only screens/reload. Backout must retain optional `moneyPlanning` compatibility and saved plans; never delete or restore business records to fit older code.
