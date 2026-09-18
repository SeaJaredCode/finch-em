-- Recomputed migration (d-1996, merge promotion)
-- Decision: d-31
-- Classification: data_rewriting
-- Generated: 2026-09-16T21:17:04.682Z
-- Statement count: 23
--
-- This file is server-authored, recomputed against the committed migration
-- log at merge time. Do not edit by hand. To change the migration, edit the
-- corresponding schema/<table>.sql or schema/policies/<table>_rls.sql and resubmit.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS home_user_id uuid;

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
   WHERE c.conrelid = 'sessions'::regclass
     AND c.conname = 'sessions_home_user_id_fkey';

  IF existing_def IS NULL THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_home_user_id_fkey FOREIGN KEY (home_user_id) REFERENCES users(id) ON DELETE SET NULL;
  ELSE
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I ', 'sessions', probe_constraint) || 'FOREIGN KEY (home_user_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID';
    SELECT regexp_replace(pg_get_constraintdef(c.oid, true), '\s+NOT VALID$', '')
      INTO desired_def
      FROM pg_constraint c
     WHERE c.conrelid = 'sessions'::regclass
       AND c.conname = probe_constraint;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', 'sessions', probe_constraint);

    IF desired_def IS NULL THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: sessions.sessions_home_user_id_fkey';
    ELSIF existing_def <> desired_def THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: sessions.sessions_home_user_id_fkey';
    END IF;
  END IF;
END$$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE users ADD COLUMN IF NOT EXISTS username_key text;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;

ALTER TABLE users ADD COLUMN IF NOT EXISTS registered_at timestamptz;

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
   WHERE c.conrelid = 'users'::regclass
     AND c.conname = 'users_uniq_0';

  IF existing_def IS NULL THEN
    ALTER TABLE users ADD CONSTRAINT users_uniq_0 UNIQUE (username_key);
  ELSE
    EXECUTE format('CREATE TEMP TABLE %I (LIKE %s) ON COMMIT DROP', probe_table, 'users');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I ', probe_table, probe_constraint) || 'UNIQUE (username_key)';
    SELECT pg_get_constraintdef(c.oid, true)
      INTO desired_def
      FROM pg_constraint c
     WHERE c.conrelid = probe_table::regclass
       AND c.conname = probe_constraint;
    EXECUTE format('DROP TABLE IF EXISTS %I', probe_table);

    IF desired_def IS NULL THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: users.users_uniq_0';
    ELSIF existing_def <> desired_def THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: users.users_uniq_0';
    END IF;
  END IF;
END$$;

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
