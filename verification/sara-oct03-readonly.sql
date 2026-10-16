-- SELECT-only exact-case diagnostic. Outputs counts/booleans only, never client keys.
-- A shared client key does not prove one encounter; different keys do not prove
-- different real people if an upstream identity mapping is wrong.
WITH
active_scopes AS (
 SELECT practice_id,account_id FROM practice_import_packages WHERE active=1
 UNION SELECT practice_id,account_id FROM practice_import_snapshots WHERE active=1
),
scope AS (SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes)=1),
billing_source AS (
 SELECT s.* FROM practice_import_snapshots s JOIN scope USING(practice_id,account_id)
 WHERE s.active=1 AND s.kind='billing' AND s.source_hash='582927eaaff23946'
),
attendance_source AS (
 SELECT s.* FROM practice_import_snapshots s JOIN scope USING(practice_id,account_id)
 WHERE s.active=1 AND s.kind='attendance' AND s.source_hash='101bc22209d8152b'
),
pair AS (
 SELECT f FROM billing_source s CROSS JOIN LATERAL jsonb_array_elements(s.rows) x(f)
 WHERE (SELECT count(*) FROM billing_source)=1
 AND lower(btrim(regexp_replace(f->>'clinician','\s+',' ','g')))='(deleted) sara bucksten'
 AND f->>'serviceDate'='2025-10-03' AND upper(btrim(f->>'billingCode'))='90837'
 AND jsonb_typeof(f->'totalFeeCharged')='number'
 AND f->'totalFeeCharged' IN ('110'::jsonb,'150'::jsonb)
),
pair_shape AS (
 SELECT count(*) row_count,count(DISTINCT f->>'clientId') client_key_count,
 count(*) FILTER(WHERE coalesce(btrim(f->>'clientId'),'')='') missing_client_keys,
 count(*) FILTER(WHERE f->'totalFeeCharged'='110'::jsonb) fee_110_rows,
 count(*) FILTER(WHERE f->'totalFeeCharged'='150'::jsonb) fee_150_rows,
 count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_each(f) kv WHERE
 lower(regexp_replace(kv.key,'[^a-zA-Z0-9]','','g')) IN
 ('time','starttime','endtime','appointmenttime','servicetime','startdatetime','enddatetime','appointmentid','sessionid','encounterid','visitid')
 AND kv.value NOT IN ('null'::jsonb,'""'::jsonb))) rows_with_encounter_or_time_fields
 FROM pair
),
matched_attendance AS (
 SELECT f FROM attendance_source s CROSS JOIN LATERAL jsonb_array_elements(s.rows) x(f)
 WHERE (SELECT count(*) FROM attendance_source)=1
 AND lower(btrim(regexp_replace(f->>'clinician','\s+',' ','g')))='(deleted) sara bucksten'
 AND f->>'serviceDate'='2025-10-03'
 AND EXISTS(SELECT 1 FROM pair p WHERE p.f->>'clientId'=f->>'clientId' AND coalesce(btrim(f->>'clientId'),'')<>'')
)
SELECT
 (SELECT count(*) FROM scope)=1 AND (SELECT count(*) FROM billing_source)=1 AND (SELECT count(*) FROM attendance_source)=1 AS scope_ready,
 p.row_count,p.fee_110_rows,p.fee_150_rows,
 CASE WHEN p.row_count=2 AND p.fee_110_rows=1 AND p.fee_150_rows=1 AND p.missing_client_keys=0 THEN p.client_key_count=1 END same_stored_client_key,
 CASE WHEN p.row_count=2 AND p.fee_110_rows=1 AND p.fee_150_rows=1 AND p.missing_client_keys=0 THEN p.client_key_count=2 END different_stored_client_keys,
 p.rows_with_encounter_or_time_fields,
 (SELECT count(*) FROM matched_attendance) matching_attendance_rows,
 (SELECT count(*) FROM matched_attendance WHERE f->>'status'='show') matching_attendance_show_rows,
 (SELECT count(*) FROM matched_attendance WHERE EXISTS(SELECT 1 FROM jsonb_each(f) kv WHERE
 lower(regexp_replace(kv.key,'[^a-zA-Z0-9]','','g')) IN
 ('time','starttime','endtime','appointmenttime','servicetime','startdatetime','enddatetime','appointmentid','sessionid','encounterid','visitid')
 AND kv.value NOT IN ('null'::jsonb,'""'::jsonb))) matching_attendance_rows_with_encounter_or_time_fields
FROM pair_shape p;
