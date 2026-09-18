-- The teacher's feedback on one submission attempt (itch-16, d-35), kept apart from the attempt so
-- the attempt row is never updated. At most one row per submission, written by upsert: comment is
-- plain text (replaceable, never deleted; '' clears it) and status is NULL, 'returned' (asks for
-- more work; resubmitting is always allowed while the assignment is open) or 'reviewed'. Values are
-- enforced by src/submissions.js, the one module that writes here.
CREATE TABLE submission_reviews (
  submission_id uuid PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  comment text NOT NULL DEFAULT '',
  status text,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
