-- Recomputed migration (d-1996, merge promotion)
-- Decision: d-6
-- Classification: additive
-- Generated: 2026-09-10T01:39:29.121Z
-- Statement count: 11
--
-- This file is server-authored, recomputed against the committed migration
-- log at merge time. Do not edit by hand. To change the migration, edit the
-- corresponding schema/<table>.sql or schema/policies/<table>_rls.sql and resubmit.

CREATE TABLE IF NOT EXISTS profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#2f80ed',
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS programs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  name text NOT NULL,
  code text NOT NULL DEFAULT '',
  floor_id text NOT NULL DEFAULT 'blank',
  exercise_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT programs_pkey PRIMARY KEY (id),
  CONSTRAINT programs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS programs_profile_updated_idx ON programs(profile_id, updated_at DESC);

GRANT DELETE, INSERT, SELECT, UPDATE ON profiles TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON programs TO cw_runtime;

GRANT SELECT ON profiles TO cw_query;

GRANT SELECT ON programs TO cw_query;

DROP POLICY IF EXISTS cw_runtime_full_access ON profiles;

CREATE POLICY cw_runtime_full_access ON profiles AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cw_runtime_full_access ON programs;

CREATE POLICY cw_runtime_full_access ON programs AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);
