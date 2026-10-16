-- SELECT-only: run in the established production SQL viewer before and after release.
-- Keep only these aggregate outputs. Do not export source rows or client identifiers.
SELECT 'snapshots' item,count(*) n,md5(string_agg(id::text||rows::text,'' ORDER BY id)) hash FROM practice_import_snapshots
UNION ALL SELECT 'snapshots_full',count(*),md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM practice_import_snapshots t
UNION ALL SELECT 'packages',count(*),md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM practice_import_packages t
UNION ALL SELECT 'goals',count(*),md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM business_goals t
UNION ALL SELECT 'scenarios',count(*),md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM scenarios t
UNION ALL SELECT 'clinicians',count(*),md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM clinicians t
UNION ALL SELECT 'staff',count(*),md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM staff_members t
UNION ALL SELECT 'reality',count(*),md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM current_reality t
UNION ALL SELECT 'workspaces',count(*),md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM hub_workspaces t
UNION ALL SELECT 'manual_records',count(*),md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM session_records t
UNION ALL SELECT 'manual_history',count(*),md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM session_record_history t;

SELECT
 (SELECT count(*) FROM practice_import_audit WHERE action='accept-billing-charge-exception') AS billing_exception_events,
 (SELECT md5(string_agg(row_to_json(t)::text,'' ORDER BY practice_id,account_id)) FROM practice_import_declarations t) AS declaration_fingerprint,
 (SELECT min(revision) FROM practice_import_declarations) AS minimum_declaration_revision,
 (SELECT max(revision) FROM practice_import_declarations) AS maximum_declaration_revision,
 (SELECT md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM practice_import_audit t WHERE action <> 'accept-billing-charge-exception') AS prior_audit_fingerprint,
 (SELECT md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM practice_import_audit t) AS full_audit_fingerprint;

-- Rollback gate: old strict readers must not be selected after new subtype rows arrive.
SELECT count(*) AS subtype_rows
FROM practice_import_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(s.rows) AS items(fact)
WHERE fact ? 'cancellationSubtype';

-- Aggregate-only impact inventory. Codes can change derived views without changing data.
SELECT upper(btrim(fact->>'billingCode')) AS code, count(*) AS rows
FROM practice_import_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(s.rows) AS items(fact)
WHERE s.active=1 AND btrim(fact->>'billingCode') IN ('1','2','4','30001','30002','30003')
GROUP BY upper(btrim(fact->>'billingCode')) ORDER BY code;
