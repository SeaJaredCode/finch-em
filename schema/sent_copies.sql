-- A copy a student sent to their teacher (itch-18, d-38), e.g. to ask for help. Insert-only: the
-- store has no update or delete for this table, so what the teacher opens never changes. Keyed by
-- the student's class membership (one row per class and user for life), which also fixes the class,
-- so there is no class_id to disagree with it. snapshot is built by the server from the student's own
-- program in the class-resource shape (schema/class_resources.sql):
--   { program: { name, code, floorId, exerciseRef }, floor: { name, data } | null }
-- with the program's custom floor embedded when it has one. message is the student's note ('' when
-- none). source_program_id is provenance only. Sent copies are the class's record: the class teacher
-- reads them whatever the student's state; the student reads their own while their membership is
-- live. They are never assignment attempts (schema/submissions.sql). The reply is
-- schema/sent_copy_replies.sql.
CREATE TABLE sent_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES class_memberships(id) ON DELETE CASCADE,
  source_program_id uuid REFERENCES programs(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sent_copies_membership_idx ON sent_copies (membership_id, created_at DESC);
