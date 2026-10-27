# Established-client acquisition proposal — not installed

Source-derived yield (`observed-start-cohort-established-yield-v1`): use first observed admitted treatment dates in explicit complete calendar start months. Count how many of those clients have reached a third distinct treatment date by the observation cutoff, regardless of early gaps. Divide that observed established count by complete reported leads for the same start months. Retain starts, established-by-cutoff, not-yet-established and minimum/maximum follow-up days. Prior starters and returns are not new starts.

This is an unlinked historical aggregate planning ratio, not measured person-level lead conversion. It can exceed1 because leads and treatment starts are not joined and may lag; no clamp or probability label is applied. Not-yet-established is right-censored, not permanent failure. The first-observed-start qualification cannot prove there were no pre-import visits. Complete cohort/follow-up coverage and no unresolved admission evidence are required. Missing annual lead months remain unknown. Provider yield requires explicit recorded provider lead attribution; practice totals are never split or reused as fallback. Practice qualification spans providers; start attribution uses the provider(s) on the first observed treatment date.

Prepared bounded-linear target equation (`established-workload-lead-target-proposal-v2`):

- T = owner-configured current roster weekly capacity; W = observed weekly workload for that column; H = horizon; f = that column's A7 established-active sessions/client/week.
- netLoss = (established active expiry events − reactivation events) / covered ledger months.
- noAcquisitionWorkload = max(0, W − H × f × netLoss).
- requiredEstablished/month = max(0, T − noAcquisitionWorkload) / (H × f).
- estimatedLeads/month = requiredEstablished / that column's observed established-per-reported-lead planning ratio.

Capacity0 yields0 demand, including missing rates. Positive capacity requires valid positive horizon/frequency, observed workload and compatible event ledger. Positive established demand requires positive finite yield; zero demand remains0 with missing yield. Finite-input arithmetic overflow returns unknown. This preserves over-capacity surplus before replacement and prevents projected workload falling below0. Annual missing leads remain unknown; no borrowing another column's yield.

`establishedActivityLedger` derives expiry on the90th day of inactivity (not a backdated last visit), reactivation on an actual return, and new third-date qualification. Provider transfers remain separate. Opening/closing active stock reconciles to new establishment + reactivation − expiry + transfers in − transfers out. Missing coverage or unresolved states withhold counts. It uses day-specific qualification/provider membership with no future lookahead.

Assumptions: marginal newly established load = period A7; expiry and return load = the same f; existing early-client workload stable; new prequalification visits receive no extra workload credit; flows remain stable. These are assumption-bound planning estimates, not person-level conversion or a validated deadline forecast. Lead-to-start/third-visit lag, ramp-up and new-cohort survival are not modeled. Do not add an initial-retention multiplier, use old backdated ending counts, or subtract attrition again from a net workload trend.

The pure equation function accepts explicit numerical ledger inputs to make the contract reviewable. It does not itself verify that a caller supplied a source-matched ledger/frequency/yield. Future source-bound wiring must bind scope, window, cutoff and revision for every input and may not fabricate inputs. No caller is live or enabled yet.

Clinician rollout plan: run canonical source admission once from an authorized coherent snapshot; derive the same practice/global establishment index; build daily clinician attribution and exposure; source each clinician's configured capacity and explicitly attributed lead periods; then calculate compatible clinician ledger workload and targets only after formula review. Preserve practice uniqueness versus clinician pairs. Publish both3/12 results atomically via the prepared bundle coordinator only after connecting the reviewed equations and coherent server-source loading. Current coordinator intentionally rejects precomputed acquisition models and keeps these targets unwired.

No actual records were copied into fixtures. Parent-reported real Apr–Jun and annual results remain separate independently verified evidence. No live source calls, database changes, imports, credentials or deployment. User agreement on the complete concrete equations and installation remains required.

Validation: final1,343/1,343 regression tests passed; dashboard types and production build passed (existing warnings). Independent review accepted9focusedtests plus shared-provider transfer probe. No rendered UI changed.
