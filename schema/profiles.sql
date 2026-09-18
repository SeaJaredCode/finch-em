-- A profile is a named workspace (spec: "Profiles") of one user (d-29). Everything else belongs
-- to a profile. user_id is NULL only on rows from before sessions existed; such a row can be
-- claimed once, by the browser that remembers its id, through POST /api/session (phase 2 of
-- itch-12 adds the real claim flow). prefs holds the per-profile preference bag:
-- { lastProgramId, speed, muted, fontSize, visited }.
CREATE TABLE profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#2f80ed',
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profiles_user_idx ON profiles (user_id);
