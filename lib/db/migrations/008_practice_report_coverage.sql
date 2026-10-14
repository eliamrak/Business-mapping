-- Observed row endpoints remain unchanged; legacy completeness is unknown.
ALTER TABLE practice_import_snapshots
  ADD COLUMN IF NOT EXISTS report_coverage jsonb;
