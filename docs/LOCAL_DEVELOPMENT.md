# Local Business Hub

## Scope and Routes

The eight-area hub is at `/hub`. Original compensation remains at `/`,
sessions at `/practice`, and public clinician presentations retain their routes.
See BUILD_STATUS.md for delivered scope and explicit remaining limitations.
Preview fixtures are fictional aggregate data. Never enter patient information.

## Local Runtime

Verified with Node 24, pnpm 11 and local PostgreSQL. Web/API dependencies,
ExcelJS and Papa Parse are installed. Unrelated mobile/mockup artifacts are not
included in this scoped local installation.

Use a dedicated disposable database on loopback. Fresh setup example:

```sh
export EMC_LOCAL_PGDATA="$(mktemp -d /private/tmp/emc-practice-db.XXXXXX)"
initdb -D "$EMC_LOCAL_PGDATA" -A trust --encoding=UTF8 --no-locale
pg_ctl -D "$EMC_LOCAL_PGDATA" -l "$EMC_LOCAL_PGDATA/server.log" -o "-h 127.0.0.1 -p 55439 -k $EMC_LOCAL_PGDATA" start
createdb -h 127.0.0.1 -p 55439 emc_practice
export DATABASE_URL="postgresql://$(id -un)@127.0.0.1:55439/emc_practice"
pnpm --filter @workspace/db push
pnpm --filter @workspace/api-server run build
DATABASE_URL="$DATABASE_URL" node scripts/dev-local.mjs
EMC_TEST_API_URL=http://127.0.0.1:4318/api node scripts/seed-local-practice.mjs
EMC_TEST_API_URL=http://127.0.0.1:4318/api node scripts/seed-local-hub.mjs
```

`db push` is for a fresh disposable schema, never production. Do not apply the
numbered migrations after push already created those tables. Existing local
databases should apply only missing migrations in order. Fixture scripts refuse
to overwrite their initial data.

- Web: http://127.0.0.1:4317/hub
- API: http://127.0.0.1:4318/api
- Logs/owned PIDs: `.local/dev/` (gitignored).
- Use LOCAL_WEB_PORT / LOCAL_API_PORT if those ports are occupied.
- API runs a compiled build; frontend changes reload through Vite.

After backend edits:

```sh
pnpm --filter @workspace/api-server run build
DATABASE_URL="$DATABASE_URL" node scripts/restart-local-api.mjs
```

The helper verifies/restarts only this project's owned API process. Preview
services remain running. Before stopping them, verify recorded PIDs still belong
to this project. Stop only the owned database with
`pg_ctl -D "$EMC_LOCAL_PGDATA" stop`.

## Verification

```sh
node scripts/check-release.mjs
```

The release helper runs the following code checks. Database/API checks require
the dedicated local test database and API and must also be run separately:

```sh
pnpm run typecheck:libs
pnpm --filter @workspace/api-server --filter @workspace/comp-dashboard run typecheck
pnpm test
pnpm --filter @workspace/api-server run build
PORT=4317 BASE_PATH=/ pnpm --filter @workspace/comp-dashboard run build
EMC_TEST_DATABASE_URL="$DATABASE_URL" EMC_TEST_API_URL=http://127.0.0.1:4318/api pnpm run test:api
```

Build libraries before scoped type checks so referenced declarations are current.
Root `pnpm typecheck` also checks uninstalled unrelated mobile/mockup packages;
it is not the verified command for this installation.

Session tests create fictional teams on the local test API and retain audit
history. Hub tests create/drop isolated databases and launch a temporary
authenticated API. They cover imports, source provenance, permissions,
corrections, concurrent writes, approvals, legacy APIs and full dump/restore.
Never target production.

The 2026-09-20 checkpoint passed 65 unit/model/PDF tests and 22 API/database tests.
Legacy formulas matched the original commit across 864 compensation inputs plus
staff/goal/reality cases. Scoped type checks and production builds passed.
Existing UI source-map diagnostics and a large main-bundle warning remain;
they are not build failures.

The web tsconfig resolves React declarations through its own installed
dependency. This avoids mixing the mobile workspace's older hoisted types
with the dashboard types in Replit's pnpm 10 installation.

Browser checks: budget edit, location/KPI creation, finalized correction,
multi-channel approval and preserved baseline, CSV mapping/review/confirmation,
downstream totals, all eight areas at 1440px and 320px with larger text,
light/dark appearance and mobile dialogs. Earlier session checks covered
save/reload/history, validation, overlaps, outage/retry, columns and unsaved
navigation. This is representative coverage, not every legacy UI interaction.

## Persistence Contracts

`GET /api/hub` returns revision/data/updatedAt. `POST /api/hub` accepts
requestId/expectedRevision/action/data. Request IDs are UUIDs. Retry an uncertain
save using the identical ID/payload; stale edits return 409. Saves are validated
and versioned. Finalized financial changes require a new correction reason.
Approved baselines cannot be rewritten; duplicate a proposal to revise it.

`POST /api/hub/proposals/:id/approve` accepts reviewed change IDs and the current
revision. Promotion is transactional, expected-case, and does not alter actuals.
Pausing an initiative ends future effects while preserving historical segments.

