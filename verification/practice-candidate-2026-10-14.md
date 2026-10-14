# Practice correction candidate

Baseline: deployed commit `0b9241f16409955eb42052084d5a614355410212`.
Status: local candidate only. No deployment, production writes, seed data,
Page/prototype changes, access grants, or new infrastructure.

## Changes

- Top Today / Long Term Goals / Sandbox navigation with the six Today sections.
- Circular individual percentage KPIs with practice markers; horizontal Compare
  evidence ends with Whole Practice. Whole Practice remains the default selector.
- Clinical KPI cards and separate pay structure; nonclinical staff appear below
  clinical staff, with monthly employer-inclusive costs.
- Fixed dollar / fixed percentage overhead goals retain their selected form.
- Three generated unsaved focused alternatives are distinct from saved plans.
  Existing plans are retained; unsaved alternatives receive change protection.
- Sessions financial label is Goal. Forecast inversion considers existing goals,
  compensation and costs without inventing personal capacity fractions. Missing
  clinician mix or recurring fund contribution provenance leaves it unavailable.
- Partial-import conflicts retain manual source evidence; completed goal reviews
  require report coverage rather than treating visit facts as complete days.
- Monthly session history aggregates evidenced calendar months; goal regression
  uses elapsed months rather than observation count.
- Billing-linked PHONE visits participate in consultation journeys. Clinician
  identity normalization, custom attrition windows and strict Rooms coverage are
  consistent with the imported evidence.
- Dated allocations use effective-day shares; household take-home excludes other
  owners. Named retained funds receive only their share. Fund projections respect
  allocation starts, do not extrapolate finite endings, and tolerate floating
  precision at integer ETA boundaries.
- Total fund balances are not recurring annual costs. Incremental operating-plan
  calculations preserve fixed salary and compensation-cap transitions. A positive
  practice cap with zero practice share remains unreachable.

## Verification

- `corepack pnpm test`: 465 passed, zero failed.
- `corepack pnpm run typecheck:libs`: passed.
- Dashboard and API typechecks: passed.
- Frontend production build with PORT and BASE_PATH set: passed; existing
  sourcemap, mixed jsPDF import and large-chunk warnings remain.
- Synthetic isolated Playwright harness: 36 desktop/mobile captures, no horizontal
  overflow or navigation overlap. Checks include keyboard navigation, circular
  retention/practice marker, Compare, staff cost, percentage persistence/reload,
  generated-plan unsaved protection, saved plans, imports and legacy daily visits.
- Independent read-only main integration review found three issues; all were
  corrected and re-reviewed without remaining findings. Reviewer independently
  ran 39 focused tests, dashboard typecheck and the 36-capture harness.
- `git diff --check`: passed.

## Limits and release gates

These synthetic checks do not certify real business values or confer user design
acceptance. Show the corrected screens to the user before deployment. The separate
auditor's frozen deployed-source audit is not certification of this candidate.

Full API integration tests could not run locally: EMC_TEST_DATABASE_URL and the
isolated EMC_TEST_API_URL are unavailable. Five database-free API tests passed.
The parent's earlier cloud checks apply only to their tested router/migration
blobs, which this candidate does not change.

Repository-wide recursive typechecking fails in untouched comp-mobile scenario
API arguments / union types and useColors typing. Do not treat that as a clean
repository-wide typecheck.

No migration is introduced. New overhead fields are optional; legacy absent-field
behavior remains intact. Back out code to the baseline without reverting stored
facts. Preserve a database/blob backup before any future approved deployment;
avoid writes from an older schema during rollback so optional fields are not lost.

Rendered artifacts are local and untracked under
`verification/practice-workspace-render/`; `metrics.json` is the current harness
record. Independent re-review captures are under
`/tmp/practice-main-rereview-20261014/`.
