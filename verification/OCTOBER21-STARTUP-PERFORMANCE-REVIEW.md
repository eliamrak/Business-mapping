# October 21 Startup Performance Independent Review

Reviewed 2026-10-21 against frozen commit `1d08466fd11b5422eca8ed8078203abe69d6d220`.

## Findings and Accepted Scope

No correctness or regression findings in the exact five-file candidate identified below. Accepted as a bounded local startup optimization: eliminate duplicate same-window attrition evidence preparation and defer Team-only historical earnings calculations until requested. This is code-review acceptance, not a publication or deployment action.

The historical earnings calculator body is byte-identical to the frozen baseline, from its existing read-only accrual comment through end of file. Formula, dated compensation, annual caps, identity resolution, coverage, unknown values, and reconciliation behavior remain inside that unchanged calculator.

The new reader enumerates selected-team IDs at construction without accessing snapshots or running the calculator. It calculates once per requested selected ID and caches available and unavailable results alike. Unknown or nonselected IDs return undefined, matching the former Map lookup. Duplicate selected IDs still reach the unchanged calculator's full-roster uniqueness check and remain unavailable. Different IDs retain independent results. Repeated UI reads return the same cached object.

Cache lifetime is explicitly tied to immutable report inputs. The reader does not monitor or copy objects changed in place. The React memo at `practice-workspace.tsx:1030` includes every calculator input: working workspace (including selected team and dated terms), full context, snapshots, same-day overrides, declarations (including billing resolutions), as-of date, and historical reports (including cohort range). Replacing any of those dependencies creates a fresh reader. Existing local retention updates replace state values, and workspace staging replaces the workspace object. Future callers must honor the same immutable-input contract. React may discard a memo and recalculate safely; this cache is an optimization, not semantic storage.

All reader consumers occur within the `section === "clinicians"` conditional starting at `practice-workspace.tsx:3964`; the initial section is summary. Thus initial Overview no longer requests historical clinician earnings. Team's first visit still performs the requested calculations synchronously, and broader report-input changes legitimately invalidate the cache.

Attrition full-window calculation now consumes the evidence already prepared for exactly that scope and requested window. The calculation does not mutate that evidence. Each observed mature portion continues to prepare its own evidence using the shortened portion range and the same clinician scope; it does not reuse full-window ending events. Portion bounds, maturity checks, coverage checks, nulls, reasons, and output ordering are unchanged.

## Independent Verification

- Ran the two modified test files locally: 52 tests passed, zero failures.
- Ran 1,200 deterministic generated attrition comparisons against `git show 1d08466:.../period-client-attrition.ts`. Whole returned objects matched, including practice and clinician scopes, exact dates, IDs, reasons, nulls, and mature portions. Generated cases included missing/truncated/interrupted coverage, duplicate snapshots and visits, mixed provider normalization, treatment/documentation/PHONE codes, uncertain follow-up, classification evidence, and immature/mature windows. Observed output shapes included complete full windows, incomplete windows without a mature portion, and incomplete windows with a mature portion. Inputs were deeply frozen and checked for equality after both calculations.
- Ran a relocated earnings suite with calls compared against the frozen baseline through the lazy reader, plus an independent multi-ID cache and replacement-input check: 31 tests passed, zero failures. Reused existing financial edge-case fixtures, including caps, ambiguous identities and terms, unavailable evidence, overrides, and zero/unknown semantics. Additional frozen-input checks verified no snapshot reads at reader creation or unknown-ID lookup, one read per requested ID, twelve repeated reads per ID without extra work, and fresh readers matching baseline after separate workspace/context/snapshot/declaration/override/as-of/range changes. The old reader retained its cached result.
- Confirmed historical calculator body byte equality programmatically and `git diff --check` passed.
- Reproducible isolated verification script: `/tmp/oct21-startup-independent-review.mjs`. Its generated frozen modules and earnings test are under `/tmp/oct21-startup-review-6uw3i2/`. Baseline dependencies are current local modules; exact diff confirms those dependencies are unchanged from the baseline.

No browser harness was rerun by this reviewer. No runtime source was edited, no business systems were accessed, and no push/deployment occurred. Pre-existing untracked `verification/practice-workspace-render/` was left untouched.

## Supplied Performance Evidence and Limits

Read the author's synthetic result files directly: before `/tmp/practice-full-scale-Ag23x0/results.json`, after `/tmp/practice-full-scale-O0p2Kb/results.json`. Both identify synthetic-only data and no production access, writes, external accesses, or browser errors.

Maximum startup component render decreased from 5,129 to 4,032 ms (21.4%). Loaded Overview elapsed time decreased from 7,066 to 6,022 ms, including the author's settle interval. Attrition aggregate instrumented time decreased from 1,199 to 813 ms. Earnings calls are absent at after-patch Overview readiness; six calls totaling 740 ms appear after navigation. First Team navigation increased from 488 to 1,223 ms, consistent with deferral. Function counts remained unchanged between the recorded idle-before and final snapshots. These are supplied single-run fixture measurements, not a general performance guarantee; substantial startup latency remains.

The author separately reports all 984 root/domain/handler tests, types, and production build passing. This reviewer did not duplicate those runs. Author-owned exact DOM parity and second-Team-visit probes were still in progress at review close; they are outside this independent test evidence. No review blocker was found in the bounded patch. Any publication remains with the parent workflow after its final candidate checks.

## Exact Candidate SHA-256

Paths below are relative to `artifacts/comp-dashboard/src/`.

| File | SHA-256 |
| --- | --- |
| `lib/historical-clinician-earnings.ts` | `8f7c4a4b8d0144bf22a31747f0e024eea4c56a019bdc4a2d014eee4cb1cc1ce8` |
| `lib/historical-clinician-earnings.test.ts` | `a85115076319b6d06bd242f54a6b429a77a37111ce7bde262880f0b6422e954c` |
| `lib/period-client-attrition.ts` | `de23716a94167d84ba6379f9abee55e2884c4749d425ea95f9cdb03235775cc9` |
| `lib/period-client-attrition.test.ts` | `dcfd9c875687014e8fb692c8d5e9fc5161b9b84686d1063a494d98e9767f09aa` |
| `pages/practice-workspace.tsx` | `b8b35f3c35038f3f82425f112462e9b5fc481c3c1ccb01ed528b2fea16ad0a3e` |
