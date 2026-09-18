// The BirdBrain Finch Python lesson catalogue (Milestone 4, d-21): titles, exercise numbering and
// links only — the lesson text stays on BirdBrain's site. This file is imported by the Workbook
// pane AND by the server (src/routes/api.js validates lesson/exercise numbers against it), so it
// must stay free of browser globals. Read from learn.birdbraintechnologies.com/finch/python/program/
// on 2026-09-10. `floor` is the built-in floor suggested for the whole lesson; `floors` overrides
// it per exercise (exercise number -> built-in floor id). Both are optional.

export const LESSONS_URL = 'https://learn.birdbraintechnologies.com/finch/python/program/';

const catalogue = [
  { n: 1, title: 'Moving and Turning', slug: 'lesson-1-moving-and-turning', exercises: 6, floor: 'blank' },
  { n: 2, title: 'Exploring Sensors', slug: 'lesson-2-exploring-sensors', exercises: 6 },
  { n: 3, title: 'Controlling the Lights', slug: 'lesson-3-controlling-lights', exercises: 7 },
  { n: 4, title: 'Controlling the Motors', slug: 'lesson-4-controlling-motors', exercises: 8, floor: 'blank' },
  { n: 5, title: 'Buttons and the Distance Sensor', slug: 'lesson-5-buttons-and-distance-sensor', exercises: 12, floors: { 4: 'walled-box', 6: 'walled-box', 7: 'walled-box', 8: 'walled-box', 12: 'maze' } },
  { n: 6, title: 'micro:bit Display', slug: 'lesson-6-microbit-display', exercises: 8 },
  { n: 7, title: 'Light Sensors', slug: 'lesson-7-light-sensor', exercises: 9, floor: 'flashlight-corner', floors: { 3: 'flashlight-corner' } },
  { n: 8, title: 'Finch Accelerometer', slug: 'lesson-8-accelerometer', exercises: 6 },
  { n: 9, title: 'Line Tracking', slug: 'lesson-9-line-tracking', exercises: 6, floor: 'oval', floors: { 4: 'y-branch', 6: 'y-branch' } },
  { n: 10, title: 'Functions with Finch', slug: 'lesson-10-functions', exercises: 7, floor: 'blank' },
  { n: 11, title: 'Buzzer', slug: 'lesson-11-buzzer', exercises: 10 },
  { n: 12, title: 'Encoders', slug: 'lesson-12-encoders', exercises: 5, floor: 'blank' },
  { n: 13, title: 'Compass', slug: 'lesson-13-compass', exercises: 5, floor: 'blank', floors: { 3: 'maze' } },
  { n: 14, title: 'Multiple Finches', slug: 'lesson-14-multiple-finches', exercises: 4, floor: 'duet', floors: { 3: 'follow-leader', 4: 'follow-leader' } },
  { n: 15, title: 'Finch Fractals', slug: 'lesson-15-finch-fractals', exercises: 3, floor: 'blank' },
];

/** The 15 lessons in order: { n, title, name ("Lesson 9 – Line Tracking"), url, exercises, floor?, floors? }. */
export const LESSONS = catalogue.map((l) => ({ ...l, name: `Lesson ${l.n} – ${l.title}`, url: LESSONS_URL + l.slug }));

export const TOTAL_EXERCISES = LESSONS.reduce((n, l) => n + l.exercises, 0);

export function lessonByNumber(n) {
  return LESSONS.find((l) => l.n === Number(n)) || null;
}

/** The built-in floor id the lesson implies for an exercise, or null. */
export function suggestedFloor(lesson, exercise) {
  const l = typeof lesson === 'object' ? lesson : lessonByNumber(lesson);
  if (!l) return null;
  return (l.floors && l.floors[exercise]) || l.floor || null;
}

/** The programs.exercise_ref text for an exercise ("9.3"), and its inverse. */
export function exerciseRef(lesson, exercise) {
  return `${lesson}.${exercise}`;
}

export function parseExerciseRef(ref) {
  const m = /^(\d+)\.(\d+)$/.exec(String(ref || ''));
  if (!m) return null;
  const lesson = Number(m[1]);
  const exercise = Number(m[2]);
  const l = lessonByNumber(lesson);
  return l && exercise >= 1 && exercise <= l.exercises ? { lesson, exercise } : null;
}
