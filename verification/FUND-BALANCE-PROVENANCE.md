# Fund Balance Display Provenance

## Reproduced Failure

On baseline `1637a23a7adf6ff0c4a23631efcbe62255bdf81d`, a synthetic blank Building Fund balance appears in Money as "$0 recorded anchor · date not recorded" and in Goals as "Current recorded balance: $0 when blank" with a Recorded legend. A synthetic entered $125 without a date also appears as a recorded anchor and incorrectly says "when blank" in Goals. No save action is needed to reproduce either label.

The numeric projection policy is already correct: a blank fund balance may be explicitly assumed $0; it is not a dated observation. An explicitly entered $0 with a date must remain a real entered-zero record, not be treated as missing. Existing chart data already distinguishes actual and projected points and is preserved.

## Narrow Repair

`fundBalanceEvidence` classifies display provenance as assumed-zero, entered-undated, recorded-dated or after-period. Money and Goals consume that state for captions; the existing Goals bar's valueLabel also reflects assumed/entered/recorded evidence. A balance dated after the selected Money period remains unavailable, never replaced by $0. Projection copy refers to the starting/entered balance rather than claiming a recorded balance or actual funding achievement.

No stored value, date, schema, save action, actual fee, compensation, expense, cash value, allocation, projection arithmetic or goal-achievement rule changes. The blank value remains null in the form and source record. Entered zero remains zero. Navigation, chart series/styles and circular visuals are unchanged. No migration is required; backout is code-only, without reverting owner data or fee approvals.

## Verification

- Three new unit tests distinguish null/undefined, explicit zero, positive undated amounts, dated observations, date-boundary exclusion and unchanged inputs. Blank and entered-zero projections retain identical contribution, remaining-balance and ETA arithmetic, while their starting observation kinds remain distinct.
- Targeted fund/overhead/achievement suite: 29 tests pass. Full domain/dashboard-library suite: 663 tests pass. Dashboard typecheck and production build pass with existing nonfatal Vite notices.
- `verification/fund-balance-provenance-render.mjs` with `FUND_PROVENANCE_PROBE_ONLY=1` prints the old labels when unchanged baseline source is served. The normal run tests Money/Goals captions, unchanged blank/zero/positive form values, provenance legends, absence/presence of Recorded balance markers, historical exclusion, reload and zero API writes.
- Six focused desktop/mobile states and the 45 existing workspace states pass (51 total), with unchanged synthetic source/workspace/context facts and no browser errors or overflow. Three extra focused mobile images make the changed captions/legends inspectable. The single-point marker for a projected series is not a recorded observation; recorded-dot assertions explicitly check the series name.
- All browser testing is isolated localhost Chromium with mocked APIs, not Forge's shared browser and not a signed-in production session. Output remains in the existing untracked `verification/practice-workspace-render/` directory (`fund-provenance-*`, `fund-balance-provenance-results.json`). Exact runtime/review evidence is recorded at the candidate freeze.

## Acceptance And Inputs

No owner input is required for this repair. If the owner wants a dated balance to count as recorded evidence, the exact actual balance and its observation date belong in the existing Current balance/Balance date fields. Do not fill them from goals, allocations, billed fees, assumed zero or sample data. This audit does not claim those records are absent in the production account.

The prioritized `PRACTICE-ACCEPTANCE-CHECKLIST.md` separately identifies verified scope, this baseline failure, untested acceptance and actual/configuration evidence unavailable to the local audit. Real bank/payroll/expense reconciliation and owner visual acceptance remain outside a synthetic test PASS. No production connection, mutation, approval application, deployment or main promotion is performed here.

## Exact Independent Review

Runtime: `f64aa0fc1fd9ff8d8ec842f673c6c2b812ce9d62`, tree `f96dfa6a2a7e36001f715f2ea4996789d711b78a`.

Independent read-only Newton worker `01a13c09-3ccf-7641-a5bc-5e2a89f4d0f9`: **PASS**, no findings. The reviewer confirmed all four display states, explicit zero, inclusive date-boundary behavior, unchanged amounts/projections/achievement/save paths and the checklist's separation of evidence bases. Independently executed: 29 focused fund/overhead/achievement tests, dashboard typecheck and diff validation. Browser captures were not independently rerun. No reviewer edits or production calls.

The following verification-only checkpoint pins the aggregate audit to this runtime; all 16 aggregate/identity-audit tests pass. Runtime code is unchanged by that checkpoint. Source comparison to baseline confirms no shared practice engine, API or database changes.
