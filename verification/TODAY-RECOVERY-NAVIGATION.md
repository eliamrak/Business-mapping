# Today Recovery Navigation

## Candidate

- Branch: `codex/today-recovery-navigation`
- Base published evidence: `77dc11849b3c668d2e92dc8de28799c685a1d692`
- Runtime and reproducible browser harness: `5c4057edc671d42a09ec2487d28fbea409b5fd5f`
- Candidate tree: `6437d73ed400baa43465b4f056f4c6add46394c9`
- Local only. No push, deployment, production API request, backup download, restore, migration, or business-data write performed for this change.

## Change

Today > Settings > **Reporting documents & recovery** opens the existing Reporting documents view with its **Reports & recovery** tab selected. The existing **Backup and recovery** controls are reused unchanged. The entry appears above the Settings tabs and only in Today, not Sandbox or Long Term Goals.

The header **Reports** button still opens Compensation reports. Other Updates callers still default to Reporting periods. All reporting tabs remain reachable. No backend, auth, export, preview, restore, schema, calculation, or persisted-data behavior changed.

## Verification

- `npm test`: 745 passed, 0 failed.
- Dashboard TypeScript `tsc -p tsconfig.json --noEmit`: passed.
- Dashboard production Vite build: passed; existing sourcemap, mixed-import and large-bundle warnings remain.
- Five focused API contract suites (backup contract, retained overlaps, import coverage confirmation, report coverage, import declarations): 133 passed, 0 failed.
- `git diff --check`: passed.
- `verification/recovery-navigation-render.mjs`: seven captured/asserted states, no browser exceptions, no writes, no backup or restore requests. Real Access, PracticeWorkspace, Updates, Reports, Entry components; synthetic Clerk role and loopback API fixtures only, no owner browser/session.
- Owner: Settings entry reaches recovery directly; compensation Reports dialog remains separate; all four Updates tabs and Back to Overview work.
- Sandbox entry absent; data-entry account sees Entry only; denied account sees access error; signed-out account sees sign-in, not protected navigation.
- Fresh built CSS used. Settings entry and recovery view captured at 1280x900 and 390x900; no horizontal overflow, entry label fits, primary navigation does not overlap. Desktop and mobile screenshots visually inspected.

Reproduce from repository root with a local Playwright installation and Chromium available:

```sh
env PRACTICE_PLAYWRIGHT_PACKAGE=/tmp/forge-reviewed-da6f1d2c-stage/package.json PRACTICE_RENDER_OUTPUT=/tmp/recovery-navigation-check node verification/recovery-navigation-render.mjs
```

The package path above is this machine's test runtime, not a production dependency. Browser harness reads the current built CSS; run the dashboard build first. Full evidence and assertions are in [results.json](recovery-navigation-evidence/results.json), [mobile entry](recovery-navigation-evidence/today-settings-recovery-entry-390.png), [desktop recovery](recovery-navigation-evidence/today-reports-and-recovery-1280.png), and [mobile recovery](recovery-navigation-evidence/today-reports-and-recovery-390.png).

## Independent Review

Plato (`01a14c54-f4f3-7345-a001-a9f88594a0c5`) reviewed the runtime diff against `77dc118` and the harness read-only: **no findings or blockers**. Reviewer did not rerun tests. Noted test limits: no compensation export execution, backup download/preview/restore exercise, keyboard-focus/touch-target measurements, or narrower-than-390px capture. Tab switching was added to the final successful run after the reviewer's snapshot. Existing backend contract suites were rerun, but no new real PostgreSQL gate was needed or claimed for this UI-only patch.

## Separate Owner Distribution Diagnosis

Kepler (`01a14c52-289b-717d-9a36-c422a74e10f6`) independently traced published base `77dc118`, ran 65 focused tests and synthetic assertions, and made no edits or live/private requests.

- Goal progress uses `financialEstimates.summary`, the full summary calendar month, not Money's selected Sep 24-Oct 7 range (`practice-workspace.tsx`, summary construction around 1067; `goalExpected` around 3181).
- Owner pay Goal uses `ownerDistributionsPretax`: household-attributed distributions. Money's `distributions` is the aggregate. Positive aggregate amounts without household attribution legitimately remain unknown for this Goal.
- A zero inconsistency was reproduced: `practice-financial-estimate.ts` around 373 returns household owner zero for known zero fallback distributions or configured non-household-only allocations. Future `engine.ts` around 1640 returns null with no household distribution bucket even when aggregate distributions are explicitly zero.
- Synthetic future zero-fallback and reserve-only cases both return aggregate zero / owner unknown; an explicit household bucket returns zero / zero. The composed summary preserves unknown segments (`financial-estimate-display.ts` around 22); formatting correctly shows null as `--` and numeric zero as `$0`.

**Conclusion:** not a formatter problem; different periods and measures matter, and the future engine's zero semantics deserve reconciliation with historical semantics. The selected-period zero does not establish the full summary-month owner's value. No blanket null-to-zero substitution or financial calculation change is included. Confirm the live summary month, complete coverage, actual/future segments and attribution inputs before determining the live Goal's correct amount. Missing coverage and positive unattributed distributions must remain unknown.

## Release Hold

This candidate is ready for parent review, not published. An authorized owner must confirm the new path in the deployed environment after any approved release. No live verification is claimed. This patch cannot change the parent-verified Sep 24-Oct 7 values: billed revenue $17,425, 107 sessions, marketing $949, profit $2,156, retained $1,725. Those values were supplied by the parent, not independently read here.
