-- The teacher's reply to one sent copy (itch-18, d-38), kept apart so the copy row is never updated.
-- At most one row per copy, written by upsert; comment is plain text, replaceable, never deleted
-- ('' clears it). Written only by src/sentcopies.js.
CREATE TABLE sent_copy_replies (
  sent_copy_id uuid PRIMARY KEY REFERENCES sent_copies(id) ON DELETE CASCADE,
  comment text NOT NULL DEFAULT '',
  replied_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
