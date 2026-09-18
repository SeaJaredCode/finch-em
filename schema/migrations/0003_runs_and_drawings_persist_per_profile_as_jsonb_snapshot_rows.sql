-- Recomputed migration (d-1996, merge promotion)
-- Decision: d-13
-- Classification: additive
-- Generated: 2026-09-10T03:57:20.632Z
-- Statement count: 19
--
-- This file is server-authored, recomputed against the committed migration
-- log at merge time. Do not edit by hand. To change the migration, edit the
-- corresponding schema/<table>.sql or schema/policies/<table>_rls.sql and resubmit.

CREATE TABLE IF NOT EXISTS runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  program_id uuid NOT NULL,
  program_name text NOT NULL DEFAULT '',
  floor_id text NOT NULL DEFAULT 'blank',
  floor_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'finished',
  elapsed double precision NOT NULL DEFAULT 0,
  wheel_left double precision NOT NULL DEFAULT 0,
  wheel_right double precision NOT NULL DEFAULT 0,
  has_pen boolean NOT NULL DEFAULT false,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runs_pkey PRIMARY KEY (id),
  CONSTRAINT runs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT runs_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drawings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  run_id uuid,
  title text NOT NULL,
  program_name text NOT NULL DEFAULT '',
  floor_name text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drawings_pkey PRIMARY KEY (id),
  CONSTRAINT drawings_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS drawings_profile_created_idx ON drawings(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS runs_profile_created_idx ON runs(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS runs_program_created_idx ON runs(program_id, created_at DESC);

GRANT DELETE, INSERT, SELECT, UPDATE ON drawings TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON floors TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON profiles TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON programs TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON runs TO cw_runtime;

GRANT SELECT ON drawings TO cw_query;

GRANT SELECT ON floors TO cw_query;

GRANT SELECT ON profiles TO cw_query;

GRANT SELECT ON programs TO cw_query;

GRANT SELECT ON runs TO cw_query;

DROP POLICY IF EXISTS cw_runtime_full_access ON drawings;

CREATE POLICY cw_runtime_full_access ON drawings AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cw_runtime_full_access ON runs;

CREATE POLICY cw_runtime_full_access ON runs AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);
