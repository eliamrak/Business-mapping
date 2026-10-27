# Coherent source revisions and owner capacity — prepared, not installed

`configuredWeeklyCapacity` uses the current authorized roster's `clinicians.sessionsPerWeek` as owner-declared desired weekly workload. No calendar access, calendar certification, hardcoded94 or alternate copied capacity is required. Missing/invalid roster inputs remain unknown. The catalog uses the same helper for practice and clinician scopes in both lookbacks.

`automaticGrowthWithConfiguredCapacity` is an unwired adapter to the existing model. It recomputes gap, required workload growth, client-equivalent requirements, starts/leads estimates and fill time from the same roster input on every call. This proves dependency behavior; it does not approve that model's equations or substitute the new A6/A7 into it. Unknown lead/frequency inputs remain unknown. Provider reports must already match the authorized scope; no inferred allocation of practice leads is enabled. The optional catalog workflow adapter now rejects capacity-stale model output.

Dependency graph:
- snapshots + classification/admission declarations + overrides + coverage + as-of -> admitted treatments and observation evidence;
- evidence + current roster/scope + calendar anchor -> practice/provider3/12 attendance, daily established A6 and matching A7;
- owner roster `sessionsPerWeek` -> configured target; changing it does not rewrite historical attendance;
- complete source/settings input -> new computation revision -> full immutable catalog -> atomic acceptance only if revision is still current;
- acquisition equations -> separate review gate, not connected in the coherent catalog coordinator.

`createClinicalComputationCoordinator` captures a structured clone of the complete input before computation. Every begin invalidates the prior published bundle, even if the caller believes only one field changed. No selective cache can retain old dependent values. Both periods and every scope come from the captured snapshot. Only bundles produced by the same coordinator and current pending revision can be accepted; stale/foreign/replayed results are rejected. Errors publish no partial data. Clear invalidates pending work for sign-out/scope changes. Deep freezing prevents a consumer mutating one part of an accepted bundle.

Revision numbers are local ordering tokens, not persisted source revision hashes, authentication, or approval. This is not a live subscription, async loader, database transaction or deployed cache. The future integration must assemble source records/settings from one coherent authorized server revision before `begin`, instantiate/clear per account context, trigger begin on every relevant source change, and replace the displayed bundle atomically. This helper cannot detect mixed revisions already assembled by an upstream loader. Precomputed acquisition models are rejected to prevent injecting stale outputs; unreviewed workflow slots are explicitly unavailable.

Tests cover snapshot isolation, frozen outputs,94-to70capacity changes preserving facts, both period dependencies, clinician targets and roster removal, attendance/override/coverage/settings changes, missing rates, delayed completion, foreign bundles, repeated completion, sign-out and failure handling. Synthetic only. No production records, migrations, live wiring or deployment.

Validation: 1,334 full tests, dashboard types/build passed; independent review accepted (including invalid capture stale-state regression). No rendered UI changes.
