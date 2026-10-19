# Money Numeric Draft Preservation Repair

## Frozen Runtime and Scope

Runtime and permanent handler regressions: `a522a8a892e081cac463a4b5e8acdb9e9d6c44eb`, tree `6316dae66387e58d1b45eadc0fc8a22d6ad8128f`. This is subsequent work after the immutable recovery checkpoint `6227adc`; it has not changed that checkpoint, been pushed or deployed, or accessed real records.

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

Frozen component SHA-256: `81fa2ab6c5265ce945413bc0841aa2b965a6e994b4590bf792304816188304bf`.
Handler-test SHA-256: `e8b157c8a905464fc8738b2dd347dae220187f5cfe2ac97da1fddd03d3051211`.

## Pending Render and Release Gates

The handler fixture executes the actual transpiled TSX and real calculation/schema code with synthetic hooks/events. It is not a DOM, real React scheduler, native input sanitizer, accessibility tree, screen-reader or persistence integration test. Browser/native event ordering, visible focus/layout, alerts and actual parent review/save behavior must be checked before publication.

The publisher currently owns isolated recovery work on `6227adc`. No competing browser, native database or remote session was started. `verification/profit-first-planning-input-render.mjs` defines 26 later desktop/mobile real-React/native-input checks. Syntax and build-only validation pass; no browser, server or profile was started and none of those 26 checks has run. Run it only after the execution owner releases the resource window; use synthetic loopback data, no real accounts or business records, and preserve the existing keyboard/zoom and staged-save regression gates:

```sh
node verification/profit-first-planning-input-render.mjs --run
```

The default invocation is build-only and does not start a server/browser. Supply existing Playwright/Chrome paths through the documented environment variables when needed. Inspect its report and screenshots rather than treating this prepared harness as a pass.

This standalone component fixture does not exercise integrated PracticeWorkspace review/save. After the exclusive execution window, also rerun `node verification/recovered-live-decisions-render.mjs` against the same frozen runtime for the existing staged goal/floor save/reload and Sandbox isolation paths. Those are synthetic intercepted-API saves, never production records. Keep the prior keyboard/native-zoom checks scoped separately; prior passing runs do not certify new source automatically.

Before release, freeze the combined candidate, obtain review for any subsequent source edits, run the scoped render/regression/build gates, retain a recovery point, and repeat established five read-only preservation comparisons/16 fingerprints. Publish once through the sole existing release task and separately record public assets/health plus authenticated read-only screens/reload. Backout must retain optional `moneyPlanning` compatibility and saved plans; never delete or restore business records to fit older code.
