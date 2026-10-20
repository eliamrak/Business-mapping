# October 20 Help and Billing Local Review

## Scope and Disposition

Independent bounded review of items 11 and 12, initially at HEAD `c6f6fafe4693dee3a5702b8fc18dec71e979ad69`, whose changes over accepted runtime `8aa7c934b052b820e06094bfee4df9ca6cd44557` are four verification documents only. Read the complete 21-row follow-up receipt, original independent review, attrition/caption addendum, requirements register and read-only trace. This is additional evidence, not a new full-21-item review or a replacement for the original matrix.

The reviewer made no runtime changes, commits, push, deployment, owner-profile access, installed-app interaction, or real-record reads/writes. The pre-existing untracked `verification/practice-workspace-render/` was untouched. Later in this review the author independently supplied uncommitted help changes; their separate disposition is recorded below. Baseline findings are explicitly about the old bytes, not presumed defects in a future patch.

**Item 12's source behavior, numerical separation and local handler paths are now independently checked. Item 11 has concrete locally fixable gaps; it is not merely waiting for authentication.** Actual configured code/charge distributions and installed native behavior remain separate owner-environment checks. Whether to add a configurable per-code fee schedule is a product decision, not an established missing implementation requirement.

## Concrete Baseline Findings

Paths in this section are relative to `artifacts/comp-dashboard/src/`.

1. **P2: Compensation model methodology is inaccessible by ordinary keyboard navigation and has no tap-open control.** `components/sandbox-view.tsx:353` renders `InfoTip` as `TooltipTrigger asChild` around a plain `span`, with no tabIndex/button; its only click handler stops propagation. The tooltip definition itself does not provide an explicit touch disclosure. This affects the production/compensation/overhead definitions, including uses at lines 661-726 and 2361. Source inspection independently agrees with the author's finding. The authored replacement delegates to HelpBubble; see follow-up below.
2. **P2: Four legacy numeric-field helpers put their help only on non-focusable labels.** `components/tabs/team-builder-tab.tsx:98`, `business-goals-tab.tsx:75`, `current-reality-tab.tsx:64`, and `scenario-builder-tab.tsx:255` render `Label htmlFor={name} title={tooltip}` and an input without `aria-describedby`. Actual provided strings include Team Builder's Session Rate and Employer FICA (`:692`, `:720`) and Compensation Targets' salary/distribution/caseload/fund definitions (`:252-265`). Two-width browser checks of the AST-extracted actual helpers confirm four label tabIndex values of -1, no input description links, and no tooltip element after input focus or label tap. These are static server-rendered controls: this proves the missing native focus/description/control path, not a full hydrated editor test. Current Reality and Scenario Builder accept a tooltip prop but currently have no `tooltip=` call sites; those two are latent helper gaps, not demonstrated missing descriptions for an existing field. The author subsequently fixes BusinessGoals NumInput; do not carry its old finding forward after the follow-up passes.
3. **P2: Lead Flow rate definitions are hover-only titles.** `components/practice/lead-flow.tsx:269-272`, `:292-295`, `:381-393` place the four formula definitions on spans/table headers with no tabIndex or disclosure. The isolated actual LeadFlow SSR at 1280/390 confirms its four year-table headers have tabIndex -1 and zero help controls. These describe distinct schedule/show/consult-close/overall-close denominators, so this is useful missing keyboard/tap help, not merely decorative text.
4. **P2 presentation: Data & imports still exposes detailed methodology as flat primary paragraphs.** `pages/practice-workspace.tsx:4844` mounts `WorkspaceCalculations` after the import workspace. `components/practice/workspace-calculations.tsx:250-266` exposes the full visit-frequency/initial-retention formula paragraph; `:335` onward exposes the long ending cutoff, partial-month, all-month/latest-six, left-censoring and pending-follow-up explanation. Neither is inside details. `components/practice/local-retention-workspace.tsx:610-628` also mixes primary coverage counts with multi-sentence reconciliation/definition prose; preserve actionable conflict alerts and counts if reducing that prose. These exact blocks are candidates for short primary values plus collapsed methodology. No general claim that every legacy screen is overloaded is made.

