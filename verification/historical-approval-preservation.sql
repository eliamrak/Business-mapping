-- SELECT-only, aggregate fingerprints only. Capture before saving the fifth
-- approval, then compare first_four_full_event_fingerprint after the save.
-- An after-only digest cannot prove equality to a missing baseline.
WITH scopes AS (
 SELECT practice_id,account_id FROM practice_import_packages WHERE active=1
 UNION SELECT practice_id,account_id FROM practice_import_snapshots WHERE active=1
), scoped AS (
 SELECT a.* FROM practice_import_audit a JOIN scopes s USING(practice_id,account_id)
 WHERE (SELECT count(*) FROM scopes)=1 AND a.action='accept-billing-charge-exception'
), events AS (
 SELECT t.*,CASE WHEN detail->>'revision'~'^[1-9][0-9]{0,8}$'
 THEN (detail->>'revision')::integer END journal_revision FROM scoped t
)
SELECT (SELECT count(*) FROM scopes)=1 AS scope_ready,
 count(*) AS approval_events,count(DISTINCT journal_revision) AS distinct_revisions,
 count(*) FILTER(WHERE journal_revision BETWEEN 1 AND 4) AS first_four_events,
 (SELECT md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) FROM scoped t
 WHERE t.detail->>'revision' IN ('1','2','3','4')) AS first_four_full_event_fingerprint,
 count(*) FILTER(WHERE journal_revision BETWEEN 1 AND 4 AND detail->'resolution' ? 'historicalProviderId') AS historical_bindings_in_original_four,
 count(*) FILTER(WHERE journal_revision=5 AND detail->'resolution' ? 'historicalProviderId'
 AND NOT (detail->'resolution' ? 'clinicianId')) AS historical_binding_in_fifth,
 count(*) FILTER(WHERE journal_revision IS NULL) AS malformed_revision_events
FROM events;
