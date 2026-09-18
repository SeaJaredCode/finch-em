-- Workbook progress (Milestone 4, d-21): one row per exercise a profile has touched. The lesson
-- catalogue itself is fixed code (public/js/lessons.js: 15 lessons, numbered exercises, links);
-- a row only exists once she marks an exercise done or attaches a program or floor to it.
-- program_id clears when the program is deleted. floor_id (text, like programs.floor_id) names
-- a built-in id or a floors.id; the store clears it when a custom floor is deleted.
CREATE TABLE workbook_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lesson integer NOT NULL,
  exercise integer NOT NULL,
  done boolean NOT NULL DEFAULT false,
  program_id uuid REFERENCES programs(id) ON DELETE SET NULL,
  floor_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, lesson, exercise)
);
