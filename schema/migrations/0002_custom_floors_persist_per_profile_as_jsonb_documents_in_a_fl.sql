-- Recomputed migration (d-1996, merge promotion)
-- Decision: d-8
-- Classification: additive
-- Generated: 2026-09-10T02:50:40.363Z
-- Statement count: 10
--
-- This file is server-authored, recomputed against the committed migration
-- log at merge time. Do not edit by hand. To change the migration, edit the
-- corresponding schema/<table>.sql or schema/policies/<table>_rls.sql and resubmit.

CREATE TABLE IF NOT EXISTS floors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT floors_pkey PRIMARY KEY (id),
  CONSTRAINT floors_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS floors_profile_created_idx ON floors(profile_id, created_at);

GRANT DELETE, INSERT, SELECT, UPDATE ON floors TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON profiles TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON programs TO cw_runtime;

GRANT SELECT ON floors TO cw_query;

GRANT SELECT ON profiles TO cw_query;

GRANT SELECT ON programs TO cw_query;

DROP POLICY IF EXISTS cw_runtime_full_access ON floors;

CREATE POLICY cw_runtime_full_access ON floors AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);
