-- One SELECT; active raw billing evidence, matching Imports' unfiltered fee counters.
-- Internal client keys and row/source hashes NEVER leave the CTEs.
-- Professional labels, service dates/codes, numeric fees and anonymous source provenance only.
WITH RECURSIVE active_scopes AS (
  SELECT practice_id, account_id FROM practice_import_snapshots WHERE active = 1
  UNION SELECT practice_id, account_id FROM practice_import_packages WHERE active = 1
), scope AS (
  SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes) = 1
), sources AS (
  SELECT s.*, dense_rank() OVER (ORDER BY s.kind || '-' || s.source_hash) AS source_no
  FROM practice_import_snapshots s JOIN scope USING (practice_id, account_id)
  WHERE s.active = 1 AND s.kind = 'billing'
), bounds AS (
  SELECT count(*) <= 20 AND coalesce(sum(CASE WHEN jsonb_typeof(rows) = 'array'
    THEN jsonb_array_length(rows) ELSE 10001 END), 0) <= 10000 AS safe
  FROM sources
), facts AS (
  SELECT row_number() OVER (ORDER BY s.source_no, s.created_at, s.id, f.ordinality) AS node,
    s.source_no, s.created_at, s.coverage_start, s.coverage_end, f.fact
  FROM sources s CROSS JOIN bounds
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN bounds.safe THEN s.rows ELSE '[]'::jsonb END)
    WITH ORDINALITY AS f(fact, ordinality)
), normalized AS (
  SELECT *, regexp_replace(fact ->> 'clientId', '^\s+|\s+$', '', 'g') AS client_key,
    lower(btrim(regexp_replace(fact ->> 'clinician', '\s+', ' ', 'g'))) AS clinician_key,
    coalesce(lower(btrim(regexp_replace(fact ->> 'billingCode', '\s+', ' ', 'g'))), '') AS code_key,
    fact ->> 'sourceRowHash' AS row_hash,
    fact ->> 'serviceDate' AS service_date
  FROM facts
), typed AS (
  SELECT coalesce(bool_and(coalesce(jsonb_typeof(fact -> 'clientId') = 'string'
    AND jsonb_typeof(fact -> 'clinician') = 'string'
    AND jsonb_typeof(fact -> 'serviceDate') = 'string'
    AND jsonb_typeof(fact -> 'sourceRowHash') = 'string'
    AND jsonb_typeof(fact -> 'totalFeeCharged') = 'number'
    AND coalesce(jsonb_typeof(fact -> 'billingCode'), 'null') IN ('string', 'null')
    AND coalesce(jsonb_typeof(fact -> 'visitKind'), 'null') IN ('string', 'null'), false)), true) AS safe
  FROM normalized
), keyed AS (
  SELECT *, jsonb_build_array(client_key, clinician_key, service_date, code_key) AS encounter_key,
    coalesce(fact ->> 'visitKind', CASE WHEN code_key = 'phone' THEN 'consultation' ELSE '' END) AS kind_key
  FROM normalized CROSS JOIN typed WHERE typed.safe
), payloads AS (
  SELECT *, jsonb_build_array(encounter_key, kind_key, fact -> 'totalFeeCharged') AS payload,
    min(node) OVER (PARTITION BY encounter_key) AS encounter_anchor,
    min(node) OVER (PARTITION BY row_hash) AS hash_anchor
  FROM keyed
), links AS (
  SELECT node, encounter_anchor AS other FROM payloads WHERE node <> encounter_anchor
  UNION SELECT node, hash_anchor FROM payloads
    WHERE node <> hash_anchor AND regexp_replace(row_hash, '\s+', '', 'g') <> ''
), edges AS (
  SELECT node, other FROM links UNION SELECT other, node FROM links
), reach(node, member) AS (
  SELECT node, node FROM payloads
  UNION SELECT r.node, e.other FROM reach r JOIN edges e ON e.node = r.member
), bounded_reach AS MATERIALIZED (
  SELECT * FROM reach LIMIT 20001
), roots AS (
  SELECT node, min(member) AS component FROM bounded_reach GROUP BY node
), grouped AS (
  SELECT p.*, r.component FROM payloads p JOIN roots r USING (node)
), per_source AS (
  SELECT component, source_no, count(*) AS raw_rows, count(DISTINCT row_hash) AS distinct_row_hashes,
    count(DISTINCT payload) AS payload_variants,
    min(created_at) AS imported_at, min(coverage_start) AS observed_start, max(coverage_end) AS observed_end
  FROM grouped GROUP BY component, source_no
), per_hash AS (
  SELECT component, row_hash, count(DISTINCT payload) > 1 AS conflicting_payload
  FROM grouped GROUP BY component, row_hash
), cases AS (
  SELECT component, count(*) AS raw_rows, count(DISTINCT source_no) AS source_count,
    count(DISTINCT encounter_key) AS encounter_identity_count,
    count(DISTINCT row_hash) AS row_hash_count,
    count(DISTINCT payload) > 1 AS conflicting,
    bool_or(regexp_replace(row_hash, '\s+', '', 'g') = '') AS missing_hash,
    bool_or(client_key = '' OR clinician_key = '') AS missing_identity,
    bool_or(code_key = '') AS missing_code,
    array_agg(DISTINCT btrim(regexp_replace(fact ->> 'clinician', '\s+', ' ', 'g'))) AS clinicians,
    array_agg(DISTINCT CASE WHEN service_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN service_date ELSE '[invalid date omitted]' END) AS service_dates,
    jsonb_agg(DISTINCT fact -> 'totalFeeCharged') AS fee_variants,
    array_agg(DISTINCT CASE WHEN length(code_key) <= 80 THEN code_key ELSE '[overlong code omitted]' END) AS codes,
    count(DISTINCT kind_key) AS visit_kind_variant_count
  FROM grouped GROUP BY component
), classified AS (
  SELECT c.*,
    EXISTS (SELECT 1 FROM per_hash h WHERE h.component = c.component AND h.conflicting_payload) AS hash_conflict,
    EXISTS (SELECT 1 FROM per_source s WHERE s.component = c.component AND s.distinct_row_hashes > 1) AS repeated_distinct_hashes_within_source,
    EXISTS (SELECT 1 FROM per_source s WHERE s.component = c.component AND s.distinct_row_hashes > 1)
      OR (raw_rows > 1 AND missing_code AND row_hash_count > 1) OR missing_identity AS ambiguous
  FROM cases c
), flagged AS (
  SELECT *, row_number() OVER (ORDER BY component) AS case_no FROM classified
  WHERE conflicting OR ambiguous
), safety AS (
  SELECT (SELECT count(*) FROM active_scopes) = 1 AND bounds.safe AND typed.safe
    AND (SELECT count(*) FROM bounded_reach) <= 20000 AND (SELECT count(*) FROM flagged) <= 50
    -- Mixed empty/nonempty codes across identities depend on JS locale sorting; refuse approximation.
    AND NOT EXISTS (SELECT 1 FROM classified c WHERE c.encounter_identity_count > 1 AND c.missing_code
      AND EXISTS (SELECT 1 FROM grouped g WHERE g.component = c.component AND g.code_key <> '')) AS safe
  FROM bounds CROSS JOIN typed
)
SELECT CASE WHEN safety.safe THEN 'DIAGNOSTIC_ONLY_NO_WINNER_OR_WRITE'
    ELSE 'STOP_SCOPE_TYPE_OR_SIZE_LIMIT_NO_PARTIAL_CASE_REPORT' END AS audit_status,
  (SELECT count(*) FROM active_scopes) AS active_scope_count,
  CASE WHEN safety.safe THEN (SELECT count(*) FROM classified WHERE conflicting) END AS ui_fee_conflict_count,
  CASE WHEN safety.safe THEN (SELECT count(*) FROM classified WHERE ambiguous) END AS ui_ambiguous_encounter_count,
  CASE WHEN safety.safe THEN (SELECT count(*) FROM flagged) END AS distinct_flagged_case_count,
  CASE WHEN safety.safe THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
    'case', f.case_no, 'clinicians', f.clinicians, 'serviceDates', f.service_dates,
    'feeVariants', f.fee_variants, 'codes', f.codes, 'visitKindVariantCount', f.visit_kind_variant_count,
    'feeConflict', f.conflicting, 'ambiguous', f.ambiguous, 'sameHashDifferentPayload', f.hash_conflict,
    'multipleRowHashesWithinSource', f.repeated_distinct_hashes_within_source,
    'missingHash', f.missing_hash, 'missingCode', f.missing_code, 'missingIdentity', f.missing_identity,
    'rawRows', f.raw_rows, 'sourceCount', f.source_count, 'encounterIdentityCount', f.encounter_identity_count,
    'rowHashCount', f.row_hash_count, 'sources', (SELECT jsonb_agg(jsonb_build_object(
      'anonymousSource', s.source_no, 'rawRows', s.raw_rows, 'distinctRowHashes', s.distinct_row_hashes,
      'payloadVariants', s.payload_variants, 'importedAt', s.imported_at,
      'observedStartNotProof', s.observed_start, 'observedEndNotProof', s.observed_end)
      ORDER BY s.source_no) FROM per_source s WHERE s.component = f.component)) ORDER BY f.case_no)
    FROM flagged f), '[]'::jsonb) END AS fee_cases
FROM safety;
