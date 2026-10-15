-- Authorized professional-provider confirmation table only. No inferred mapping or writes.
-- Empty output means STOP: missing scope/workspace/source labels or safety bounds exceeded.
WITH active_scopes AS (
  SELECT practice_id, account_id FROM practice_import_snapshots WHERE active = 1
  UNION SELECT practice_id, account_id FROM practice_import_packages WHERE active = 1
), scope AS (
  SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes) = 1
), w AS (
  SELECT data FROM hub_workspaces WHERE id = 1 AND EXISTS (SELECT 1 FROM scope)
), team AS (
  SELECT CASE WHEN coalesce((data #>> '{settings,teamSelectionExplicit}')::boolean, false)
    THEN (data #>> '{settings,teamId}')::integer
    ELSE coalesce((data #>> '{settings,teamId}')::integer,
      (SELECT id FROM business_goals ORDER BY created_at, id LIMIT 1)) END AS id
  FROM w
), source_labels AS (
  SELECT DISTINCT fact ->> 'clinician' AS provider_label, s.kind,
    lower(btrim(regexp_replace(fact ->> 'clinician', '\s+', ' ', 'g'))) AS name_key
  FROM practice_import_snapshots s JOIN scope USING (practice_id, account_id)
  CROSS JOIN LATERAL jsonb_array_elements(s.rows) AS items(fact)
  WHERE s.active = 1 AND s.kind IN ('attendance', 'billing')
    AND jsonb_typeof(fact -> 'clinician') = 'string'
    AND btrim(fact ->> 'clinician') <> ''
), sources AS (
  SELECT name_key, array_agg(DISTINCT provider_label ORDER BY provider_label) AS source_provider_labels,
    array_agg(DISTINCT kind ORDER BY kind) AS source_kinds
  FROM source_labels GROUP BY name_key
), roster AS (
  SELECT c.id, c.label, c.goal_id, g.name AS configuration_name,
    lower(btrim(regexp_replace(c.label, '\s+', ' ', 'g'))) AS name_key
  FROM clinicians c LEFT JOIN business_goals g ON g.id = c.goal_id
), safety AS (
  SELECT 1 WHERE (SELECT count(*) FROM w) = 1
    AND (SELECT count(*) FROM sources) BETWEEN 1 AND 20
    AND (SELECT count(*) FROM source_labels) <= 100
    AND (SELECT count(*) FROM roster) <= 200
)
SELECT s.source_provider_labels, s.source_kinds,
  t.id AS selected_configuration_id,
  CASE WHEN t.id IS NULL THEN 'Unassigned' ELSE selected.name END AS selected_configuration_name,
  r.id AS candidate_clinician_id, r.label AS candidate_professional_name,
  r.goal_id AS candidate_configuration_id,
  CASE WHEN r.id IS NULL THEN NULL WHEN r.goal_id IS NULL THEN 'Unassigned' ELSE r.configuration_name END AS candidate_configuration_name,
  r.id IS NOT NULL AND r.goal_id IS NOT DISTINCT FROM t.id AS candidate_in_selected_configuration,
  CASE WHEN r.id IS NULL THEN 'NO_EXACT_CANDIDATE_REQUIRES_OWNER_REVIEW'
    ELSE 'EXACT_NORMALIZED_LABEL_CANDIDATE_NOT_CONFIRMED_IDENTITY' END AS review_status
FROM sources s CROSS JOIN team t CROSS JOIN safety
LEFT JOIN business_goals selected ON selected.id = t.id
LEFT JOIN roster r ON r.name_key = s.name_key
ORDER BY s.name_key, candidate_in_selected_configuration DESC, r.goal_id NULLS FIRST, r.id;
