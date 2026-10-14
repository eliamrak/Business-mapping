# Practice Repair Candidate

## Scope

Repairs the existing production project's read-through goals, import-derived clinical metrics, provenance, navigation and approved dark layout. No production data was changed, imported, deleted or reset. No application deployment or native-wrapper installation was performed.

Approved reference: `practice-tabs.html`, SHA256 `4f0de5d32c38cf8e441d28947a021e921714a9d12330948f5ae56462e8d38a81`. The reference and user screenshots remain outside the Git repository. Prototype amounts were not seeded into business data.

## Data Rules

- Existing named goals, including explicit zero and archived records, override legacy fallback. Otherwise the selected original compensation goal supplies owner pay, co-owner salary, profit, headcount and fund targets without automatic writes. First edits preserve inherited values.
- All four existing compensation scenarios remain discoverable separately from new workspace versions.
- Observed snapshot endpoints remain the earliest/latest rows. Optional `reportCoverage` is a separate, validated declaration of a complete interval. Legacy spans do not create absent-day zeros.
- Recorded visits and dates remain visible. Unverified calendar-window pace is labelled estimated; chart points show observed visits. Negative/mature retention, consultation and ending conclusions require verified observation. Positive conversions and retained episodes remain visible, with pending/coverage labels.
- Three treatment sessions, the agreed 28-day initial gaps, PHONE exclusion, one-calendar-month consultations, actual-closer attribution, 90-day endings and later returns are retained.
- Financial projections remain estimates and billed fees remain revenue, not cash. The annual Overview uses the existing bounded projection pace rather than averaging only imported session-bearing dates.
- Negative funding results cannot paint a full positive progress bar. Unconfigured 75%/80% goal lines were removed.

## Verification

- `corepack pnpm test`: 374 domain tests passed.
- Database-free report-coverage API suite: 5 tests passed.
- Library TypeScript build, API typecheck and dashboard typecheck passed.
- Frontend production build passed. Existing sourcemap/chunk-size warnings remain.
- Isolated Playwright harness: 32 desktop/mobile captures at 1280/390 pixels; no horizontal overflow or application browser exceptions. It verifies saved synthetic edits, focus persistence, four-scenario discovery, import navigation/provenance, original-goal read-through, 36 daily imported visits and explicitly estimated 8.4/week, and negative funding progress.
- The harness uses synthetic intercepted APIs and local preview access, not the authenticated production account. A narrowly recognized localhost-only Clerk load failure is recorded separately and prevented from covering the preview; other application exceptions still fail the run.
- Approved reference views were rendered at both sizes and compared locally. Candidate evidence is in the ignored/untracked local `verification/practice-workspace-render/` directory; it contains no production clinical data.

## Migration and Backout

Apply `lib/db/migrations/008_practice_report_coverage.sql` in the existing deployment process after independent review. It adds one nullable JSONB column idempotently. It does not alter existing snapshots or fabricate completeness provenance.

Application reads and legacy package writes remain compatible before migration. New completeness-proof writes fail clearly with `503 REPORT_COVERAGE_MIGRATION_REQUIRED` until the column exists. Reverting application code can leave the additive column and its data intact; do not drop the column or discard stored history to back out.

## Remaining Gates

The complete Postgres/API integration suite was not runnable because no disposable loopback database and isolated test API were configured. Those tests were not pointed at production.

The parent must obtain an independent exact-SHA full-check PASS, run migration/integration checks in the existing authorized environment, and reconcile the authenticated account's real data. Deployment and post-deployment desktop/mobile/native-wrapper verification remain separate gates. Prior acceptance is withdrawn; this document is not a release approval.

The original fallback that treats selected compensation pay goals as a forecast payroll budget remains unchanged for parity. Review the real account's explicit owner-payroll/family-salary settings before making any financial-model changes; never infer a real salary from a target.
