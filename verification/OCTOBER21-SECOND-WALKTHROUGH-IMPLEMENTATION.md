# October 21 second-walkthrough implementation

Authority: user message Sentinel_4f73f887a6ec81918009b85436a1fd6f, replying to plan Sentinel_70c2f7444d448191b7fa188408f2a0f4. This supersedes conflicting first-walkthrough cost-input presentation. Base reviewed source is da803da4ab5a0ae9bc21ef612d1e05f5172c119b. This receipt concerns local source, not publication or native acceptance.

## Requirement evidence

| Requirement | Implemented behavior and evidence |
| --- | --- |
| Overview hierarchy | Existing four KPI cards remain first. Monthly surplus, collapsed forecast controls, projection basis and import attention follow them in DOM order. Removed Current business eyebrow. Existing simultaneous histories/rings/targets retained. Integrated browser checks assert actual vertical order. |
| Sessions 90 days and chart | Shared period defaults to 90 days. Full-width calendar chart precedes KPI cards. Gold dotted four-week trailing average is separate from actual weekly counts and capacity. Trend requires four consecutive fully covered calendar weeks; no visit-day extrapolation or unknown-to-zero. Focused covered-trend fixtures preserve incomplete-week gaps. |
| Clinician close-rate investigation | Confirmed clinician closer credit still requires recorded attribution. Practice observed conversion can exist while clinician evaluated denominator is zero and close rate is Unknown. No automatic closer confirmation or production attribution change. Definition decision remains open below. |
| Attrition time basis | Separate mature attrition windows, not the immature retention/consultation cohort. As-of Oct21 with original report calendar through Oct7 selects Apr1-Jun30 and Jul1,2025-Jun30,2026. Recent retention/consultation remain Jul-Sep. Labels explicitly say mature months; dates/help remain accessible. Existing establishment, observation, coverage and later-return rules unchanged. |
| Attrition cross-view consistency | Overview whole-window count/rate retain the unique established-client denominator. Team/Sessions monthly averages use dedicated attrition activity/ranges. A known observed monthly average can coexist with unknown whole-window percentage when establishment is left-censored; separate basis disclosed, never presented as a percentage. Independent synthetic audit verified 1/3 = 0.3 per mature month while whole-window values remain null. |
| Money help overlap | Planning help uses existing body-portaled Radix Popover, bounded to viewport; not clipped or covered by neighboring inputs. Keyboard, Escape/focus return, tap and point-occlusion checks. |
| Plain allocation choice | Floor renamed Minimum income share %, distinct from Current %. Explanation uses an income-share example. Actual allocation choices remain editable; derived costs are source readouts. |
| Money Budget subtab | Allocations/Budget subtab reuses existing budget records, category IDs, frequency and effective dates. Add/edit uses existing staged record flow and parent Review/Save. No duplicate store or seeded items. Legacy standalone overhead-allowance controls hidden from Money Budget. |
| Budget feeds operating costs | Today Money uses selected-month operating/facility budget line accrual only; saved scenario overrides and old overhead goal floors do not override the Budget source. Existing values preserved for Sandbox. Explicit zero is zero; absent/unsupported cost source remains Unknown. Synthetic edit 8500 to 9000 updates Money to 9000 and persists. |
| Budget feeds marketing | Existing dated campaign cost fields and Budget marketing lines feed selected-month estimates, without copying records. Calendar-day proration. Potential linked source overlap, invalid dates or nonzero undated campaign costs remain Unknown with actionable reason. Archived/planning-only campaigns excluded. Proven future/ended campaigns and explicit zero retain zero. |
| Processing fees | Existing percentage/fixed-fee/payment-count assumptions editable in Budget. No dedicated recorded processor-fee data exists in current model; billed charges cannot establish exact Stripe fees. Output stays an estimate. No bank/processor data requested. |
| Goals composition | Performance inputs stacked vertically in one card; salary/distribution/profit/overhead topic cards side by side on desktop, responsive on narrow screens. Fund balances and contributions remain Goals. Independent visual review caught and repaired higher-specificity legacy CSS causing input overlap; parent-card bounds now asserted. |
| Per-section layouts | Reusable edit mode with native pointer drag, Alt+Arrow and up/down controls, bounded Small/Medium/Wide choices, live announcement and Reset. Independent preferences on Overview, Sessions, Team, Growth, Rooms and Goals. No marketing copy/feature explanation added to ordinary screens. |
| Persistence and safety | Optional versioned settings.sectionLayouts only, with unique IDs and maximum64 entries. Layout changes use existing staged workspace Review/Save. Stable IDs preserve content drafts; reset clears only selected section. Hidden widget preferences retained within bound. No SQL migration, dependency addition or source configuration changes. |
| Cache correctness | Layout-only edits no longer rebuild unrelated clinical readers. Pay-event-only changes invalidate earnings reader; regression confirms previous reader remains stable and refreshed unsupported compensation becomes unavailable, not stale pay. |

