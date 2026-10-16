-- SELECT-only inventory, NOT reconciled billing/session/retention totals.
-- Scope/date groups overlap intentionally; never add across windows/scopes.
-- No client keys, provider source strings, source hashes or source rows are output.
WITH
windows(window_label,start_day,end_day) AS (VALUES
 ('all_loaded',NULL::text,NULL::text),
 ('January_15_28','2026-01-15','2026-01-28'),
 ('January_01_31','2026-01-01','2026-01-31')),
roster(scope_label,clinician_id) AS (VALUES
 ('Erin Mrakovich',8),('Elia Mrakovich',9),('Natalie Rieke',10),
 ('Michele Teague',11),('Jessica Cockrum',12),('Jessica Yates',13)),
active_scopes AS (
 SELECT practice_id,account_id FROM practice_import_snapshots WHERE active=1
 UNION SELECT practice_id,account_id FROM practice_import_packages WHERE active=1),
scope AS (SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes)=1),
declaration AS (
 SELECT d.data FROM practice_import_declarations d JOIN scope USING(practice_id,account_id)),
map_entries AS (
 SELECT m,lower(btrim(regexp_replace(m->>'sourceLabel','\s+',' ','g'))) provider
 FROM declaration CROSS JOIN LATERAL jsonb_array_elements(coalesce(data->'mappings','[]'::jsonb)) x(m)),
maps AS (
 SELECT e.provider,c.id clinician_id FROM map_entries e
 JOIN clinicians c ON e.m->>'clinicianId'=c.id::text AND e.m->>'clinicianLabel'=c.label
 JOIN roster r ON r.clinician_id=c.id AND r.scope_label=c.label
 WHERE c.goal_id=1 AND e.m->>'teamId'='1'
 AND (SELECT count(*) FROM map_entries other WHERE other.provider=e.provider)=1),
gate AS (SELECT (SELECT count(*) FROM scope)=1
 AND (SELECT count(*) FROM declaration)=1
 AND (SELECT count(DISTINCT clinician_id) FROM maps)=6 AS scope_ready),
scopes AS (
 SELECT * FROM roster UNION ALL SELECT 'Whole Practice',0
 UNION ALL SELECT 'Outside accepted roster or unresolved mapping',-1),
raw AS (
 SELECT s.kind,f,
 lower(btrim(regexp_replace(f->>'clinician','\s+',' ','g'))) provider,
 f->>'clientId' client_key,f->>'serviceDate' service_day,f->>'sourceRowHash' source_hash,
 CASE WHEN jsonb_typeof(f->'billingCode')='number' THEN
   CASE WHEN (f->>'billingCode')::numeric=0 THEN '0' ELSE btrim(f->>'billingCode') END
   ELSE btrim(coalesce(f->>'billingCode','')) END code,
 CASE WHEN NOT (f ? 'billingCode') THEN 'missing'
   WHEN jsonb_typeof(f->'billingCode')='null' THEN 'null'
   WHEN f->>'billingCode'='' THEN 'blank-string'
   ELSE jsonb_typeof(f->'billingCode') END source_code_type,
 CASE WHEN f->>'status' IN ('show','cancelled','no show','clinician cancelled')
   THEN f->>'status' WHEN s.kind='billing' THEN 'not-attendance' ELSE 'unrecognized-or-missing' END status,
 coalesce(f->>'visitKind'='consultation',false) old_kind_consult,
 CASE WHEN jsonb_typeof(f->'totalFeeCharged')='number' THEN (f->>'totalFeeCharged')::numeric END fee
 FROM practice_import_snapshots s JOIN scope USING(practice_id,account_id)
 CROSS JOIN LATERAL jsonb_array_elements(s.rows) x(f)
 WHERE s.active=1),
typed AS (
 SELECT *,lower(code)='phone' OR old_kind_consult old_consult,
 CASE WHEN code IN ('1','2','4','30001','30002') THEN false
   WHEN code='30003' THEN true ELSE lower(code)='phone' OR old_kind_consult END new_consult,
 code='2' new_documentation
 FROM raw),
billing_groups AS (
 SELECT client_key,provider,service_day,
 bool_or(old_consult) AND NOT bool_or(NOT old_consult) old_consult_only,
 bool_or(new_consult) AND NOT bool_or(NOT new_consult AND NOT new_documentation) new_consult_only,
 bool_or(new_documentation) AND NOT bool_or(NOT new_documentation) documentation_only,
 bool_or(code IN ('1','4','30001','30002')) AND NOT bool_or(new_consult) legacy_treatment_present
 FROM typed WHERE kind='billing' GROUP BY client_key,provider,service_day),
