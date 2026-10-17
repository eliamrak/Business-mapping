# Billed Gross And Current-Pay Correction

## Frozen Runtime

Branch `codex/estimate-billing-diagnostics`; runtime/test HEAD `cfd02ab724fdde7d8dc020326333ab9ec647e275`, tree `3647deb33b7fd20fa2ba34c43f74127434ea122f`. Includes bounded correction `1dbfac4` and reviewed split-precedence repair `cfd02ab`. Based on published candidate/evidence `81bc7e6`. Local only: no push, deployment or business-data writes in this correction task.

## Diagnosis And Changes

The parent supplied live September 24-October 7 observations: $17,425 reported charges; 115 accepted rows from 226 source rows, 111 duplicates; six complete provider periods; 107 treatment sessions; configured collection/processing inputs. This task did not independently read the live source records.

The estimate conflated accepted billed gross with treatment-compensation classification. It treated paid legacy consultation `30003` and documentation `2` as invalid nonzero PHONE charges. The existing source-derived legacy fixture explicitly preserves $60 consultation and $25 documentation fees, while marking neither service as free PHONE or treatment. That code path can blank otherwise verified gross and consequently percentage processing. Zero-valued unclassified rows also unnecessarily poisoned monetary totals.

- Accepted gross, modeled revenue and treatment-compensation eligibility are now separate. Paid consultation/documentation fees remain business revenue, not treatment visits or treatment-percentage pay. The latter exclusion preserves the existing compensation engine's service classification. Positive unclassified charges retain known gross/percentage processing but withhold uncertain treatment compensation. A zero-valued unknown code neither invents service meaning nor invalidates a monetary zero.
- Nonzero free-PHONE anomalies retain their original billed gross for review, while withholding affected modeled revenue/profit. No charge, code, source hash or approval is changed.
- Warning reasons distinguish admitted-source/reconciliation failure, unclassified compensation basis, profile-date gaps, unknown cap progress, invalid processing settings and missing processing revenue/count bases. Known settings are no longer generically called missing because revenue propagated null.
- The optional **Current pay assumptions for earlier gaps** selector explicitly applies current configured pay only before the earliest profile configuration for clinicians with recorded work. Default remains **Respect configured pay dates**. The selection is local UI state, not a saved setting. It carries across Money, Overview and Goals; disclosures distinguish the scenario from historical pay facts and completed actual achievement.
- Known historical terms win first; current effective terms win over legacy clinician cards in the opt-in scenario. A 0% current term cannot fall through to a stale 60% card. Known earlier salary remains usable despite a later profile configuration. Unknown annual cap position remains unknown; no zero cap opening is invented.
- Session components have explicit numeric units, so 107 sessions are not formatted as $107.
- Related independent review found reported billing reconciled only after eligibility filtering. It now reconciles all retained evidence first, selects an admitted representative only for ordinary identical duplicates, and preserves exact approved-charge anchors. An excluded conflicting payload cannot become a known charge; an eligible copy cannot replace an excluded approved anchor. Actual completeness/finalized-period rules are unchanged.

No SQL, schema, migration, API handler, transaction, persistence format, compensation engine, stored assumptions, import records or converter files changed. Arbitrary-alias findings were not revived: the supported declaration API rejects aliases beyond normalized case/whitespace matching.

## Evidence

- Author: 733/733 domain/dashboard tests, 30/30 bounded verification tests and 40/40 pure API/import tests pass. Dashboard TypeScript/build and diff validation pass; existing Vite large-chunk advisory remains. Built asset `index-DBqcZbGX.js`.
- New synthetic six-provider fixture independently matches the supplied aggregate shape: 226 source / 115 accepted / 111 duplicate charges, $17,425 billed gross, 107 treatment sessions. Configured 100% collections, 3.15% fee, $0.30 fixed fee and one payment/session yield $580.9875 modeled processing. Historical profile gaps still withhold compensation by default; explicit current-pay scenario can compute it without rewriting history. This is synthetic regression evidence, not reproduction of private business records or certification of their exact compensation/profit.
- Additional tests cover paid legacy services, unknown service eligibility versus known gross, nonzero PHONE policy, current 0% over stale 60%, historical 40% precedence, earlier salary precedence, unknown cap withholding, five approved exceptions, global conflicts and source immutability. Recorded `actual.complete` remains false and actual profit null without independently complete recorded actuals.
- Independent reviewer Zeno (`01a14baa-a7ed-7489-8c52-34bd348100f2`) verified exact runtime/tree, ran 733 tests plus 12 independent numeric checks, and approved the bounded runtime with no remaining findings. Its initial current-split P1 was repaired before final approval. Review was read-only and did not include browser reruns.
- Author final mounted-page Playwright: 16 desktop/mobile states at 1280/390px, zero browser errors, zero horizontal overflow, only synthetic loopback GETs and no writes. Includes numeric session rendering, known gross with historical pay gap, explicit scenario, current 0% versus stale card, estimate/actual distinction, unknown-source state, navigation and circles. Screenshots/results: `/tmp/financial-completeness-render-jR2zh6/`; author inspected both current-pay detail captures. Machine results: `BILLED-GROSS-CORRECTION-RENDER-RESULTS.json`; harness: `billed-estimate-render.mjs`.

## Remaining Boundaries

Fresh live reconciliation of this correction has not occurred. The browser/release worker must verify the fixed September 24-October 7 totals and both compensation bases after any separately authorized release. Genuine unclassified positive charges, conflicting evidence or unknown cap positions must remain visible rather than being silently financed by assumed values. Remaining authenticated lead/save/reload/reimport/export workflows from the prior handoff are not newly certified here.

The earlier fresh synthetic Postgres integration limitation remains: host shared-memory exhaustion prevented initialization. No database setup or system setting was changed or retried for this computation/UI correction. Pure API/import tests are not database integration acceptance.

Logs use `/tmp/practice-billing-fix-*`. Code-only backout to `81bc7e6` requires no database restoration; retain every existing owner record, declaration and all five fee approvals. No deployment performed.
