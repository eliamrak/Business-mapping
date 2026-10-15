# Working Forecast External-Review Repairs

Base: f2be9f19d87b1d12285b66c31cd8f5e24386497a, explicitly blocked by independent external review. This is a replacement review candidate, not approval to publish. No main change, deployment, migration or business-record edit was performed.

## Eight Findings

1. Overlapping billing exports: reconcile encounter coordinates and source hashes globally before team/date filtering. Shifted parser row indexes produce $150, not $250. Conflicting amounts or indistinguishable repeated encounters are unknown. Distinct codes remain distinct. Raw snapshots remain unchanged. Tests: parser-billing-evidence.test.ts; reported-billing.test.ts.
2. PHONE-only replacement: zero PHONE fees do not replace unrelated treatment estimates. Paid PHONE charge facts remain visible in reported fees, but revenue classification is unapproved and affected modeled revenue is withheld. Partial treatment-day billing cannot replace a whole modeled day without matching evidence. Tests: parser-billing-evidence.test.ts; working-forecast.test.ts.
3. Former-clinician referrals: filter consultation cohorts by current consultants, retaining all treatment follow-up evidence. Known successful internal referrals remain conversions, not misses. Tests: retention-local.test.ts.
4. Off-team headcount: working monthly and daily goal counts exclude onTeam=false. Historical actual membership is not rewritten. Tests: working-forecast.test.ts.
5. Dated current consultation roster: common helper honors selected team, active status, onTeam, and inclusive start/end dates at explicit asOf. Future/ended profiles cannot enter current cohorts silently. Tests: practice-scope.test.ts.
6. Working room utilization: unknown, not fabricated zero. Uncapped working volume does not establish room assignment/use. The coverage-gated observed Rooms demand remains separate. Tests: working-forecast.test.ts.
7. Current-year progress: actual Jan1 through asOf plus exact dated forecast asOf+1 through Dec31. No overlap, next-year spill, retrospective forecast fill or invented complete YTD. Reported actual charges are shown separately; missing actual financial coverage withholds combined totals. Actual ledger aggregate costs are explicit, not invented separate zero fees. Tests: practice-financial-range.test.ts; working-forecast.test.ts; working-period-repair-render.mjs.
8. Shared Money period: selected dates govern charges, financial bridge and detailed flow from one range result. Past-only selections have no forecast fill. January/February browser fixtures change charges $33,035/$31,370 and actual earned revenue/profit $1,000/$2,000. Monthly source editors remain available under collapsed, separately labeled editing controls; their month follows the selected range end. Tests: practice-financial-range.test.ts; working-period-repair-render.mjs.

## Additional Integration Controls

- Global billing conflicts remain visible after date/team scope; invalid service dates keep selected aggregate charges unknown.
- Actual $1,000 earned revenue minus $200 compensation minus $100 recorded operating expenses reconciles to $700 actual profit. Unclassified processing remains null, never an invented zero line.
- Dated future slices preserve calendar-month salary/owner-pay denominators, event boundaries and variable budgets. Missing prior full-month collection evidence keeps delayed receipts and accumulated cash unknown.
- Working ROAS, contribution ROAS and net ROI remain unknown even when marketing budgets exist without campaign rows.
- Future balance observations cannot become historical fund balances. A nonmonthly or actual-only selection cannot be treated as a monthly future fund-contribution rate.
- A mobile child-geometry assertion prevents long current-year labels from squeezing/clipping currency values. Unsupported combined-year charts are replaced by an explicit incomplete-coverage state.

## Verification

- 585 domain/dashboard tests passed. Five database-free API report-coverage tests passed. No authenticated database suite was run.
- Library, dashboard and API typechecks passed. Dashboard and API production builds passed, retaining existing sourcemap/mixed-import/large-bundle warnings.
- Independent reviewer Nietzsche rechecked all eight numeric blocker controls, plus the two integration findings identified during this repair. Its final bounded pass found no remaining defects in those controls. The reviewer ran 584 full tests before the final additional working-ROI control; the author subsequently ran 585/585. This is not external exact-SHA publication approval.
- Synthetic browser acceptance: 45 main-workspace, 15 roster/pay, two future-revenue and six targeted period/year captures, plus focused mobile screenshots. All use isolated Chromium, frozen clock, localhost and mocked APIs. Targeted period/revenue probes assert zero writes and zero browser errors; author workflow mutations are mocked only.
- Screenshots/JSON: verification/practice-workspace-render/. Targeted evidence: working-period-repair-results.json; focused images money-selected-january-flow-mobile.png and current-year-financial-summary-mobile.png. Full trace: METRIC-TRACEABILITY.md inventories all42 registered metrics and extra clinical/legacy measures, with limits.

Reproduce from the repository:

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts
node --test artifacts/api-server/test/practice-report-coverage.test.mjs
corepack pnpm run typecheck:libs
corepack pnpm --filter @workspace/comp-dashboard run typecheck
corepack pnpm --filter @workspace/api-server run typecheck
PORT=4318 BASE_PATH=/ corepack pnpm --filter @workspace/comp-dashboard run build
corepack pnpm --filter @workspace/api-server run build
PORT=4318 BASE_PATH=/ VITE_LOCAL_PREVIEW=true corepack pnpm --filter @workspace/comp-dashboard run dev --host 127.0.0.1
PRACTICE_PREVIEW_URL=http://127.0.0.1:4318 node verification/working-period-repair-render.mjs
PRACTICE_PREVIEW_URL=http://127.0.0.1:4318 node verification/render-practice-workspace.mjs
PRACTICE_PREVIEW_URL=http://127.0.0.1:4318 node verification/staff-configuration-render.mjs
PRACTICE_PREVIEW_URL=http://127.0.0.1:4318 node verification/revenue-repair-render.mjs
```

## Genuine Policy Questions and Safe Behavior

1. Latest-report versus today anchoring for each clinician's available three-month history. Current estimate anchors at the latest available report; dates/basis are disclosed. Later unreported days are not invented zeros. A common as-of/staleness policy still needs confirmation.
2. Partial treatment-day billing: per-visit replacement versus verified complete-day replacement. Current code withholds unsupported whole-day replacement. Complete matching proof is required; one known charge cannot establish the day's entire fee total. No per-visit financial policy was invented.
3. Percentage compensation fee basis: configured contractual rates versus actual charged fees. Current modeled compensation follows configured terms and discloses that assumption; another agreement is not inferred from billing.
4. Nonzero PHONE revenue classification: whether paid consultations belong in billable consultation revenue requires business/source evidence. Zero PHONE never erases treatment income; unapproved paid consultation model revenue is withheld. Reported-charge facts remain separate.

The referral and dated-membership issues are repaired defects, not deferred questions. Negative-fee CSV/package ingestion remains unsupported; core signed arithmetic is not an end-to-end import claim.

## Publication Hold

Parent must route the new exact SHA to external re-review before publication. Direct reviewer messaging was rejected by the messaging authorization gate; no workaround was attempted. Explicit human authorization would be required to send directly to that task. Existing automatic parent handoff remains available.

Production remains unchanged, so no new live verification is claimed. Preserve all real settings, imports, targets and histories. Backout after any future approved code deployment is a normal code redeployment; these repairs require no database rollback. Do not revert deliberate user data edits when reverting code.
