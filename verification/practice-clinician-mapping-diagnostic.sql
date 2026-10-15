-- SELECT-only production SQL UI diagnostic. No patient fields, names, mapping values, IDs or hashes are returned.
-- Prefix/ID matches are diagnostic candidates, NEVER an automatic crosswalk or proof of identity.
WITH input AS (SELECT 'elia'::text AS target, DATE '2026-01-01' AS start_date, DATE '2026-10-15' AS end_date),
active_scopes AS (
  SELECT practice_id, account_id FROM practice_import_snapshots WHERE active = 1
  UNION SELECT practice_id, account_id FROM practice_import_packages WHERE active = 1
), scope AS (SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes) = 1),
roster AS (
  SELECT id, lower(btrim(regexp_replace(label, '\s+', ' ', 'g'))) AS name_key FROM clinicians
), target AS (
  SELECT count(DISTINCT id) AS identity_matches, CASE WHEN count(DISTINCT id) = 1 THEN min(id) END AS id
  FROM roster CROSS JOIN input WHERE name_key = input.target
), facts AS (
  SELECT s.kind, fact, lower(btrim(regexp_replace(coalesce(fact ->> 'clinician', ''), '\s+', ' ', 'g'))) AS source_key
  FROM practice_import_snapshots s JOIN scope u USING (practice_id, account_id)
  CROSS JOIN LATERAL jsonb_array_elements(s.rows) AS items(fact) WHERE s.active = 1
), matches AS (
  SELECT f.*, input.target AS target_name_key, input.start_date, input.end_date, target.identity_matches,
    (SELECT count(DISTINCT r.id) FROM roster r WHERE r.name_key = f.source_key) AS exact_name_id_matches,
    EXISTS (SELECT 1 FROM roster r WHERE r.id::text = f.source_key) AS main_field_matches_any_numeric_roster_id,
    f.source_key = target.id::text AS main_field_matches_target_numeric_id,
    EXISTS (SELECT 1 FROM unnest(ARRAY[f.fact ->> 'clinicianId', f.fact ->> 'clinician_id', f.fact ->> 'providerId', f.fact ->> 'provider_id']) AS aliases(value)
      WHERE value = target.id::text) AS separate_id_field_matches_target,
    EXISTS (SELECT 1 FROM unnest(ARRAY[f.fact ->> 'clinicianName', f.fact ->> 'clinician_name', f.fact ->> 'providerName', f.fact ->> 'provider_name']) AS aliases(value)
      WHERE lower(btrim(regexp_replace(value, '\s+', ' ', 'g'))) = input.target) AS separate_name_field_matches_target
  FROM facts f CROSS JOIN input CROSS JOIN target
), classified AS (
  SELECT *, CASE
    WHEN coalesce(jsonb_typeof(fact -> 'clinician'), 'null') NOT IN ('string', 'number') OR source_key = '' THEN 'missing_or_unsupported_main_clinician_field'
    WHEN exact_name_id_matches > 1 THEN 'globally_ambiguous_exact_roster_name'
    WHEN source_key = target_name_key AND exact_name_id_matches = 1 THEN 'exact_requested_roster_name'
    WHEN exact_name_id_matches = 1 THEN 'exact_other_roster_name'
    WHEN main_field_matches_target_numeric_id THEN 'requested_numeric_id_in_name_field_requires_schema_crosswalk'
    WHEN main_field_matches_any_numeric_roster_id THEN 'other_numeric_roster_id_in_name_field_requires_schema_crosswalk'
    WHEN left(source_key, length(target_name_key) + 1) = target_name_key || ' ' THEN 'requested_name_token_prefix_candidate_not_verified'
    WHEN left(target_name_key, length(source_key) + 1) = source_key || ' ' THEN 'source_token_prefix_candidate_not_verified'
    ELSE 'unmapped_main_clinician_field' END AS category
  FROM matches
), distribution AS (
  SELECT CASE WHEN kind = 'attendance' THEN 'attendance' WHEN kind = 'billing' THEN 'billing' ELSE 'unsupported' END AS kind,
    category, count(*) AS raw_rows, count(DISTINCT source_key) AS distinct_source_keys,
    count(*) FILTER (WHERE fact ->> 'serviceDate' BETWEEN start_date::text AND end_date::text) AS raw_rows_in_requested_iso_text_window,
    count(*) FILTER (WHERE separate_id_field_matches_target) AS separate_id_field_target_matches,
    count(*) FILTER (WHERE separate_name_field_matches_target) AS separate_name_field_target_matches,
    count(*) FILTER (WHERE fact ->> 'status' = 'show') AS literal_show_rows,
    count(*) FILTER (WHERE lower(btrim(regexp_replace(coalesce(fact ->> 'status', ''), '\s+', ' ', 'g'))) = 'show') AS normalized_show_rows,
    count(*) FILTER (WHERE fact ? 'serviceDate') AS service_date_field_present_rows,
    count(*) FILTER (WHERE fact ->> 'serviceDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AS service_date_iso_shape_rows,
    count(*) FILTER (WHERE fact ? 'service_date' OR fact ? 'dateOfService' OR fact ? 'date') AS alternate_date_field_present_rows,
    count(*) FILTER (WHERE fact ? 'clinicianId' OR fact ? 'clinician_id' OR fact ? 'providerId' OR fact ? 'provider_id') AS separate_id_field_present_rows,
    count(*) FILTER (WHERE fact ? 'clinicianName' OR fact ? 'clinician_name' OR fact ? 'providerName' OR fact ? 'provider_name') AS separate_name_field_present_rows
  FROM classified GROUP BY 1, category
), frequencies AS (
  SELECT count(*) AS raw_rows_per_source_key FROM facts GROUP BY kind, source_key
), frequency_histogram AS (
  SELECT raw_rows_per_source_key, count(*) AS anonymous_key_count FROM frequencies GROUP BY raw_rows_per_source_key
)
SELECT (SELECT count(*) FROM active_scopes) AS active_import_scope_count,
  target.identity_matches AS requested_name_global_roster_identity_matches,
  CASE WHEN (SELECT count(*) FROM active_scopes) <> 1 THEN 'STOP_SCOPE_MISSING_OR_NOT_UNIQUE'
    WHEN target.identity_matches <> 1 THEN 'STOP_REQUESTED_ROSTER_IDENTITY_MISSING_OR_AMBIGUOUS'
    ELSE 'DIAGNOSTIC_ONLY_NO_ACTIVITY_INFERENCE_OR_AUTOMATIC_CROSSWALK' END AS audit_status,
  CASE WHEN target.identity_matches = 1 AND EXISTS (SELECT 1 FROM scope)
    THEN (SELECT count(*) FROM session_records WHERE clinician_id = target.id) END AS manual_records_for_requested_roster_id_all_dates,
  CASE WHEN target.identity_matches = 1 AND EXISTS (SELECT 1 FROM scope)
    THEN (SELECT count(*) FROM session_records CROSS JOIN input WHERE clinician_id = target.id AND period_start >= input.start_date AND period_end <= input.end_date) END AS manual_records_for_requested_roster_id_in_window,
  CASE WHEN target.identity_matches = 1 AND EXISTS (SELECT 1 FROM scope)
    THEN (SELECT sum(completed) FROM session_records CROSS JOIN input WHERE clinician_id = target.id AND period_start >= input.start_date AND period_end <= input.end_date) END AS manual_recorded_sessions_in_window_not_a_retention_metric,
  coalesce((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'category', category, 'rawRows', raw_rows, 'distinctSourceKeys', distinct_source_keys,
    'rawRowsInRequestedWindow', raw_rows_in_requested_iso_text_window, 'separateIdFieldTargetMatches', separate_id_field_target_matches,
    'literalShowRows', literal_show_rows, 'normalizedShowRows', normalized_show_rows, 'serviceDateFieldPresentRows', service_date_field_present_rows,
    'serviceDateIsoShapeRows', service_date_iso_shape_rows, 'alternateDateFieldPresentRows', alternate_date_field_present_rows,
    'separateNameFieldTargetMatches', separate_name_field_target_matches, 'separateIdFieldPresentRows', separate_id_field_present_rows,
    'separateNameFieldPresentRows', separate_name_field_present_rows) ORDER BY kind, category) FROM distribution), '[]'::jsonb) AS matching_category_distribution,
  coalesce((SELECT jsonb_agg(jsonb_build_object('rawRowsPerAnonymousSourceKey', raw_rows_per_source_key, 'anonymousKeyCount', anonymous_key_count)
    ORDER BY raw_rows_per_source_key) FROM frequency_histogram), '[]'::jsonb) AS anonymous_key_frequency_histogram
FROM target;
