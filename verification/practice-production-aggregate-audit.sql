-- SELECT-only. Run in the existing production SQL UI, NOT the empty development DB.
-- No credentials, source rows, client/provider IDs, names, hashes or notes are returned.
-- Every statement independently refuses data scope unless there is exactly one active import scope.
-- Change only the explicit audit dates / requested clinician input to the agreed audit values.

-- 1. Environment/source metadata and exact missing-proof implication. Observed dates are NOT report completeness.
WITH active_scopes AS (
  SELECT practice_id, account_id FROM practice_import_snapshots WHERE active = 1
  UNION SELECT practice_id, account_id FROM practice_import_packages WHERE active = 1
), scope AS (SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes) = 1),
sources AS (
  SELECT s.* FROM practice_import_snapshots s JOIN scope u USING (practice_id, account_id) WHERE s.active = 1
), groups AS (
  SELECT kind, count(*) AS snapshots, sum(jsonb_array_length(rows)) AS raw_rows,
    min(coverage_start) AS observed_start_not_proof, max(coverage_end) AS observed_end_not_proof,
    count(*) FILTER (WHERE to_jsonb(s) -> 'report_coverage' IS NULL OR to_jsonb(s) -> 'report_coverage' = 'null'::jsonb) AS missing_proof
  FROM sources s GROUP BY kind
)
SELECT (SELECT count(*) FROM hub_workspaces WHERE id = 1) AS workspace_count,
  (SELECT count(*) FROM active_scopes) AS active_import_scope_count,
  (SELECT count(*) FROM sources) AS active_snapshot_count,
  (SELECT count(*) FROM practice_import_packages p JOIN scope u USING (practice_id, account_id) WHERE p.active = 1) AS active_package_count,
  CASE WHEN (SELECT count(*) FROM active_scopes) <> 1 THEN 'STOP_SCOPE_MISSING_OR_NOT_UNIQUE'
    WHEN NOT EXISTS (SELECT 1 FROM hub_workspaces WHERE id = 1) THEN 'STOP_NOT_EXISTING_PRODUCTION_WORKSPACE'
    WHEN (SELECT count(*) FROM sources) > 0 AND (SELECT sum(missing_proof) FROM groups) = (SELECT count(*) FROM sources)
      THEN 'ALL_ACTIVE_REPORT_COVERAGE_NULL_IMPORTED_ACTUALS_AND_CLINICAL_METRICS_WITHHELD_OWNER_OR_SOURCE_CONFIRMATION_REQUIRED'
    ELSE 'COVERAGE_PRESENT_REQUIRES_FULL_CANDIDATE_MODEL_NOT_MINMAX_INFERENCE' END AS audit_status,
  coalesce((SELECT jsonb_agg(jsonb_build_object('kind', CASE WHEN kind = 'attendance' THEN 'attendance' WHEN kind = 'billing' THEN 'billing' ELSE 'unsupported' END,
    'snapshots', snapshots, 'rawRows', raw_rows, 'missingExplicitProof', missing_proof,
    'observedStartNotProof', observed_start_not_proof, 'observedEndNotProof', observed_end_not_proof) ORDER BY kind) FROM groups), '[]'::jsonb) AS source_aggregates;

