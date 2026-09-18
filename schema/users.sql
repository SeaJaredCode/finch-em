-- A user: the identity a browser session belongs to. Minted anonymous on first contact by
-- POST /api/session (d-29). A user may later attach a credential (itch-13, d-31): username as
-- typed, username_key lowercased for the uniqueness rule, password_hash in src/account.js's
-- `scrypt$N$r$p$salt$hash` form, registered_at when that happened. Anonymous users keep all
-- four NULL, and a unique constraint admits any number of NULL keys. Everything a user owns
-- hangs off profiles.user_id.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text,
  username_key text,
  password_hash text,
  registered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username_key)
);