linked AS (
 SELECT t.*,m.clinician_id,
 t.old_consult OR (t.kind='attendance' AND coalesce(b.old_consult_only,false)) before_consult,
 t.new_documentation OR (t.kind='attendance' AND t.code='' AND coalesce(b.documentation_only,false)) after_documentation,
 CASE WHEN t.new_documentation OR (t.kind='attendance' AND t.code='' AND coalesce(b.documentation_only,false)) THEN false
   WHEN t.kind='attendance' AND t.code='' AND coalesce(b.legacy_treatment_present,false) THEN false
   ELSE t.new_consult OR (t.kind='attendance' AND t.code NOT IN ('1','2','4','30001','30002','30003') AND coalesce(b.new_consult_only,false)) END after_consult
 FROM typed t LEFT JOIN maps m USING(provider)
 LEFT JOIN billing_groups b USING(client_key,provider,service_day)),
expanded AS (
 SELECT w.window_label,sc.scope_label,l.*
 FROM linked l CROSS JOIN windows w CROSS JOIN scopes sc CROSS JOIN gate g
 WHERE g.scope_ready AND (w.start_day IS NULL OR l.service_day BETWEEN w.start_day AND w.end_day)
 AND ((sc.clinician_id=0 AND l.clinician_id IS NOT NULL)
   OR sc.clinician_id=l.clinician_id OR (sc.clinician_id=-1 AND l.clinician_id IS NULL))
 AND l.code IN ('0','00000','1','2','4','30001','30002','30003','')),
details AS (
 SELECT 'code-detail' record_kind,true scope_ready,window_label,scope_label,kind,
 CASE WHEN service_day~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN service_day ELSE 'invalid-or-missing' END service_date,
 CASE WHEN code='' THEN '<missing/blank/null>' ELSE code END code,source_code_type,status,
 CASE WHEN before_consult THEN 'consultation' WHEN code IN ('0','') THEN 'unclassified' ELSE 'treatment-candidate' END before_class,
 CASE WHEN after_documentation THEN 'documentation' WHEN after_consult THEN 'consultation' WHEN code IN ('0','') THEN 'unclassified' ELSE 'treatment-candidate' END after_class,
 count(*) raw_rows,count(DISTINCT nullif(source_hash,'')) distinct_source_hashes,
 count(*) FILTER(WHERE coalesce(source_hash,'')='') missing_hash_rows,
 sum(fee) FILTER(WHERE kind='billing') raw_fees_not_reconciled,
 count(*) FILTER(WHERE kind='billing' AND fee IS NOT NULL) numeric_fee_rows,
 count(DISTINCT (client_key,provider,service_day)) FILTER(WHERE kind='attendance' AND status='show' AND NOT before_consult) before_show_candidates,
 count(DISTINCT (client_key,provider,service_day)) FILTER(WHERE kind='attendance' AND status='show' AND NOT after_consult AND NOT after_documentation) after_show_candidates
 FROM expanded GROUP BY window_label,scope_label,kind,service_day,code,source_code_type,status,before_consult,after_documentation,after_consult),
summaries AS (
 SELECT 'scope-summary' record_kind,g.scope_ready,w.window_label,sc.scope_label,
 NULL::text kind,NULL::text service_date,NULL::text code,NULL::text source_code_type,NULL::text status,NULL::text before_class,NULL::text after_class,
 CASE WHEN g.scope_ready THEN count(e.kind) END raw_rows,
 CASE WHEN g.scope_ready THEN count(DISTINCT nullif(e.source_hash,'')) END distinct_source_hashes,
 CASE WHEN g.scope_ready THEN count(*) FILTER(WHERE e.kind IS NOT NULL AND coalesce(e.source_hash,'')='') END missing_hash_rows,
 CASE WHEN g.scope_ready THEN sum(e.fee) FILTER(WHERE e.kind='billing') END raw_fees_not_reconciled,
 CASE WHEN g.scope_ready THEN count(*) FILTER(WHERE e.kind='billing' AND e.fee IS NOT NULL) END numeric_fee_rows,
 CASE WHEN g.scope_ready THEN count(DISTINCT (e.client_key,e.provider,e.service_day)) FILTER(WHERE e.kind='attendance' AND e.status='show' AND NOT e.before_consult) END before_show_candidates,
 CASE WHEN g.scope_ready THEN count(DISTINCT (e.client_key,e.provider,e.service_day)) FILTER(WHERE e.kind='attendance' AND e.status='show' AND NOT e.after_consult AND NOT e.after_documentation) END after_show_candidates
 FROM windows w CROSS JOIN scopes sc CROSS JOIN gate g
 LEFT JOIN expanded e ON e.window_label=w.window_label AND e.scope_label=sc.scope_label
 GROUP BY g.scope_ready,w.window_label,sc.scope_label)
SELECT * FROM summaries UNION ALL SELECT * FROM details
ORDER BY window_label,scope_label,record_kind,kind,service_date,code,source_code_type,status;
