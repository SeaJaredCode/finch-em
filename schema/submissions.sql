-- A turned-in attempt (itch-16, d-35). Insert-only: the store has no update or delete for this
-- table, so what a teacher reviewed never changes. One row per Turn in, keyed by the assignment
-- and the student's class membership (one row per class and user for life, so attempts survive a
-- profile split, span every profile of the student and keep numbering after a rejoin); attempt
-- counts 1, 2, 3 ... per (assignment, membership). snapshot is built by the server in the class
-- resource shape (schema/class_resources.sql):
--   { program: { name, code, floorId, exerciseRef }, floor: { name, data } | null }
-- where floor is the assignment's own floor copy as it was at Turn in (a built-in floor stays an id
-- on the program). run is the summary of the newest run of exactly that code, copied so deleting
-- runs cannot erase it: { runId, status, elapsed, verdict, passed, floorName, createdAt } | null.
-- source_program_id is provenance only; deleting the draft sets it to NULL and keeps the attempt.
-- Submissions belong to the class record: the teacher reads them whatever the student's state;
-- the student reads their own while their membership is live. Feedback is schema/submission_reviews.sql.
CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES class_memberships(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  source_program_id uuid REFERENCES programs(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  run jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, membership_id, attempt)
);

CREATE INDEX submissions_assignment_idx ON submissions (assignment_id, created_at DESC);
