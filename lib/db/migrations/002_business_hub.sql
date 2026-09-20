BEGIN;
CREATE TABLE hub_workspaces (id integer PRIMARY KEY, revision integer NOT NULL DEFAULT 0, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hub_history (id serial PRIMARY KEY, workspace_id integer NOT NULL REFERENCES hub_workspaces(id), revision integer NOT NULL, request_id uuid NOT NULL UNIQUE, actor text NOT NULL, action text NOT NULL, command jsonb NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX hub_history_workspace_revision ON hub_history(workspace_id,revision);
CREATE TABLE hub_attachments (id uuid PRIMARY KEY, period_id uuid NOT NULL, name text NOT NULL, mime text NOT NULL, data text NOT NULL, size integer NOT NULL, sha256 text NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hub_users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, role text NOT NULL, disabled integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hub_auth_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL, expires_at timestamptz NOT NULL);
COMMIT;
