# Read-Only Source Trace Handoff

Prepared from source inspection only. **No production request or real-record investigation was executed here.** This closes neither the reported repeated-4/43 examples nor the actual payroll-person mapping gate. Parent's existing authorized reader/publisher environment must perform the reads when its browser is available.

## Existing Authenticated Route

The existing web app uses Clerk same-origin browser-session cookies, not a legacy password or copied bearer token (`.agents/memory/clerk-authorization.md`). Protected routes mount under `/api` using `requireAccess` (`artifacts/api-server/src/app.ts:60`). Owner access is required for the following financial/import reads. An existing signed-in owner browser on `https://compensation-calculater-app.replit.app/` can use same-origin GETs with `credentials: "same-origin"`, `cache: "no-store"`. No new endpoint, access grant, account, credential export, browser-profile copy, cookie extraction or authorization bypass is needed or authorized.

No connected authenticated application browser is exposed to this delegated task. A localhost development server is **not** an authenticated production reader; do not proxy/copy the owner's cookies into one. Do not reload or inject diagnostics into the owner's open macOS window without coordination about pending work. Prefer the parent's already-authorized separate browser/production read-only tool.

Minimal existing GETs:

| Route | Required fields / purpose |
| --- | --- |
| `/api/auth/me` | Check `role === "owner"`; discard actor/email from returned evidence. Stop on401/403; do not install/invite/reset/login around the gate. |
| `/api/hub` | `{revision, updatedAt, data.settings, data.clinicians, data.terms, data.goals, data.allocations, data.consultAttributionOverrides}`. Settings include `teamId`, `familyW2ClinicianId`, owner payroll fields. Full response may remain in protected memory but output only reviewed aggregates. This GET selects an existing workspace or returns an unsaved empty default; `current()` does not insert a record. |
| `/api/hub/context` | Full clinician roster `{id,label,goalId,classification,sessionRate,sessionsPerWeek,...}` for identity resolution, staff and saved manual sessions. Preserve the full roster while calculating, then select team/clinician; do not globally filter away copied-name collisions or former providers. |
| `/api/practice-imports` | Active scoped `{snapshots, declarations, billingResolutions, billingResolutionRevision, sameDayVisitOverrides, billingCodeMinutes, packages}`. Scope is the authenticated practice/account. The current frontend's `getStoredHistory()` uses this exact GET. |
| `/api/business-goals` | Legacy goal IDs and `ownerPayGoal`, `secondOwnerPayGoal`, basis/year metadata. Needed only for linked inheritance; do not treat field names as proof of a human recipient. |

`/api/hub/history` and `/api/hub/history/:revision` are existing optional GETs if a known original workspace revision must be recovered. Prefer a specific revision to exporting all history. `/api/hub/export` and attachment downloads are broader than this investigation and are not needed for the initial trace. Import active snapshots may have changed since October19; do not claim exact original reproduction without matching source-package/declaration evidence or an already-retained protected snapshot.

Do not call any POST/PATCH/PUT/DELETE, import package, attribution-confirmation, coverage-declaration, restore, backup-replace, or role/user endpoint. Before/after workspace revision and scoped package/declaration fingerprints should remain unchanged. A normal browser read may make provider requests, but app business writes must be absent.

## Capture the Observation Context First

Record the loaded web asset/release, local business date/timezone, exact selected activity range, contributor ID/team, Compare state, current workspace revision, active package IDs/content hashes, declarations and billing-resolution revisions. The frontend's `today` uses local `en-CA` calendar date, not an assumed UTC day. The old reported90-day view must use its exact inclusive range; do not substitute three complete calendar months. Historical comparisons use their separately labeled completed-calendar windows.

For the October19 screenshots, reproduce with the deployed source that produced them (`7f54613a` / public `index-B5r4xObK.js`) and matching protected evidence, then compare with the candidate. Current data/current date are a new observation, not proof of what happened in the original call. If the original scope/version cannot be recovered, state that limit and report the current-source trace separately.

## Repeated Consultation Four

Necessary original row fields are attendance `clientId, clinician, serviceDate, status, visitKind, billingCode, sourceRowHash` and billing `clientId, clinician, serviceDate, billingCode, visitKind, totalFeeCharged, sourceRowHash`. Retain original snapshot `id, kind, coverageStart, coverageEnd, reportCoverage, sourceHash`; derived `coverageClinicians` and identity admission are produced by the existing coverage pipeline, never fabricated. Classification may use raw billing evidence while visits and completeness must come only from admitted attendance.

Rebuild exactly the frontend sequence: full-roster provider resolution/declarations -> complete clinical source admission -> exclusions/unresolved follow-up -> `summarizeConsultConversions` with selected activity dates, `today`, saved `consultAttributionOverrides`, original classification sources and the current-team consultation cohort. Do not run the summarizer directly against every raw import and accidentally introduce unadmitted visits.

