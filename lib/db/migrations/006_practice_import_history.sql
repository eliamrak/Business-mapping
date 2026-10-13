CREATE TABLE IF NOT EXISTS practice_import_packages (
  id uuid PRIMARY KEY,
  practice_id text NOT NULL,
  account_id text NOT NULL,
  package_id text NOT NULL,
  content_hash text NOT NULL,
  exported_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by text NOT NULL,
  billing_code_minutes jsonb NOT NULL DEFAULT '{}'::jsonb,
  active integer NOT NULL DEFAULT 1,
  UNIQUE (practice_id, account_id, package_id)
);

CREATE TABLE IF NOT EXISTS practice_import_snapshots (
  id uuid PRIMARY KEY,
  package_import_id uuid NOT NULL REFERENCES practice_import_packages(id) ON DELETE RESTRICT,
  practice_id text NOT NULL,
  account_id text NOT NULL,
  kind text NOT NULL,
  coverage_start date NOT NULL,
  coverage_end date NOT NULL,
  source_hash text NOT NULL,
  row_count integer NOT NULL,
  rows jsonb NOT NULL,
  active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('attendance', 'billing')),
  CHECK (coverage_end >= coverage_start),
  CHECK (row_count > 0)
);

CREATE INDEX IF NOT EXISTS practice_import_snapshots_scope_active
  ON practice_import_snapshots (practice_id, account_id, active, kind, coverage_start, coverage_end);

CREATE UNIQUE INDEX IF NOT EXISTS practice_import_snapshots_active_source
  ON practice_import_snapshots (practice_id, account_id, kind, source_hash)
  WHERE active = 1;

CREATE TABLE IF NOT EXISTS practice_import_audit (
  id uuid PRIMARY KEY,
  practice_id text NOT NULL,
  account_id text NOT NULL,
  package_id text NOT NULL,
  action text NOT NULL,
  actor text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