All seven integrated routes were source inspected through `IntegratedToolContent` (`practice-workspace.tsx:206-235`) and their actual destinations: Team Builder, Clinician Impact, Current Reality, Business Goals, SandboxView, Scenario Builder and Scenario Comparison. Current Pay Comparison's short dated-basis caption (`clinician-impact-tab.tsx:544`) and Scenario Comparison's one-line matching legend (`scenario-comparison-tab.tsx:332`) are useful context, not demonstrated overload. The long classification explanation in Clinician Impact is outside its `currentPractice` early return, so it is not incorrectly attributed to Today's Pay Comparison.

## Item 11 Locally Completed Evidence

Independently verified all **143 runtime source hashes** in `/tmp/october19-requirements-YHnmqY/results.json` against both exact Git blobs at `8aa7c934` and the initial working files. Independently verified all **28 screenshot hashes**. The retained record has **14 states, 18 help checks**, empty runtime diff, stable sources, no browser errors/external requests/attempted API writes and `finalCommittedCandidate: true`. These are the author's retained full-workspace interactions, not a new independent repeat of all 14 states.

The retained 18 heading-help checks cover Reporting period plus About Clinical staff/Marketing/Current goals/Practice summary at 1280 and 390. They check initially collapsed text, nonempty hover title, keyboard activation, click/tap and return to collapsed state. The consultation methods disclosure and focus-spacing assertion are also present. This supports those named controls, not every legacy tooltip or installed WKWebView accessibility behavior. Native title hover is supported by the title attribute; the browser harness does not inspect an OS tooltip bitmap.

Fresh independent synthetic legacy-help check: `node /tmp/oct20-help-billing-probe.mjs`, output `/tmp/oct20-help-billing-probe/results.json`; SSR HTML and two screenshot hashes are included there. Cached Chromium used a fresh temporary profile, in-memory content, and blocked all network requests. Desktop1280/phone390 actual LeadFlow markup and AST-extracted numeric helpers were inspected. This is bounded semantic evidence, not styled full-app layout acceptance. Initial sandbox Chrome launch aborted before rendering; the approved isolated rerun passed.

## Item 12 Source Flow and Numerical Evidence

| Concern | Existing source behavior and independent evidence |
| --- | --- |
| Plain editable Session fee | `practice-workspace.tsx:4161-4170` passes `person.sessionRate` to NumberField, saving `patchPerson(person, {sessionRate:n})`. NumberField validates finite, nonnegative bounded numbers, saves on blur/Enter, exposes errors, and resets on Escape (`:427-515`). |
| Editable desired sessions/week | `:4172-4180` saves `sessionsPerWeek`, max100. `patchPerson` uses `/api/clinicians/:id` PATCH for Today; sandbox updates its working draft. A desired-basis forecast also adjusts its manual aggregate baseline. |
| Separate future revenue override | `:4181-4193` reads profile `expectedSessionRevenue ?? person.sessionRate`; `stageClinicianAverageRate` (`:2099`) stages a profile override or dated term. Reset uses null (`:4201`). This is a staged planning edit, not a source-billing write. The forecast engine applies dated/profile expected rate separately (`lib/practice/src/hub/engine.ts:974-1006`). |
| Historical compensation/session | `:4194-4199` is text/strong with optional counts/definition, no input or save handler. `lib/historical-clinician-earnings.ts:36` uses accepted discounted treatment charges, exact service-date attendance matches, dated pay and cap replay; it explicitly excludes certification of paid payroll/cash. Unknown coverage/identity/pay stays unknown. |
| Variable per-service charges | CSV parser `lib/retention-local.ts:880-893` retains `billingCode` and parsed `totalFeeCharged`; converter `tools/practice-converter/Resources/converter_core.py:1121-1145` retains source fee/code. The system consumes the imported fee; it does not independently calculate or prove a discount from a list price. `lib/practice/src/hub/billing-evidence.ts` reconciles exact source facts/conflicts before consumption. |
| Actual billing-code controls | Data & imports exposes billing-code minutes (`components/practice/local-retention-workspace.tsx:738-795`), billing evidence/reconciliation, coverage and accepted two-charge exceptions. `artifacts/api-server/src/routes/practiceImports.ts:896` saves minutes metadata. These are duration/reconciliation controls, not per-code fee settings. |
| Configuration boundary | Clinician API PATCH (`artifacts/api-server/src/routes/clinicians.ts:119-141`), clinician schema, hub profile/term schemas and inspected editors contain standard session fee/planning overrides, not a configured code-to-fee schedule. No such editor is claimed. |

