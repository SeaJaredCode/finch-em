-- A class (itch-14, d-32): a teacher's group of students. Authority comes from a
-- class_memberships row with role 'teacher', never from created_by (provenance only). join_code
-- is the short code students type (src/classes.js: 6 symbols, no 0/O/1/I), unique across every
-- class ever and replaced when the teacher regenerates it. archived_at closes the class: no more
-- joins or teacher writes; members still read it as archived. Nothing here is ever deleted.
CREATE TABLE classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  join_code text NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (join_code)
);
