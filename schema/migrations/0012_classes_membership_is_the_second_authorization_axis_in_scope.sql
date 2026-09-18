-- Recomputed migration (d-1996, merge promotion)
-- Decision: d-32
-- Classification: additive
-- Generated: 2026-09-16T22:45:39.262Z
-- Statement count: 33
--
-- This file is server-authored, recomputed against the committed migration
-- log at merge time. Do not edit by hand. To change the migration, edit the
-- corresponding schema/<table>.sql or schema/policies/<table>_rls.sql and resubmit.

CREATE TABLE IF NOT EXISTS classes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL,
  join_code text NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classes_pkey PRIMARY KEY (id),
  CONSTRAINT classes_uniq_0 UNIQUE (join_code),
  CONSTRAINT classes_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS class_memberships (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  state text NOT NULL,
  rejoin_allowed boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_memberships_pkey PRIMARY KEY (id),
  CONSTRAINT class_memberships_uniq_0 UNIQUE (class_id, user_id),
  CONSTRAINT class_memberships_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT class_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS class_resources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL,
  published_by uuid NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_id text,
  published_at timestamptz NOT NULL DEFAULT now(),
  unpublished_at timestamptz,
  CONSTRAINT class_resources_pkey PRIMARY KEY (id),
  CONSTRAINT class_resources_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT class_resources_published_by_fkey FOREIGN KEY (published_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS class_memberships_user_idx ON class_memberships(user_id);

CREATE INDEX IF NOT EXISTS class_resources_class_idx ON class_resources(class_id, published_at DESC);

GRANT DELETE, INSERT, SELECT, UPDATE ON class_memberships TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON class_resources TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON classes TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON drawings TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON floors TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON profiles TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON programs TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON runs TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON sessions TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON users TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON workbook_entries TO cw_runtime;

GRANT SELECT ON class_memberships TO cw_query;

GRANT SELECT ON class_resources TO cw_query;

GRANT SELECT ON classes TO cw_query;

GRANT SELECT ON drawings TO cw_query;

GRANT SELECT ON floors TO cw_query;

GRANT SELECT ON profiles TO cw_query;

GRANT SELECT ON programs TO cw_query;

GRANT SELECT ON runs TO cw_query;

GRANT SELECT ON sessions TO cw_query;

GRANT SELECT ON users TO cw_query;

GRANT SELECT ON workbook_entries TO cw_query;

DROP POLICY IF EXISTS cw_runtime_full_access ON class_memberships;

CREATE POLICY cw_runtime_full_access ON class_memberships AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cw_runtime_full_access ON class_resources;

CREATE POLICY cw_runtime_full_access ON class_resources AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cw_runtime_full_access ON classes;

CREATE POLICY cw_runtime_full_access ON classes AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);
