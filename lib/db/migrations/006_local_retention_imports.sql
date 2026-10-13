BEGIN;
CREATE TABLE IF NOT EXISTS local_retention_snapshots (
  id serial PRIMARY KEY,
  practice_id text NOT NULL,
  snapshot_id text NOT NULL,
  kind text NOT NULL,
  package_id text,
  package_exported_at timestamptz,
  imported_at timestamptz NOT NULL,
  coverage_start date NOT NULL,
  coverage_end date NOT NULL,
  source_hash text NOT NULL,
  row_count integer NOT NULL,
  rows jsonb NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_retention_snapshot_kind CHECK (kind IN ('attendance', 'billing')),
  CONSTRAINT local_retention_snapshot_dates CHECK (coverage_end >= coverage_start),
  CONSTRAINT local_retention_snapshot_rows CHECK (row_count > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS local_retention_practice_snapshot ON local_retention_snapshots(practice_id, snapshot_id);
CREATE UNIQUE INDEX IF NOT EXISTS local_retention_kind_source_hash ON local_retention_snapshots(practice_id, kind, source_hash);
CREATE UNIQUE INDEX IF NOT EXISTS local_retention_package_kind ON local_retention_snapshots(practice_id, package_id, kind);
CREATE TABLE IF NOT EXISTS local_retention_settings (
  id serial PRIMARY KEY,
  practice_id text NOT NULL UNIQUE,
  billing_code_minutes jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS local_retention_import_events (
  id serial PRIMARY KEY,
  practice_id text NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  package_id text,
  command jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