`GET /api/session-records?goalId=unassigned` (or positive goal ID) returns team
records. `POST /api/session-records` accepts requestId/expectedRevision/entry.
Entries require clinicianId/start/end/completed/desired/cancelled/noShow;
scheduled/inPerson/telehealth/sourceAttachmentId default to null. Corrections
increment revision and preserve actor/source history.

Dates are inclusive ISO calendar dates, at most 366 days per entry. Counts are
integers 0-10000. Scheduled cannot be below completed. In-person plus telehealth
must equal completed when both are supplied. Missing is not zero. Actual totals
include only whole recorded periods within the range; crossing periods are
flagged. Monthly forecast expectations can be explicitly prorated for comparison.
Clinicians referenced by history or connected plans cannot be deleted.

CSV/XLSX originals are retained before column mapping and human confirmation.
Preview allows 1000 data rows; XLSX parsing has memory/time limits. Same-content
uploads in one period resolve to one attachment. PDF/images are manual reference
documents, not automatic extraction. Duplicate/overlapping session imports cannot
silently overwrite prior records; a partially saved import can resume remaining
rows while its review remains open.

## Authentication

Production fails closed until configured:

- EMC_OWNER_EMAIL: owner login.
- EMC_OWNER_PASSWORD_HASH: scrypt salt/hash, `salt:hexHash`, using
  Node `scryptSync(password,salt,64)`. Store in secrets, never commit.
- APP_ORIGIN: exact public HTTPS origin, no trailing slash.
- NODE_ENV=production and the reviewed DATABASE_URL/host/port.

Local auth bypass requires all three: nonproduction, HOST=127.0.0.1,
LOCAL_PREVIEW=true. Never enable a production bypass.

Sessions use HttpOnly/SameSite cookies (Secure in production), hashed tokens and
expiry. Mutation origins are checked. Owner has management access. Restricted
entry users can enter sessions/funnel totals for the active team and open periods,
without finance or compensation access. No VA account is created automatically.
Public share-token reads remain available; management endpoints are protected.

Test actual hosting cookies, proxies, origins, expiry and login throttling in
staging before release. No real owner password was created by local testing.

## Migration and Recovery

Additive SQL migrations:

1. 001_session_records.sql: session entries and history.
2. 002_business_hub.sql: workspace/history/attachments/users/auth sessions.
3. 003_session_detail.sql: attendance/types/actor.
4. 004_session_sources.sql: session source attachment links.

Review target schema first. Existing compensation values are not rewritten.
Retain new tables/columns on application rollback; dropping them loses data.

The post-merge hook installs the locked dependencies but never runs `db push`.
Inspect an existing target, verify a protected backup, then apply only the
missing numbered migrations:

```sh
DATABASE_URL="$REVIEWED_DATABASE_URL" node scripts/migrate-hub.mjs
EMC_DATABASE_BACKUP_VERIFIED=true DATABASE_URL="$REVIEWED_DATABASE_URL" node scripts/migrate-hub.mjs --apply
```

Development and production databases must be identified separately. Never copy
local fixtures or replace production with the development database.

Updates > Reports & recovery downloads all application business tables,
including original compensation/scenario records, sessions, source documents
and audit history. Authentication accounts, credentials and sessions are
excluded. Recovery previews counts and requires an explicit confirmation,
an empty target app and a short-lived owner-bound token. It is atomic, checks
the schema, and cannot overwrite an occupied database. The browser import
limit is 14 MB. The simpler hub JSON export remains a partial export.

Full server recovery and larger backups use PostgreSQL plus protected secrets:

```sh
pg_dump --format=custom --file=emc-backup.dump "$DATABASE_URL"
pg_restore --dbname="$EMPTY_RESTORE_DATABASE_URL" --no-owner --no-privileges emc-backup.dump
```

Use a reviewed source and separate empty restore database. Protect backups as
sensitive financial data. Full local dump/restore equality passed. Real Replit
schema/data and hosted recovery have not yet been reviewed or rehearsed.

## Release Gate

Expansion and final fixes through 0579d23 were pushed to GitHub and
fast-forwarded into Replit. The full code release check passed on Replit.
No production migration or publish has occurred. Owner authentication is not
yet configured. Keep the existing live deployment unchanged until these gates
are satisfied.

1. Release approval was given on 2026-09-20 for this expansion. Inspect the
   target before each external step; approval does not bypass security gates.
2. Review the complete diff/schema/secrets. Rerun verification and take a
   protected production backup with a rehearsed restore.
3. Commit/push approved work to github.com/eliamrak/Business-mapping.
4. In Replit, inspect status/remotes. The user's GitHub remote is named
   `github`, not `origin`. Fetch and fast-forward only the approved commit.
   Stop for dirty/divergent work; never force-push or reset it.
5. Configure authentication and apply reviewed migrations. Staging-smoke legacy
   tools, hub saves, imports, approvals, exports and public/revoked links.
6. Publish only after approval. Verify HTTPS, health, permissions, persistence
   after reload/restart, and the real live URL. Roll back code without dropping
   newly entered data if required.

No Replit Agent is needed. Hosting/database/publication charges are separate;
there is no claim that Replit hosting is free.
