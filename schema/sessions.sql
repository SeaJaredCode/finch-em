-- A browser session (d-29). The cookie carries 32 random bytes; only their sha256 is stored here,
-- so a copy of this table cannot impersonate anyone. Expiry slides: src/auth.js moves
-- last_seen_at and expires_at forward at most once a day while the session is used, and the
-- cookie's Max-Age moves with it. Deleting the user deletes its sessions. home_user_id (d-31) is
-- the anonymous user this browser held before a sign-in or split replaced its session — the
-- household on a shared computer — so sign-out can return there; NULL when there is no such user.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  home_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
