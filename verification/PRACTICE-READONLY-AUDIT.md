# In-Environment Aggregate Acceptance Audit

Run only after review, inside the existing authorized Replit app environment with its existing DATABASE_URL. Do not run on a Mac against a remote DB, copy database credentials, upload source records, or export patient data. No extra access grants or services are required. This tool has not connected to any real database in the author environment.

## Production SQL UI Fallback: Current Supported Route

The cloud worker verified that shell DATABASE_URL targets an empty development DB (0 snapshots/packages/workspaces), not production (supplied aggregate 4/2/1). Do not run the JavaScript command there and present it as production acceptance. Do not extract production credentials, transfer raw rows, start a new backend, or bootstrap data to bridge this separation.

Use `verification/practice-production-aggregate-audit.sql` in the already-authorized production SQL UI instead. It contains four independent SELECT-only statements, no transaction/settings changes, writes, functions, temporary tables or DDL. Run each separately and keep only its aggregate output private. Dates are explicit example inputs; agree them before execution. Query 4's target input is normalized exact existing clinician name, not a fuzzy match. The script chooses an import scope only when exactly one active scope exists; otherwise stop, do not broaden or select a scope arbitrarily.

1. Verify production counts/scope and summarize attendance/billing raw row counts, observed source bounds and null explicit-proof counts. Those bounds are labeled not proof. If all four reportCoverage values are null, the exact candidate consequence is zero admitted imported clinical facts; rates and source-complete actuals stay unknown, not zero percent.
2. Check separately whether stored manual session records contain valid Jan1-anchored ended 14-day periods. These can support a manual-only working baseline despite unproved imports. Output contains only aggregate period dates/provider counts/session totals and the common manual cutoff. It reproduces three-calendar-month manual-only baseline arithmetic only when every active import proof is missing. It does not claim attendance or billing source completeness from manual totals.
3. Summarize raw billing-row amounts within the explicit ISO text window. This intentionally does NOT perform encounter reconciliation or convert charges to cash. Duplicated/overlapping source exports can inflate this subtotal; do not label it actual income or use it to approve publication.
4. Inspect aggregate raw positive evidence for the requested name: earliest consult per client for that name, positive treatment follow-up within one calendar month, stored confirmed-closer override count, and initial three-distinct-treatment-date evidence with gaps at most28 days. PHONE rows and linked PHONE-only billing are excluded from treatment. Invalid row dates are counted. A globally ambiguous/missing name withholds these attribution counts. No identifiers, row data or arbitrary source strings are selected out.

Query 4 is deliberately NOT a replay of the entire practice consultation cohort, confirmation-override journey validation, complete retention/90-day absence maturity, or the former deployed UI. Raw positives cannot certify unobserved failures. The exact all-null-proof candidate state is independently known without porting the whole application to SQL: imports contribute no admitted clinical events; close and retention rates are unknown until source proof is deliberately supplied. A raw1/1 success-only100% can coexist with no confirmed closer credit, and pending starts must remain outside a retention denominator; the JavaScript synthetic test demonstrates these definitions, not actual business counts.

No SQL here has been executed against real data by the author. The production SQL UI must still validate runtime/schema compatibility. Original report header/date scope or explicit owner confirmation is the actual missing decision for the supplied all-null-proof dataset. Do not automatically fill dates from occupied min/max; preserve all7,593 supplied source rows and original hashes. The owner must also see the resulting supported pay periods and unknown states before publication.

## JavaScript Run: Only With Legitimate Existing Production-Side Execution

From the repository root, supply explicit UTC service-date boundaries and the exact existing clinician-card label. The following is an example window; choose the actual agreed audit as-of/window, do not infer it from upload time:

```sh
AUDIT_AS_OF=2026-10-15 AUDIT_WINDOW_START=2026-01-01 AUDIT_WINDOW_END=2026-10-15 AUDIT_CLINICIAN_LABEL=Elia node verification/practice-readonly-audit.mjs --ack-existing-db-read-only
```

The script uses the existing configured scope exactly as the API: normalized EMC_PRACTICE_ID, otherwise EMC_OWNER_EMAIL, otherwise default-practice; practice_id and account_id are equal in this existing app. It does not print that scope, the database URL, labels or account information. Do not override these existing configuration values to broaden scope.

Runtime dependencies are the already-installed pg from lib/db and esbuild from the API server. The model bundles in memory; no database snapshot, raw row file, compiled file or report file is written. The runner supports ordinary modern Node without native TypeScript support. No dependency installation, migration, server restart, checkout replacement or publication is part of this command.

