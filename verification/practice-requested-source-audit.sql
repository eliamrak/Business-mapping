-- Exact source label audit only; no person attribution, completeness or clinical-rate certification.
WITH input AS (SELECT 'elia mrakovich'::text AS source_label),
active_scopes AS (
  SELECT practice_id, account_id FROM practice_import_snapshots WHERE active = 1
  UNION SELECT practice_id, account_id FROM practice_import_packages WHERE active = 1
), scope AS (SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes) = 1),
w AS (SELECT data FROM hub_workspaces WHERE id = 1 AND EXISTS (SELECT 1 FROM scope)),
team AS (
  SELECT CASE WHEN coalesce((data #>> '{settings,teamSelectionExplicit}')::boolean, false)
    THEN (data #>> '{settings,teamId}')::integer
    ELSE coalesce((data #>> '{settings,teamId}')::integer,
      (SELECT id FROM business_goals ORDER BY created_at, id LIMIT 1)) END AS id FROM w
), matching_roster AS (
  SELECT c.id, c.goal_id FROM clinicians c CROSS JOIN input
  WHERE lower(btrim(regexp_replace(c.label, '\s+', ' ', 'g'))) = input.source_label
), raw AS (
  SELECT s.kind, fact FROM practice_import_snapshots s JOIN scope USING (practice_id, account_id)
  CROSS JOIN LATERAL jsonb_array_elements(s.rows) AS items(fact) CROSS JOIN input
  WHERE s.active = 1 AND s.kind IN ('attendance', 'billing')
    AND lower(btrim(regexp_replace(fact ->> 'clinician', '\s+', ' ', 'g'))) = input.source_label
), kinds AS (SELECT unnest(ARRAY['attendance', 'billing']) AS kind)
SELECT k.kind,
  (SELECT count(*) FROM active_scopes) AS active_import_scope_count,
  (SELECT count(*) FROM w) AS workspace_count,
  (SELECT count(*) FROM matching_roster) AS exact_label_global_roster_candidates,
  (SELECT count(*) FROM matching_roster r CROSS JOIN team t WHERE r.goal_id IS NOT DISTINCT FROM t.id) AS exact_label_selected_team_candidates,
  (SELECT count(*) FROM raw r WHERE r.kind = k.kind) AS raw_source_label_rows_before_dedup,
  (SELECT count(*) FROM raw r WHERE r.kind = k.kind AND r.fact ->> 'status' = 'show') AS raw_literal_show_rows_before_dedup,
  (SELECT count(*) FROM raw r WHERE r.kind = k.kind AND
    (lower(btrim(regexp_replace(coalesce(r.fact ->> 'billingCode', ''), '\s+', ' ', 'g'))) = 'phone'
      OR r.fact ->> 'visitKind' = 'consultation')) AS raw_consult_marker_rows_before_billing_linkage,
  CASE WHEN (SELECT count(*) FROM active_scopes) <> 1 OR (SELECT count(*) FROM w) <> 1
    THEN 'STOP_SCOPE_OR_WORKSPACE_MISSING_OR_NOT_UNIQUE'
    ELSE 'SOURCE_LABEL_ONLY_CROSSWALK_PENDING_NOT_PERSON_ACTIVITY_OR_CLINICAL_RATE' END AS interpretation
FROM kinds k;