Fresh independent three-encounter probe uses the same code90837 at **$50 and $125**, plus code90834 at **$80**, matched attendance and a dated60% clinician split: **$255 charges -> $153 accrued compensation / 3 completed treatments = $51/session**. Card fee900, desired70, profile desired99 and future override999 are deliberately different. Changing card fee to1200, desired sessions to1 and override to5000 leaves the entire historical result unchanged. Setting the first accepted charge to0 produces **$123 / 3 = $41**, preserving the completed-session denominator. The calculation leaves its complete input unchanged before each deliberate fixture edit.

Six fresh AST-extracted production-handler probes (`node /tmp/oct20-billing-handlers.mjs`, `/tmp/oct20-billing-handlers.log`) pass using dependency spies only: profile override120, null reset, dated override125, new-profile override130, Session fee190 -> `PATCH /api/clinicians/41 {sessionRate:190}`, and desired23 -> `{sessionsPerWeek:23}` plus desired aggregate40-20+23=43. No real fetch/database call occurred. This establishes handler intent and field separation, not authenticated persistence or a complete editor interaction.

Focused regression command:

```sh
node --test --test-reporter=tap artifacts/comp-dashboard/src/lib/historical-clinician-earnings.test.ts artifacts/comp-dashboard/src/lib/practice-financial-estimate.test.ts artifacts/comp-dashboard/src/lib/practice-financial-range.test.ts artifacts/comp-dashboard/src/lib/parser-billing-evidence.test.ts artifacts/comp-dashboard/src/lib/reported-billing.test.ts artifacts/comp-dashboard/src/lib/historical-billing-ledger.test.ts artifacts/comp-dashboard/src/lib/legacy-service-codes.test.ts artifacts/comp-dashboard/src/lib/lead-flow-rates.test.ts lib/practice/test/billing-resolution.test.ts artifacts/api-server/test/practice-import-declarations.test.mjs artifacts/api-server/test/practice-import-coverage-confirmation.test.mjs
```

**153 passed, 0 failed/skipped**, `/tmp/oct20-help-billing-clean.tap`. This includes mocked route handlers, not a real PostgreSQL integration. An initial command also selected `practice-imports.integration.test.mjs`: 124 domain checks passed but that suite refused setup because no `EMC_TEST_DATABASE_URL` was set. Its failure is retained in `/tmp/oct20-help-billing-focused.tap`; no owner database was substituted. The focused clean command uses available in-memory handler suites. Database integration is a locally provisionable environment check, not an authentication blocker and not claimed complete here.

## Remaining Gates, Precisely

- **Local implementation:** item11's identified passive/flat help gaps can be repaired/tested locally. They need no owner login. Scope the follow-up to actual repaired consumers; untouched LeadFlow/TeamBuilder or Calculations gaps do not disappear because HelpBubble itself passes.
- **Product decision:** item12's request to verify billing-code editing does not by itself establish that a new internal fee-schedule editor must exist. Decide whether the intended workflow is editing charges in the source billing system then importing, or maintaining prospective per-code settings inside Practice. Existing code implements the former data boundary plus standard clinician fee/planning inputs, not the latter editor. No owner action or fee edit was attempted to settle that intent.
- **Actual-data read:** aggregating real distinct imported codes, distinct charges per code, unresolved conflicts and configured minutes requires the already-authorized owner environment. Synthetic variability verifies capability, not the real account's billing distributions. Follow the aggregate-only trace already documented; no client-linked fee output is needed.
- **Installed native/release:** touch/keyboard in isolated Chromium does not certify the running WKWebView, actual loaded release, production persistence or publication. Those stay with the existing owner environment and delivery process. They do not invalidate completed local checks.

## Authored Help Follow-Up

Author-owned changes were supplied during review: new `components/practice/help-bubble.tsx`, Sandbox InfoTip delegation, and Compensation Targets NumInput with separate help button and proper Label/Input association. The reviewer owns new `verification/help-bubble-render.mjs`, not those runtime files. Its actual source bundle uses nested Radix Tooltip/Popover, the actual Dialog components, and TypeScript-extracted real InfoTip/NumInput wrappers. It checks standalone and nested-editor behavior at1280/390/320, hover, Tab focus, Enter/Space, Escape focus restoration, tap toggle, parent click/form isolation, visible untruncated text and overflow. Before/after component/dependency/harness/CSS hashes are required. Final pass/fail and exact source fingerprints are appended after execution; no acceptance is inferred from source shape alone.

### Final Independent Acceptance