## Safety and Source Pin

- Candidate calculation revision: daae9bee27716a8ae76bed27c627f56917ca83fa; tree e4cdace9396bd501ea402f3b90432811ec2676d2. The runner checks that tree and refuses modified/untracked calculation sources under lib/practice/src, dashboard src/lib, and the Practice workspace page before connection. The later coverage-editor component/API can differ; neither is imported by the audit calculation. Audit helper/runner themselves must be reviewed at their delivered commit.
- Connection default is read-only. All reads occur inside BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY, with transaction_read_only=on explicitly verified. Transaction-local statement/lock/idle timeouts prevent open-ended queries. Every successful or failed read ends with ROLLBACK, never COMMIT. No INSERT/UPDATE/DELETE/DDL/COPY or SQL function that mutates business data is executed.
- Reads are fixed, parameterized, scope-limited SQL. Workspace 1 and full clinician identities match the existing API's singleton model. Active import scope is identical to the API. Whole-row to_jsonb extraction tolerates an absent report_coverage column without migration or invented proof.
- Safety bounds refuse over 1,000,000 source facts, 5,000 snapshots, 200,000 manual records or 10,000 other context rows. They never produce a truncated acceptance report. Conflicting active-package override values also fail rather than choosing an arbitrary query order. Existing same-day override reconciliation is reproduced without writing it back.
- Success stdout contains only explicit aggregate numbers, known constants, complete/gap period dates and anonymous baseline windows. No patient IDs (even pseudonymous), source hashes, snapshot IDs, provider IDs/labels, row details, raw warnings, arbitrary notes or journey objects are emitted. Failure output contains only a phase and whitelisted reason, never the underlying message/stack/URL. Keep even the aggregate report private: low-count groups are not anonymous simply because identifiers are omitted.

## Interpretation

- `comparison` means retained raw evidence versus candidate complete-period admission, not a reconstruction of an older deployed UI. Raw visit/fee subtotals are not complete-period actuals. `periods`, through-dates, incomplete ranges and anonymous baseline windows show what source proof supports; zero and null retain distinct meanings.
- `coverageBlocker` explicitly reports all-active-imports-lack-explicit-coverage when every stored reportCoverage is null/missing. It never autofills dates or turns observed min/max into completeness. Parent reports four active production snapshots with null proof (4,300 attendance and 3,293 billing source rows); this is supplied aggregate evidence, not a new author DB read. Actual script results remain unverified until the cloud worker runs it.
- Candidate historical income uses admitted billed fees; missing actual pay/expenses remain unknown. Future uses dated card fees. Paid-PHONE and percentage-compensation policies remain unchanged. `evidenceIssues` reports relevant aggregate conflicts/paid PHONE/partial follow-up counts without sensitive source details.
- Practice conversion counts one client journey reaching treatment within one calendar month divided by evaluated journeys. Pending journeys are excluded. Clinician close requires saved manual closer credit; zero confirmed conversions with no evaluated credited journeys means an unknown rate, not necessarily 0%. The script reports the requested clinician's confirmed credits, candidates, pending attribution and internal-referral protection separately from practice conversion.
- Initial retention requires three treatment sessions with initial gaps at most 28 days; PHONE is excluded. Retained/evaluated, pending and percent are all reported. A 100% result based on 1/1 plus pending starts is not broad clinical certainty. Ninety-day ending maturity and excluded-return safeguards remain intact.
- No result certifies the provenance or completeness of the source reports, actual cash reconciliation, employment/compensation policy, or source-confirmation accuracy. Missing metadata needs original report header/date scope or explicit owner confirmation; these must be separate deliberate UI actions, never audit writes.

## Synthetic Verification

```sh
node --test verification/practice-readonly-audit.test.mjs
```

Eight tests cover no source/identifier output or input mutation; practice 100% versus zero confirmed credits; retention 1/1 with pending; legacy-null-proof unknowns; cross-team ambiguity and unrelated-provider inverse; parameterized read-only SQL and rollback on failures; explicit date/source/ack guards and sanitized CLI errors; and SELECT-only SQL/scope/identity-normalization guards. Independent bounded review also probed privacy, proved empty-fee windows, invalid snapshot kind and rollback failure. SQL review found and corrected whitespace-before-trim normalization so tab-padded duplicate identities cannot be missed. No real DB compatibility or acceptance is claimed by these tests.
