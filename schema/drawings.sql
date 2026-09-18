-- A gallery drawing (Milestone 3, d-13): the pen ink of a run, kept with a title. A drawing
-- outlives its run, so run_id is a plain reference (no foreign key) that may point at a deleted
-- run. data is { width, height, background, strokes: [{ color, width, points: [[x, y, t]...] }] }
-- in floor centimetres (d-7), validated by src/runshape.js.
CREATE TABLE drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  run_id uuid,
  title text NOT NULL,
  program_name text NOT NULL DEFAULT '',
  floor_name text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX drawings_profile_created_idx ON drawings (profile_id, created_at DESC);
