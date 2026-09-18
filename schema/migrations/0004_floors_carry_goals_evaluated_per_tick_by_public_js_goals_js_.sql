-- Recomputed migration (d-1996, merge promotion)
-- Decision: d-20
-- Co-decisions: d-21
-- Classification: additive
-- Generated: 2026-09-10T05:10:58.228Z
-- Statement count: 17
--
-- This file is server-authored, recomputed against the committed migration
-- log at merge time. Do not edit by hand. To change the migration, edit the
-- corresponding schema/<table>.sql or schema/policies/<table>_rls.sql and resubmit.

CREATE TABLE IF NOT EXISTS workbook_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  lesson int NOT NULL,
  exercise int NOT NULL,
  done boolean NOT NULL DEFAULT false,
  program_id uuid,
  floor_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workbook_entries_pkey PRIMARY KEY (id),
  CONSTRAINT workbook_entries_uniq_0 UNIQUE (profile_id, lesson, exercise),
  CONSTRAINT workbook_entries_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT workbook_entries_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL
);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS verdict text;

ALTER TABLE runs ADD COLUMN IF NOT EXISTS passed boolean;

GRANT DELETE, INSERT, SELECT, UPDATE ON drawings TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON floors TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON profiles TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON programs TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON runs TO cw_runtime;

GRANT DELETE, INSERT, SELECT, UPDATE ON workbook_entries TO cw_runtime;

GRANT SELECT ON drawings TO cw_query;

GRANT SELECT ON floors TO cw_query;

GRANT SELECT ON profiles TO cw_query;

GRANT SELECT ON programs TO cw_query;

GRANT SELECT ON runs TO cw_query;

GRANT SELECT ON workbook_entries TO cw_query;

DROP POLICY IF EXISTS cw_runtime_full_access ON workbook_entries;

CREATE POLICY cw_runtime_full_access ON workbook_entries AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);
