-- Recomputed migration (d-1996, merge promotion)
-- Decision: d-37
-- Classification: data_rewriting
-- Generated: 2026-09-17T04:25:38.975Z
-- Statement count: 34
--
-- This file is server-authored, recomputed against the committed migration
-- log at merge time. Do not edit by hand. To change the migration, edit the
-- corresponding schema/<table>.sql or schema/policies/<table>_rls.sql and resubmit.

ALTER TABLE class_resources ADD COLUMN IF NOT EXISTS submission_id uuid;

ALTER TABLE class_resources ADD COLUMN IF NOT EXISTS live_submission_id uuid;

ALTER TABLE class_resources ADD COLUMN IF NOT EXISTS attribution text;

ALTER TABLE class_resources ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';

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
   WHERE c.conrelid = 'class_resources'::regclass
     AND c.conname = 'class_resources_submission_id_fkey';

  IF existing_def IS NULL THEN
    ALTER TABLE class_resources ADD CONSTRAINT class_resources_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE;
  ELSE
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I ', 'class_resources', probe_constraint) || 'FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE NOT VALID';
    SELECT regexp_replace(pg_get_constraintdef(c.oid, true), '\s+NOT VALID$', '')
      INTO desired_def
      FROM pg_constraint c
     WHERE c.conrelid = 'class_resources'::regclass
       AND c.conname = probe_constraint;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', 'class_resources', probe_constraint);

    IF desired_def IS NULL THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: class_resources.class_resources_submission_id_fkey';
    ELSIF existing_def <> desired_def THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: class_resources.class_resources_submission_id_fkey';
    END IF;
  END IF;
END$$;

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
   WHERE c.conrelid = 'class_resources'::regclass
     AND c.conname = 'class_resources_uniq_0';

  IF existing_def IS NULL THEN
    ALTER TABLE class_resources ADD CONSTRAINT class_resources_uniq_0 UNIQUE (live_submission_id);
  ELSE
    EXECUTE format('CREATE TEMP TABLE %I (LIKE %s) ON COMMIT DROP', probe_table, 'class_resources');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I ', probe_table, probe_constraint) || 'UNIQUE (live_submission_id)';
    SELECT pg_get_constraintdef(c.oid, true)
      INTO desired_def
      FROM pg_constraint c
     WHERE c.conrelid = probe_table::regclass
       AND c.conname = probe_constraint;
    EXECUTE format('DROP TABLE IF EXISTS %I', probe_table);

    IF desired_def IS NULL THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: class_resources.class_resources_uniq_0';
    ELSIF existing_def <> desired_def THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: class_resources.class_resources_uniq_0';
    END IF;
  END IF;
END$$;

GRANT DELETE, INSERT, SELECT, UPDATE ON assignments TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON class_memberships TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON class_resources TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON classes TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON drawings TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON floors TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON profiles TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON programs TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON runs TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON sessions TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON submission_reviews TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON submissions TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON users TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON workbook_entries TO cw_runtime;

GRANT SELECT ON assignments TO cw_query;

GRANT SELECT ON class_memberships TO cw_query;

GRANT SELECT ON class_resources TO cw_query;

GRANT SELECT ON classes TO cw_query;

GRANT SELECT ON drawings TO cw_query;

GRANT SELECT ON floors TO cw_query;

GRANT SELECT ON profiles TO cw_query;

GRANT SELECT ON programs TO cw_query;

GRANT SELECT ON runs TO cw_query;

GRANT SELECT ON sessions TO cw_query;

GRANT SELECT ON submission_reviews TO cw_query;

GRANT SELECT ON submissions TO cw_query;

GRANT SELECT ON users TO cw_query;

GRANT SELECT ON workbook_entries TO cw_query;
