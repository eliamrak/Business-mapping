# Aggregate Clinician-Mapping Diagnostic

Run `practice-clinician-mapping-diagnostic.sql` as one SELECT in the existing authorized production SQL UI. No raw rows, patient details, clinician names/IDs, source hashes, credentials or mappings are returned. No DB call has been made by the author. It refuses import data scope unless exactly one active practice/account pair exists.

Input is an exact normalized requested roster label (`elia` in the example), with explicit example dates. Change inputs only to the known agreed label/window; never guess a provider mapping. All active source dates are counted separately from the requested window, so an empty window cannot silently imply no lifetime activity.

The result reports:
- Global requested-name identity match count and existing manual records/session totals for that roster ID, without returning the ID. These are manual records, not clinical retention or consultation evidence.
- Per-source-kind counts/distinct-key counts by fixed category: exact requested or other roster name, ambiguous exact name, numeric roster ID stored in the clinician-name field, prefix candidate, missing field or unmapped field.
- Matching/presence counts for known alternate clinician/provider ID/name keys. Each alias is tested independently; no first-nonnull winner is chosen. An apparent match remains diagnostic, not a verified identity crosswalk.
- Literal versus normalized show-status counts, expected serviceDate-field/ISO-shape counts and alternate date-field presence. These identify schema/status/date-window mismatches without printing values. ISO shape is not date validity certification.
- Anonymous source-key frequency bins, without strings or hashes. Keep even aggregate output private.

Parent supplied production aggregates after the earlier four SELECT statements: four null-coverage imports; global roster identity unique; 107 canonical ended manual records for six current providers, common cutoff October7 and manual-only forecast October8 at47.33/week. Elia's exact-name raw journey query returned zero despite known sessions; this is a mapping/schema/window question, not evidence of no activity. Raw billed-row subtotal306139 across2151 numeric YTD rows is not reconciled income or cash. Eight pre/post hashes were reported unchanged by the cloud worker. These are parent-provided results, not author DB verification.

Use the diagnostic counts to ask the cloud worker through the parent which field/category needs existing source/crosswalk verification. Do not return raw source strings/client data, accept a prefix as identity, add a mapping, confirm coverage, change records, or publish. Exact billing/attendance through-date mapping and the report start date remain unconfirmed; observed minimum dates cannot fill them.

Static bounded review found no SELECT/scope/privacy blocker. Live SQL execution/schema compatibility remains unverified. This diagnostic is not a complete metric replay or business-data certification.
