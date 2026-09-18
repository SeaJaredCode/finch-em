-- A recorded run (Milestone 3, d-13). One row per press of Run: the program code and the floor
-- as they were, the trail, the console log, a bounded per-tick sensor trace and the pen ink all
-- live in `data` (validated and bounded by src/runshape.js) so a run replays exactly as it
-- happened even after the program or floor is edited:
-- { code, speed, floor, trail, trace: { fields, samples }, console, ink, error, verdict }.
-- verdict / passed (Milestone 4, d-20) summarise data.verdict (the goal verdict, e.g.
-- 'Fail — touched wall at 4.2 s') so the Runs list can show it without loading data; both are
-- NULL when the floor carried no goal. Deleting a program deletes its runs. floor_id (text, like programs.floor_id) names a built-in
-- id or a floors.id and is only used for filtering; replay uses the snapshot in data.
CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  program_name text NOT NULL DEFAULT '',
  floor_id text NOT NULL DEFAULT 'blank',
  floor_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'finished',
  elapsed double precision NOT NULL DEFAULT 0,
  wheel_left double precision NOT NULL DEFAULT 0,
  wheel_right double precision NOT NULL DEFAULT 0,
  has_pen boolean NOT NULL DEFAULT false,
  verdict text,
  passed boolean,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX runs_profile_created_idx ON runs (profile_id, created_at DESC);
CREATE INDEX runs_program_created_idx ON runs (program_id, created_at DESC);
