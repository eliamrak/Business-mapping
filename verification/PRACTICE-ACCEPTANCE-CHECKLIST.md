# Practice Acceptance Checklist

Audit baseline: main `1637a23a7adf6ff0c4a23631efcbe62255bdf81d`, tree `35a1124546f8d7d61fb94d2669865b00fda9d0c6`. Agreed UX/measurement requirements are represented by the UX Working Map sequence 27, preservation plan and current metric contracts. This is a prioritized acceptance ledger, not a whole-app PASS. Historical checklists and passing test counts do not certify current business inputs.

**Evidence tags:** LIVE-PARENT = bounded live result relayed by the authorized release worker, not a new local production read. AUTOMATED = source/model/mocked-browser verification. FAILED-BASELINE = a reproduced defect on this baseline. UNTESTED = not established by available evidence. MISSING-EVIDENCE = required actual/configuration/reconciliation evidence is not available to this audit; this does not imply an existing database record is absent or was deleted.

## P0: Preserve Data And Decisions

- [x] **LIVE-PARENT:** Rooms release serves `index-C-iRSPSV.js`, published 13:52:13 UTC; all 11 preservation fingerprints, declarations and the full audit comparison were unchanged, and the four explicit fee exceptions remain retained. Declaration revision remains 1. This task makes no production connection or mutation and must not reapply those approvals.
- [x] **AUTOMATED:** Exact source guards, scoped append-only approval journal, reimport idempotence, pinned provider/source evidence and unchanged raw import records are covered by existing audit/API/model tests. Any code rollback must preserve deliberate owner records and approvals, not restore an old database.
- [ ] **UNTESTED:** Fresh production preservation/read-back checks after this next candidate. These belong to release coordination if the candidate is approved, not to a local claim of live acceptance.

## P1: Trustworthy Actuals And Measurement

- [x] **AUTOMATED:** Recorded billed fees, future clinician-card estimates and cash are separate. Complete service-period admission precedes billing reconciliation; incomplete periods and unknown costs are not zeros. Actual percentage compensation uses accepted fees, while future working revenue does not reuse historical billing as free revenue. See `METRIC-TRACEABILITY.md`, financial-range and working-forecast tests.
- [ ] **MISSING-EVIDENCE / UNTESTED:** Actual expense, payroll, bank/collection and fund-balance reconciliation has not been supplied to or performed by this local audit. Trustworthy actual profit/cash requires independently complete, finalized ledger/receipt/payroll evidence. A null actual remains null. Do not assume that a configured salary, modeled allocation, billed fee or blank balance is a reconciled payment or bank balance.
- [x] **AUTOMATED:** Sessions and working pace use complete canonical periods and included calendar days; partial aggregates are not prorated. PHONE is not treatment. Initial retention requires three treatment sessions with the agreed 28-day initial gaps. Endings require mature 90-day covered follow-up and later-return handling. Consult conversion uses one calendar month, counts the practice journey once and protects internal referrers.
- [ ] **UNTESTED:** Every real clinician/cohort/period value and the complete account-wide annual mathematics. Existing synthetic controls and live preservation fingerprints are not that certification. Unresolved clinician closer attribution, if any remains in the live account, needs the actual closer recorded through the existing review workflow; do not infer it from a treatment-start candidate.
- [x] **AUTOMATED:** Financial session goals include typed owner pretax distributions, fixed co-owner salary, profit and recurring fund contributions, with dated cap/salary/cost transitions and known capacity. Missing mix/cost/capacity inputs withhold certification. Total fund-balance goals are not recurring annual expenses.
- [ ] **MISSING-EVIDENCE:** Where required assumptions or actual observations are genuinely absent in the app, their real values must be entered by the owner or obtained from the source record. Zero-valued goals are still editable, not seeded business facts or a reason to block the build.

## P2: Current Reproducible Display Defect

