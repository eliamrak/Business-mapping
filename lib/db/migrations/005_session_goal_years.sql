CREATE TABLE IF NOT EXISTS session_goal_years (
  id serial PRIMARY KEY,
  clinician_id integer NOT NULL REFERENCES clinicians(id) ON DELETE RESTRICT,
  goal_year integer NOT NULL,
  sessions_per_week numeric(6,2) NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT session_goal_years_valid CHECK (
    goal_year BETWEEN 2000 AND 2100 AND sessions_per_week BETWEEN 0 AND 100
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS session_goal_years_clinician_year
  ON session_goal_years(clinician_id, goal_year);
