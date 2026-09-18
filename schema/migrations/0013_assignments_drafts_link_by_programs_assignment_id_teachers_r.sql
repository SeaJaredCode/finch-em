-- Recomputed migration (d-1996, merge promotion)
-- Decision: d-34
-- Classification: data_rewriting
-- Generated: 2026-09-17T03:35:28.261Z
-- Statement count: 40
--
-- This file is server-authored, recomputed against the committed migration
-- log at merge time. Do not edit by hand. To change the migration, edit the
-- corresponding schema/<table>.sql or schema/policies/<table>_rls.sql and resubmit.

CREATE TABLE IF NOT EXISTS assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL,
  created_by uuid NOT NULL,
  lesson int NOT NULL,
  exercise int NOT NULL,
  instructions text NOT NULL DEFAULT '',
  due_at timestamptz,
  allow_floor_edit boolean NOT NULL DEFAULT false,
  floor_id text NOT NULL DEFAULT 'blank',
  starter jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignments_pkey PRIMARY KEY (id),
  CONSTRAINT assignments_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id)
);

ALTER TABLE floors ADD COLUMN IF NOT EXISTS class_id uuid;

ALTER TABLE floors ADD COLUMN IF NOT EXISTS assignment_id uuid;

ALTER TABLE floors ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

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
   WHERE c.conrelid = 'floors'::regclass
     AND c.conname = 'floors_class_id_fkey';

  IF existing_def IS NULL THEN
    ALTER TABLE floors ADD CONSTRAINT floors_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;
  ELSE
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I ', 'floors', probe_constraint) || 'FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL NOT VALID';
    SELECT regexp_replace(pg_get_constraintdef(c.oid, true), '\s+NOT VALID$', '')
      INTO desired_def
      FROM pg_constraint c
     WHERE c.conrelid = 'floors'::regclass
       AND c.conname = probe_constraint;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', 'floors', probe_constraint);

    IF desired_def IS NULL THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: floors.floors_class_id_fkey';
    ELSIF existing_def <> desired_def THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: floors.floors_class_id_fkey';
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
   WHERE c.conrelid = 'floors'::regclass
     AND c.conname = 'floors_assignment_id_fkey';

  IF existing_def IS NULL THEN
    ALTER TABLE floors ADD CONSTRAINT floors_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE SET NULL;
  ELSE
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I ', 'floors', probe_constraint) || 'FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE SET NULL NOT VALID';
    SELECT regexp_replace(pg_get_constraintdef(c.oid, true), '\s+NOT VALID$', '')
      INTO desired_def
      FROM pg_constraint c
     WHERE c.conrelid = 'floors'::regclass
       AND c.conname = probe_constraint;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', 'floors', probe_constraint);

    IF desired_def IS NULL THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: floors.floors_assignment_id_fkey';
    ELSIF existing_def <> desired_def THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: floors.floors_assignment_id_fkey';
    END IF;
  END IF;
END$$;

ALTER TABLE programs ADD COLUMN IF NOT EXISTS class_id uuid;

ALTER TABLE programs ADD COLUMN IF NOT EXISTS assignment_id uuid;

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
   WHERE c.conrelid = 'programs'::regclass
     AND c.conname = 'programs_class_id_fkey';

  IF existing_def IS NULL THEN
    ALTER TABLE programs ADD CONSTRAINT programs_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;
  ELSE
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I ', 'programs', probe_constraint) || 'FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL NOT VALID';
    SELECT regexp_replace(pg_get_constraintdef(c.oid, true), '\s+NOT VALID$', '')
      INTO desired_def
      FROM pg_constraint c
     WHERE c.conrelid = 'programs'::regclass
       AND c.conname = probe_constraint;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', 'programs', probe_constraint);

    IF desired_def IS NULL THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: programs.programs_class_id_fkey';
    ELSIF existing_def <> desired_def THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: programs.programs_class_id_fkey';
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
   WHERE c.conrelid = 'programs'::regclass
     AND c.conname = 'programs_assignment_id_fkey';

  IF existing_def IS NULL THEN
    ALTER TABLE programs ADD CONSTRAINT programs_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE SET NULL;
  ELSE
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I ', 'programs', probe_constraint) || 'FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE SET NULL NOT VALID';
    SELECT regexp_replace(pg_get_constraintdef(c.oid, true), '\s+NOT VALID$', '')
      INTO desired_def
      FROM pg_constraint c
     WHERE c.conrelid = 'programs'::regclass
       AND c.conname = probe_constraint;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', 'programs', probe_constraint);

    IF desired_def IS NULL THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: programs.programs_assignment_id_fkey';
    ELSIF existing_def <> desired_def THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: programs.programs_assignment_id_fkey';
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
   WHERE c.conrelid = 'programs'::regclass
     AND c.conname = 'programs_uniq_0';

  IF existing_def IS NULL THEN
    ALTER TABLE programs ADD CONSTRAINT programs_uniq_0 UNIQUE (profile_id, assignment_id);
  ELSE
    EXECUTE format('CREATE TEMP TABLE %I (LIKE %s) ON COMMIT DROP', probe_table, 'programs');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I ', probe_table, probe_constraint) || 'UNIQUE (profile_id, assignment_id)';
    SELECT pg_get_constraintdef(c.oid, true)
      INTO desired_def
      FROM pg_constraint c
     WHERE c.conrelid = probe_table::regclass
       AND c.conname = probe_constraint;
    EXECUTE format('DROP TABLE IF EXISTS %I', probe_table);

    IF desired_def IS NULL THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: programs.programs_uniq_0';
    ELSIF existing_def <> desired_def THEN
      RAISE EXCEPTION 'reconciler add constraint replay mismatch: programs.programs_uniq_0';
    END IF;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS assignments_class_idx ON assignments(class_id, created_at DESC);

CREATE INDEX IF NOT EXISTS floors_assignment_idx ON floors(assignment_id);

CREATE INDEX IF NOT EXISTS programs_assignment_idx ON programs(assignment_id);

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

GRANT SELECT ON users TO cw_query;

GRANT SELECT ON workbook_entries TO cw_query;

DROP POLICY IF EXISTS cw_runtime_full_access ON assignments;

CREATE POLICY cw_runtime_full_access ON assignments AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);
