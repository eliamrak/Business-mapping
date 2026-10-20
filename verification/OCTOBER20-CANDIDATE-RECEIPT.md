# October 20 Local Candidate Receipt

## Exact Source

- Repository: `/Users/eliam/Documents/Codex/2026-10-14/task-2/practice-app-durable-history`
- Branch: `codex/recovered-live-planning-decisions`
- Runtime candidate: `834eed0932d50709f08914853d777e1cc14bc4ad`
- Main implementation: `53d79d4121a2f37772143b34fc97f2da7214b4da`
- Presentation follow-ups: `ea25d40fb8273c779aa4d8befb473ad9ba170cb6`, `834eed0`.
- The only pre-existing untracked path, `verification/practice-workspace-render/`, remains untouched.
- No source schemas/migrations or stored business records were changed. New tax editing reuses the existing monthly override, storing the quarterly value divided by three. Owner goal IDs/amounts remain with their original economic metrics.

Scope and omission diagnosis: `OCTOBER19-REQUIREMENTS-RECONCILIATION.md`. Item-by-item candidate implementation and limits: `OCTOBER19-IMPLEMENTATION-EVIDENCE.md`. Native artifact reconciliation: `OCTOBER20-MACOS-RECONCILIATION.md`.

## Tests and Review

- Combined root/domain/component-handler suite: **947 passed, zero failed** (`node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts verification/profit-first-planning-input.test.mjs`).
- Dashboard TypeScript passed. Final follow-ups are CSS/harness only; TypeScript runtime sources are unchanged from the typechecked main candidate.
- Dashboard production builds passed using `PORT=5198 BASE_PATH=/`; existing sourcemap, mixed-import and large-chunk warnings remain. This is not a publication receipt.
- Euclid independently reproduced the earnings overlapping-profile P1, then independently verified its repair in both source orders, selected and prior-cap windows. No remaining material findings in that bounded clinical/earnings review.
- Darwin independently found and rechecked owner-funding ambiguity and legacy-label P1/P2. Exact main candidate passed original reproductions and 96 planner/handler checks. Subsequent commits do not alter those source files or math.
- API, authenticated production records, actual paid payroll, and running installed-native behavior are not certified by these tests.

## Rendered Candidate

Final run: `/tmp/october19-requirements-bOZOba/results.json`.
Manifest: `/tmp/october19-requirements-bOZOba/runtime-hash-manifest.json`.

- Exact commit matches runtime candidate; empty runtime diff; captured source hashes stable throughout.
- `finalCommittedCandidate: true`, `runtimeStableDuringRun: true`.
- **14 states**, desktop1280 and phone390; **28 screenshots**, **18 help checks**.
- No browser errors, external requests or attempted API writes; synthetic source facts unchanged.
- Both period values/date ranges/differences appear together in historical cards. Activity-date changes do not change historical windows; consultation scope follows the top Sessions contributor; removed selectors remain absent.
- Money named targets are reachable beside allocations; Goals overflow/help, Overview removed cards/simple surplus/funnel, desired-caseload comparisons checked.
- Team ring/caption/value/legend containment assertions are unchanged and pass. At phone width a 96px ring fits a 134px period region; the 66.7% text is 59.984px wide. Author inspected desktop and phone crops.

Useful captures: `team-retention-crop-1280.png`, `team-retention-crop-390.png`, `overview-histories-1280.png`, `overview-histories-390.png`, `money-targets-and-help-1280.png`, `goals-overflow-and-help-390.png`, all in that run directory.

## Not Published / Not Fully Accepted

`fullOctober19Acceptance: false` is intentional. Remaining gates:

1. Trace the actual consultation repeated-4 counts and Overview43 source records through an authorized read-only authenticated production view. Fixtures do not explain those real examples.
2. Verify the configured protected-payroll recipient/person mapping in actual saved data. The UI now reveals the configured recipient rather than treating a legacy metric key as proof of identity.
3. Establish a valid matching unique eligible-client denominator before claiming a whole-window attrition percentage. Current safe display is unknown; no latest-month/client-month substitute was invented.
4. Parent's independent complete-requirements review and existing-environment publication/preservation/backout checks.
5. Coordinated macOS reload only after pending work is saved/finished; verify the actual loaded frontend and behavior separately from public web asset hashes.

No web deployment, Git push, owner-app reload/restart/replacement, private browser-profile inspection or production record write occurred in this repair. The installed app is an online shell without bundled frontend; the previous published web itself contains the omitted selector. This is an already-requested scope omission, not evidence that the owner's desktop was simply stale.

The local delegated environment has no connected authenticated application browser. No credentials or new access grants were requested. The source-data checks must use the existing authorized reader/publisher environment; the owner need not repeat the original requirements.
