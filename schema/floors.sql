-- A custom floor (Milestone 2, spec "Floors (environments)"). Built-in floors live in
-- public/js/floors.js and are never stored; programs.floor_id names either a built-in id
-- ('blank', 'oval', ...) or a floors.id. data is the floor geometry document exactly as the
-- client uses it (d-7 shape, validated by src/floorshape.js):
-- { description, width, height, background, start, tape, walls, lights, darkAreas, slopes }.
-- class_id / assignment_id / locked (itch-15, d-34): a floor copied in by Start on an assignment
-- carries its origin, and is locked (the floor routes refuse edits and delete) unless the
-- assignment lets students edit the floor. Only Start writes these columns.
CREATE TABLE floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  assignment_id uuid REFERENCES assignments(id) ON DELETE SET NULL,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX floors_profile_created_idx ON floors (profile_id, created_at ASC);
CREATE INDEX floors_assignment_idx ON floors (assignment_id);
