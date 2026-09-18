-- A membership (itch-14, d-32): one row per (class, user) for life. role is 'teacher' or
-- 'student'; state is 'invited' (reserved: nothing writes it in phase 3), 'active', 'archived'
-- (the class was archived) or 'removed' (the teacher removed the student; rejoin_allowed says
-- whether the join code lets them back in). Removing, archiving and rejoining are state flips
-- on this row, so nothing is deleted. Values are enforced by src/classes.js, the one module that
-- writes here; reads are gated by src/store/scoped.js classRole().
CREATE TABLE class_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  state text NOT NULL,
  rejoin_allowed boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, user_id)
);

CREATE INDEX class_memberships_user_idx ON class_memberships (user_id);