**Accepted bounded source checkpoint: the three author-owned runtime files with the exact SHA-256 fingerprints below. No blocking source/composition/behavior finding remains in that change.** HEAD remains `c6f6fafe4693dee3a5702b8fc18dec71e979ad69`; these new bytes are uncommitted at acceptance, so HEAD alone is not their identity. The author may commit these unchanged bytes with this harness/report. Any runtime change needs reconciliation with this manifest. No push/deploy was performed by this reviewer, and this disposition is not full item11 or full21 acceptance.

Final fresh command: `node verification/help-bubble-render.mjs`. **PASS, all six cases**, `/tmp/practice-help-independent-yOIBDn/results.json`. Each of1280/390/320 checks the real HelpBubble via Sandbox's actual InfoTip declaration and via the actual NumInput declaration nested in the real Radix Dialog. The nested fixture is a synthetic editor using those production wrappers/components, not the authenticated complete BusinessGoals screen.

- Hover reveals full methodology; keyboard Tab (or Shift+Tab from the following input) reaches the native help button and independently opens its tooltip. Help starts collapsed and its button measures32px after opening animations settle.
- Enter and Space each open the popover. Clicking its portaled text works inside Dialog without a focus trap intercept, parent click, or form submission. Escape closes help, returns focus to its trigger, and leaves the outer editor open. Touch tap opens and a second trigger tap closes help at every width.
- Tooltip and popover full text is present, finished animating with opacity1, inside viewport bounds and without horizontal text clipping. Document width does not overflow. All three dialog-popover screenshots are hashed in results; the reviewer visually inspected320 and1280. The320 image shows the full text wrapping within the viewport and the dialog's close control unobscured.
- Outer-editor cleanup uses its actual Close button. It does not assume a fixed Escape count across Popover, a tooltip reopened by restored focus, and Dialog.
- No browser exceptions or network requests; no owner profile, loopback service, authenticated API or production URL is used. Sources, imported dependencies, the harness and final utility stylesheet all matched before/after SHA-256 checks. The final run uses the author's final `index-DOR1HCDX.css`, not an earlier build stylesheet.

The complete dirty diff for the two existing consumers contains only help imports/delegation and replacing the BusinessGoals title-only label with a proper label plus help button. The new component uses Radix's existing trigger/content APIs, `type="button"`, a named icon button and stopped click propagation. No formula, schema, field value, save callback, payroll rule or billing calculation changed. Author-reported dashboard types,981 root tests and final build are supporting author evidence, not independently rerun by this reviewer. Parent reports zero Actions/checks/statuses for prior pushed commits; that absence is not a green CI result and says nothing about this uncommitted source.

### Retained Fixture Failures

Earlier failures remain under `/tmp/practice-help-independent-*`; none was deleted or silently counted as a passing run. The final harness retains every requested hover/focus/keyboard/touch assertion and adds post-animation opacity, real Dialog-state and geometric pointer-target checks.

| Retained run | What failed / disposition |
| --- | --- |
| `2P1HHp` | Waiting for hover tooltip to disappear after a single move to blank coordinates. Later diagnostics did not establish a component composition failure. The original trace alone cannot distinguish pointer transit, actual tooltip placement and focus; it is not labeled a proven product bug or a proven CSS fault. |
| `ETPgG1` |32px measurement during nested Dialog opening. The harness now waits for running animations. This run also used an earlier build stylesheet; no unsupported assertion that missing CSS alone caused the failure is made. |
| `I5o5H5` | Assumed forward Tab from the numeric input would reach a help button that actually precedes it; an extra Escape in the earlier hover transition could also affect the parent layer. The final test preserves the editor, checks it is open, and uses the actual Shift+Tab order. |
| `iCu8D8` | Both1280 behavior cases passed; cleanup expected the outer editor to close on a fixed second Escape. Restored trigger focus may reopen Tooltip, so another Escape can dismiss that layer. Cleanup now clicks the actual Dialog Close button; help's own Escape/focus assertion remains. |
| `lVVI4v`, `fA0lz1` | Hover-hide waits still failed. Subsequent geometry/focus diagnostics were added rather than declaring these passes or changing the component. |
| `9Gn0ey` | Playwright explicitly reported TooltipContent intercepting the hardcoded `#after` hover target. A hovered tooltip is allowed to receive pointer events; no pointer-event suppression was added to product code. |
| `OJRVGM`, `cXNKHY` | Diagnostics show active `#before`, help not hovered, pointer hits `#before`, and a `delayed-open` tooltip at x0/y76/288x78. That proves the observed state, not a lost forwarded blur: the help button had only been hovered, so focusing `#before` did not itself produce a help-button blur. A grace-listener timing hypothesis alone did not resolve it and was not promoted to a root cause. |
| `asY1gk` | Five full behavior cases passed; the320 nested case stopped at the guard proving the fixed heading anchor overlapped the tooltip. This was a fixture-target failure before the sixth case's remaining gestures. |

