-- A class assignment (itch-15, d-34): a workbook exercise the teacher sets for a class. starter is an
-- immutable snapshot taken at creation, the same shape as a class resource (d-32):
--   { program: { name, code, exerciseRef } | null, floor: { name, data } | null }
-- where data is the sanitized floor geometry (src/floorshape.js). floor_id names the built-in floor
-- used when the starter carries no custom floor. starter, floor_id, allow_floor_edit and require_run
-- never change after creation; instructions and due_at are the only edits. require_run (d-35): Turn
-- in needs a run of exactly the code being turned in. Closing sets closed_at and reopening
-- clears it; nothing is deleted. A student's work is a program in their own profile whose
-- assignment_id names this row (schema/programs.sql).
CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  lesson integer NOT NULL,
  exercise integer NOT NULL,
  instructions text NOT NULL DEFAULT '',
  due_at timestamptz,
  allow_floor_edit boolean NOT NULL DEFAULT false,
  require_run boolean NOT NULL DEFAULT false,
  floor_id text NOT NULL DEFAULT 'blank',
  starter jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assignments_class_idx ON assignments (class_id, created_at DESC);
