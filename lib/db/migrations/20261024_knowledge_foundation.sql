-- REVIEW ONLY: apply solely to a disposable database until backup/restore and rollout approval.
-- No identities, source grants, approvals or business records are seeded.
BEGIN;
CREATE TABLE IF NOT EXISTS knowledge_resources (
 practice_id text NOT NULL, principal_id text NOT NULL, id uuid NOT NULL,
 kind text NOT NULL DEFAULT 'reference', title text NOT NULL, category text NOT NULL,
 audience text NOT NULL DEFAULT 'owner', published_version integer, archived boolean NOT NULL DEFAULT false,
 PRIMARY KEY(practice_id,principal_id,id)
);
CREATE TABLE IF NOT EXISTS knowledge_versions (
 practice_id text NOT NULL, principal_id text NOT NULL, resource_id uuid NOT NULL,
 schema_version integer NOT NULL DEFAULT 1, derived_view_version integer NOT NULL DEFAULT 1,
 version integer NOT NULL, content jsonb NOT NULL, content_hash text NOT NULL,
 approval text NOT NULL DEFAULT 'draft', approved_by text, approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), source jsonb NOT NULL,
 PRIMARY KEY(practice_id,principal_id,resource_id,version),
 FOREIGN KEY(practice_id,principal_id,resource_id) REFERENCES knowledge_resources(practice_id,principal_id,id)
);
-- Existing versions are deliberately not backfilled or reapproved. Missing publication metadata fails closed.
ALTER TABLE knowledge_versions ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE knowledge_versions ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE knowledge_versions ADD COLUMN IF NOT EXISTS publication_hash text;
CREATE TABLE IF NOT EXISTS knowledge_import_receipts (
 practice_id text NOT NULL, principal_id text NOT NULL, id uuid NOT NULL, resource_id uuid NOT NULL,
 source_file_id text NOT NULL, source_revision text NOT NULL, content_hash text NOT NULL,
 status text NOT NULL, reason text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(practice_id,principal_id,id),
 FOREIGN KEY(practice_id,principal_id,resource_id) REFERENCES knowledge_resources(practice_id,principal_id,id)
);
CREATE TABLE IF NOT EXISTS knowledge_source_authorizations (
 practice_id text NOT NULL, principal_id text NOT NULL, file_id text NOT NULL, epoch integer NOT NULL CHECK(epoch>0),
 state text NOT NULL DEFAULT 'unapproved' CHECK(state IN ('approved','unapproved','revoked','deleted')),
 approved_by text, approved_at timestamptz,
 PRIMARY KEY(practice_id,principal_id,file_id),
 CHECK ((state='approved' AND approved_by=principal_id AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
 OR (state<>'approved' AND approved_by IS NULL AND approved_at IS NULL))
);
CREATE TABLE IF NOT EXISTS knowledge_pipeline_states (
 practice_id text NOT NULL, principal_id text NOT NULL, generation integer NOT NULL CHECK(generation>0),
 state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(practice_id,principal_id),
 CHECK (state ?& ARRAY['practiceId','principalId','generation'] AND state->>'practiceId'=practice_id
 AND state->>'principalId'=principal_id AND (state->>'generation')::integer=generation)
);
CREATE OR REPLACE FUNCTION knowledge_guard_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.approval='approved' THEN
  RAISE EXCEPTION 'Approved Knowledge versions are immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.version<1 OR NEW.approval NOT IN ('draft','approved') THEN RAISE EXCEPTION 'Invalid Knowledge version'; END IF;
 IF NEW.approval='approved' AND (NEW.approved_by IS DISTINCT FROM NEW.principal_id OR NEW.approved_at IS NULL
 OR NEW.title IS NULL OR NEW.category IS NULL OR NEW.publication_hash IS NULL
 OR NEW.publication_hash !~ '^[a-f0-9]{64}$' OR NEW.content_hash !~ '^[a-f0-9]{64}$') THEN
  RAISE EXCEPTION 'Incomplete Knowledge publication approval';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS knowledge_immutable_version ON knowledge_versions;
CREATE TRIGGER knowledge_immutable_version BEFORE INSERT OR UPDATE OR DELETE ON knowledge_versions
 FOR EACH ROW EXECUTE FUNCTION knowledge_guard_version();
COMMIT;
