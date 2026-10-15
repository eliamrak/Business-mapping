-- One SELECT for the existing authorized SQL UI. Configuration IDs are not person IDs.
-- Returns counts/configuration membership only, never labels, source values, tokens or client fields.
-- Selected-team uniqueness is diagnostic evidence, NOT an authorized identity crosswalk.
WITH input AS (SELECT DATE '2026-10-15' AS as_of, 'elia'::text AS requested_label),
active_scopes AS (
  SELECT practice_id, account_id FROM practice_import_snapshots WHERE active = 1
  UNION SELECT practice_id, account_id FROM practice_import_packages WHERE active = 1
), scope AS (SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes) = 1),
w AS (SELECT data FROM hub_workspaces WHERE id = 1 AND EXISTS (SELECT 1 FROM scope)),
team AS (
  SELECT CASE WHEN coalesce((data #>> '{settings,teamSelectionExplicit}')::boolean, false)
    THEN (data #>> '{settings,teamId}')::integer
    ELSE coalesce((data #>> '{settings,teamId}')::integer,
      (SELECT id FROM business_goals ORDER BY created_at, id LIMIT 1)) END AS team_id
  FROM w
), roster AS (
  SELECT c.id, c.goal_id, lower(btrim(regexp_replace(c.label, '\s+', ' ', 'g'))) AS name_key,
    c.goal_id IS NOT DISTINCT FROM t.team_id AS selected_team,
    (p.profile IS NULL OR (coalesce(p.profile ->> 'onTeam', 'true') <> 'false'
      AND coalesce(p.profile ->> 'status', 'active') = 'active'
      AND p.profile ->> 'start' <= input.as_of::text
      AND (p.profile ->> 'end' IS NULL OR p.profile ->> 'end' >= input.as_of::text))) AS current_profile,
    (SELECT count(*) FROM session_records s WHERE s.clinician_id = c.id) AS manual_records
  FROM clinicians c CROSS JOIN team t CROSS JOIN input CROSS JOIN w
  LEFT JOIN LATERAL (
    SELECT profile FROM jsonb_array_elements(coalesce(w.data -> 'clinicians', '[]'::jsonb)) AS items(profile)
    WHERE (profile ->> 'clinicianId')::integer = c.id LIMIT 1
  ) p ON true
), names AS (
  SELECT name_key, count(*) AS global_rows,
    count(*) FILTER (WHERE selected_team) AS selected_rows,
    count(*) FILTER (WHERE selected_team AND current_profile) AS selected_current_rows,
    count(DISTINCT goal_id) + CASE WHEN bool_or(goal_id IS NULL) THEN 1 ELSE 0 END AS configuration_count
  FROM roster GROUP BY name_key
), source_keys AS (
  SELECT s.kind, lower(btrim(regexp_replace(coalesce(fact ->> 'clinician', ''), '\s+', ' ', 'g'))) AS name_key,
    count(*) AS raw_rows
  FROM practice_import_snapshots s JOIN scope USING (practice_id, account_id)
  CROSS JOIN LATERAL jsonb_array_elements(s.rows) AS items(fact)
  WHERE s.active = 1 GROUP BY s.kind, 2
), source_matches AS (
  SELECT s.kind, s.raw_rows, CASE
    WHEN s.name_key = '' THEN 'missing_source_label'
    WHEN n.name_key IS NULL THEN 'no_exact_roster_match'
    WHEN n.selected_rows = 0 THEN 'no_selected_team_match'
    WHEN n.selected_rows > 1 THEN 'ambiguous_within_selected_team'
    WHEN n.global_rows > 1 THEN 'unique_selected_team_but_globally_ambiguous_requires_confirmation'
    ELSE 'unique_selected_team_and_global' END AS category,
    coalesce(n.selected_current_rows, 0) AS selected_current_rows
  FROM source_keys s LEFT JOIN names n USING (name_key)
), configurations AS (
  SELECT r.goal_id, bool_or(r.selected_team) AS selected_team, count(*) AS roster_rows,
    count(*) FILTER (WHERE r.current_profile) AS current_profile_rows,
    count(*) FILTER (WHERE r.manual_records > 0) AS manual_record_bearing_rows,
    sum(r.manual_records) AS manual_records,
    count(*) FILTER (WHERE n.global_rows > 1) AS globally_repeated_label_rows,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM source_keys s WHERE s.name_key = r.name_key)) AS exact_source_label_rows,
    count(*) FILTER (WHERE r.name_key = input.requested_label) AS requested_exact_label_rows,
    coalesce(sum(r.manual_records) FILTER (WHERE r.name_key = input.requested_label), 0) AS requested_exact_label_manual_records
  FROM roster r JOIN names n USING (name_key) CROSS JOIN input GROUP BY r.goal_id
), memberships AS (
  SELECT n.name_key, n.global_rows, n.selected_rows, n.configuration_count,
    jsonb_agg(jsonb_build_object('configurationId', r.goal_id, 'rosterRows', r.rows) ORDER BY r.goal_id) AS membership
  FROM names n JOIN (SELECT name_key, goal_id, count(*) AS rows FROM roster GROUP BY name_key, goal_id) r USING (name_key)
  WHERE n.global_rows > 1 GROUP BY n.name_key, n.global_rows, n.selected_rows, n.configuration_count
), scenario_links AS (
  SELECT s.business_goal_id, count(*) AS scenario_rows,
    count(*) FILTER (WHERE sc.source_clinician_id IS NULL) AS unlinked_rows,
    count(*) FILTER (WHERE r.id IS NOT NULL) AS linked_main_roster_rows,
    count(*) FILTER (WHERE r.selected_team) AS linked_selected_team_rows
  FROM scenario_clinicians sc JOIN scenarios s ON s.id = sc.scenario_id
  LEFT JOIN roster r ON r.id = sc.source_clinician_id
  WHERE EXISTS (SELECT 1 FROM scope) GROUP BY s.business_goal_id
)
SELECT (SELECT count(*) FROM active_scopes) AS active_import_scope_count,
  (SELECT count(*) FROM w) AS workspace_count,
  CASE WHEN (SELECT count(*) FROM active_scopes) <> 1 OR (SELECT count(*) FROM w) <> 1
    THEN 'STOP_SCOPE_OR_WORKSPACE_MISSING_OR_NOT_UNIQUE'
    ELSE 'DIAGNOSTIC_ONLY_NO_MAPPING_OR_COVERAGE_AUTHORIZATION' END AS audit_status,
  (SELECT team_id FROM team) AS selected_configuration_id,
  coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY goal_id) FROM configurations c), '[]'::jsonb) AS configurations,
  coalesce((SELECT jsonb_agg(jsonb_build_object('globalRows', global_rows, 'selectedRows', selected_rows,
    'configurationCount', configuration_count, 'membership', membership)
    ORDER BY global_rows, selected_rows, membership::text) FROM memberships), '[]'::jsonb) AS anonymous_repeated_label_memberships,
  coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY kind, category) FROM (
    SELECT kind, category, count(*) AS source_keys, sum(raw_rows) AS raw_rows,
      count(*) FILTER (WHERE selected_current_rows = 1) AS unique_current_selected_matches
    FROM source_matches GROUP BY kind, category
  ) g), '[]'::jsonb) AS source_match_categories,
  coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY business_goal_id) FROM scenario_links s), '[]'::jsonb) AS scenario_source_links,
  coalesce((SELECT jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name) ORDER BY table_name, column_name)
    FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name IN ('clinicians', 'scenario_clinicians', 'practice_import_snapshots', 'practice_import_packages')
      AND column_name IN ('canonical_person_id', 'source_clinician_id', 'clinician_mapping', 'provider_mapping', 'identity_crosswalk')
  ), '[]'::jsonb) AS known_identity_column_presence;