Final resolution: choose an actually hit-tested point inside the active fixture/Dialog outside trigger and visible TooltipContent; continue pointer movement after React effects; explicitly focus then blur the help trigger before the separate keyboard test. Plain Radix Tooltip controls at all three widths also dismiss after pointer exit. The resulting six help focus/blur and required interaction cases pass on the unchanged source. This establishes the tested dismissal transition; it does not retroactively claim every earlier pointer-only hide timeout was conclusively diagnosed. There is no demonstrated remaining keyboard/tap/composition bug in the accepted change.

### Accepted Follow-Up Fingerprints

| File / evidence | SHA-256 |
| --- | --- |
| `artifacts/comp-dashboard/src/components/practice/help-bubble.tsx` | `3fde6c8e51ddd1eb2dea231489184848b8db80cff553fec22e087aa184d976e5` |
| `artifacts/comp-dashboard/src/components/sandbox-view.tsx` | `b6ccbdb2b599028e2dd7cd93454b8f60d5387f29d5ae55f44a1f09dba2949a31` |
| `artifacts/comp-dashboard/src/components/tabs/business-goals-tab.tsx` | `d7eb03842ddba11e9c85ffcc8170968da17745afa1cec07feb8b407edc41a896` |
| `verification/help-bubble-render.mjs` | `945b9a2a819f8befcdb0e5a72c406ace6435ad1e40019d66306ecb5e75776cfd` |
| `/tmp/practice-help-independent-yOIBDn/results.json` | `a636bdf20596c62fd28748fc78fff1d1784412584843a9d8ed2fe95b6dfd4b4d` |
| Final `index-DOR1HCDX.css` utility stylesheet | `70de7535ab2d2f4a1f78a65e28f2fbd784ac50b9cb0b49c8c3ac5fed7ef56a43` |

The results manifest also pins Dialog, Input, Label, Tooltip, Popover and utility helper sources, fixture and JavaScript bundle hashes, plus three screenshot hashes. `git diff --check` passes. The reviewer created only this report and the new harness inside the repository, plus temporary evidence outside it. Main full-workspace14-state verification on the eventual exact follow-up commit remains the author's next check; it is not replaced by these six isolated interaction cases.

## Initial Evidence Fingerprints

SHA-256 before authored runtime changes:

| Evidence | SHA-256 |
| --- | --- |
| `/tmp/oct20-help-billing-probe.mjs` | `b454dd2424ee13ec557f7bcc70ddba5494b4d13bdb94846f7c9ef72c5885dc91` |
| `/tmp/oct20-billing-handlers.mjs` | `db0c0da91506a166b32b6540ebf29c2c4ed5e9f7cbf34571f9b63b9b19007e49` |
| `/tmp/oct20-help-billing-clean.tap` | `532502716f56d92392fae3d986de484f3a61d36b1363961924adb6bc5b0a1234` |
| `/tmp/oct20-help-billing-probe/results.json` | `c2010adae5ce7c19d400408eaaad78264dcdced66ba37d1a22379eed4e9a7eba` |
| Baseline `sandbox-view.tsx` | `45ef758cb774606dc00f0363d205eb3afa4fa6e77e9354e9574aa59f72092ba4` |
| `lead-flow.tsx` | `d28bb4aefa32b132a14630158436422906a7529b8370eb4a50b75f41ca89692e` |
| `workspace-calculations.tsx` | `26d6ad3d5944546e30ca3a004c0be3074aac85165c77779ca990118dd9f89699` |
| `historical-clinician-earnings.ts` | `1d8e9834185a5b8a5f50a0d4be5fdece40aa18c98ddaad726b0d05576970f1bd` |
| `artifacts/api-server/src/routes/practiceImports.ts` | `42251790fa3ee8e015b704ffe4f7d03771e4f552507078e7e1b69f9e3e8eaa30` |

## Additional Item 11 Paths: Independent Follow-Up

