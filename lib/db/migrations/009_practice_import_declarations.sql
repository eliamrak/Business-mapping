-- Additive only. Backout: stop reading declarations; preserve this table and its audit history.
CREATE TABLE IF NOT EXISTS practice_import_declarations (
  practice_id text NOT NULL,
  account_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  data jsonb NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by text NOT NULL,
  PRIMARY KEY (practice_id, account_id)
);
