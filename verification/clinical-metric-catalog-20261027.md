# Practice / clinician metric catalog — unconnected review candidate

Builds on shared foundation2478ae9. No database duplication, migrations, reimports, UI changes, downstream formula replacements, provider connections, or deployment.

## Population attribution

Retention qualification and 90-day absence are practice-wide across admitted historical providers. A clinician does NOT need to have delivered all three qualifying visits. At the cutoff, the most recent observed treatment-date provider(s) receive the clinician-client assignment. Multiple same-day providers each receive one pair; practice clients remain unique. The DTO reports clinicianClientPairs, sharedRetainedClients and excessClinicianClientPairs. Clinician values must not be summed as unique practice clients.

Both 3/12-month columns use the same explicit population asOf. Attendance and exposure windows differ; A6 is the same cutoff snapshot, not two differently filtered retained cohorts. Current roster and global follow-up rules remain explicit. No return is labeled a new initial start or confirmed re-enrolment.

## Shared catalog

`deriveClinicalMetricCatalog` returns whole-practice and each current clinician's threeMonths/twelveMonths collections. Each includes scope ID, source/provenance/coverage DTO, asOf, calendar anchor, stable metric ID, unit, formulaVersion, model category, value/status/reason and denominators where computed. Clinical catalog computation uses existing authorized database inputs; no manual Page datastore is created.

Computed clinical/configured metrics:
- treatment_sessions; sessions_per_week (covered calendar-day weighted)
- weekly_unique_attendees; monthly_unique_attendees
- retained_not_ended; retained_sessions; retained_client_weeks; retained_sessions_per_client_week
- all_attender_sessions_per_client_week (current attendee-month proxy, separate from proposed retained-only frequency)
- desired_weekly_capacity (configured target, not observed actual)
- reported_leads; reported_leads_per_month (existing complete funnel records)

Lead attribution is never allocated by headcount or workload. A clinician's recorded lead total requires source rows with explicit clinician attribution and complete period evidence. Practice totals/unassigned rows cannot silently become clinician totals. Missing clinician rows remain unknown rather than assumed zero. Practice source totals remain distinct from individual identity-linked client outcomes.

## Existing workflow adapter — NOT new equations

Optional `currentModels` accepts the existing engine’s already-computed practice output only. Caller-supplied clinician models are rejected: the existing engine DTO does not yet bind outputs to an immutable provider/source scope, so labeling a practice model with a clinician ID is insufficient. Provider clinical measures and recorded leads are available; provider calculated acquisition targets remain unavailable pending the source-bound engine review. Its cutoff must match the catalog, and attendance calendar windows must match before values are admitted. Any future provider target adapter must additionally require recorded attribution for the actual mature-flow months, not merely recent calendar leads. Rejected calendar-mismatched practice outputs are not exposed through the adjacent workflowSource field.

Stable workflow slots: matured_starts_per_month, apparent_endings_per_month, start_end_flow_balance, observed_consultation_close_rate, workload_growth_per_month, required_workload_growth_per_month, required_client_equivalents_per_month, required_matured_starts_per_month, required_leads_per_month, provider_lead_requirement, estimated_fill_months, target_pace_percent. Existing engine source metadata accompanies these values. When no accepted practice engine result is supplied, or for clinician acquisition slots, these are explicitly unavailable—not newly estimated or derived through a proposed retained-only funnel.

This adapter is preparation, not a claim that all clinician acquisition equations are settled or live. The caller must use the same authorized source/config revision; no cross-version caching is introduced. Formula review must establish the approved routing/target equation before any live wiring. No fallback conversion assumptions are enabled, and no VA contact/outreach occurs.

## Remaining explicit gates

- User review/agreement on equations, attribution and retained-frequency use.
- Connect approved shared computations to app queries/views and source/config invalidation; current candidate is intentionally unconnected.
- Recorded clinician-attributed leads are needed for provider lead requirements; absent attribution is not an implementation permission to fabricate a split.
- Single publisher review/deployment after approval. No new visual surface exists in this commit; no new live screenshot verification is claimed.

## Final validation

- Full regression: **1,317 passed**, zero failed (`/tmp/clinical-catalog-final-full.log`).
- Dashboard TypeScript passed (`/tmp/clinical-catalog-types.log`).
- Dashboard production build passed (`/tmp/clinical-catalog-final-build.log`); existing sourcemap/chunk-size warnings remain.
- Independent read-only review: **15/15 focused tests passed**; accepted for unwired derived-layer scope after rejecting unbound clinician models and removing rejected workflowSource output.
- Shared-patient pair counts, practice-wide qualification, same-cutoff3/12 comparisons, no provider lead splitting and invalid workflow cutoff/window/scope paths tested.
- No visual changes or new browser actions; source-only candidate. Not published, installed, deployed or live-wired.
