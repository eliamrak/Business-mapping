# Configuration Copy Versus Person Identity

## Confirmed Source Behavior

`artifacts/api-server/src/routes/clinicians.ts` copies main-roster rows through `/clinicians/copy-to-goal`. It deliberately removes the original ID, goal ID, timestamps and share token, then inserts a new row with the destination goal. The `clinicians` schema has no canonical-person ID or source-clinician link. This operation can produce identical labels on distinct IDs without preserving provenance. It does not prove that any particular production rows were copied by this route.

`scenario_clinicians.source_clinician_id` is a real, nullable FK to one main-roster row. Scenario rows are a separate table, not the main-roster rows returned by `/clinicians` and hub context. Their explicit link cannot equate two different main-roster IDs. Share tokens are access credentials, not person identifiers; this diagnostic never reads them.

The import identity guard currently treats every distinct main-roster ID with the same normalized label as ambiguous, including IDs outside the selected configuration. Parent's aggregate result establishes that this guard blocks the imported names globally. It does not establish that the selected team has duplicate people, or that those rows are modeling copies. Name equality, matching economics, and creation-time proximity cannot prove that.

## Next Read-Only Check

Run `practice-identity-lineage-diagnostic.sql` as one SELECT in the existing authorized production SQL UI. No new connection, credentials, raw export or write is needed. Keep output private. The author has not executed this query against production.

Output contains configuration IDs and counts, but no clinician IDs, labels, source strings, tokens, hashes, client fields, notes or economics. Anonymous repeated-label groups have no stable person identifier. The query refuses import scope unless exactly one active practice/account pair exists and flags a missing workspace. Current-profile counts use the example as-of date at the top; change it only to an agreed audit date. A null selected configuration is valid for explicitly selected unassigned rows.

- Configuration membership shows which selected/current/manual-record-bearing rows have exact source-label matches. It also locates the requested exact-label row by configuration/count only (`elia` example input), so a planning-row match is not mistaken for the live clinician. It never treats a prefix as identity.
- Source categories distinguish unique selected-team/global matches, unique selected-team but globally ambiguous matches, ambiguity inside the selected team, and absent matches. Uniqueness is diagnostic, not permission to map.
- Anonymous repeated-label membership shows cross-configuration distribution without exposing names or person IDs.
- Scenario source-link counts show existing explicit links separately. Known identity-column presence checks a bounded set of expected crosswalk column names; absence does not certify that no external mapping exists.

## Smallest Confirmation

If every source key has exactly one intended selected-team row, ask the owner to confirm in the authenticated app that this configuration is the live clinical team and that each of the six source labels belongs to its displayed clinician row, rather than another same-name person. This is an explicit source-label-to-roster confirmation, not a global name merge. If any key is ambiguous within the selected team, the owner must choose that specific row using existing roster context; aggregate output alone cannot do so.

An implementation could then persist a practice/account-scoped explicit crosswalk to the selected roster IDs, with provenance and an ambiguity/staleness check. Do not silently infer it from selected team or backfill historical person identity. No crosswalk exists or is authorized merely because this document proposes one. Preserve all copied rows, scenarios, imports and manual records. Report completeness is a separate confirmation and remains blocked on the source type/date-window answers; this check cannot certify it.

This increment changes verification artifacts only. No mapping guard, business calculation, saved metadata, main branch or deployment is changed. Static tests and independent source review are not production SQL runtime certification.
