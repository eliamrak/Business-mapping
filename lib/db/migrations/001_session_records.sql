BEGIN;

CREATE TABLE session_records (
  id serial PRIMARY KEY,
  clinician_id integer NOT NULL CONSTRAINT session_records_clinician_id_clinicians_id_fk REFERENCES clinicians(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  completed integer NOT NULL,
  desired integer NOT NULL,
  cancelled integer,
  no_show integer,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_records_dates CHECK (period_end >= period_start AND period_end - period_start < 366),
  CONSTRAINT session_records_counts CHECK (
    completed BETWEEN 0 AND 10000 AND desired BETWEEN 0 AND 10000 AND
    (cancelled IS NULL OR cancelled BETWEEN 0 AND 10000) AND
    (no_show IS NULL OR no_show BETWEEN 0 AND 10000)
  )
);
CREATE UNIQUE INDEX session_records_clinician_period ON session_records(clinician_id, period_start, period_end);

CREATE TABLE session_record_history (
  id serial PRIMARY KEY,
  record_id integer NOT NULL CONSTRAINT session_record_history_record_id_session_records_id_fk REFERENCES session_records(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  request_id uuid NOT NULL CONSTRAINT session_record_history_request_id_unique UNIQUE,
  command jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX session_history_record_revision ON session_record_history(record_id, revision);

COMMIT;
