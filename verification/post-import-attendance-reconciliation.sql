-- SELECT-only post-import attendance acceptance. Fixed as-of 2026-10-16.
-- September 17..October 16 is the requested inclusive 30-day selection.
-- Inherits the reviewed six-source/five-approval release gate; source rows remain private.
-- Complete source-period admission precedes exact daily selection; manual aggregates are never prorated.
WITH
settings AS (SELECT DATE '2025-07-01' first_day,DATE '2026-10-12' last_day),
scopes AS (
 SELECT practice_id,account_id FROM practice_import_packages WHERE active=1
 UNION SELECT practice_id,account_id FROM practice_import_snapshots WHERE active=1
), scope AS (SELECT * FROM scopes WHERE (SELECT count(*) FROM scopes)=1),
declarations AS (SELECT d.* FROM practice_import_declarations d JOIN scope USING(practice_id,account_id)),
history_events AS (
 SELECT a.* FROM practice_import_audit a JOIN scope USING(practice_id,account_id)
 WHERE action='confirm-historical-billing-providers'
), history AS (
 SELECT p FROM history_events CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(detail->'providers')='array' THEN detail->'providers' ELSE '[]'::jsonb END) x(p)
), maps AS (
 SELECT m,c.id clinician_id,lower(btrim(regexp_replace(m->>'sourceLabel','\s+',' ','g'))) provider
 FROM declarations d CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(d.data->'mappings')='array' THEN d.data->'mappings' ELSE '[]'::jsonb END) x(m)
 JOIN clinicians c ON m->>'clinicianId'=c.id::text AND m->>'clinicianLabel'=c.label
 WHERE m->>'teamId'=c.goal_id::text AND c.goal_id=1
 AND lower(btrim(regexp_replace(m->>'sourceLabel','\s+',' ','g')))=lower(btrim(regexp_replace(c.label,'\s+',' ','g')))
), providers AS (
 SELECT provider,'current_team'::text provider_scope,clinician_id::text identity_id FROM maps
 UNION ALL SELECT lower(btrim(regexp_replace(p->>'sourceLabel','\s+',' ','g'))),
 'historical_'||row_number() OVER(ORDER BY lower(btrim(regexp_replace(p->>'sourceLabel','\s+',' ','g')))),p->>'id' FROM history
), sources AS (
 SELECT s.*,s.kind||'-'||s.source_hash source_key FROM practice_import_snapshots s JOIN scope USING(practice_id,account_id) WHERE active=1
), raw AS (
 SELECT s.source_key,s.kind,f,ord,btrim(f->>'clientId') client_key,
 lower(btrim(regexp_replace(f->>'clinician','\s+',' ','g'))) provider,
 f->>'serviceDate' day_text,f->>'sourceRowHash' row_hash,
 lower(btrim(regexp_replace(coalesce(f->>'billingCode',''),'\s+',' ','g'))) code,
 CASE WHEN lower(btrim(f->>'billingCode'))='2' THEN 'documentation'
 WHEN lower(btrim(f->>'billingCode'))='30003' THEN 'consultation'
 WHEN lower(btrim(f->>'billingCode')) IN ('1','4','30001','30002') THEN ''
 ELSE coalesce(f->>'visitKind',CASE WHEN lower(btrim(f->>'billingCode'))='phone' THEN 'consultation' ELSE '' END) END visit_kind,
 CASE WHEN jsonb_typeof(f->'totalFeeCharged')='number' THEN (f->>'totalFeeCharged')::numeric END fee
 FROM sources s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.rows)='array' THEN s.rows ELSE '[]'::jsonb END) WITH ORDINALITY x(f,ord)
), day_parts AS (
 SELECT DISTINCT day_text,
 CASE WHEN day_text~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN substring(day_text,1,4)::integer END y,
 CASE WHEN day_text~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN substring(day_text,6,2)::integer END m,
 CASE WHEN day_text~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN substring(day_text,9,2)::integer END d FROM raw
), day_months AS (SELECT *,CASE WHEN y BETWEEN 1 AND 9999 AND m BETWEEN 1 AND 12 THEN make_date(y,m,1) END month_start FROM day_parts),
days AS (SELECT day_text,CASE WHEN d BETWEEN 1 AND extract(day FROM month_start+INTERVAL '1 month - 1 day') THEN month_start+d-1 END AS day FROM day_months),
facts AS (
 SELECT r.*,d.day,p.provider_scope,p.identity_id FROM raw r LEFT JOIN days d USING(day_text) LEFT JOIN providers p USING(provider)
), source_sets AS (
 SELECT x.item FROM declarations d CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(d.data->'sourceSets')='array' THEN d.data->'sourceSets' ELSE '[]'::jsonb END) x(item)
), billing_set AS (SELECT item FROM source_sets WHERE item->>'kind'='billing'),
attendance_set AS (SELECT item FROM source_sets WHERE item->>'kind'='attendance'),
approval_events AS (
 SELECT a.* FROM practice_import_audit a JOIN scope USING(practice_id,account_id) WHERE action='accept-billing-charge-exception'
), approvals AS (
 SELECT detail->'resolution' res,detail->>'revision' journal_revision FROM approval_events
), bound_approvals AS (
 SELECT a.*,p.provider,p.provider_scope,p.identity_id FROM approvals a JOIN providers p
 ON p.provider=lower(btrim(regexp_replace(res->>'clinicianLabel','\s+',' ','g')))
 AND ((p.provider_scope='current_team' AND res->>'clinicianId'=p.identity_id AND NOT(res ? 'historicalProviderId'))
 OR (p.provider_scope<>'current_team' AND res->>'historicalProviderId'=p.identity_id AND NOT(res ? 'clinicianId')))
), billing AS (SELECT * FROM facts WHERE kind='billing'),
hash_checks AS (
 SELECT row_hash,count(DISTINCT (client_key,provider,day_text,code))>1 cross_encounter_collision
 FROM billing WHERE coalesce(row_hash,'')<>'' GROUP BY row_hash
), gate AS (
 SELECT coalesce((SELECT count(*) FROM scope)=1 AND (SELECT count(*) FROM declarations)=1
 AND (SELECT min(revision) FROM declarations)=2
 AND (SELECT count(*) FROM maps)=6 AND (SELECT count(DISTINCT provider) FROM maps)=6
 AND (SELECT jsonb_array_length(data->'mappings') FROM declarations)=6
 AND (SELECT count(DISTINCT clinician_id) FROM maps)=6
 AND (SELECT count(*) FROM history_events)=1
 AND (SELECT min(detail->>'version') FROM history_events)='1' AND (SELECT min(detail->>'declarationRevision') FROM history_events)='2'
 AND (SELECT count(*) FROM history)=3 AND (SELECT count(DISTINCT p->>'id') FROM history)=3
 AND NOT EXISTS(SELECT 1 FROM history h JOIN clinicians c ON lower(btrim(regexp_replace(h.p->>'sourceLabel','\s+',' ','g')))=lower(btrim(regexp_replace(c.label,'\s+',' ','g'))))
 AND (SELECT count(*) FROM providers)=9 AND (SELECT count(DISTINCT provider) FROM providers)=9
 AND (SELECT array_agg(provider ORDER BY provider) FROM providers WHERE provider_scope<>'current_team')=ARRAY['(deleted) jordan madison','(deleted) sara bucksten','(deleted) sarah brubaker']
 AND (SELECT count(*) FROM sources)=6 AND (SELECT count(*) FROM sources WHERE kind='billing')=3 AND (SELECT count(*) FROM sources WHERE kind='attendance')=3
 AND (SELECT count(DISTINCT source_key) FROM sources)=6
 AND NOT EXISTS(SELECT 1 FROM sources WHERE jsonb_typeof(rows) IS DISTINCT FROM 'array' OR row_count<>jsonb_array_length(rows))
 AND (SELECT count(*) FROM source_sets)=2 AND (SELECT count(*) FROM billing_set)=1 AND (SELECT count(*) FROM attendance_set)=1
 AND NOT EXISTS(SELECT 1 FROM source_sets x CROSS JOIN settings cfg WHERE x.item->'complete' IS DISTINCT FROM 'true'::jsonb
 OR x.item->>'start' IS DISTINCT FROM cfg.first_day::text OR x.item->>'end' IS DISTINCT FROM cfg.last_day::text
 OR jsonb_typeof(x.item->'snapshotIds') IS DISTINCT FROM 'array' OR jsonb_array_length(x.item->'snapshotIds') IS DISTINCT FROM 3 OR (SELECT count(DISTINCT id) FROM jsonb_array_elements_text(x.item->'snapshotIds') ids(id))<>3
 OR jsonb_typeof(x.item->'clinicianIds') IS DISTINCT FROM 'array' OR jsonb_array_length(x.item->'clinicianIds') IS DISTINCT FROM 6 OR (SELECT count(DISTINCT id) FROM jsonb_array_elements_text(x.item->'clinicianIds') ids(id))<>6
 OR EXISTS(SELECT 1 FROM sources s WHERE s.kind=x.item->>'kind' AND NOT(x.item->'snapshotIds' ? s.source_key))
 OR EXISTS(SELECT 1 FROM maps m WHERE NOT(x.item->'clinicianIds' @> jsonb_build_array(m.clinician_id))))
 AND NOT EXISTS(SELECT 1 FROM history h CROSS JOIN settings cfg WHERE jsonb_typeof(h.p->'sourceSets') IS DISTINCT FROM 'array' OR jsonb_array_length(h.p->'sourceSets') IS DISTINCT FROM 1 OR EXISTS(
 SELECT 1 FROM jsonb_array_elements(h.p->'sourceSets') x(item) WHERE item->'complete' IS DISTINCT FROM 'true'::jsonb
 OR item->>'start' IS DISTINCT FROM cfg.first_day::text OR item->>'end' IS DISTINCT FROM cfg.last_day::text OR jsonb_typeof(item->'snapshotIds') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'snapshotIds') IS DISTINCT FROM 3
 OR (SELECT count(DISTINCT id) FROM jsonb_array_elements_text(item->'snapshotIds') ids(id))<>3
 OR EXISTS(SELECT 1 FROM sources s WHERE s.kind='billing' AND NOT(item->'snapshotIds' ? s.source_key))))
 AND NOT EXISTS(SELECT 1 FROM facts f CROSS JOIN settings cfg WHERE f.day IS NULL OR f.day<cfg.first_day OR f.day>cfg.last_day OR f.provider_scope IS NULL)
 AND NOT EXISTS(SELECT 1 FROM maps m WHERE NOT EXISTS(SELECT 1 FROM facts f WHERE f.provider=m.provider AND f.kind='attendance') OR NOT EXISTS(SELECT 1 FROM facts f WHERE f.provider=m.provider AND f.kind='billing'))
 AND NOT EXISTS(SELECT 1 FROM providers p WHERE provider_scope<>'current_team' AND NOT EXISTS(SELECT 1 FROM billing b WHERE b.provider=p.provider))
 AND (SELECT count(*) FROM approvals)=5 AND (SELECT count(*) FROM bound_approvals)=5
 AND (SELECT count(DISTINCT res->>'id') FROM approvals)=5 AND (SELECT count(DISTINCT res->>'approvalToken') FROM approvals)=5
 AND (SELECT array_agg(journal_revision ORDER BY journal_revision) FROM approvals)=ARRAY['1','2','3','4','5']
 AND (SELECT count(*) FROM approvals WHERE journal_revision='5' AND res ? 'historicalProviderId' AND NOT(res ? 'clinicianId'))=1
 AND (SELECT md5(string_agg(row_to_json(a)::text,'' ORDER BY id)) FROM approval_events a WHERE detail->>'revision' IN ('1','2','3','4'))='cc19f8c6dd2eec520b459206a632561c'
 ,false) AS release_scope_ready

), clinical_input AS (
 SELECT DATE '2026-10-16' as_of,DATE '2026-09-17' selected_start,DATE '2026-10-16' selected_end
), clinical_calendar AS (
 SELECT d::date AS day,DATE '2026-01-01'+floor((d::date-DATE '2026-01-01')::numeric/14)::integer*14 period_start
 FROM settings cfg CROSS JOIN LATERAL generate_series(cfg.first_day,cfg.last_day,INTERVAL '1 day') d
), admitted_calendar AS (
 SELECT c.* FROM clinical_calendar c CROSS JOIN settings cfg CROSS JOIN clinical_input i
 WHERE c.period_start>=cfg.first_day AND c.period_start+13<=least(cfg.last_day,i.as_of)
), admitted_facts AS (
 SELECT f.*,c.period_start FROM facts f JOIN admitted_calendar c USING(day)
 WHERE f.provider_scope='current_team'
), billed_kinds AS (
 SELECT client_key,provider,day,
 bool_and(visit_kind='documentation') documentation_only,
 bool_and(visit_kind='consultation') FILTER(WHERE visit_kind<>'documentation') consultation_only,
 bool_or(code IN ('1','4','30001','30002')) AND bool_and(visit_kind IN ('','documentation')) legacy_treatment_present
 FROM admitted_facts WHERE kind='billing' GROUP BY client_key,provider,day
), classified AS (
 SELECT a.*,a.code='2' OR (a.code='' AND coalesce(b.documentation_only,false)) is_documentation,
 CASE WHEN a.code='2' OR (a.code='' AND coalesce(b.documentation_only,false)) THEN false
 WHEN a.code='' AND coalesce(b.legacy_treatment_present,false) THEN false
 ELSE a.visit_kind='consultation' OR (a.code NOT IN ('1','2','4','30001','30002','30003') AND coalesce(b.consultation_only,false)) END is_consultation
 FROM admitted_facts a LEFT JOIN billed_kinds b USING(client_key,provider,day) WHERE a.kind='attendance'
), per_source_statuses AS (
 SELECT source_key,client_key,identity_id,day,period_start,is_consultation,
 array_agg(DISTINCT f->>'status' ORDER BY f->>'status') statuses
 FROM classified WHERE NOT is_documentation
 GROUP BY source_key,client_key,identity_id,day,period_start,is_consultation
), clinical_conflicts AS (
 SELECT DISTINCT identity_id,period_start FROM per_source_statuses
 GROUP BY client_key,identity_id,day,period_start,is_consultation HAVING count(DISTINCT statuses)>1
), clean_calendar AS (
 SELECT m.clinician_id::text identity_id,c.day,c.period_start
 FROM maps m CROSS JOIN admitted_calendar c WHERE NOT EXISTS(
 SELECT 1 FROM clinical_conflicts x WHERE x.identity_id=m.clinician_id::text AND x.period_start=c.period_start)
), entities AS (
 SELECT 'whole_practice'::text report_scope,NULL::text identity_id
 UNION ALL SELECT 'clinician_'||row_number() OVER(ORDER BY clinician_id),clinician_id::text FROM maps
), scoped_days AS (
 SELECT e.report_scope,c.day FROM entities e JOIN clean_calendar c ON e.identity_id=c.identity_id
 UNION ALL SELECT 'whole_practice',day FROM clean_calendar GROUP BY day HAVING count(DISTINCT identity_id)=6
), distinct_shows AS (
 SELECT DISTINCT a.client_key,a.identity_id,a.day FROM classified a
 WHERE NOT a.is_documentation AND NOT a.is_consultation AND a.f->>'status'='show'
 AND EXISTS(SELECT 1 FROM clean_calendar c WHERE c.identity_id=a.identity_id AND c.day=a.day)
), attendance_hashes AS (
 SELECT row_hash,count(DISTINCT(client_key,identity_id,day,f->>'status',code,visit_kind))>1 conflicting_payload
 FROM admitted_facts WHERE kind='attendance' AND coalesce(btrim(row_hash),'')<>''
 GROUP BY row_hash
), override_gate AS (
 SELECT count(*) unsupported_package_overrides FROM practice_import_packages p JOIN scope USING(practice_id,account_id)
 WHERE p.active=1 AND CASE WHEN jsonb_typeof(coalesce(to_jsonb(p)->'same_day_visit_overrides','{}'::jsonb))='object'
 THEN EXISTS(SELECT 1 FROM jsonb_each(coalesce(to_jsonb(p)->'same_day_visit_overrides','{}'::jsonb)))
 ELSE true END
), attendance_gate AS (
 SELECT g.release_scope_ready AND o.unsupported_package_overrides=0
 AND NOT EXISTS(SELECT 1 FROM hash_checks WHERE cross_encounter_collision)
 AND NOT EXISTS(SELECT 1 FROM attendance_hashes WHERE conflicting_payload)
 AND NOT EXISTS(SELECT 1 FROM admitted_facts WHERE kind='attendance'
 AND (coalesce(btrim(row_hash),'')='' OR coalesce(client_key,'')='' OR coalesce(f->>'status','') NOT IN ('show','cancelled','no show','clinician cancelled')))
 AS attendance_scope_ready,o.unsupported_package_overrides FROM gate g CROSS JOIN override_gate o
), clinical_windows AS (
 SELECT 'selected_30_days'::text window_label,selected_start start_day,selected_end end_day FROM clinical_input
 UNION ALL SELECT 'last_complete_canonical_period',DATE '2026-09-24',DATE '2026-10-07'
 UNION ALL SELECT 'uncompleted_October_08_12',DATE '2026-10-08',DATE '2026-10-12'
), diagnostic_counts AS (
 SELECT w.*,e.report_scope,
 (SELECT count(*) FROM scoped_days d WHERE d.report_scope=e.report_scope AND d.day BETWEEN w.start_day AND w.end_day) included_calendar_days,
 (SELECT count(*) FROM distinct_shows s WHERE (e.identity_id IS NULL OR s.identity_id=e.identity_id)
 AND s.day BETWEEN w.start_day AND w.end_day AND EXISTS(SELECT 1 FROM scoped_days d WHERE d.report_scope=e.report_scope AND d.day=s.day)) deduplicated_imported_treatment_visits,
 (SELECT count(*) FROM classified a WHERE NOT a.is_documentation AND NOT a.is_consultation AND a.f->>'status'='show'
 AND (e.identity_id IS NULL OR a.identity_id=e.identity_id) AND a.day BETWEEN w.start_day AND w.end_day
 AND EXISTS(SELECT 1 FROM scoped_days d WHERE d.report_scope=e.report_scope AND d.day=a.day)) raw_counted_treatment_show_rows,
 (SELECT count(*) FROM clinical_conflicts x WHERE (e.identity_id IS NULL OR x.identity_id=e.identity_id)
 AND x.period_start<=w.end_day AND x.period_start+13>=w.start_day) conflicted_provider_periods,
 (SELECT count(*) FROM facts f WHERE f.kind='attendance' AND f.provider_scope='current_team'
 AND (e.identity_id IS NULL OR f.identity_id=e.identity_id) AND f.day BETWEEN w.start_day AND w.end_day
 AND NOT EXISTS(SELECT 1 FROM admitted_calendar c WHERE c.day=f.day)) unfinished_or_unproved_raw_rows,
 (SELECT max(d.day) FROM scoped_days d WHERE d.report_scope=e.report_scope) latest_complete_coverage_day
 FROM clinical_windows w CROSS JOIN entities e
), result AS (
 SELECT d.*,a.attendance_scope_ready AND d.included_calendar_days>0 AND d.conflicted_provider_periods=0 comparison_ready,
 CASE WHEN a.attendance_scope_ready AND d.included_calendar_days>0 AND d.conflicted_provider_periods=0 THEN d.deduplicated_imported_treatment_visits END verified_imported_treatment_visits,
 CASE WHEN a.attendance_scope_ready AND d.included_calendar_days>0 AND d.conflicted_provider_periods=0 THEN d.deduplicated_imported_treatment_visits*7::numeric/d.included_calendar_days END verified_weekly_pace,
 d.included_calendar_days=d.end_day-d.start_day+1 full_selected_calendar_coverage
 FROM diagnostic_counts d CROSS JOIN attendance_gate a
)
SELECT jsonb_build_object(
 'as_of',(SELECT as_of FROM clinical_input),
 'release_scope_ready',(SELECT release_scope_ready FROM gate),
 'attendance_scope_ready',(SELECT attendance_scope_ready FROM attendance_gate),
 'unsupported_same_day_override_packages',(SELECT unsupported_package_overrides FROM attendance_gate),
 'attendance_hash_payload_conflicts',(SELECT count(*) FROM attendance_hashes WHERE conflicting_payload),
 'billing_cross_encounter_hash_collisions',(SELECT count(*) FROM hash_checks WHERE cross_encounter_collision),
 'stored_approval_events',(SELECT count(*) FROM approvals),
 'original_four_match_baseline',(SELECT md5(string_agg(row_to_json(a)::text,'' ORDER BY id))='cc19f8c6dd2eec520b459206a632561c' FROM approval_events a WHERE detail->>'revision' IN ('1','2','3','4')),
 'source_inventory',(SELECT jsonb_agg(jsonb_build_object('kind',s.kind,'stored_rows',s.row_count,'array_rows',jsonb_array_length(s.rows),
 'raw_late_cancelled_rows',(SELECT count(*) FROM raw r WHERE r.source_key=s.source_key AND r.f->>'cancellationSubtype'='late_cancelled')) ORDER BY s.kind,s.created_at,s.id) FROM sources s),
 'report_scope_slots','clinician_1 through clinician_6 sort by the six existing mapped clinician IDs; no IDs or provider labels output',
 'results',(SELECT jsonb_agg(to_jsonb(r) ORDER BY window_label,report_scope) FROM result r),
 'limits','Imported treatment observations only. Comparison requires scope_ready and comparison_ready. No source facts, manual counts, approvals or business records are changed. Conflicts withhold certification; manual fallback is not inferred. Unfinished October 8-21 is excluded. No cash/payroll/profit claim.'
) diagnostic;

