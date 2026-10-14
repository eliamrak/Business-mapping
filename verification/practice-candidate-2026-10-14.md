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

- `corepack pnpm test`: 487 passed, zero failed.
- `corepack pnpm run typecheck:libs`: passed.
- Dashboard and API typechecks: passed.
- API production build: passed.
- Frontend production build with PORT and BASE_PATH set: passed; existing
  sourcemap, mixed jsPDF import and large-chunk warnings remain.
- Synthetic isolated Playwright harness: 49 desktop/mobile captures, no horizontal
  overflow or navigation overlap. Checks include keyboard navigation, circular
  retention/practice marker, Compare, staff cost, percentage persistence/reload,
  generated-plan unsaved protection, saved plans, imports and legacy daily visits.
  The capital-only Current Reality screen shows no recurring target and a separate
  zero-percent Building Fund balance, without a green overall achievement claim.
- Independent read-only main integration review found three issues; all were
  corrected and re-reviewed without remaining findings. Reviewer independently
  ran 39 focused tests, dashboard typecheck and the 36-capture harness.
- `git diff --check`: passed.

## Exact-candidate audit follow-up

The independent audit of `c1d5e63` passed 27 checks covering the original defects,
ETA boundary, existing controls and additional inverse/coverage cases. It found
two remaining blockers, fixed by this follow-up:

- Financial Goal rejects unverified room capacity and other unsupported forecast
  warnings; it cannot mark capacity sufficient from those fallbacks. Regression
  controls retain a valid solution when telehealth is explicitly configured.
- Current Reality has no recurring achievement percentage when annual recurring
  need is zero. UI and export labels distinguish recurring flow from capital
  balances; Building Fund and Emergency Reserve use their respective balances,
  while Growth remains unknown because no current Growth balance exists there.

Independent read-only follow-up review found no issues, with 31 focused tests and
dashboard/API typechecks passing. The new frozen commit still requires the separate
auditor's exact-commit confirmation; c1d5e63 audit results do not certify these new
changes. No deployment was performed.

## Requirement-gap follow-up

The independent review of `34e7868` identified three broader requirement gaps.
This follow-up removes the fixed Attrition goal of eight: without a defined
client-ending target or sourced replacement model, the Goal is unavailable and no
green target marker is drawn, in either individual or Compare views.

Sessions, Retention, Attrition and Consultations now share one horizontal Compare
renderer. Every selected-team clinician appears before Whole Practice, on a common
scale for that metric and period. Unknown observations remain unfilled, not zero.
Sessions uses strict verified weekly pace, not an unverified estimate. Practice
benchmark, configured capacity and available practice Goal markers remain distinct.
Name-only clinical imports are withheld where the full roster contains multiple
distinct clinician IDs with the same normalized name; Compare and individual/Team
views show mapping ambiguity instead of duplicating a person's imported metrics.

Generated alternatives are ordered by evidenced fractional shortfall relative to
their defined first-month target, with baseline, target, period and units visible.
Zero-denominator and unevidenced alternatives remain unranked. Equal gaps share
rank; unknown options are not assigned invented scores. Each card exposes modeled
monthly values and deltas versus Today for its one or two focus KPIs. Room priority
caps demand at clinician capacity and explicitly describes its shortfall as an
upper bound, not guaranteed recovery. Existing forecast and financial equations
are unchanged; ranking and presentation do not save or adopt plans automatically.

Independent read-only review found room overattribution and ambiguous-name lookup
issues during this follow-up. Both were fixed and re-reviewed with no remaining
findings; 23 focused tests and dashboard typecheck passed independently. The author
completed 49 fresh synthetic desktop/mobile captures, including all four Compare
views, individual Attrition, ranked outcomes and duplicate-name withholding.

The new frozen candidate still requires the external reviewer's exact-commit
check and the user's screen approval. This is not a production-data certification.

## Final Staff/Configuration Follow-Up

The final staff checks reproduced and repaired the remaining roster/pay issues:

- Explicit zero work weeks remain zero in the shared compensation helper.
- Salary/hourly labels follow the actual pay precedence, including omitted or
  zero salary with hourly terms. Incomplete/nonfinite pay or W2 burden data remain
  unknown in Team and Pay structure, including the aggregate readout.
- Unassigned staff are selectable and survive reload through an optional explicit
  team-selection preference. The absent preference retains legacy first-team
  defaulting. No staff/clinician configuration IDs are assigned or duplicated.
- The selector writes only selection fields on the stored snapshot, never the
  resolved view's inherited owner-payroll/profit defaults. Regression tests and
  browser checks preserve stored zero values and all source roster arrays.
- Name-only clinical metrics are matched within the selected configuration,
  consistent with the import overlay. Configuration copies are not treated as
  ambiguous people; two matching IDs within one configuration remain unknown.

`verification/staff-configuration-render.mjs` adds 15 desktop/mobile captures and
isolated checks for 6/1,8/1,7/0,9/0 clinical/nonclinical configuration counts, six
unassigned clinicians, no-session visibility, and zero inherited staff in blank
Sandbox. Two Grace rows remain configuration-specific. The explicit Year1
compatibility inputs provided by the parent (18/hour,10hours/week,48weeks,W2 burden
7.65%+1%+0.5%+0%) reconcile to8640base+790.56burden=9430.56annual,785.88monthly.
Step2 terms were not copied, inferred or exported; the fixture leaves them unknown.
The harness uses mocked APIs and synthetic IDs/clinical economics, not a production
adapter, and no business records were changed.

Independent read-only review caught the inherited-default persistence risk and
confirmed its correction (27 focused tests/typechecks). It also reviewed the final
configuration identity scoping with no findings (5 focused tests/typecheck).
All 49 existing screen captures were rerun after the final scope change. Five
database-free API tests pass; local authenticated/real-database end-to-end testing
remains unavailable as described above.

Deploy frontend and backend from the same commit so both recognize the optional
selection preference. No migration or seed data is introduced. The parent owns the
established repository push, existing-environment deployment and real-account
post-deployment verification. This task has not pushed or deployed the candidate.

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
