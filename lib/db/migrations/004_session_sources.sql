BEGIN;
ALTER TABLE session_records ADD COLUMN IF NOT EXISTS source_attachment_id uuid REFERENCES hub_attachments(id) ON DELETE RESTRICT;
COMMIT;
