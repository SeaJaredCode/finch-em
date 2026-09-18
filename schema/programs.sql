-- A program: name, Python code, the floor it last ran on, optional workbook exercise (Milestone 4).
-- floor_id is a text key: built-in floors use their builtin id ('blank', 'oval', ...);
-- custom floors (Milestone 2) will use their own row id.
-- class_id / assignment_id (itch-15, d-34): set only when a student presses Start on an assignment,
-- never by the program routes. At most one program per profile per assignment (NULLs are distinct,
-- so ordinary programs are unconstrained). A teacher reads such a program only through the
-- assignment drafts read in src/store/scoped.js.
CREATE TABLE programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL DEFAULT '',
  floor_id text NOT NULL DEFAULT 'blank',
  exercise_ref text,
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  assignment_id uuid REFERENCES assignments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, assignment_id)
);

CREATE INDEX programs_profile_updated_idx ON programs (profile_id, updated_at DESC);
CREATE INDEX programs_assignment_idx ON programs (assignment_id);