This addendum preserves the earlier checkpoint and failures. The author subsequently changed six more files while HEAD remained `c6f6fafe4693dee3a5702b8fc18dec71e979ad69`: TeamBuilder/CurrentReality/ScenarioBuilder NumField, LeadFlow, WorkspaceCalculations and LocalRetentionWorkspace. The previously accepted HelpBubble, Sandbox and BusinessGoals bytes are unchanged. The reviewer changed no runtime source and added only an independent companion harness, `verification/help-added-paths-render.mjs`, so the earlier accepted harness fingerprint remains valid.

**Bounded outcome: the added helper, RateLabel and disclosure changes pass the local checks below with no introduced formula, handler or JSX finding. Two direct staff-editor title-only help controls remain outside the repaired NumField path; therefore do not claim all concrete item11 gaps are closed at this checkpoint.** This remaining source finding is local and actionable, not an authentication blocker.

### Remaining Concrete Finding

**P2: Team Builder's StaffMemberDialog still uses passive title-only labels for Employer FICA and Other Burden.** `artifacts/comp-dashboard/src/components/tabs/team-builder-tab.tsx:280` and `:292` render direct `<Label title="...">` elements, not NumField. Neither label has `htmlFor`, and its adjacent input lacks an id/accessible label or description connection. The repaired NumField at line93 does not affect them. The descriptions are "Employer's share of Social Security & Medicare (7.65%)" and "Health insurance, retirement match, or other benefits". They remain keyboard/tap-inaccessible as explicit help controls. Other staff fields also use unassociated direct labels, but this finding is limited to the two actual methodology strings rather than expanding this help review into a general form audit. Author was notified before completion.

### Fresh Source Review

- Team Builder, Current Reality and Scenario Builder NumField now use a proper `Label htmlFor={name}`, matching Input id and separate conditional HelpBubble. All three actual helper declarations were extracted with TypeScript and hydrated, including the latent tooltip-prop paths in Current Reality/Scenario Builder. Existing onChange handlers remain byte-equivalent after whitespace normalization.
- LeadFlow has exactly four shared definition strings and exactly16 RateLabel uses: practice results, source-table headings, source totals and clinician-table headings. Each exact formula string occurs once, in the shared definition map. The rate helper, source grouping, totals, denominators, save/correction logic and handlers are unchanged by the diff. A40/24/20/10 fixture still displays60%,83%,50%,25%.
- WorkspaceCalculations wraps the existing visit-frequency branches and detailed established-ending paragraph in native details, without altering any conditional or numerical expression. The source builds successfully; no malformed closing JSX was found. Primary inputs, estimates and Use estimate actions remain outside the added methodology disclosures.
- LocalRetentionWorkspace moves import-format/storage text and definitions into collapsed details. Primary data-through dates, excluded count, fee-conflict/ambiguity counts, accepted-case count, stale-approval alert, attendance-conflict warning, PHONE alert, missing-roster warning and recent-gap list remain outside the new details. No import/package/coverage/billing-resolution mutation handler changed.
- The new harness parses all six changed files and compares **every original JSX event-handler attribute expression** with exact Git source at `8aa7c934` (whitespace-normalized): all match. Full component graph compilation through esbuild also passes. This check supports handler preservation; it is not an assertion that every possible runtime state was browser-tested.

### Fresh Tests and Rendering

```sh
node --test --test-reporter=tap artifacts/comp-dashboard/src/lib/lead-flow-rates.test.ts artifacts/comp-dashboard/src/lib/bulk-lead-flow.test.ts artifacts/comp-dashboard/src/lib/complete-report-coverage.test.ts artifacts/comp-dashboard/src/lib/retention-local.test.ts artifacts/comp-dashboard/src/lib/legacy-parity.test.ts artifacts/comp-dashboard/src/lib/team-attrition-units.test.ts
node verification/help-added-paths-render.mjs
```

**91 focused tests passed,0 failed/skipped**, `/tmp/oct20-expanded-help-tests.tap`. These are fresh independent results, not the author's larger root/type/build evidence.

**Added-path browser/SSR harness PASS**, `/tmp/practice-help-added-Fd1ark/results.json`, at1280/390/320:

- **21 hydrated help probes**: three actual NumField helpers plus four definitions in the actual hydrated LeadFlow practice-results view at each width. Each checks hover tooltip, focus tooltip, Enter popover, Escape trigger-focus return and touch opening/closing. Help content is fully opaque after animation, fits the viewport horizontally and has no horizontal text clipping. This is focused component behavior, not a new full-app layout/theme acceptance run.
- The actual hydrated source-view table, totals and clinician table each contain the matching four HelpBubble controls, establishing the other12 caption placements. Those twelve placements were not individually gesture-tested; mobile table-header visibility follows existing responsive behavior. Shared definitions were interacted with through the visible practice-results controls, and source totals retain their own visible labels. Do not equate DOM control existence with complete mobile table accessibility proof.
- **12 native disclosure probes** on actual SSR markup: four new details controls at each width begin collapsed; Enter opens, Space closes, touch opens/closes and body text changes visibility. WorkspaceCalculations and LocalRetentionWorkspace are server-rendered with actual components and synthetic imported snapshots, then inspected with native HTML interaction. Import/network/save hooks are not hydrated or certified by this part of the test.
- SSR synthetic conflicting billing and nonzero PHONE evidence preserves visible billing-review counts, excluded-row count and PHONE alert while definitions stay collapsed. Stale-approval and attendance-status-conflict states were source-reviewed but are not claimed as newly rendered fixture cases.
- LeadFlow's workspace/context fixture objects remain unchanged. No network requests or browser exceptions occurred in the passing run; no owner records or authenticated environment were accessed. Source/dependency, harness and stylesheet bytes were checked before/after. Six screenshot hashes and the complete source manifest are in results. The reviewer visually inspected the390 LeadFlow/field screenshot, with the limitations of a synthetic isolated fixture rather than the complete themed workspace.

Initial local setup refused an incomplete funnel fixture lacking required `spend` and `firstSessions`; adding explicit null test values fixed the fixture. `/tmp/practice-help-added-bp6YLa/failure.json` then retained an insecure-context `crypto.randomUUID` fixture failure before component mounting; fixed synthetic UUIDs resolve it. Neither failure is a product regression. No runtime source assertion was removed to produce the passing result.

### Additional Checkpoint Fingerprints

Acceptance below is for the added changes at these exact bytes, with the separate two-control staff-editor omission remaining open. It does not promote the overall21-item matrix or claim native/authenticated acceptance.

| File / evidence | SHA-256 |
| --- | --- |
| `artifacts/comp-dashboard/src/components/tabs/team-builder-tab.tsx` | `5117f1e4dd024b1a1a863c002a04d90651a940226afebb765b6d3bd200f6c0bc` |
| `artifacts/comp-dashboard/src/components/tabs/current-reality-tab.tsx` | `06fe590df19f7a59296061ef93b63090b60de97ca82a70cdcad5e50618dd6326` |
| `artifacts/comp-dashboard/src/components/tabs/scenario-builder-tab.tsx` | `8a4ba92ea55f9ecfdd9c643d38d98c05d13f601e05f87a6b8c83bcbdeffb17a8` |
| `artifacts/comp-dashboard/src/components/practice/lead-flow.tsx` | `053730fe393c303f12ecb323c60af45cf82e269514ed40fb190ebd74f9cc92e4` |
| `artifacts/comp-dashboard/src/components/practice/workspace-calculations.tsx` | `0127f25c5282e16ac36af8198ec1d7280bc5a66e2bdb88ddb9d6043168dd51ea` |
| `artifacts/comp-dashboard/src/components/practice/local-retention-workspace.tsx` | `c21bd40adac8f2dd5229470e5c2ec9b4f0b24b93bf0a2f46d313f053214bd9a7` |
| `verification/help-added-paths-render.mjs` | `d4a3e91ebd6c2943cd9aae0913401c48bb3daa29fa8784171f15d014ad536ae8` |
| `/tmp/practice-help-added-Fd1ark/results.json` | `1363931e6aa8c3c7fb4151803be80e6c84fd4c1cdee9eaf14ea23b6348bc8428` |
| `/tmp/oct20-expanded-help-tests.tap` | `f0b163f94b9e52a9ae0adcceb26ec6003f9cd21c52812877a57a9055d9381cb2` |

`HelpBubble` still matches `3fde6c8e51ddd1eb2dea231489184848b8db80cff553fec22e087aa184d976e5`. This run uses the same final utility CSS hash `70de7535ab2d2f4a1f78a65e28f2fbd784ac50b9cb0b49c8c3ac5fed7ef56a43`. No reviewer commit, push, deploy or real-data interaction occurred.