## Verification

Canonical regression command:

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts verification/profit-first-planning-input.test.mjs
```

Final run: 1065 passed, zero failed/skipped; `/tmp/practice-oct21-second-final-tests.log`. Original1039 coverage is included. Focused campaign/planning review:135 passed. Independent attrition/integration audit:105 passed after the subsequently repaired unrelated markup selector. Independent code review reports no actionable findings after the pay-event memo repair.

API/dashboard TypeScript checks, lib/practice project build and API/web builds pass. Local pnpm is unavailable; equivalent installed entrypoints were invoked directly:

```sh
node node_modules/typescript/bin/tsc -b lib/practice
node node_modules/typescript/bin/tsc -p artifacts/comp-dashboard/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p artifacts/api-server/tsconfig.json --noEmit
```

Web artifact cwd: `PORT=23894 BASE_PATH=/ node node_modules/vite/bin/vite.js build`. API artifact cwd: `node build.mjs`. Existing nonfatal Vite sourcemap/chunk warnings remain. Publisher must preserve actual injected public runtime build inputs; local output hash equality is not promised across different public Clerk/VITE configuration.

Integrated synthetic harness: `node verification/october21-second-walkthrough-acceptance.mjs`. Final expanded run passed26/26: six sections at1280/900/390/320, Overview DOM order, Sessions90days/chart/card ordering, Money help opacity/occlusion/focus, per-card Goal input/progress-bar bounds, vertical Performance inputs, existing Budget edit/add/save/reload, independent layout resize/reorder/save/reload/reset, immutable source evidence and no external requests. Portable receipt `verification/OCTOBER21-SECOND-WALKTHROUGH-RESULTS.json`; full screenshots including Budget, help and staged-layout states in `/tmp/practice-oct21-live-call-l7MKtp`. Help screenshots await opening-animation completion and assert opacity1 before capture. Earlier failed receipts remain under `/tmp/practice-oct21-live-call-*` and are not counted as passes.

Final local default-public-input build: JS `index-l4oRYTdP.js`,2462122bytes,SHA256 `11d7f186559ef4d9f723aeb868b15ccb285a8a98554ccb5ff4a7368a8d07e389`; CSS `index-CxcdzufH.css`,263801bytes,SHA256 `40d87464c9e78510a772276e68d1ae9c0d0add7677c5198b3df389dd4926f569`. Runtime source is the important publisher gate; injected public auth configuration can change JS hash without a source change.

Independent final visual review cleared the repaired Goals progress/input containment, Budget, desktop staged-layout states, and fully settled help at320/1280. No remaining blocking findings in reviewed captures. Review found genuine issues missed by page-overflow checks; the final harness now asserts parent-card control/bar bounds and settled opaque help. These captures do not certify every possible custom layout, production data or native view.

Separate browser fixtures (installed Chrome in an isolated synthetic profile):

```sh
PRACTICE_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test verification/section-widget-grid.test.mjs verification/overview-historical-summary-grid.test.mjs
```

Both pass. Covers native pointer drag, Alt+Arrow focus retention, content draft preservation, bounded resize, reset, narrow screens and 200% CSS zoom. This is not browser-native zoom, WKWebView or VoiceOver certification. Evidence `/tmp/section-widget-grid-bU1oNp`, `/tmp/overview-summary-grid-k9fewA`.

## Remaining acceptance and metric decision

No source change can honestly turn missing confirmed closer attribution into confirmed clinician close rate. Needed product decision: retain confirmed close rate as primary, or additionally offer a distinctly labeled observed clinician treatment-start conversion metric. The latter is not confirmed closer credit. This candidate preserves the established definition; no pending journey is silently converted or attributed.

Production attrition values are not certified by synthetic tests; mature windows remove the deterministic timing obstruction, but incomplete real evidence can still yield Unknown. Exact October19 observation/scope reconstruction remains unavailable and is not pretended from current dates. Owner review and authenticated live checks remain separate gates. Native Mac app/VoiceOver remain unverified; no Accessibility permission was granted or bypassed.

## Publisher handoff and backout

Integrate only the reviewed delta from da803da onto the established publisher descendant; do not reset to this branch or replace publisher history. Reverify current clean publisher HEAD/tree and source preimages before applying. Preserve .replit, artifact contracts, publisher-only memory files, all existing commits and data. No SQL/schema migration, seed, import approval, mapping, attribution, financial-record or business-data mutation is required. Keep copy-development-database OFF.

Run the canonical pure regression suite, scoped types and existing artifact builds in the publisher. Create a normal descendant commit and retain a preintegration rollback branch. Root coordinates publication and authenticated aggregate/UI preservation checks; no duplicate deployment from this local task. Source rollback does not require restoring/deleting any business records. Preserve current six imports/source identities, configuration/revision/journal, duration mappings and all saved amounts/IDs before and after. Billed amounts, modeled estimates and reconciled cash remain distinct.
