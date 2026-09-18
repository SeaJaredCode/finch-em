-- A published class resource (itch-14, d-32): an immutable snapshot of a teacher's program or
-- custom floor. snapshot is { program: { name, code, floorId, exerciseRef } | null,
-- floor: { name, data } | null } where data is the sanitized floor geometry (src/floorshape.js);
-- a program that used a custom floor embeds it. The teacher's later edits never change a
-- snapshot; republishing inserts a new row and unpublish sets unpublished_at. source_id is the
-- teacher's row id at publish time, informational only. Assignment starters (d-34) use the same
-- snapshot shape but live on schema/assignments.sql, not here.
-- Peer examples (itch-17, d-37): a row with submission_id is a teacher-published copy of a student's
-- turned-in attempt (kind stays 'program'; the snapshot is copied from schema/submissions.sql with
-- neutral program and floor names). attribution is 'anonymous' or 'name' (the label is resolved when
-- read); note is the teacher's text for the class. live_submission_id equals submission_id while the
-- row is published and is cleared by unpublish, so UNIQUE allows one published example per attempt.
-- Students see an example only while its author is an active or archived student (src/store/scoped.js).
CREATE TABLE class_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  published_by uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  name text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_id text,
  published_at timestamptz NOT NULL DEFAULT now(),
  unpublished_at timestamptz,
  submission_id uuid REFERENCES submissions(id) ON DELETE CASCADE,
  live_submission_id uuid,
  attribution text,
  note text NOT NULL DEFAULT '',
  UNIQUE (live_submission_id)
);

CREATE INDEX class_resources_class_idx ON class_resources (class_id, published_at DESC);
