-- One SELECT, no mutations, no private client/provider/source keys output.
-- Bounded certification for the owner-confirmed 2025-07-01..2026-10-12 release.
-- All retained billing sources reconcile BEFORE date/provider projection.
-- Cross-encounter source-hash collisions conservatively withhold affected sums.
-- No clinical sessions, cash, payroll, expense, profit or extrapolation claims.
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
), group_sources AS (
 SELECT client_key,provider,day_text,code,source_key,count(DISTINCT row_hash) distinct_hashes
 FROM billing GROUP BY client_key,provider,day_text,code,source_key
), groups AS (
 SELECT b.client_key,b.provider,b.day_text,b.code,min(b.day) AS day,min(b.provider_scope) provider_scope,
 count(*) raw_rows,min(b.fee) one_fee,
 bool_or(b.fee IS NULL OR b.day IS NULL OR coalesce(btrim(b.row_hash),'')='' OR coalesce(b.client_key,'')='' OR coalesce(b.provider,'')='') invalid,
 count(DISTINCT (b.fee,b.visit_kind))>1 conflicting,
 bool_or(coalesce(h.cross_encounter_collision,false)) hash_collision,
 EXISTS(SELECT 1 FROM group_sources gs WHERE gs.client_key=b.client_key AND gs.provider=b.provider AND gs.day_text=b.day_text AND gs.code=b.code AND gs.distinct_hashes>1)
 OR (b.code='' AND count(*)>1 AND count(DISTINCT b.row_hash)>1) ambiguous,
 min(b.visit_kind) visit_kind,count(DISTINCT b.visit_kind) kind_variants
 FROM billing b LEFT JOIN hash_checks h USING(row_hash)
 GROUP BY b.client_key,b.provider,b.day_text,b.code
), resolution_checks AS (
 SELECT g.*,a.res,
 (SELECT count(*) FROM approvals other WHERE btrim(other.res->>'clientId')=g.client_key
 AND lower(btrim(regexp_replace(other.res->>'clinicianLabel','\s+',' ','g')))=g.provider
 AND other.res->>'serviceDate'=g.day_text AND other.res->>'billingCode'=g.code) relevant_approvals,
 coalesce(a.res IS NOT NULL AND NOT g.invalid AND NOT g.hash_collision AND g.kind_variants=1
 AND a.res->>'visitKind'=g.visit_kind AND g.code<>'phone' AND g.visit_kind<>'consultation'
 AND jsonb_typeof(a.res->'charges')='array' AND jsonb_array_length(CASE WHEN jsonb_typeof(a.res->'charges')='array' THEN a.res->'charges' ELSE '[]'::jsonb END)=2
 AND (SELECT count(DISTINCT (ch->'anchor'->>'snapshotId',ch->'anchor'->>'sourceRowHash',ch->'amount')) FROM jsonb_array_elements(a.res->'charges') x(ch))=2
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.res->'charges') x(ch)
 WHERE jsonb_typeof(ch->'amount') IS DISTINCT FROM 'number' OR NOT EXISTS(
 SELECT 1 FROM billing b WHERE b.client_key=g.client_key AND b.provider=g.provider AND b.day_text=g.day_text AND b.code=g.code
 AND b.source_key=ch->'anchor'->>'snapshotId' AND b.row_hash=ch->'anchor'->>'sourceRowHash' AND to_jsonb(b.fee)=ch->'amount' AND b.fee>0))
 AND NOT EXISTS(SELECT 1 FROM billing b WHERE b.client_key=g.client_key AND b.provider=g.provider AND b.day_text=g.day_text AND b.code=g.code
 AND (b.fee<=0 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.res->'charges') x(ch) WHERE ch->'amount'=to_jsonb(b.fee))))
 AND NOT EXISTS(SELECT 1 FROM billing b WHERE b.client_key=g.client_key AND b.provider=g.provider AND b.day_text=g.day_text AND b.code=g.code
 GROUP BY b.source_key,b.fee HAVING count(DISTINCT b.row_hash)>(SELECT count(*) FROM jsonb_array_elements(a.res->'charges') x(ch) WHERE ch->'amount'=to_jsonb(b.fee))),false) valid_resolution
 FROM groups g LEFT JOIN bound_approvals a ON btrim(a.res->>'clientId')=g.client_key AND a.provider=g.provider
 AND a.res->>'serviceDate'=g.day_text AND a.res->>'billingCode'=g.code
), reconciled AS (
 SELECT *,relevant_approvals=1 AND valid_resolution approved,
 (relevant_approvals=1 AND valid_resolution) OR (relevant_approvals=0 AND NOT invalid AND NOT hash_collision AND NOT conflicting AND NOT ambiguous) known,
 CASE WHEN relevant_approvals=1 AND valid_resolution THEN (SELECT sum((ch->>'amount')::numeric) FROM jsonb_array_elements(res->'charges') x(ch)) ELSE one_fee END charges,
 CASE WHEN relevant_approvals=1 AND valid_resolution THEN 2 ELSE 1 END accepted_rows
 FROM resolution_checks
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
), windows AS (
 SELECT 'monthly'::text window_kind,to_char(m,'YYYY-MM') window_label,m::date start_day,
 least((m+INTERVAL '1 month - 1 day')::date,cfg.last_day) end_day FROM settings cfg
 CROSS JOIN LATERAL generate_series(cfg.first_day,cfg.last_day,INTERVAL '1 month') m
 UNION ALL SELECT 'October_overlap',d::date::text,d::date,d::date FROM generate_series(DATE '2026-10-10',DATE '2026-10-12',INTERVAL '1 day') x(d)
 UNION ALL SELECT 'partial_operating_period','October_08_12',DATE '2026-10-08',DATE '2026-10-12'
 UNION ALL SELECT 'full_history','all_reported',first_day,last_day FROM settings
), report_scopes(report_scope) AS (VALUES('whole_practice'),('current_team'),('historical_1'),('historical_2'),('historical_3')),
attendance_source_statuses AS (
 SELECT source_key,client_key,provider,day,array_agg(DISTINCT f->>'status' ORDER BY f->>'status') statuses
 FROM facts WHERE kind='attendance' GROUP BY source_key,client_key,provider,day
), attendance_encounters AS (
 SELECT client_key,provider,day,count(DISTINCT statuses)>1 status_set_conflict,count(*) source_count
 FROM attendance_source_statuses GROUP BY client_key,provider,day
), attendance_windows AS (
 SELECT w.window_label,w.start_day,w.end_day,
 (SELECT count(*) FROM facts f WHERE f.kind='attendance' AND f.day BETWEEN w.start_day AND w.end_day) raw_attendance_rows,
 (SELECT count(*) FROM attendance_encounters a WHERE a.day BETWEEN w.start_day AND w.end_day) raw_encounter_candidates,
 (SELECT count(*) FROM attendance_encounters a WHERE a.day BETWEEN w.start_day AND w.end_day AND a.source_count>1) cross_source_encounter_candidates,
 (SELECT count(*) FROM attendance_encounters a WHERE a.day BETWEEN w.start_day AND w.end_day AND a.status_set_conflict) status_set_conflict_candidates,
 false complete_operating_period
 FROM windows w WHERE window_kind IN ('October_overlap','partial_operating_period')
),
totals AS (
 SELECT w.window_kind,w.window_label,w.start_day,w.end_day,sc.report_scope,g.release_scope_ready,
 w.window_kind='monthly' AND w.end_day<>(date_trunc('month',w.start_day)+INTERVAL '1 month - 1 day')::date partial_calendar_month,
 CASE WHEN g.release_scope_ready AND NOT EXISTS(SELECT 1 FROM facts f WHERE f.kind='billing' AND f.day IS NULL)
 AND count(*) FILTER(WHERE r.day IS NOT NULL AND (r.known IS NOT TRUE OR r.provider_scope IS NULL))=0 THEN coalesce(sum(r.charges),0) END reported_charges,
 CASE WHEN g.release_scope_ready AND count(*) FILTER(WHERE r.day IS NOT NULL AND r.known IS NOT TRUE)=0 THEN coalesce(sum(r.accepted_rows),0) END accepted_charge_rows,
 CASE WHEN g.release_scope_ready AND count(*) FILTER(WHERE r.day IS NOT NULL AND r.known IS NOT TRUE)=0 THEN coalesce(sum(r.raw_rows-r.accepted_rows),0) END collapsed_duplicate_rows,
 count(*) FILTER(WHERE r.day IS NOT NULL AND r.known IS NOT TRUE) unresolved_groups,
 count(*) FILTER(WHERE r.approved) applied_approval_groups,
 count(*) FILTER(WHERE r.relevant_approvals>0 AND r.approved IS NOT TRUE) stale_approval_groups
 FROM windows w CROSS JOIN report_scopes sc CROSS JOIN gate g LEFT JOIN reconciled r
 ON r.day BETWEEN w.start_day AND w.end_day AND (sc.report_scope='whole_practice' OR r.provider_scope=sc.report_scope)
 GROUP BY w.window_kind,w.window_label,w.start_day,w.end_day,sc.report_scope,g.release_scope_ready
)
SELECT jsonb_build_object(
 'release_scope_ready',(SELECT release_scope_ready FROM gate),
 'basis','reported-service-date-billed-charges-not-cash-payroll-costs-or-profit',
 'original_four_events',(SELECT count(*) FROM approvals WHERE journal_revision IN ('1','2','3','4')),
 'original_four_fingerprint',(SELECT md5(string_agg(row_to_json(a)::text,'' ORDER BY id)) FROM approval_events a WHERE detail->>'revision' IN ('1','2','3','4')),
 'original_four_match_publisher_baseline',(SELECT md5(string_agg(row_to_json(a)::text,'' ORDER BY id))='cc19f8c6dd2eec520b459206a632561c' FROM approval_events a WHERE detail->>'revision' IN ('1','2','3','4')),
 'stored_approvals',(SELECT count(*) FROM approvals),
 'historical_provider_slots','1 Jordan; 2 Sara; 3 Sarah; exact confirmed registry labels retained, not current cards',
 'source_inventory',(SELECT jsonb_agg(jsonb_build_object('kind',kind,'stored_rows',row_count,'array_rows',jsonb_array_length(rows),'observed_start',coverage_start,'observed_end',coverage_end,'individual_proof_present',report_coverage IS NOT NULL) ORDER BY kind,created_at,id) FROM sources),
 'monthly_and_october_scopes',(SELECT jsonb_agg(to_jsonb(t) ORDER BY window_kind,start_day,report_scope) FROM totals t),
 'october_raw_attendance_candidates',(SELECT jsonb_agg(to_jsonb(t) ORDER BY start_day,window_label) FROM attendance_windows t),
 'invalid_billing_dates',(SELECT count(*) FROM billing WHERE day IS NULL),
 'global_cross_encounter_hash_collisions',(SELECT count(*) FROM hash_checks WHERE cross_encounter_collision),
 'limits','Conservative independent billing reconciliation; scope gate must pass. October 8-12 is not a completed operating period. No clinical attendance-count certification. Fingerprint equality requires the captured baseline.'
) diagnostic;
