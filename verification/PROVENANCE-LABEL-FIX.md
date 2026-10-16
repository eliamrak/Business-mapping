# Selected-Period Provenance Label Candidate

## Bounded Changes

No compensation, session, conversion, retention, ending, fee, fund or goal equation is changed. No API write, database schema, metadata save, declaration or billing approval is changed. The completed real-account reconciliation is separately preserved in `REAL-ACCOUNT-JANUARY-RECONCILIATION.md`.

1. Initial retention gets a separate in-memory `initialRetentionCoverageVerified` flag. It requires continuous selected-window attendance proof and continuous proof from each selected initial treatment start through its third qualifying visit or its 28-day failure-observation deadline. As-of clipping, coverage gaps and relevant excluded follow-up remain unsafe. Existing history-wide `coverageVerified` flags and all clinical numerators/denominators remain unchanged. Sessions, Team and Overview initial-retention labels use the selected flag consistently.
2. Money month labels say `(partial selection)` only when selected actual dates do not enclose that whole calendar month. Invalid/missing selection is labeled unverified. Full selected January is not called partial merely because the billing summary's as-of is January 31. The billing helper's elapsed-month averaging flag and charged amounts remain unchanged. Selection extent does not certify source coverage.
3. Financial limitations are separated into selected-period issues, other dated source history/report boundaries, and current forecast baseline. Selected proof gaps and actual-cost unknowns remain in selected limitations. Broader incomplete first/last periods and rolling forecast bases remain visible under clearly separate collapsed headings, rather than implying they are January actual-data gaps.

## Exact Cause And Production Boundary

Source and synthetic evidence establish the retention-label mechanism: the old clinician history flag required no excluded follow-up anywhere, so raw positive rows after the admitted cutoff could invalidate a historical label without changing its covered observations or metrics. The practice flag used a different history interval check. Explicit mappings/copy identities are included in the synthetic regression and are not themselves the cause.

The frozen production reconciliation did not expose excluded-tail metadata. Audit-only main `b93321c` extends the reviewed SELECT with a separate `retention_provenance` aggregate for all 14 rows: unresolved partial follow-up count, count after admitted attendance through, legacy clinician label flag, and selected retention coverage flag. The extension preserves the original numeric projection and exports no client/source keys. It passed the 17 synthetic SQL checks and independent review. Cloud worker should run that SELECT through the existing authorized production SQL UI before claiming this exact mechanism is confirmed on the real account. No additional owner decision, credentials, data export or metadata edit is needed.

The partial-month cause is directly established by the live symptom and source call: `practiceFinancialRange` passes `actualEnd` into `summarizeReportedBilling`, which compares month with that same as-of month for `fullyElapsed`. The UI previously used that flag as a selection label. Global warning propagation is likewise directly established: all source incomplete periods and rolling clinician pace reasons were previously appended into one selected-range warning array.

## Verification

- 672 domain/dashboard tests pass, including seven new retention provenance guards and two warning-scope regressions.
- Two provenance characterization tests retain the old-history discrepancy while verifying the new display flag and month-selection label.
- Dashboard typecheck and production build pass. Existing nonfatal Vite source-map/chunk warnings remain.
- Synthetic SQL extension: 17/17 tests pass. No production execution was performed locally.
- Independent review and final desktop/mobile render results accompany the frozen candidate handoff.
- Render verification completed: 51 synthetic captures at desktop 1280x900 and mobile 390x900, including six focused full-January/partial-selection/individual-retention states. No horizontal overflow; focused desktop Money and mobile retention screenshots visually inspected. Evidence: `/tmp/practice-provenance-render/metrics.json` and adjacent PNGs. This is mocked UI verification, not production auth or real-data acceptance.

Frozen runtime candidate: `3f5ad92c5bebedc2d740b9ebb8c88b84abf2f689`, tree `808cc4e9c0df1e75eb6ea8175ca2d52d67b4ad01`. Independent reviewer Newton reports PASS/no blockers on that exact candidate, independently ran 98/98 focused tests and dashboard TypeScript validation, verified reviewed runtime matches HEAD and inspected the 51-state/no-overflow render metrics. It did not independently rerun the browser captures or authenticate production. Some synthetic captures contain the expected local Clerk script-loading failure; production auth is not certified by those screenshots. Subsequent changes update verification source pins/docs only.

## Existing-Environment Release

Cloud follow-up, October 16 at 16:08 UTC: the exact reviewed production SELECT completed READY. All 14 January selected-retention coverage flags are true, and all six legacy clinician flags are false because their excluded partial follow-up rows all fall after the admitted attendance cutoff (Erin 6, Elia 4, Natalie 4, Michele 5, Jessica Cockrum 2, Jessica Yates 2; practice deduplicates to 22). This confirms the exact production mechanism previously established only by source/synthetic evidence. January numbers, declaration revision 1, four approvals and zero original gate/PHONE anomalies are unchanged. Cloud is proceeding with only frozen `d8d67f8` / runtime `3f5ad92`; newer historical-billing code is explicitly excluded. Completed deployment/new-asset/live-label verification remains a separate result not yet supplied locally.

1. Confirm the extra production provenance aggregate and review the candidate's synthetic desktop/mobile states. Preserve current runtime and all existing source/declaration/journal fingerprints.
2. Publish only the reviewed runtime candidate to the existing app. No migration, source import, balance/goal update, approval reapplication or workspace save is required.
3. Recheck January 15-28 and January 1-31, all six clinicians and Whole Practice. Initial retention labels must agree with the selected coverage calculation; a genuine follow-up gap must still say unverified. Full January is not partial; biweekly January is a partial selection. Selected limitations must not contain unrelated October unfinished-period or rolling-baseline claims.
4. Independently confirm the frozen January numeric table and all preservation fingerprints remain unchanged. Charges remain distinct from unknown costs, cash and profit.
5. Backout is prior runtime `61fc038`, retaining all declarations and approvals. Do not delete or rewrite stored data. Candidate production deployment/live verification are not performed by this local author.