- [ ] **FAILED-BASELINE:** Money labels an unentered balance as "$0 recorded anchor". Goals labels it "Current recorded balance: $0 when blank" and gives its bar a Recorded legend. An entered amount without a date is also called recorded. This contradicts the agreed distinction between explicitly assumed $0, entered data and dated recorded observations.
- [x] **AUTOMATED CANDIDATE REPAIR, NOT YET LIVE:** The fund provenance repair distinguishes assumed-zero, entered-undated, dated recorded balance and later-than-selected-period unavailability. Captions and legends consume the same evidence state. Stored values, dates, dollar arithmetic, projections, goal achievement rules and save paths are unchanged. See `FUND-BALANCE-PROVENANCE.md` for exact candidate and review evidence.
- [ ] **UNTESTED:** Live owner acceptance of those corrected captions after release. Do not claim bank reconciliation or fabricate a balance/date to make the visual look complete.

## P2: Timeframes, Team, Rooms And Visuals

- [x] **AUTOMATED:** Shared valid/custom dates carry across tabs, contributor changes retain dates and top-level changes reset to Whole Practice. Blank/reversed custom edits remain local and explicitly name the last applied range. Previous date regression covers 28 invalid-input cases across seven views; current broad rendering preserves those controls.
- [x] **AUTOMATED:** Top navigation, separate Today/Long Term Goals, Sessions clinical panels, Growth/Rooms, valid-percentage circles with practice markers, comparison bars and Goal/real-limiter labels remain in the established layout. Clinical KPI cards precede nonclinical staff; pay structure remains separate. Team attrition uses mature calendar months, not client-month exposure.
- [x] **LIVE-PARENT + AUTOMATED:** Live Rooms has seven review-only locations and displays 0 configured slots/0 hours. That is a truthful configuration state, not a software defect. Nonzero/future/expired/date-boundary cases are synthetic controls. Both headline values now use the same dated configured-room scope.
- [ ] **MISSING ACTUAL CONFIGURATION:** Nonzero physical-room feasibility requires actual opening hours or recurring blocks, session minutes, usable percentage, effective dates and shared/dedicated assignments. Imported location names do not supply those facts. Keep the existing editors; no guessed room setup or default hours.
- [ ] **UNTESTED:** Final owner visual preference acceptance, exhaustive keyboard/assistive-technology/zoom coverage and every narrow Mac-window/native-wrapper state. Existing desktop/mobile captures establish bounded rendering, not all of these.

## P2: Operational Completion And Planning

- [x] **AUTOMATED:** Existing editors, saved scenarios, advanced compensation tools, source history, imports and review/save paths remain reachable. This candidate does not add an automatic save or alter API/database formats.
- [ ] **UNTESTED:** All authenticated live edit/save/reload/correction/import/export/backup workflows after the current series of releases. Current mocked saves and source tests must not be described as a new authenticated database integration run.
- [x] **AUTOMATED:** Three focused Long Term alternatives and explicit adoption/review paths are preserved. Missing assumptions lead to unavailable/unranked outcomes, not invented impact. Saved scenarios remain available separately.
- [ ] **MISSING-EVIDENCE / OWNER ACCEPTANCE:** Meaningful practice-specific plan comparisons require sufficiently complete goals, clinician mix, dated costs/capacity and relevant funnel assumptions. Selecting/adopting a plan remains the owner's explicit choice. No new interview is needed to repair already settled navigation or measurement decisions.

## Next Release Gate

No owner input is needed for the fund provenance repair. Exact runtime `f64aa0fc1fd9ff8d8ec842f673c6c2b812ce9d62` (tree `f96dfa6a2a7e36001f715f2ea4996789d711b78a`) passed independent bounded review: 29 focused tests, dashboard typecheck and diff validation; no findings. Coordinator evidence is 663 domain tests, 16 aggregate/identity-audit tests, 51 rendered states and dashboard typecheck/build. Browser captures were not independently rerun. See `FUND-BALANCE-PROVENANCE.md` for reviewer provenance and limits.

The reviewed candidate still needs release coordination approval/main promotion/deployment and live acceptance; none occurred in this task. A normal code release requires no migration, no production fixture seeding and no balance/room/payroll edits. After deployment, verify corrected blank/entered/date states read-only where available, preserve all fingerprints/declarations/approvals and continue the UNTESTED/MISSING-EVIDENCE items separately. Do not turn this checklist into a claim of complete business reconciliation.