-- 2. Complete MANUAL service-period support and manual-only forecast baseline under the all-null-import-proof case.
WITH input AS (SELECT DATE '2026-10-15' AS as_of),
active_scopes AS (
  SELECT practice_id, account_id FROM practice_import_snapshots WHERE active = 1
  UNION SELECT practice_id, account_id FROM practice_import_packages WHERE active = 1
), scope AS (SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes) = 1),
w AS (SELECT data FROM hub_workspaces WHERE id = 1 AND EXISTS (SELECT 1 FROM scope)),
team AS (SELECT CASE WHEN coalesce((data #>> '{settings,teamSelectionExplicit}')::boolean, false)
    THEN (data #>> '{settings,teamId}')::integer ELSE coalesce((data #>> '{settings,teamId}')::integer,
      (SELECT id FROM business_goals ORDER BY created_at, id LIMIT 1)) END AS team_id FROM w),
roster AS (
  SELECT c.id, (p.profile IS NULL OR (coalesce(p.profile ->> 'onTeam', 'true') <> 'false'
    AND coalesce(p.profile ->> 'status', 'active') = 'active' AND p.profile ->> 'start' <= input.as_of::text
    AND (p.profile ->> 'end' IS NULL OR p.profile ->> 'end' >= input.as_of::text))) AS current
  FROM clinicians c CROSS JOIN team CROSS JOIN input CROSS JOIN w
  LEFT JOIN LATERAL (SELECT profile FROM jsonb_array_elements(coalesce(w.data -> 'clinicians', '[]'::jsonb)) AS items(profile)
    WHERE (profile ->> 'clinicianId')::integer = c.id LIMIT 1) p ON true
  WHERE c.goal_id IS NOT DISTINCT FROM team.team_id
), manual AS (
  SELECT r.*, DATE '2026-01-01' + floor((r.period_start - DATE '2026-01-01')::numeric / 14)::integer * 14 AS canonical_start
  FROM session_records r JOIN roster c ON c.id = r.clinician_id
), eligible AS (
  SELECT m.* FROM manual m CROSS JOIN input WHERE m.period_start = m.canonical_start
    AND m.period_end = m.canonical_start + 13 AND m.period_end <= input.as_of AND m.completed >= 0
), periods AS (
  SELECT e.period_start, e.period_end, count(*) AS selected_providers, count(*) FILTER (WHERE r.current) AS current_providers,
    sum(e.completed) AS completed_sessions FROM eligible e JOIN roster r ON r.id = e.clinician_id GROUP BY e.period_start, e.period_end
), cutoff AS (
  SELECT max(period_end) AS through FROM periods WHERE current_providers = (SELECT count(*) FROM roster WHERE current)
    AND (SELECT count(*) FROM roster WHERE current) > 0
), baselines AS (
  SELECT r.id, count(e.id) AS periods, sum(e.completed) AS sessions FROM roster r CROSS JOIN cutoff k
  LEFT JOIN eligible e ON e.clinician_id = r.id AND e.period_end <= k.through
    AND e.period_start >= (k.through - INTERVAL '3 months' + INTERVAL '1 day')::date
  WHERE r.current GROUP BY r.id
), imports AS (
  SELECT count(*) AS total, count(*) FILTER (WHERE to_jsonb(s) -> 'report_coverage' IS NULL OR to_jsonb(s) -> 'report_coverage' = 'null'::jsonb) AS missing
  FROM practice_import_snapshots s JOIN scope u USING (practice_id, account_id) WHERE s.active = 1
)
SELECT (SELECT count(*) FROM roster) AS selected_provider_count, (SELECT count(*) FROM roster WHERE current) AS current_provider_count,
  (SELECT count(*) FROM manual) AS retained_manual_records, (SELECT count(*) FROM eligible) AS canonical_ended_manual_records,
  (SELECT count(*) FROM manual) - (SELECT count(*) FROM eligible) AS excluded_partial_or_unaligned_manual_records,
  CASE WHEN imports.total > 0 AND imports.total = imports.missing THEN cutoff.through END AS common_manual_through_when_imports_unproved,
  CASE WHEN imports.total > 0 AND imports.total = imports.missing THEN cutoff.through + 1 END AS manual_only_forecast_start_when_imports_unproved,
  CASE WHEN imports.total > 0 AND imports.total = imports.missing AND (SELECT count(*) FROM baselines) > 0
    AND NOT EXISTS (SELECT 1 FROM baselines WHERE periods = 0) THEN (SELECT sum(sessions * 7.0 / (periods * 14)) FROM baselines) END AS manual_only_practice_weekly_when_imports_unproved,
  coalesce((SELECT jsonb_agg(jsonb_build_object('start', period_start, 'end', period_end, 'supportedSelectedProviders', selected_providers,
    'supportedCurrentProviders', current_providers, 'completedSessions', completed_sessions) ORDER BY period_start) FROM periods), '[]'::jsonb) AS manual_period_aggregates
FROM cutoff CROSS JOIN imports;

-- 3. Raw fee evidence only: not encounter-reconciled income, cash, or complete actuals.
WITH input AS (SELECT DATE '2026-01-01' AS start_date, DATE '2026-10-15' AS end_date),
active_scopes AS (
  SELECT practice_id, account_id FROM practice_import_snapshots WHERE active = 1
  UNION SELECT practice_id, account_id FROM practice_import_packages WHERE active = 1
), scope AS (SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes) = 1),
facts AS (
  SELECT fact FROM practice_import_snapshots s JOIN scope u USING (practice_id, account_id)
  CROSS JOIN LATERAL jsonb_array_elements(s.rows) AS items(fact) CROSS JOIN input
  WHERE s.active = 1 AND s.kind = 'billing' AND fact ->> 'serviceDate' BETWEEN input.start_date::text AND input.end_date::text
)
SELECT count(*) AS raw_billing_rows_in_lexical_date_window,
  count(*) FILTER (WHERE jsonb_typeof(fact -> 'totalFeeCharged') <> 'number' OR fact -> 'totalFeeCharged' IS NULL) AS invalid_or_missing_fee_values,
  sum(CASE WHEN jsonb_typeof(fact -> 'totalFeeCharged') = 'number' THEN (fact ->> 'totalFeeCharged')::numeric END) AS raw_fee_sum_before_encounter_dedup_not_certified_income,
  'RAW_SOURCE_ROWS_MAY_OVERLAP_NOT_AN_ACTUAL_INCOME_OR_CASH_TOTAL' AS basis FROM facts;

-- 4. Requested clinician's raw positive-evidence counts and exact all-null-proof candidate implications.
-- Client keys remain inside CTEs; only aggregates leave this statement. No absent days become verified misses.
WITH input AS (SELECT DATE '2026-01-01' AS start_date, DATE '2026-10-15' AS end_date, DATE '2026-10-15' AS as_of, 'elia'::text AS target),
active_scopes AS (
  SELECT practice_id, account_id FROM practice_import_snapshots WHERE active = 1
  UNION SELECT practice_id, account_id FROM practice_import_packages WHERE active = 1
), scope AS (SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes) = 1),
sources AS (SELECT s.* FROM practice_import_snapshots s JOIN scope u USING (practice_id, account_id) WHERE s.active = 1),
proof AS (SELECT count(*) > 0 AND bool_and(to_jsonb(s) -> 'report_coverage' IS NULL OR to_jsonb(s) -> 'report_coverage' = 'null'::jsonb) AS all_missing FROM sources s),
identity AS (SELECT count(DISTINCT c.id) AS matches FROM clinicians c CROSS JOIN input WHERE lower(btrim(regexp_replace(c.label, '\s+', ' ', 'g'))) = input.target),
raw AS (
  SELECT s.kind, fact, fact ->> 'clientId' AS client_key, lower(btrim(regexp_replace(fact ->> 'clinician', '\s+', ' ', 'g'))) AS clinician_key,
    fact ->> 'serviceDate' AS date_text,
    lower(btrim(regexp_replace(coalesce(fact ->> 'billingCode', ''), '\s+', ' ', 'g'))) = 'phone' OR fact ->> 'visitKind' = 'consultation' AS phone_marker
  FROM sources s CROSS JOIN LATERAL jsonb_array_elements(s.rows) AS items(fact)
), parts AS (
  SELECT *, CASE WHEN date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN substring(date_text, 1, 4)::integer END AS y,
    CASE WHEN date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN substring(date_text, 6, 2)::integer END AS m,
    CASE WHEN date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN substring(date_text, 9, 2)::integer END AS d FROM raw
), months AS (SELECT *, CASE WHEN y BETWEEN 1 AND 9999 AND m BETWEEN 1 AND 12 THEN make_date(y, m, 1) END AS month_start FROM parts),
dated AS (SELECT *, CASE WHEN d BETWEEN 1 AND extract(day FROM month_start + INTERVAL '1 month - 1 day') THEN month_start + (d - 1) END AS service_date FROM months),
billing AS (
  SELECT client_key, clinician_key, service_date, bool_or(coalesce(phone_marker, false)) AND NOT bool_or(NOT coalesce(phone_marker, false)) AS phone_only
  FROM dated WHERE kind = 'billing' AND service_date IS NOT NULL GROUP BY client_key, clinician_key, service_date
), shows AS (
  SELECT DISTINCT a.client_key, a.clinician_key, a.service_date, coalesce(a.phone_marker, false) OR coalesce(b.phone_only, false) AS consultation
  FROM dated a LEFT JOIN billing b USING (client_key, clinician_key, service_date) CROSS JOIN input
  WHERE a.kind = 'attendance' AND a.fact ->> 'status' = 'show' AND a.service_date <= input.as_of
), consults AS (
  SELECT client_key, min(service_date) AS first_consult FROM shows CROSS JOIN input
  WHERE consultation AND clinician_key = input.target GROUP BY client_key
), journeys AS (
  SELECT c.*, EXISTS (SELECT 1 FROM shows t CROSS JOIN input WHERE t.client_key = c.client_key AND NOT t.consultation
    AND t.service_date >= c.first_consult AND t.service_date <= (c.first_consult + INTERVAL '1 month')::date AND t.service_date <= input.as_of) AS positive_followup
  FROM consults c CROSS JOIN input WHERE c.first_consult BETWEEN input.start_date AND input.end_date
), treatment_dates AS (
  SELECT client_key, array_agg(DISTINCT service_date ORDER BY service_date) AS dates FROM shows CROSS JOIN input
  WHERE NOT consultation AND clinician_key = input.target GROUP BY client_key
), retention_starts AS (
  SELECT *, cardinality(dates) >= 3 AND dates[2] - dates[1] <= 28 AND dates[3] - dates[2] <= 28 AS positive_retained
  FROM treatment_dates CROSS JOIN input WHERE dates[1] BETWEEN input.start_date AND input.end_date
), overrides AS (
  SELECT value FROM hub_workspaces w CROSS JOIN LATERAL jsonb_array_elements(coalesce(w.data -> 'consultAttributionOverrides', '[]'::jsonb)) AS entries(value)
  CROSS JOIN input WHERE w.id = 1 AND EXISTS (SELECT 1 FROM scope) AND coalesce(value ->> 'archived', 'false') <> 'true'
    AND value ->> 'outcome' = 'confirmed_closer' AND lower(btrim(regexp_replace(value ->> 'clinicianName', '\s+', ' ', 'g'))) = input.target
)
SELECT identity.matches AS requested_name_global_identity_matches,
  (SELECT count(*) FROM dated WHERE service_date IS NULL) AS invalid_raw_service_date_rows,
  CASE WHEN identity.matches = 1 THEN (SELECT count(*) FROM journeys) END AS raw_requested_name_consult_journeys,
  CASE WHEN identity.matches = 1 THEN (SELECT count(*) FROM journeys WHERE positive_followup) END AS raw_journeys_with_positive_treatment_followup,
  CASE WHEN identity.matches = 1 THEN (SELECT count(*) FROM overrides) END AS stored_confirmed_closer_overrides_not_yet_journey_validated,
  CASE WHEN identity.matches = 1 THEN (SELECT count(*) FROM retention_starts WHERE positive_retained) END AS raw_positive_initial_retention_starts,
  CASE WHEN identity.matches = 1 THEN (SELECT count(*) FROM retention_starts WHERE NOT coalesce(positive_retained, false)) END AS raw_other_starts_not_certified_failures,
  CASE WHEN proof.all_missing THEN 0 END AS candidate_admitted_imported_clinical_facts,
  NULL::numeric AS candidate_clinical_percent_not_certified_by_this_sql,
  CASE WHEN proof.all_missing THEN 'NO_ADMITTED_IMPORTS_CLOSE_AND_RETENTION_RATES_UNKNOWN_NOT_ZERO_PERCENT'
    ELSE 'STOP_USE_FULL_CANDIDATE_MODEL_FOR_PROVED_SOURCES' END AS candidate_interpretation,
  CASE WHEN identity.matches = 1 THEN 'RAW_POSITIVES_ONLY_NOT_SOURCE_COMPLETENESS_OR_CONFIRMED_CREDIT'
    ELSE 'REQUESTED_NAME_MISSING_OR_GLOBALLY_AMBIGUOUS_DO_NOT_ATTRIBUTE' END AS raw_evidence_limit
FROM proof CROSS JOIN identity;
