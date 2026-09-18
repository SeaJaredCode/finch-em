-- Recomputed migration (d-1996, merge promotion)
-- Decision: d-35
-- Classification: additive
-- Generated: 2026-09-17T04:06:00.485Z
-- Statement count: 36
--
-- This file is server-authored, recomputed against the committed migration
-- log at merge time. Do not edit by hand. To change the migration, edit the
-- corresponding schema/<table>.sql or schema/policies/<table>_rls.sql and resubmit.

CREATE TABLE IF NOT EXISTS submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  attempt int NOT NULL,
  source_program_id uuid,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  run jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submissions_pkey PRIMARY KEY (id),
  CONSTRAINT submissions_uniq_0 UNIQUE (assignment_id, membership_id, attempt),
  CONSTRAINT submissions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  CONSTRAINT submissions_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES class_memberships(id) ON DELETE CASCADE,
  CONSTRAINT submissions_source_program_id_fkey FOREIGN KEY (source_program_id) REFERENCES programs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS submission_reviews (
  submission_id uuid NOT NULL,
  comment text NOT NULL DEFAULT '',
  status text,
  reviewed_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_reviews_pkey PRIMARY KEY (submission_id),
  CONSTRAINT submission_reviews_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  CONSTRAINT submission_reviews_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS require_run boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS submissions_assignment_idx ON submissions(assignment_id, created_at DESC);

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

DROP POLICY IF EXISTS cw_runtime_full_access ON submission_reviews;

CREATE POLICY cw_runtime_full_access ON submission_reviews AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cw_runtime_full_access ON submissions;

CREATE POLICY cw_runtime_full_access ON submissions AS PERMISSIVE FOR ALL TO cw_runtime USING (true) WITH CHECK (true);
