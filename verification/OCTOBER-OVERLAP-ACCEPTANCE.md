# October 10 Overlap Candidate

Publication HOLD. User says the next upload repeats October10 and supplied two possible through-dates. Their billing/attendance mapping and report start date remain unconfirmed; no dates or completeness metadata were written or inferred from observed endpoints. All implementation and renders use invented fixtures only.

## Non-Destructive Upload Review

- An overlap still stops for review by default. The primary action is Keep history and reconcile overlap. It sends explicit retainOverlaps=true, preserving original rows, hashes, active snapshots/packages and settings. Existing manual replacement remains a separate, explicitly labeled choice that warns it archives entire overlapping snapshots, including dates outside the new export.
- Retain and replace are mutually exclusive. Retain inserts the new provenance and audits retained/replaced counts atomically; it never updates old source active flags, settings or facts. Exact package/source+proof duplicates remain idempotent.
- Same kind/hash with different coverage proof is NOT inserted as a second active public identity. Retain returns409 COVERAGE_REVIEW_REQUIRED before writes and directs the user to the existing per-import coverage editor. No automatic coverage change or duplicate identity is introduced. Explicit replacement remains available separately.
- Raw overlapping facts can remain in distinct immutable exports for provenance. Clinical counts and billed-fee summaries reconcile them; retaining provenance is not permission to add repeated fees or visits to actual totals.

## Evidence Reconciliation

- October10 identical visits/fees count once even when row positions, export hashes and source-row hashes differ. One client + normalized clinician + date remains one treatment visit by default; pre-existing explicit same-day extra-visit confirmations remain supported.
- Changed same-encounter fees are conflicts/unknown, never an upload-order winner or a sum. Separate legitimate billing codes remain distinct charges without multiplying clinical visits.
- Cross-export differing attendance-status sets are explicit conflicts. Affected provider canonical periods are withheld from eligible attendance rows/coverage, not certified as zero; independent billing proof and other periods/providers remain usable. Sources must independently prove the whole period before status reconciliation, so an unverified partial export cannot poison a complete replacement.
- Mixed appointments represented within one source remain supported. Identical mixed-status sets across exports do not create a false correction. Clearly distinguishable PHONE consultation and treatment kinds remain separate; PHONE is excluded from treatment visits. Billed cancellations remain charge evidence, never attended sessions. Repeated non-show facts collapse for clinical cancellation counts without altering raw row counts.
- Conflicted visits cannot establish conversion/retention success, and missing/conflicted follow-up cannot certify absence or a mature miss. No status, fee, source row or earlier export is destructively overwritten to resolve a conflict. Matching diagnostics display original statuses and the conflict reason; Sessions says unavailable observations instead of implying no activity.

## Verification

- 636 domain/dashboard tests pass, including nine focused October overlap cases and all prior mixed-status controls. Full suite log: `/tmp/october-overlap-all-tests.log`.
- 20 mocked API tests pass across existing coverage, per-import confirmation and retain-overlap controls. Independent review rechecked status admission/withholding, preserve-both behavior and the same-hash/different-proof atomic guard with no remaining bounded blockers. No real DB execution or metadata writes were performed.
- Two static mapping-query tests pass. The separate read-only audit runner requires repinning to this frozen calculation source before its full eight-test check; it deliberately refuses old pinned calculation mismatches.
- API/dashboard typechecks and production builds pass, with existing bundle warnings.
- 105 synthetic captures pass: 45 broad,18 complete-period/global identity,15 staff,8 selected-period,2 revenue,5 explicit coverage confirmation,8 October duplicate/correction,4 retain-overlap. All horizontal-overflow checks pass. October KPI probes report zero API writes and browser errors; retain/confirmation workflows exercise only explicit mocked writes, never production. Author inspected correction Imports mobile and retain-review desktop pixels.
- October KPI fixture: duplicate exports yield2 visits over14 eligible days and$150, not3 visits/$250. Appended fee/status corrections leave charged fees and attendance unknown, preserving original source rows byte-equivalently. The unfinished October8-21 period cannot become actual on October14.

Evidence: `/tmp/october-final-overlap/october-overlap-results.json`, `/tmp/october-final-retain/retain-overlap-results.json`, and `/tmp/october-final-{main,contract,staff,period,revenue,confirmation}/` plus adjacent PNGs. New harnesses: `october-overlap-render.mjs` and `retain-overlap-render.mjs`.

## Remaining Production Gate

`practice-clinician-mapping-diagnostic.sql` (initial deliverable098bd82) gives aggregate-only exact-name/ID/prefix/schema/window evidence. Prefixes and alternate fields are not automatic mappings. A zero exact-name journey query does not mean Elia has no activity; source key identity must be reconciled through the parent/cloud worker before any real-data certification.

All supplied production import coverage remains null. Valid manual periods can independently support pacing, but imported clinical rates remain unknown until exact source/owner coverage and identity are established. Parent will resolve coverage mapping/start dates separately. Raw fee subtotals are not reconciled income or cash. No source data was fetched to the Mac, no credentials extracted, no production requests/SQL/migrations/bootstrap performed, and no main push or publication occurred. External exact-SHA review, production aggregate acceptance and corrected-screen review remain required.
