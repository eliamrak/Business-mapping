# October 21 consolidated live-call implementation

Authority: user message Sentinel_01600d255a148191b6e68e12680b5047, replying to consolidated plan Sentinel_5410c53886e881919291a307ad3228ab. This is the newer implementation scope, not a claim that the October 19 checklist or owner screen acceptance is complete.

## Implemented scope

| Requirement | Implementation / verification |
| --- | --- |
| Distinct compact Overview KPI cards | Scoped overview-historical-summary component/CSS; simultaneous recent/year PercentageKpi rings, labeled baseline markers, exact differences in disclosures, relative period titles, dates on demand |
| Caseload / target 5 / 32% / 1.6 actual | Caseload heading; desired weekly target is primary context, actual weekly pace secondary; component regression verifies 5 and 1.6 yield centered 32%; above-100 actual percentages stay explicit |
| Configurable performance markers | Optional settings.performanceTargets retentionPct/closeRatePct/attritionPct; editable in Goals, no inferred defaults; labeled green markers; serialization, null clearing and range validation tests |
| Sessions period clarity | Total sessions alongside relative selected period or explicit Custom dates; no generic selected-window total; redundant scope lines and outer duplicate coverage warning removed; close-rate ring kept and ordered before counts on narrow screens |
| Clinician shorter available history | Clinician range resolver uses admitted attendance proof, not first visit/upload/profile start; clips only outer unavailable bounds, keeps internal gaps unknown, preserves calendar denominators/maturity/follow-up; distinct requested/effective dates accessible. Six-month versus three-month regression retains correct different weekly denominators. This is not confirmed employment tenure. |
| Safe comparisons | Same-name ID resolution restricted to workspace team; mixed effective windows retain ranges and suppress mismatched Whole Practice markers; single rings use same-window practice results |
| Money month selection | Separate month input and Last month control; selected-month baseline observations capped at min(today, selected month end); undated historic assumptions disclosed, not represented as saved historical snapshots |
| Existing-clinician baseline | Current existing active clinician intersection; hiring mechanisms excluded from Money baseline, preserved in workspace/Sandbox |
| Inline allocation planning | Current allocation percentages directly editable, distinct from profit/planned percentage floors; overhead, processing and marketing dollars and quarterly tax estimate inline. Current dollars/gap outputs react (6% of $35,000 = $2,100). Optional moneyPlanning.currentPercents preserves original percentages until edited; totals above 100% warn without normalization or blocked saving, individual invalid/blank percentages cannot stage. Existing stage/review/save remains; mocked end-to-end save/reload and validation coverage, not production writes. Mobile uses labeled stacked rows. |
| Honest tax unknown | Quarterly tax planning input absent and no tax budget means Unknown; saved quarter input /3 uses existing monthly estimate field. A 3% allocation is not an inferred tax liability. |
| Collapsed financial methodology | Cost estimates/source periods, observed planning basis and other non-actionable assumptions collapsed by default; missing tax input and genuine deficits remain visible |
| Goals information boundary | Targets, dated fund balances and monthly funding goals in Goals, not ordinary Money; owner salary/distributions/profit labels and target periods concise. Existing IDs/amounts/mapping retained; headcount growth removed from ordinary target rows but preserved for scenarios. |
| Goals overhead and help | Fixed-dollar/percent basis, equivalent uses same saved revenue override as Money (including explicit zero/null), small radios, saved/recorded metadata collapsed, optional deadlines collapsed, inline label/help controls; no overhead percentage circle |
| App hierarchy | Forecast controls collapsed on Overview; generic section help beside heading; Sessions historical help attached to its heading; mobile layout and keyboard/tap help acceptance included |

## Independent review

Independent code review found four defects during implementation: mismatched-period comparison markers, cross-team same-name lookup, month-start salary replacement of valid prorated payroll, and overhead equivalents ignoring saved revenue overrides. All four were repaired; reviewer independently rechecked original fixtures and reported no remaining code-review blockers (61 targeted tests).

Independent visual review examined twelve full-page desktop/mobile images and component-only ring previews. It accepted revised Goals overhead/help/deadlines, Overview ring hierarchy and reduced preamble, and Sessions close-rate/period composition. It correctly found clipping at 320px that document-overflow-only assertions missed; final acceptance must include actual cell/editor bounding checks, not just a zero document overflow result.

Final independent visual follow-up inspected `/tmp/practice-oct21-live-call-qXtajx/money-320.png` and `overview-390.png`: prior P1 clipping resolved, labels/inputs fit, editable Current % distinct from planned floors, paired rings readable without overlap. No blocking visual issue remained in those captures. Minor polish: right-column Period dates can wrap while the left stays on one line. This does not certify every expanded state or native UI.

## Test receipts and limits

Canonical regression command (includes the old 984 coverage plus new cases):

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts verification/profit-first-planning-input.test.mjs
```

Latest numerical/component run: 1039 tests passed, zero failures/skips; log `/tmp/practice-oct21-consolidated-tests.log`. Dashboard/API type checks and web/API builds were run. Local pnpm was unavailable, so the equivalent existing TypeScript, Vite and API build entrypoints were invoked directly, without installing dependencies. Web build uses PORT=23894 BASE_PATH=/; deployment-specific injected public values must still be preserved in the publisher.

Integrated synthetic harness: `verification/october21-live-call-acceptance.mjs`; isolated loopback server and new browser context, no production access. Final receipt `/tmp/practice-oct21-live-call-qXtajx/results.json`: 15/15 pass. Checks all four pages at 1280/390/320, every mobile allocation cell/editor's bounds, selected-period changes, collapsed defaults, keyboard/tap help, Money save/reload including direct percentage recalculation and performance-target save/reload. Earlier failed receipts remain adjacent and are not counted as passes. Independent follow-up review of the current-percentage addition found no blockers (37 focused tests).

Separate real Chrome page zoom receipt: `/tmp/practice-oct21-zoom-8Zgya6/results.json`, 36 checks / 30 captures, 100/200/400% page zoom, no writes/browser errors. This is bounded navigation/heading/reflow/focus evidence in an owned synthetic profile, not exhaustive high-zoom content or VoiceOver acceptance.

## Data and release safety

No production records, imports, mappings, balances, compensation, allocations or coverage approvals were changed. Synthetic writes terminate at mocked loopback routes. No SQL migration or seed is required; performanceTargets is optional/backward-compatible. No owner scope/date, tax rate or employment start was invented. Billed fees, planning estimates and reconciled cash remain distinct; no bank/payroll reconciliation was requested.

Publish only the reviewed source delta on top of the existing publisher history, preserving .replit, artifact contracts, publisher-only memory files and all existing commits. Keep copy-development-database OFF. Preserve current source/config metadata before and after publication; use existing rollback branch/source history, not destructive resets or data restoration. Runtime publication and authenticated postrelease verification are separate gates from this source receipt.

Installed Mac/WKWebView and VoiceOver acceptance remain unverified: no supported native controller and no existing Accessibility trust. No permission was requested or bypassed. Exact October 19 observation/scope reconstruction remains an acknowledged historical limitation, not a release-blocking demand to recreate unavailable history. Owner review of the new cohesive result remains open.
