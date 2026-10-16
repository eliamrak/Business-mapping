-- SELECT-only aggregate diagnostic. No client/provider names, source IDs/hashes or rows output.
-- Selects latest active package only when one active practice/account scope exists
-- and its latest imported_at timestamp is unique. Verify its timestamp against UI.
-- Declaration reference is NOT full admission. Conflict counts are RAW candidates,
-- not approval-aware reconciled conflicts, clinical visits, revenue or cash.
WITH
active_scopes AS (
 SELECT practice_id,account_id FROM practice_import_packages WHERE active=1
 UNION SELECT practice_id,account_id FROM practice_import_snapshots WHERE active=1
),
scope AS (SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes)=1),
packages AS (
 SELECT p.* FROM practice_import_packages p JOIN scope USING(practice_id,account_id)
 WHERE p.active=1
),
newest AS (SELECT * FROM packages WHERE imported_at=(SELECT max(imported_at) FROM packages)),
latest AS (SELECT * FROM newest WHERE (SELECT count(*) FROM newest)=1),
declarations AS (
 SELECT d.* FROM practice_import_declarations d JOIN scope USING(practice_id,account_id)
),
sets AS (
 SELECT item FROM declarations CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(data->'sourceSets')='array' THEN data->'sourceSets' ELSE '[]'::jsonb END
 ) x(item)
),
sources AS (
 SELECT s.*,s.kind||'-'||s.source_hash public_id,
 EXISTS(SELECT 1 FROM latest p WHERE p.id=s.package_import_id) is_latest
 FROM practice_import_snapshots s JOIN scope USING(practice_id,account_id)
 WHERE s.active=1
),
inventory AS (
 SELECT s.kind,s.created_at,s.row_count stored_row_count,
 jsonb_array_length(CASE WHEN jsonb_typeof(s.rows)='array' THEN s.rows ELSE '[]'::jsonb END) actual_stored_array_count,
 s.coverage_start observed_start,s.coverage_end observed_end,
 s.report_coverage,
 EXISTS(SELECT 1 FROM sets WHERE item->'snapshotIds' ? s.public_id) referenced_by_any_source_set,
 EXISTS(SELECT 1 FROM sets WHERE item->'complete'='true'::jsonb AND item->'snapshotIds' ? s.public_id) referenced_by_complete_source_set
 FROM sources s WHERE is_latest
),
raw AS (
 SELECT s.kind,s.public_id,s.is_latest,f->>'clientId' client_key,
 lower(btrim(regexp_replace(f->>'clinician','\s+',' ','g'))) provider,
 f->>'serviceDate' service_day,
 upper(btrim(coalesce(f->>'billingCode',''))) code,
 coalesce(f->>'status','<missing>') status,
 CASE WHEN jsonb_typeof(f->'totalFeeCharged')='number' THEN (f->>'totalFeeCharged')::numeric END fee,
 f->>'cancellationSubtype' cancellation_subtype
 FROM sources s CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(s.rows)='array' THEN s.rows ELSE '[]'::jsonb END) x(f)
 WHERE f->>'serviceDate' BETWEEN '2026-10-10' AND '2026-10-12'
),
attendance AS (
 SELECT service_day,client_key,provider,count(*) raw_rows,
 count(*) FILTER(WHERE is_latest) latest_rows,
 count(DISTINCT public_id) source_count,count(DISTINCT status) status_variants,
 count(DISTINCT (status,coalesce(cancellation_subtype,''))) status_subtype_variants
 FROM raw WHERE kind='attendance' GROUP BY service_day,client_key,provider
 HAVING bool_or(is_latest)
),
billing AS (
 SELECT service_day,client_key,provider,code,count(*) raw_rows,
 count(*) FILTER(WHERE is_latest) latest_rows,
 count(DISTINCT public_id) source_count,count(DISTINCT fee) numeric_fee_variants,
 count(*) FILTER(WHERE fee IS NULL) missing_fee_rows
 FROM raw WHERE kind='billing' GROUP BY service_day,client_key,provider,code
 HAVING bool_or(is_latest)
),
days(service_day) AS (VALUES ('2026-10-10'),('2026-10-11'),('2026-10-12')),
overlap AS (
 SELECT d.service_day,
 (SELECT count(*) FROM raw r WHERE r.service_day=d.service_day AND r.is_latest AND r.kind='attendance') latest_attendance_rows,
 (SELECT count(*) FROM raw r WHERE r.service_day=d.service_day AND r.is_latest AND r.kind='billing') latest_billing_rows,
 (SELECT count(*) FROM attendance a WHERE a.service_day=d.service_day) attendance_encounter_candidates,
 (SELECT count(*) FROM attendance a WHERE a.service_day=d.service_day AND a.source_count>1) attendance_cross_source_groups,
 (SELECT count(*) FROM attendance a WHERE a.service_day=d.service_day AND a.status_variants>1) attendance_status_conflict_candidates,
 (SELECT count(*) FROM attendance a WHERE a.service_day=d.service_day AND a.status_subtype_variants>1) attendance_status_or_subtype_variants,
 (SELECT coalesce(sum(raw_rows-1),0) FROM attendance a WHERE a.service_day=d.service_day AND a.status_subtype_variants=1) attendance_redundant_rows_same_status_candidates,
 (SELECT count(*) FROM billing b WHERE b.service_day=d.service_day) billing_encounter_code_candidates,
 (SELECT count(*) FROM billing b WHERE b.service_day=d.service_day AND b.source_count>1) billing_cross_source_groups,
 (SELECT count(*) FROM billing b WHERE b.service_day=d.service_day AND b.numeric_fee_variants>1) billing_fee_conflict_candidates,
 (SELECT coalesce(sum(raw_rows-1),0) FROM billing b WHERE b.service_day=d.service_day AND b.numeric_fee_variants=1 AND b.missing_fee_rows=0) billing_redundant_rows_same_fee_candidates
 FROM days d
),
latest_audit AS (
 SELECT a.created_at,a.action,
 a.detail->'attendanceRows' attendance_rows,a.detail->'billingRows' billing_rows,
 a.detail->'replacedSnapshotCount' replaced_sources,
 a.detail->'retainedOverlapSnapshotCount' retained_sources,
 a.detail->'skippedDuplicateSnapshotCount' skipped_sources
 FROM practice_import_audit a JOIN scope USING(practice_id,account_id)
 JOIN latest p ON p.package_id=a.package_id
 WHERE a.action IN ('import','retain-overlap','replace-overlap')
 ORDER BY a.created_at DESC LIMIT 1
)
SELECT jsonb_build_object(
 'scope_ready',(SELECT count(*) FROM scope)=1 AND (SELECT count(*) FROM latest)=1,
 'latest_imported_at',(SELECT imported_at FROM latest),
 'latest_exported_at',(SELECT exported_at FROM latest),
 'declaration_count',(SELECT count(*) FROM declarations),
 'declaration_min_revision',(SELECT min(revision) FROM declarations),
 'declaration_max_revision',(SELECT max(revision) FROM declarations),
 'latest_success_audit',(SELECT to_jsonb(a) FROM latest_audit a),
 'latest_active_sources',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY kind) FROM inventory i),'[]'::jsonb),
 'october_10_12_raw_overlap_candidates',CASE WHEN (SELECT count(*) FROM latest)=1 THEN (SELECT jsonb_agg(to_jsonb(o) ORDER BY service_day) FROM overlap o) END,
 'billing_exception_approval_events',(SELECT count(*) FROM practice_import_audit a JOIN scope USING(practice_id,account_id) WHERE action='accept-billing-charge-exception'),
 'limits','Stored rows are not admitted actuals. Declaration reference is not admission certification. Raw conflicts ignore approval resolutions. No rejected-attempt ledger. No financial totals certified.'
) diagnostic;
