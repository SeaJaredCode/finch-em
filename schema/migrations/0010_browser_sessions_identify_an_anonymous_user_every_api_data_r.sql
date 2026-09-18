-- Recomputed migration (d-1996, merge promotion)
-- Decision: d-29
-- Classification: data_rewriting
-- Generated: 2026-09-16T14:16:49.947Z
-- Statement count: 26
--
-- This file is server-authored, recomputed against the committed migration
-- log at merge time. Do not edit by hand. To change the migration, edit the
-- corresponding schema/<table>.sql or schema/policies/<table>_rls.sql and resubmit.

CREATE TABLE IF NOT EXISTS users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT sessions_pkey PRIMARY KEY (token_hash),
  CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id uuid;

DO $$
DECLARE
  existing_def text;
  desired_def text;
  probe_table text := '__cw_constraint_probe_' || substr(md5(clock_timestamp()::text || random()::text), 1, 16);
  probe_constraint text := '__cw_constraint_probe_' || substr(md5(clock_timestamp()::text || random()::text), 1, 16);
BEGIN
  SELECT pg_get_constraintdef(c.oid, true)
    INTO existing_def
    FROM pg_constraint c
   WHERE c.conrelid = 'profiles'::regclass
     AND c.conname = 'profiles_user_id_fkey';

  IF existing_def IS NULL THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  ELSE
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I ', 'profiles', probe_constraint) || 'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID';
    SELECT regexp_replace(pg_get_constraintdef(c.oid, true), '\s+NOT VALID$', '')
      INTO desired_def
      FROM pg_constraint c
     WHERE c.conrelid = 'profiles'::regclass
       AND c.conname = probe_constraint;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', 'profiles', probe_constraint);

    IF desired_def IS NULL THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: profiles.profiles_user_id_fkey';
    ELSIF existing_def <> desired_def THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: profiles.profiles_user_id_fkey';
    END IF;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS profiles_user_idx ON profiles(user_id);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

GRANT DELETE, INSERT, SELECT, UPDATE ON drawings TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON floors TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON profiles TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON programs TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON runs TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON sessions TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON users TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON workbook_entries TO cw_runtime;

GRANT SELECT ON drawings TO cw_query;

GRANT SELECT ON floors TO cw_query;

GRANT SELECT ON profiles TO cw_query;

GRANT SELECT ON programs TO cw_query;

GRANT SELECT ON runs TO cw_query;

GRANT SELECT ON sessions TO cw_query;

GRANT SELECT ON users TO cw_query;

GRANT SELECT ON workbook_entries TO cw_query;

DROP POLICY IF EXISTS cw_runtime_full_access ON sessions;

CREATE POLICY cw_runtime_full_access ON sessions AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cw_runtime_full_access ON users;

CREATE POLICY cw_runtime_full_access ON users AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);
