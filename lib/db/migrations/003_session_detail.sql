BEGIN;
ALTER TABLE session_records ADD COLUMN IF NOT EXISTS scheduled integer;
ALTER TABLE session_records ADD COLUMN IF NOT EXISTS in_person integer;
ALTER TABLE session_records ADD COLUMN IF NOT EXISTS telehealth integer;
ALTER TABLE session_record_history ADD COLUMN IF NOT EXISTS actor text NOT NULL DEFAULT 'Legacy entry';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_records_detail_counts') THEN
    ALTER TABLE session_records ADD CONSTRAINT session_records_detail_counts CHECK (
      (scheduled IS NULL OR scheduled BETWEEN completed AND 10000) AND
      (in_person IS NULL OR in_person BETWEEN 0 AND completed) AND
      (telehealth IS NULL OR telehealth BETWEEN 0 AND completed) AND
      (in_person IS NULL OR telehealth IS NULL OR in_person + telehealth = completed)
    );
  END IF;
END $$;
COMMIT;
