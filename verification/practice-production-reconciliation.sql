-- Independent SELECT-only diagnostic. Execute ONLY in the existing production SQL UI.
-- Dates confirmed by cloud worker: Jan15-28 and Jan1-31, 2026. Edit input ONLY.
-- No source rows, client keys, hashes, notes or credentials leave this statement.
WITH
input AS (
  SELECT DATE '2026-01-15' AS period_start, DATE '2026-01-28' AS period_end,
    DATE '2026-01-01' AS month_start, DATE '2026-01-31' AS month_end,
    DATE '2026-10-16' AS as_of, 1::integer AS team_id
),
expected_roster(slot, clinician_id, display_label) AS (VALUES
  (1,8,'Erin Mrakovich'),(2,9,'Elia Mrakovich'),(3,10,'Natalie Rieke'),
  (4,11,'Michele Teague'),(5,12,'Jessica Cockrum'),(6,13,'Jessica Yates')
),
active_scopes AS (
  SELECT practice_id,account_id FROM practice_import_snapshots WHERE active=1
  UNION SELECT practice_id,account_id FROM practice_import_packages WHERE active=1
),
scope AS (SELECT * FROM active_scopes WHERE (SELECT count(*) FROM active_scopes)=1),
workspace AS (SELECT data FROM hub_workspaces WHERE id=1 AND EXISTS(SELECT 1 FROM scope)),
declaration AS MATERIALIZED (
  SELECT d.data,d.revision FROM practice_import_declarations d JOIN scope USING(practice_id,account_id)
),
sources AS (
  SELECT s.kind,s.kind||'-'||s.source_hash AS source_key,s.rows,
    to_jsonb(s)->'report_coverage' AS proof
  FROM practice_import_snapshots s JOIN scope USING(practice_id,account_id) WHERE s.active=1
),
packages AS (
  SELECT p.same_day_visit_overrides AS overrides FROM practice_import_packages p
  JOIN scope USING(practice_id,account_id) WHERE p.active=1
),
maps AS (
  SELECT m,lower(btrim(regexp_replace(m->>'sourceLabel','\s+',' ','g'))) AS provider
  FROM declaration CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(data->'mappings')='array' THEN data->'mappings' ELSE '[]'::jsonb END) x(m)
),
roster AS (
  SELECT e.*,lower(btrim(regexp_replace(c.label,'\s+',' ','g'))) AS provider,
    coalesce((SELECT p->>'onTeam'<>'false' AND coalesce(p->>'status','active')='active'
      AND coalesce(p->>'start','0001-01-01')<=i.as_of::text
      AND coalesce(p->>'end','9999-12-31')>=i.as_of::text
      FROM workspace w CROSS JOIN LATERAL jsonb_array_elements(coalesce(w.data->'clinicians','[]')) x(p)
      WHERE p->>'clinicianId'=c.id::text LIMIT 1),true) AS current_member
  FROM expected_roster e JOIN clinicians c ON c.id=e.clinician_id AND c.label=e.display_label
  CROSS JOIN input i WHERE c.goal_id=i.team_id
    AND EXISTS(SELECT 1 FROM maps WHERE m->>'clinicianId'=c.id::text AND m->>'clinicianLabel'=c.label
      AND m->>'teamId'=i.team_id::text AND provider=lower(btrim(regexp_replace(c.label,'\s+',' ','g'))))
),
mapping_valid AS (
  SELECT m.*,c.id AS clinician_id FROM maps m JOIN clinicians c ON m.m->>'clinicianId'=c.id::text
    AND m.m->>'clinicianLabel'=c.label CROSS JOIN input i
  WHERE c.goal_id=i.team_id AND m.m->>'teamId'=i.team_id::text
    AND (SELECT count(*) FROM maps other WHERE other.provider=m.provider)=1
),
raw_rows AS (
  SELECT s.source_key,s.kind,f,ord, f->>'clientId' AS client_key,
    lower(btrim(regexp_replace(f->>'clinician','\s+',' ','g'))) AS provider,
    f->>'serviceDate' AS date_text,f->>'sourceRowHash' AS row_hash,
    lower(btrim(regexp_replace(coalesce(f->>'billingCode',''),'\s+',' ','g'))) AS code,
    coalesce(f->>'visitKind',CASE WHEN lower(btrim(regexp_replace(coalesce(f->>'billingCode',''),'\s+',' ','g')))='phone' THEN 'consultation' ELSE '' END) AS visit_kind,
    coalesce(f->>'visitKind'='consultation',false) OR lower(btrim(regexp_replace(coalesce(f->>'billingCode',''),'\s+',' ','g')))='phone' AS phone,
    CASE WHEN jsonb_typeof(f->'totalFeeCharged')='number' THEN (f->>'totalFeeCharged')::numeric END AS fee
  FROM sources s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.rows)='array' THEN s.rows ELSE '[]'::jsonb END) WITH ORDINALITY x(f,ord)
),
sets_raw AS (SELECT set_no,set_data FROM declaration CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(data->'sourceSets')='array' THEN data->'sourceSets' ELSE '[]'::jsonb END) WITH ORDINALITY x(set_data,set_no)),
journal_raw AS (
  SELECT a.detail,a.detail->'resolution' AS res FROM practice_import_audit a JOIN scope USING(practice_id,account_id)
  WHERE a.action='accept-billing-charge-exception'
),
journal_shapes AS (
  SELECT *,CASE WHEN res->>'confirmedAt'~'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?Z$'
    THEN CASE WHEN substring(res->>'confirmedAt',1,4)::integer BETWEEN 1 AND 9999
      THEN make_date(substring(res->>'confirmedAt',1,4)::integer,substring(res->>'confirmedAt',6,2)::integer,1) END END AS confirmed_month
  FROM journal_raw
),
journal_schema AS (
  SELECT *,CASE WHEN jsonb_typeof(detail->'revision')='number' AND detail->>'revision'~'^[1-9][0-9]{0,8}$' THEN (detail->>'revision')::integer END AS journal_revision,
    jsonb_typeof(res)='object' AND jsonb_typeof(res->'charges')='array' AND jsonb_array_length(CASE WHEN jsonb_typeof(res->'charges')='array' THEN res->'charges' ELSE '[]'::jsonb END)=2
    AND jsonb_typeof(res->'clinicianId')='number' AND res->>'clinicianId'~'^[1-9][0-9]{0,8}$'
    AND jsonb_typeof(res->'clientId')='string' AND btrim(res->>'clientId')<>''
    AND jsonb_typeof(res->'clinicianLabel')='string' AND btrim(res->>'clinicianLabel')<>''
    AND jsonb_typeof(res->'billingCode')='string' AND jsonb_typeof(res->'visitKind')='string'
    AND jsonb_typeof(res->'id')='string' AND res->>'id'~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND jsonb_typeof(res->'approvalToken')='string' AND res->>'approvalToken'~'^[0-9a-f]{64}$'
    AND jsonb_typeof(res->'confirmedAt')='string' AND confirmed_month IS NOT NULL
    AND CASE WHEN confirmed_month IS NOT NULL THEN substring(res->>'confirmedAt',9,2)::integer<=extract(day FROM confirmed_month+INTERVAL '1 month - 1 day') ELSE false END
    AND jsonb_typeof(res->'approvalNote')='string' AND btrim(res->>'approvalNote')<>''
    AND jsonb_typeof(res->'serviceDate')='string'
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(res->'charges')='array' THEN res->'charges' ELSE '[]'::jsonb END) x(ch)
      WHERE jsonb_typeof(ch->'amount') IS DISTINCT FROM 'number' OR jsonb_typeof(ch->'anchor') IS DISTINCT FROM 'object'
        OR jsonb_typeof(ch->'anchor'->'snapshotId') IS DISTINCT FROM 'string' OR coalesce(btrim(ch->'anchor'->>'snapshotId'),'')=''
        OR jsonb_typeof(ch->'anchor'->'sourceRowHash') IS DISTINCT FROM 'string' OR coalesce(btrim(ch->'anchor'->>'sourceRowHash'),'')='') AS schema_valid
  FROM journal_shapes
),
journal AS MATERIALIZED (SELECT * FROM journal_schema WHERE schema_valid AND journal_revision IS NOT NULL),
-- Validate dates without a cast that could emit invalid source text in a database error.
date_strings AS (
  SELECT date_text AS t FROM raw_rows UNION SELECT set_data->>'start' FROM sets_raw
  UNION SELECT set_data->>'end' FROM sets_raw UNION SELECT proof->>'start' FROM sources
  UNION SELECT proof->>'end' FROM sources UNION SELECT res->>'serviceDate' FROM journal
),
date_parts AS (
  SELECT t,CASE WHEN t~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN substring(t,1,4)::integer END y,
    CASE WHEN t~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN substring(t,6,2)::integer END m,
    CASE WHEN t~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN substring(t,9,2)::integer END d FROM date_strings
),
date_months AS (SELECT *,CASE WHEN y BETWEEN 1 AND 9999 AND m BETWEEN 1 AND 12 THEN make_date(y,m,1) END ms FROM date_parts),
dates AS (SELECT t,CASE WHEN d BETWEEN 1 AND extract(day FROM ms+INTERVAL '1 month - 1 day') THEN ms+d-1 END AS day FROM date_months),
facts AS (
  SELECT r.*,d.day,m.clinician_id,
    DATE '2026-01-01'+floor((d.day-DATE '2026-01-01')::numeric/14)::integer*14 AS period
  FROM raw_rows r LEFT JOIN dates d ON d.t=r.date_text LEFT JOIN mapping_valid m USING(provider)
),
sets AS MATERIALIZED (
  SELECT s.*,a.day AS start_day,b.day AS end_day FROM sets_raw s
  LEFT JOIN dates a ON a.t=set_data->>'start' LEFT JOIN dates b ON b.t=set_data->>'end'
  WHERE jsonb_typeof(set_data->'snapshotIds')='array' AND jsonb_typeof(set_data->'clinicianIds')='array'
    AND jsonb_typeof(set_data->'kind')='string'
),
valid_sets AS (
  SELECT * FROM sets s WHERE set_data->'complete'='true'::jsonb AND start_day<=end_day
    AND jsonb_array_length(set_data->'snapshotIds')>0 AND jsonb_array_length(set_data->'clinicianIds')>0
    AND (SELECT count(DISTINCT value) FROM jsonb_array_elements(set_data->'snapshotIds'))=jsonb_array_length(set_data->'snapshotIds')
    AND (SELECT count(DISTINCT value) FROM jsonb_array_elements(set_data->'clinicianIds'))=jsonb_array_length(set_data->'clinicianIds')
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(set_data->'snapshotIds') ids(id)
      WHERE (SELECT count(*) FROM sources src WHERE src.source_key=ids.id AND src.kind=set_data->>'kind')<>1)
    AND NOT EXISTS(SELECT 1 FROM facts f WHERE set_data->'snapshotIds' ? f.source_key
      AND (f.day IS NULL OR f.day<start_day OR f.day>end_day OR f.clinician_id IS NULL
        OR NOT set_data->'clinicianIds' @> jsonb_build_array(f.clinician_id)))
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(set_data->'clinicianIds') ids(id)
      WHERE NOT EXISTS(SELECT 1 FROM facts f WHERE set_data->'snapshotIds' ? f.source_key AND f.clinician_id::text=ids.id))
),
source_proofs AS (
  SELECT DISTINCT src.source_key,src.kind,r.clinician_id,s.start_day,s.end_day
  FROM valid_sets s JOIN sources src ON s.set_data->'snapshotIds' ? src.source_key
  JOIN roster r ON s.set_data->'clinicianIds' @> jsonb_build_array(r.clinician_id)
  UNION
  SELECT DISTINCT src.source_key,src.kind,f.clinician_id,a.day,b.day FROM sources src
  JOIN dates a ON a.t=src.proof->>'start' JOIN dates b ON b.t=src.proof->>'end'
  JOIN facts f ON f.source_key=src.source_key JOIN roster r ON r.clinician_id=f.clinician_id
  WHERE src.proof->'complete'='true'::jsonb AND a.day<=b.day AND NOT EXISTS(
    SELECT 1 FROM facts bad WHERE bad.source_key=src.source_key AND (bad.day IS NULL OR bad.day<a.day OR bad.day>b.day))
),
proof_periods AS (
  SELECT DISTINCT p.source_key,p.kind,p.clinician_id,p.start_day+g.n AS period
  FROM source_proofs p CROSS JOIN input i CROSS JOIN LATERAL generate_series(0,least(p.end_day,i.as_of)-p.start_day) g(n)
  WHERE p.start_day+g.n=DATE '2026-01-01'+floor(((p.start_day+g.n)-DATE '2026-01-01')::numeric/14)::integer*14
    AND p.start_day+g.n+13<=least(p.end_day,i.as_of)
),
pre_admitted AS (
  SELECT f.* FROM facts f WHERE EXISTS(SELECT 1 FROM proof_periods p WHERE p.source_key=f.source_key
    AND p.clinician_id=f.clinician_id AND p.period=f.period)
),
phone_groups AS (
  SELECT client_key,provider,day,bool_and(phone) AS phone_only FROM pre_admitted WHERE kind='billing' GROUP BY client_key,provider,day
),
classified AS (
  SELECT f.*,f.phone OR coalesce(b.phone_only,false) AS is_consult FROM pre_admitted f
  LEFT JOIN phone_groups b USING(client_key,provider,day)
),
status_sets AS (
  SELECT source_key,client_key,clinician_id,day,period,is_consult,
    array_agg(DISTINCT f->>'status' ORDER BY f->>'status') AS statuses
  FROM classified WHERE kind='attendance' GROUP BY source_key,client_key,clinician_id,day,period,is_consult
),
conflicts AS (
  SELECT clinician_id,period FROM status_sets GROUP BY client_key,clinician_id,day,period,is_consult HAVING count(DISTINCT statuses)>1
),
admitted AS (
  SELECT * FROM classified f WHERE kind='billing' OR NOT EXISTS(
    SELECT 1 FROM conflicts c WHERE c.clinician_id=f.clinician_id AND c.period=f.period)
),
coverage AS (
  SELECT DISTINCT kind,clinician_id,period FROM proof_periods p WHERE kind='billing' OR NOT EXISTS(
    SELECT 1 FROM conflicts c WHERE c.clinician_id=p.clinician_id AND c.period=p.period)
),
entities AS (SELECT 0 AS clinician_id,'Whole Practice'::text AS label UNION ALL SELECT clinician_id,display_label FROM roster),
coverage_days AS (
  SELECT DISTINCT c.kind,c.clinician_id,c.period+n AS day FROM coverage c CROSS JOIN generate_series(0,13) n
),
entity_coverage AS (
  SELECT * FROM coverage_days UNION ALL SELECT kind,0 AS clinician_id,day FROM coverage_days GROUP BY kind,day
  HAVING count(DISTINCT clinician_id)=6
),
shows AS (
  SELECT DISTINCT client_key,clinician_id,day,is_consult FROM admitted WHERE kind='attendance' AND f->>'status'='show'
),
treatment AS (SELECT * FROM shows WHERE NOT is_consult),
entity_treatment AS (
  SELECT clinician_id,client_key,day FROM treatment UNION SELECT 0,client_key,day FROM treatment
),
excluded_followup AS (
  SELECT DISTINCT f.client_key,f.day FROM facts f CROSS JOIN input i WHERE f.kind='attendance' AND f.f->>'status'='show' AND f.day<=i.as_of
    AND NOT EXISTS(SELECT 1 FROM coverage_days c WHERE c.kind='attendance' AND c.clinician_id=f.clinician_id AND c.day=f.day)
),
clinical_partial AS (
  SELECT DISTINCT t.clinician_id,x.client_key,x.day FROM excluded_followup x JOIN entity_treatment t ON t.client_key=x.client_key AND t.day<x.day
  WHERE NOT EXISTS(SELECT 1 FROM entity_treatment other WHERE other.clinician_id=t.clinician_id AND other.client_key=x.client_key AND other.day=x.day)
),
clinical_coverage AS (
  SELECT c.* FROM entity_coverage c WHERE c.kind='attendance' AND NOT EXISTS(
    SELECT 1 FROM clinical_partial x WHERE x.clinician_id=c.clinician_id AND x.day=c.day)
),
clinical_ranges AS (
  SELECT clinician_id,min(day) AS start_day,max(day) AS end_day FROM (
    SELECT clinician_id,day,day-(row_number() OVER(PARTITION BY clinician_id ORDER BY day))::integer AS island FROM clinical_coverage
  ) d GROUP BY clinician_id,island
),
consult_ranges AS (
  SELECT min(day) AS start_day,max(day) AS end_day FROM (
    SELECT day,day-(row_number() OVER(ORDER BY day))::integer AS island FROM entity_coverage WHERE kind='attendance' AND clinician_id=0
  ) d GROUP BY island
),
windows AS (
  SELECT 'biweekly'::text AS window,period_start AS start_day,period_end AS end_day FROM input
  UNION ALL SELECT 'month',month_start,month_end FROM input
),
grid AS (SELECT e.*,w.*,w.end_day-w.start_day+1 AS calendar_days FROM entities e CROSS JOIN windows w),
-- Same-day multiplicity overrides need the API's hashed-key clamp. Withhold session
-- expectations when any are stored; distinct-date clinical outcomes are unaffected.
session_counts AS (
  SELECT g.clinician_id,g.window,count(t.day) AS visits FROM grid g LEFT JOIN treatment t ON (g.clinician_id=0 OR t.clinician_id=g.clinician_id)
    AND t.day BETWEEN g.start_day AND g.end_day GROUP BY g.clinician_id,g.window
),
relationships AS (
  SELECT clinician_id,client_key,array_agg(day ORDER BY day) AS days FROM entity_treatment GROUP BY clinician_id,client_key
),
initial AS (
  SELECT *,days[1] AS first_day,days[cardinality(days)] AS final_day,
    cardinality(days)>=3 AND days[2]-days[1]<=28 AND days[3]-days[2]<=28 AS retained,
    CASE WHEN cardinality(days)>=2 AND days[2]-days[1]<=28 THEN days[2] ELSE days[1] END+28 AS initial_deadline
  FROM relationships
),
initial_outcomes AS (
  SELECT r.*,EXISTS(SELECT 1 FROM clinical_ranges c WHERE c.clinician_id=r.clinician_id AND c.start_day<=r.first_day AND c.end_day>=r.initial_deadline) AS maturity_covered
  FROM initial r
),
retention_counts AS (
  SELECT g.clinician_id,g.window,count(*) FILTER(WHERE r.retained) AS retained,
    count(*) FILTER(WHERE NOT r.retained AND r.maturity_covered) AS nonretained,
    count(*) FILTER(WHERE NOT r.retained AND NOT r.maturity_covered) AS pending,
    count(*) FILTER(WHERE r.first_day=(SELECT min(day) FROM clinical_coverage c WHERE c.clinician_id=g.clinician_id)) AS left_boundary_starts
  FROM grid g LEFT JOIN initial_outcomes r ON r.clinician_id=g.clinician_id AND r.first_day BETWEEN g.start_day AND g.end_day GROUP BY g.clinician_id,g.window
),
ending_outcomes AS (
  SELECT r.*,EXISTS(SELECT 1 FROM clinical_ranges c WHERE c.clinician_id=r.clinician_id AND c.start_day<=r.final_day+1 AND c.end_day>=r.final_day+90)
    AND NOT EXISTS(SELECT 1 FROM clinical_partial x WHERE x.clinician_id=r.clinician_id AND x.client_key=r.client_key AND x.day>r.final_day) AS mature
  FROM initial r WHERE cardinality(days)>=3
),
mature_months AS (
  SELECT g.*,m::date AS month_day FROM grid g CROSS JOIN LATERAL generate_series(date_trunc('month',g.start_day)::date,g.end_day,INTERVAL '1 month') m
  WHERE m::date>=g.start_day AND (m+INTERVAL '1 month - 1 day')::date<=g.end_day
    AND EXISTS(SELECT 1 FROM clinical_ranges c WHERE c.clinician_id=g.clinician_id AND c.start_day<=m::date AND c.end_day>=(m+INTERVAL '1 month - 1 day')::date+90)
    AND NOT EXISTS(SELECT 1 FROM ending_outcomes r JOIN clinical_partial x ON x.clinician_id=r.clinician_id AND x.client_key=r.client_key AND x.day>r.final_day
      WHERE r.clinician_id=g.clinician_id AND date_trunc('month',r.final_day)=m)
),
ending_counts AS (
  SELECT g.clinician_id,g.window,
    (SELECT count(*) FROM ending_outcomes r WHERE r.clinician_id=g.clinician_id AND r.final_day BETWEEN g.start_day AND g.end_day AND r.mature) AS events,
    (SELECT count(*) FROM ending_outcomes r WHERE r.clinician_id=g.clinician_id AND r.final_day BETWEEN g.start_day AND g.end_day AND NOT r.mature) AS unverified_final_events,
    (SELECT count(*) FROM mature_months m WHERE m.clinician_id=g.clinician_id AND m.window=g.window) AS mature_months,
    (SELECT count(*) FROM ending_outcomes r JOIN mature_months m ON m.clinician_id=r.clinician_id AND date_trunc('month',r.final_day)=m.month_day
      WHERE m.clinician_id=g.clinician_id AND m.window=g.window AND r.mature) AS full_month_ends,
    EXISTS(SELECT 1 FROM clinical_ranges c WHERE c.clinician_id=g.clinician_id AND c.start_day<=g.start_day AND c.end_day>=g.end_day+90)
      AND NOT EXISTS(SELECT 1 FROM ending_outcomes r JOIN clinical_partial x ON x.clinician_id=r.clinician_id AND x.client_key=r.client_key AND x.day>r.final_day
        WHERE r.clinician_id=g.clinician_id AND r.final_day BETWEEN g.start_day AND g.end_day) AS event_window_complete
  FROM grid g
),
consult_first AS (
  SELECT s.client_key,min(s.day) AS consult_day FROM shows s JOIN roster r USING(clinician_id)
  WHERE s.is_consult AND r.current_member GROUP BY s.client_key
),
consult_base AS (
  SELECT c.*,(consult_day+INTERVAL '1 month')::date AS deadline,
    (SELECT min(t.day) FROM treatment t WHERE t.client_key=c.client_key AND t.day BETWEEN c.consult_day AND (c.consult_day+INTERVAL '1 month')::date) AS treatment_day
  FROM consult_first c
),
attributions AS (
  SELECT DISTINCT ON (btrim(a->>'clientId')) btrim(a->>'clientId') AS client_key,a->>'outcome' AS outcome,
    lower(btrim(regexp_replace(a->>'clinicianName','\s+',' ','g'))) AS provider
  FROM workspace w CROSS JOIN LATERAL jsonb_array_elements(coalesce(w.data->'consultAttributionOverrides','[]')) WITH ORDINALITY x(a,n)
  WHERE coalesce(a->>'archived','false')<>'true' ORDER BY btrim(a->>'clientId'),n DESC
),
journeys AS (
  SELECT c.*,a.outcome,r.clinician_id AS credited_id,
    (SELECT CASE WHEN count(DISTINCT t.clinician_id)=1 THEN min(t.clinician_id) END FROM treatment t WHERE t.client_key=c.client_key AND t.day=c.treatment_day) AS candidate_id,
    c.treatment_day IS NULL AND (i.as_of<c.deadline OR EXISTS(SELECT 1 FROM excluded_followup x WHERE x.client_key=c.client_key AND x.day BETWEEN c.consult_day AND c.deadline)
      OR NOT EXISTS(SELECT 1 FROM consult_ranges v WHERE v.start_day<=c.consult_day AND v.end_day>=c.deadline)) AS pending
  FROM consult_base c CROSS JOIN input i LEFT JOIN attributions a USING(client_key) LEFT JOIN roster r ON r.provider=a.provider
),
consult_participants AS (
  SELECT DISTINCT j.client_key,s.clinician_id FROM journeys j JOIN shows s ON s.client_key=j.client_key AND s.is_consult AND s.day BETWEEN j.consult_day AND j.deadline
  JOIN roster r ON r.clinician_id=s.clinician_id WHERE r.current_member
),
consult_counts AS (
  SELECT g.clinician_id,g.window,
    count(*) FILTER(WHERE j.treatment_day IS NOT NULL AND (g.clinician_id=0 OR (j.outcome='confirmed_closer' AND j.credited_id=g.clinician_id))) AS converted,
    count(*) FILTER(WHERE j.treatment_day IS NULL AND NOT j.pending AND (g.clinician_id=0 OR (j.outcome='missed_owner' AND j.credited_id=g.clinician_id))) AS missed,
    count(*) FILTER(WHERE (g.clinician_id=0 AND j.pending) OR (g.clinician_id<>0 AND (
      (j.pending AND p.clinician_id=g.clinician_id)
      OR (j.treatment_day IS NOT NULL AND (j.outcome IS DISTINCT FROM 'confirmed_closer' OR j.credited_id IS NULL)
        AND (j.candidate_id=g.clinician_id OR (j.candidate_id IS NULL AND p.clinician_id=g.clinician_id)))
      OR (j.treatment_day IS NULL AND NOT j.pending AND (j.outcome IS DISTINCT FROM 'missed_owner' OR j.credited_id IS NULL) AND p.clinician_id=g.clinician_id)
    ))) AS pending,
    count(*) FILTER(WHERE j.treatment_day IS NOT NULL AND (j.outcome IS DISTINCT FROM 'confirmed_closer' OR j.credited_id IS NULL)
      AND (g.clinician_id=0 OR (j.candidate_id=g.clinician_id) OR (j.candidate_id IS NULL AND p.clinician_id=g.clinician_id))) AS converted_needs_attribution,
    count(*) FILTER(WHERE j.treatment_day IS NULL AND NOT j.pending AND (j.outcome IS DISTINCT FROM 'missed_owner' OR j.credited_id IS NULL)
      AND (g.clinician_id=0 OR p.clinician_id=g.clinician_id)) AS missed_needs_attribution,
    count(*) FILTER(WHERE g.clinician_id<>0 AND j.treatment_day IS NOT NULL AND p.clinician_id=g.clinician_id
      AND g.clinician_id<>coalesce(CASE WHEN j.outcome='confirmed_closer' THEN j.credited_id END,j.candidate_id)) AS internal_referrer_protected
  FROM grid g LEFT JOIN journeys j ON j.consult_day BETWEEN g.start_day AND g.end_day
  LEFT JOIN consult_participants p ON p.client_key=j.client_key AND p.clinician_id=g.clinician_id GROUP BY g.clinician_id,g.window
),
-- Hashes are global identities. Cross-encounter reuse withholds fees rather than
-- selecting a component winner; this conservative diagnostic does not recurse rows.
billing AS (SELECT source_key,coalesce(btrim(client_key),'') AS client_key,provider,day,code,visit_kind,fee,row_hash,clinician_id FROM admitted WHERE kind='billing'),
hash_collisions AS (
  SELECT row_hash FROM billing WHERE coalesce(btrim(row_hash),'')<>'' GROUP BY row_hash
  HAVING count(DISTINCT (btrim(client_key),provider,day,code))>1
),
bill_source_counts AS (
  SELECT client_key,provider,day,code,source_key,count(DISTINCT row_hash) AS hashes
  FROM billing GROUP BY client_key,provider,day,code,source_key
),
bill_multiplicity AS (
  SELECT client_key,provider,day,code,max(hashes) AS max_hashes_per_source FROM bill_source_counts GROUP BY client_key,provider,day,code
),
bill_groups AS (
  SELECT client_key,provider,clinician_id,day,code,
    count(*) AS raw_rows,count(DISTINCT (visit_kind,fee)) AS payloads,
    bool_or(fee IS NULL OR coalesce(btrim(row_hash),'')='' OR coalesce(btrim(client_key),'')='') AS invalid,
    min(fee) AS one_fee,min(visit_kind) AS visit_kind,
    max(mult.max_hashes_per_source) AS max_hashes_per_source,
    count(DISTINCT row_hash) AS distinct_hashes
  FROM billing b JOIN bill_multiplicity mult USING(client_key,provider,day,code) GROUP BY client_key,provider,clinician_id,day,code
),
approval_checks AS (
  SELECT g.*,j.res,
    j.res IS NOT NULL AND (SELECT count(*) FROM journal other WHERE other.res->>'clientId'=g.client_key
      AND lower(btrim(regexp_replace(other.res->>'clinicianLabel','\s+',' ','g')))=g.provider AND other.res->>'serviceDate'=g.day::text AND other.res->>'billingCode'=g.code)=1
    AND j.res->>'clinicianId'=g.clinician_id::text AND EXISTS(SELECT 1 FROM mapping_valid m WHERE m.provider=g.provider AND m.clinician_id=g.clinician_id)
    AND j.res->>'visitKind'=g.visit_kind AND g.code<>'phone' AND g.visit_kind<>'consultation' AND NOT g.invalid
    AND jsonb_array_length(j.res->'charges')=2
    AND (SELECT count(DISTINCT (ch->'anchor'->>'snapshotId',ch->'anchor'->>'sourceRowHash',ch->>'amount')) FROM jsonb_array_elements(j.res->'charges') x(ch))=2
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.res->'charges') x(ch) WHERE jsonb_typeof(ch->'amount')<>'number' OR (ch->>'amount')::numeric<=0 OR NOT EXISTS(
      SELECT 1 FROM billing b WHERE btrim(b.client_key)=g.client_key AND b.provider=g.provider AND b.day=g.day AND b.code=g.code AND b.visit_kind=g.visit_kind
        AND b.source_key=ch->'anchor'->>'snapshotId' AND b.row_hash=ch->'anchor'->>'sourceRowHash' AND b.fee=(ch->>'amount')::numeric))
    AND NOT EXISTS(SELECT 1 FROM billing b WHERE btrim(b.client_key)=g.client_key AND b.provider=g.provider AND b.day=g.day AND b.code=g.code
      AND (b.fee<=0 OR b.visit_kind<>g.visit_kind OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.res->'charges') x(ch) WHERE b.fee=(ch->>'amount')::numeric)))
    AND NOT EXISTS(SELECT 1 FROM billing b WHERE btrim(b.client_key)=g.client_key AND b.provider=g.provider AND b.day=g.day AND b.code=g.code
      GROUP BY b.source_key,b.fee HAVING count(DISTINCT b.row_hash)>(SELECT count(*) FROM jsonb_array_elements(j.res->'charges') x(ch) WHERE (ch->>'amount')::numeric=b.fee)) AS approval_valid
  FROM bill_groups g LEFT JOIN journal j ON j.res->>'clientId'=g.client_key
    AND lower(btrim(regexp_replace(j.res->>'clinicianLabel','\s+',' ','g')))=g.provider AND j.res->>'serviceDate'=g.day::text AND j.res->>'billingCode'=g.code
),
accepted_billing AS (
  SELECT *,coalesce(approval_valid,false) OR (res IS NULL AND NOT invalid AND payloads=1 AND max_hashes_per_source<=1 AND (code<>'' OR distinct_hashes<=1)) AS known,
    CASE WHEN approval_valid THEN (SELECT sum((ch->>'amount')::numeric) FROM jsonb_array_elements(res->'charges') x(ch)) ELSE one_fee END AS charged
  FROM approval_checks
),
fee_counts AS (
  SELECT g.clinician_id,g.window,count(b.day) AS groups,sum(b.raw_rows) AS raw_rows,
    count(*) FILTER(WHERE NOT b.known) AS unknown_groups,count(*) FILTER(WHERE b.approval_valid) AS approved_groups,
    count(*) FILTER(WHERE b.res IS NOT NULL AND NOT coalesce(b.approval_valid,false)) AS stale_approvals,
    sum(b.charged) AS charged FROM grid g LEFT JOIN accepted_billing b ON (g.clinician_id=0 OR b.clinician_id=g.clinician_id)
      AND b.day BETWEEN g.start_day AND g.end_day GROUP BY g.clinician_id,g.window
),
gate AS (
  SELECT CASE WHEN (SELECT count(*) FROM active_scopes)<>1 THEN 'STOP_SCOPE_NOT_UNIQUE'
    WHEN (SELECT count(*) FROM workspace)<>1 OR (SELECT count(*) FROM declaration)<>1 THEN 'STOP_WORKSPACE_OR_DECLARATION'
    WHEN EXISTS(SELECT 1 FROM practice_import_audit a JOIN scope USING(practice_id,account_id)
      WHERE a.action='confirm-historical-billing-providers') THEN 'STOP_HISTORICAL_BILLING_SCOPE_REQUIRES_LEDGER_AUDIT'
    WHEN EXISTS(SELECT 1 FROM declaration WHERE data->'version' IS DISTINCT FROM '1'::jsonb
      OR jsonb_typeof(data->'mappings') IS DISTINCT FROM 'array' OR jsonb_typeof(data->'sourceSets') IS DISTINCT FROM 'array')
      OR EXISTS(SELECT 1 FROM sources WHERE jsonb_typeof(rows) IS DISTINCT FROM 'array')
      OR EXISTS(SELECT 1 FROM maps WHERE jsonb_typeof(m->'sourceLabel') IS DISTINCT FROM 'string'
        OR jsonb_typeof(m->'clinicianLabel') IS DISTINCT FROM 'string' OR jsonb_typeof(m->'clinicianId') IS DISTINCT FROM 'number' OR jsonb_typeof(m->'teamId') IS DISTINCT FROM 'number') THEN 'STOP_METADATA_SCHEMA'
    WHEN (SELECT count(*) FROM roster)<>6 OR (SELECT count(*) FROM maps)<>6 OR (SELECT count(*) FROM mapping_valid)<>6
      OR (SELECT count(*) FROM clinicians c WHERE c.goal_id=i.team_id)<>6 THEN 'STOP_ROSTER_OR_MAPPING_CHANGED'
    WHEN (SELECT data#>>'{settings,teamId}' FROM workspace) IS DISTINCT FROM i.team_id::text THEN 'STOP_SELECTED_TEAM_CHANGED'
    WHEN (SELECT count(*) FROM sets_raw)<>(SELECT count(*) FROM valid_sets) THEN 'STOP_STALE_SOURCE_SET'
    WHEN EXISTS(SELECT 1 FROM sources WHERE kind NOT IN('attendance','billing')) THEN 'STOP_UNSUPPORTED_SOURCE_KIND'
    WHEN EXISTS(SELECT 1 FROM admitted WHERE kind='attendance' AND coalesce(btrim(client_key),'')='') THEN 'STOP_ATTENDANCE_IDENTITY'
    WHEN EXISTS(SELECT 1 FROM admitted WHERE kind='attendance' AND (f->>'status' IS NULL OR f->>'status' NOT IN('show','cancelled','no show','clinician cancelled'))) THEN 'STOP_UNSUPPORTED_ATTENDANCE_STATUS'
    WHEN EXISTS(SELECT 1 FROM admitted WHERE kind='attendance' GROUP BY row_hash
      HAVING coalesce(btrim(row_hash),'')='' OR count(DISTINCT (client_key,provider,day,is_consult,f->>'status'))>1) THEN 'STOP_ATTENDANCE_HASH_IDENTITY'
    WHEN EXISTS(SELECT 1 FROM attributions a WHERE a.outcome IN('confirmed_closer','missed_owner')
      AND NOT EXISTS(SELECT 1 FROM roster r WHERE r.provider=a.provider)) THEN 'STOP_UNMAPPED_ATTRIBUTION_TARGET'
    WHEN (SELECT count(*) FROM journal_raw)<>(SELECT count(*) FROM journal) OR (SELECT count(*) FROM journal)>1000
      OR EXISTS(SELECT 1 FROM (SELECT journal_revision,row_number() OVER(ORDER BY journal_revision) n FROM journal) j WHERE j.journal_revision IS DISTINCT FROM j.n::integer)
      OR (SELECT count(DISTINCT res->>'id') FROM journal)<>(SELECT count(*) FROM journal)
      OR (SELECT count(DISTINCT res->>'approvalToken') FROM journal)<>(SELECT count(*) FROM journal) THEN 'STOP_JOURNAL_INVALID'
    WHEN i.period_end<>i.period_start+13 OR i.period_start<>DATE '2026-01-01'+floor((i.period_start-DATE '2026-01-01')::numeric/14)::integer*14
      OR i.month_start<>date_trunc('month',i.month_start)::date OR i.month_end<>(i.month_start+INTERVAL '1 month - 1 day')::date
      OR i.period_start<i.month_start OR i.period_end>i.month_end OR i.month_end>i.as_of OR i.as_of-i.month_start>3660 THEN 'STOP_INVALID_AUDIT_WINDOW'
    ELSE 'READY_AGGREGATE_DIAGNOSTIC_NOT_UI_CERTIFICATION' END AS status FROM input i
),
metrics AS (
  SELECT g.*,
    (SELECT count(*) FROM entity_coverage c WHERE c.kind='attendance' AND c.clinician_id=g.clinician_id AND c.day BETWEEN g.start_day AND g.end_day) AS attendance_days,
    (SELECT count(*) FROM entity_coverage c WHERE c.kind='billing' AND c.clinician_id=g.clinician_id AND c.day BETWEEN g.start_day AND g.end_day) AS billing_days,
    s.visits,r.retained,r.nonretained,r.pending AS retention_pending,r.left_boundary_starts,
    e.events,e.unverified_final_events,e.mature_months,e.full_month_ends,e.event_window_complete,
    c.converted,c.missed,c.pending AS consult_pending,c.converted_needs_attribution,c.missed_needs_attribution,c.internal_referrer_protected,
    b.groups AS fee_groups,coalesce(b.raw_rows,0) AS fee_raw_rows,b.unknown_groups,b.approved_groups,b.stale_approvals,coalesce(b.charged,0) AS charged
  FROM grid g JOIN session_counts s USING(clinician_id,"window") JOIN retention_counts r USING(clinician_id,"window")
  JOIN ending_counts e USING(clinician_id,"window") JOIN consult_counts c USING(clinician_id,"window") JOIN fee_counts b USING(clinician_id,"window")
)
SELECT gate.status,
  (SELECT revision FROM declaration) AS declaration_revision,(SELECT count(*) FROM valid_sets) AS valid_source_sets,
  (SELECT count(*) FROM sources) AS active_snapshots,(SELECT count(*) FROM journal) AS billing_journal_entries,
  (SELECT count(*) FROM facts WHERE day IS NULL) AS invalid_source_dates,
  (SELECT count(*) FROM facts WHERE clinician_id IS NULL) AS unmapped_raw_rows,
  (SELECT count(*) FROM conflicts) AS conflicting_attendance_groups,
  (SELECT count(*) FROM hash_collisions) AS cross_encounter_billing_hash_collisions,
  (SELECT count(*) FROM facts WHERE kind='billing' AND phone AND (fee IS NULL OR fee<>0)) AS raw_phone_charge_anomalies,
  (SELECT count(*) FROM packages WHERE coalesce(overrides,'{}')<>'{}'::jsonb) AS packages_with_unsupported_multiplicity_overrides,
  (SELECT count(*) FROM roster WHERE current_member) AS current_consult_cohort_clinicians,
  'BILLED_CHARGES_NOT_COLLECTIONS_PAYROLL_OR_PROFIT'::text AS financial_basis,
  CASE WHEN gate.status='READY_AGGREGATE_DIAGNOSTIC_NOT_UI_CERTIFICATION' THEN
    (SELECT jsonb_agg(jsonb_build_object(
      'clinician',m.label,'window',m.window,'start',m.start_day,'end',m.end_day,'asOf',i.as_of,
      'attendanceCoveredDays',m.attendance_days,'billingCoveredDays',m.billing_days,'calendarDays',m.calendar_days,
      'attendanceRawRows', (SELECT count(*) FROM facts f WHERE f.kind='attendance' AND (m.clinician_id=0 OR f.clinician_id=m.clinician_id) AND f.day BETWEEN m.start_day AND m.end_day),
      'attendanceAdmittedRows', (SELECT count(*) FROM admitted f WHERE f.kind='attendance' AND (m.clinician_id=0 OR f.clinician_id=m.clinician_id) AND f.day BETWEEN m.start_day AND m.end_day),
      'admittedConsultAttendanceRows', (SELECT count(*) FROM admitted f WHERE f.kind='attendance' AND f.f->>'status'='show' AND f.is_consult AND (m.clinician_id=0 OR f.clinician_id=m.clinician_id) AND f.day BETWEEN m.start_day AND m.end_day),
      'admittedNonShowAttendanceRows', (SELECT count(*) FROM admitted f WHERE f.kind='attendance' AND f.f->>'status'<>'show' AND (m.clinician_id=0 OR f.clinician_id=m.clinician_id) AND f.day BETWEEN m.start_day AND m.end_day),
      'sessions',CASE WHEN m.attendance_days=m.calendar_days AND NOT EXISTS(SELECT 1 FROM packages WHERE coalesce(overrides,'{}')<>'{}'::jsonb) THEN m.visits END,
      'sessionsWeekly',CASE WHEN m.attendance_days=m.calendar_days AND NOT EXISTS(SELECT 1 FROM packages WHERE coalesce(overrides,'{}')<>'{}'::jsonb) THEN m.visits*7.0/m.calendar_days END,
      'retained',m.retained,'retentionEvaluated',m.retained+m.nonretained,'retentionNonretained',m.nonretained,'retentionPending',m.retention_pending,
      'retentionPercent',100.0*m.retained/nullif(m.retained+m.nonretained,0),'retentionLeftBoundaryStarts',m.left_boundary_starts,
      'endingEvents',CASE WHEN m.event_window_complete THEN m.events END,'positiveMatureEndingEvents',m.events,'unverifiedFinalEvents',m.unverified_final_events,
      'endingMatureMonths',m.mature_months,'endingFullMonthTotal',m.full_month_ends,'endingMonthlyAverage',m.full_month_ends*1.0/nullif(m.mature_months,0),
      'consultConverted',m.converted,'consultEvaluated',m.converted+m.missed,'consultMissed',m.missed,'consultPending',m.consult_pending,
      'consultPercent',100.0*m.converted/nullif(m.converted+m.missed,0),'convertedNeedsAttribution',m.converted_needs_attribution,
      'missedNeedsAttribution',m.missed_needs_attribution,'internalReferrerProtected',m.internal_referrer_protected,
      'billingRawRows',(SELECT count(*) FROM facts f WHERE f.kind='billing' AND (m.clinician_id=0 OR f.clinician_id=m.clinician_id) AND f.day BETWEEN m.start_day AND m.end_day),
      'billingAdmittedRawRows',m.fee_raw_rows,'billingEncounterGroups',m.fee_groups,'unknownFeeGroups',m.unknown_groups,
      'approvedTwoChargeGroups',m.approved_groups,'staleApprovals',m.stale_approvals,
      'billedCharges',CASE WHEN m.billing_days=m.calendar_days AND m.unknown_groups=0 AND NOT EXISTS(SELECT 1 FROM hash_collisions) THEN m.charged END
    ) ORDER BY m.window,m.clinician_id) FROM metrics m CROSS JOIN input i)
  END AS aggregate_metrics
  ,CASE WHEN gate.status='READY_AGGREGATE_DIAGNOSTIC_NOT_UI_CERTIFICATION' THEN
    (SELECT jsonb_agg(jsonb_build_object(
      'clinician',g.label,'window',g.window,
      'unresolvedPartialFollowupRows',(SELECT count(*) FROM clinical_partial x WHERE x.clinician_id=g.clinician_id),
      'partialFollowupAfterAdmittedThroughRows',(SELECT count(*) FROM clinical_partial x WHERE x.clinician_id=g.clinician_id
        AND x.day>(SELECT max(day) FROM entity_coverage c WHERE c.kind='attendance' AND c.clinician_id=g.clinician_id)),
      'legacyClinicianLabelVerified',CASE WHEN g.clinician_id=0 THEN NULL ELSE
        NOT EXISTS(SELECT 1 FROM clinical_partial x WHERE x.clinician_id=g.clinician_id)
        AND EXISTS(SELECT 1 FROM clinical_ranges c WHERE c.clinician_id=g.clinician_id
          AND c.start_day<=(SELECT min(day) FROM entity_treatment t WHERE t.clinician_id=g.clinician_id)
          AND c.end_day>=(SELECT max(day) FROM entity_treatment t WHERE t.clinician_id=g.clinician_id)) END,
      'selectedRetentionCoverageVerified',EXISTS(SELECT 1 FROM clinical_ranges c WHERE c.clinician_id=g.clinician_id AND c.start_day<=g.start_day AND c.end_day>=g.end_day)
        AND NOT EXISTS(SELECT 1 FROM initial_outcomes r WHERE r.clinician_id=g.clinician_id AND r.first_day BETWEEN g.start_day AND g.end_day
          AND NOT EXISTS(SELECT 1 FROM clinical_ranges c WHERE c.clinician_id=g.clinician_id AND c.start_day<=r.first_day
            AND c.end_day>=CASE WHEN r.retained THEN r.days[3] ELSE r.initial_deadline END))
    ) ORDER BY g.window,g.clinician_id) FROM grid g)
  END AS retention_provenance
FROM gate;