Read these summary fields for the chosen scope: `consultations`, `converted`, `candidateConversions`, `evaluated`, `pending`, `needsAttribution`, `internalReferralsProtected`, `conversionRate`, `coverageVerified`, `rateBasis`. Internal per-journey fields: `consultDate, deadline, status, consultClinicians, treatmentStartClinician, closerClinician, creditedClinician, treatmentDate, attributionSource, attributionIssue, coverageVerified`. Preserve client IDs only within the protected calculation to deduplicate/join.

Produce an aggregate cross-tab of journey status by attributionSource, and set-intersection counts for evaluated/candidate/needs-attribution/confirmed-close cohorts. Check saved overrides for archived state, actual named closer, missed-owner assignment and unresolved outcomes. Confirm one practice conversion per client, exact one-calendar-month deadline, source PHONE classification, internal-referrer protection, identity ambiguity, duplicate source rows and pending maturity. **Only after reading actual results** explain whether the repeated four are the same journeys under different questions or some other issue; neither that explanation nor zero confirmed closers can be assumed from source code.

## Overview43

The old `overviewClientFlow` implementation (`lib/practice-overview.ts` at the deployed checkpoint) takes the earliest admitted qualifying treatment-show date per unique client across retained history. It counts first dates inside the selected activity window only when strictly later than source `coverageStart`; first dates on that boundary are separately left-censored. PHONE/documentation classification and same-day source safeguards apply upstream. It is **not** an onboarding-complete or booking flag, and a first observed treatment client need not have a recorded consultation.

To trace43, calculate that exact old predicate using matching source/scope/dates and compare aggregate counts for: first observed treatment, left-censored starts, recorded qualifying consultation cohort, treatment after consultation within deadline, consultation-associated treatment starters, starters without a recorded eligible consultation, and unresolved source/identity cases. Keep numerator/denominator cohorts compatible. Do not divide first-treatment totals by an unrelated period's consultation count. Do not infer a client's onboarding completion from these reports.

Output the actual reconstructed total and whether it equals43. If not, identify the evidence/scope/date/version mismatch using aggregate diagnostics. Never silently change stored records to force the remembered total.

## Payroll Person and Goal Mapping

Resolve `settings.familyW2ClinicianId` against **all** context clinician rows; require exactly one ID match in the selected team. Within the protected reader, verify that this exact record is Erin, including copied-row/team ambiguity. Trace its active profile and dated terms (`clinicianId,start,end,status,payMode,payAmount`, and effective terms dates) at the displayed planning month; do not pick by array order if overlapping. Recalculate monthly salary from the configured annual amount/calendar basis used by the existing planner, protected before optional goals.

Inspect saved goals by **ID and metric**, including archives, duplicates, amount, basis/date and original name. `coOwnerSalaryPretax` is the legacy engine key for Erin salary/Owner pay; `ownerDistributionsPretax` is the legacy key for Elia household distributions/Co-owner pay. The new projection preserves IDs/amounts rather than swapping recipients based on names. Legacy `secondOwnerPayGoal` stays with salary and `ownerPayGoal` with distributions. That compatibility contract does not independently prove the actual saved person's identity or an original field's intended recipient.

Trace household-marked allocations separately from other owners' distributions; effective dates and basis must match. Confirm owner clinical revenue accrues to business and is not paid a second therapist payout; salary is included once in clinician compensation, removed once from other therapist payroll and protected once in owner payroll. Confirm Elia distributions remain optional, not a protected salary minimum. Report mismatch/ambiguity without editing any IDs, roles, goals or pay terms.

## Privacy-Safe Returned Evidence

For item12's billing-code workflow check, use the same already-read billing evidence to report aggregate counts of distinct configured/imported treatment codes and distinct discounted charges per code, with unknown-code/conflict counts. Do not output client-linked fee rows. Source configuration currently offers standard Session fee and a separate future revenue override; billing-code minutes describe duration, not a fee schedule. Verify these actual controls and retained per-service charges before claiming a billing-code fee editor exists. No fee or source record should be edited as part of this check.

Return release/date/scope basis, revision/fingerprint-match booleans, coverage and ambiguity counts, aggregate statuses/cohort intersections, reproduced4/43 totals or explicit mismatch, and human-recipient verification booleans with a concise verified explanation. Never return raw client IDs, client names, exact service-date rows, source-row hashes, notes, attachment bodies, credentials, session cookies, or a full data export. If row-level follow-up is necessary, keep it in the authorized private app; an ephemeral opaque audit index can link a review without exposing identities.

State separately: source arithmetic verified, actual data read, original observation reproduced, fields still unknown, no app business writes, and no deployment/native reload. These are separate findings, not one synthetic pass flag.
