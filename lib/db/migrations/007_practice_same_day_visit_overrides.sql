ALTER TABLE practice_import_packages
  ADD COLUMN IF NOT EXISTS same_day_visit_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
