// Built-in floors (spec: "Floors (environments)"). A floor is a plain object:
// { id, name, description, width, height, background: 'white'|'wood'|'carpet',
//   start: { x, y, heading }, startB: { x, y, heading } | null (a second Finch, Milestone 6),
//   tape: [{ points: [[x,y],...], width, color }],
//   walls: [{ x, y, w, h }], lights: [{ x, y, brightness, reach }],
//   darkAreas: [{ x, y, w, h }], slopes: [{ x, y, w, h, uphill }],
//   checkpoints: [{ x, y, r }], finishZones: [{ x, y, w, h }], goals: [{ type, ...params }] }
// Units are centimetres, y up, heading degrees clockwise from north (d-7).
// Milestone 2's floor editor and Milestone 4's goals (goals.js, d-20) extend this shape.

const BLACK = '#111111';

function ellipse(cx, cy, rx, ry, n = 72) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}

function lemniscate(cx, cy, a, n = 160) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const s = Math.sin(t);
    const c = Math.cos(t);
    const d = 1 + s * s;
    pts.push([cx + (a * c) / d, cy + (a * s * c) / d]);
  }
  return pts;
}

function frame(width, height, thickness = 3) {
  return [
    { x: 0, y: height - thickness, w: width, h: thickness },
    { x: 0, y: 0, w: width, h: thickness },
    { x: 0, y: 0, w: thickness, h: height },
    { x: width - thickness, y: 0, w: thickness, h: height },
  ];
}

const base = (f) => ({
  background: 'white',
  startB: null,
  tape: [],
  walls: [],
  lights: [],
  darkAreas: [],
  slopes: [],
  checkpoints: [],
  finishZones: [],
  goals: [],
  builtin: true,
  ...f,
});

export const BUILTIN_FLOORS = [
  base({
    id: 'blank',
    name: 'Blank floor',
    description: 'A 120 x 90 cm sheet of white paper. Good for Lessons 1-4 and drawing shapes.',
    width: 120,
    height: 90,
    start: { x: 60, y: 45, heading: 0 },
  }),
  base({
    id: 'oval',
    name: 'Oval tape track',
    description: 'A black tape loop for Lesson 9 line following. The robot starts on the tape heading east. Goal: complete a lap on the tape.',
    width: 160,
    height: 110,
    start: { x: 80, y: 20, heading: 90 },
    tape: [{ points: ellipse(80, 55, 60, 35), width: 2.5, color: BLACK }],
    goals: [{ type: 'lap', maxOff: 3 }],
  }),
  base({
    id: 'figure-eight',
    name: 'Figure-eight track',
    description: 'A crossing tape loop. Watch what a one-sensor tracker does at the crossing.',
    width: 180,
    height: 110,
    start: { x: 165, y: 55, heading: 0 },
    tape: [{ points: lemniscate(90, 55, 75), width: 2.5, color: BLACK }],
  }),
  base({
    id: 'y-branch',
    name: 'Y-branch track',
    description: 'A tape path that forks, with a box at the end of the left branch (Lesson 9, exercise 6). Goal: follow the tape to the finish zone.',
    width: 160,
    height: 120,
    start: { x: 80, y: 14, heading: 0 },
    tape: [
      { points: [[80, 6], [80, 60]], width: 2.5, color: BLACK },
      { points: [[80, 60], [76, 70], [68, 82], [56, 96], [44, 108]], width: 2.5, color: BLACK },
      { points: [[80, 60], [84, 70], [92, 82], [104, 96], [116, 108]], width: 2.5, color: BLACK },
    ],
    walls: [{ x: 30, y: 104, w: 14, h: 14 }],
    finishZones: [{ x: 104, y: 98, w: 24, h: 20 }],
    goals: [{ type: 'finish' }, { type: 'stayOnTape', maxOff: 3 }],
  }),
  base({
    id: 'walled-box',
    name: 'Walled box',
    description: 'A 120 x 120 cm box with walls on all four sides. Drive at the north wall and stop before it (Lesson 5). Goal: stop within 30 cm of the wall without touching it.',
    width: 120,
    height: 120,
    start: { x: 60, y: 20, heading: 0 },
    walls: frame(120, 120, 3),
    goals: [{ type: 'stopNearWall', distance: 30 }],
  }),
  base({
    id: 'flashlight-corner',
    name: 'Flashlight corner',
    description: 'A lamp shines from the top-right corner. The light sensors read higher as the robot faces it (Lesson 7). Goal: reach the finish zone under the lamp.',
    width: 140,
    height: 100,
    start: { x: 35, y: 25, heading: 0 },
    lights: [{ x: 128, y: 90, brightness: 100, reach: 110 }],
    finishZones: [{ x: 100, y: 66, w: 30, h: 26 }],
    goals: [{ type: 'finish' }],
  }),
  base({
    id: 'dark-tunnel',
    name: 'Dark tunnel',
    description: 'A dark band crosses the floor. Light readings drop inside it; a lamp waits at the far end.',
    width: 160,
    height: 100,
    start: { x: 20, y: 50, heading: 90 },
    darkAreas: [{ x: 55, y: 0, w: 50, h: 100 }],
    lights: [{ x: 150, y: 50, brightness: 90, reach: 60 }],
  }),
  base({
    id: 'maze',
    name: 'Maze of walls',
    description: 'Walls to feel your way around with the distance sensor. Goal: reach the finish zone in the far corner without hitting anything.',
    width: 160,
    height: 120,
    start: { x: 20, y: 16, heading: 0 },
    walls: [
      ...frame(160, 120, 3),
      { x: 40, y: 0, w: 3, h: 85 },
      { x: 80, y: 35, w: 3, h: 85 },
      { x: 120, y: 0, w: 3, h: 85 },
    ],
    finishZones: [{ x: 128, y: 3, w: 29, h: 28 }],
    goals: [{ type: 'finish' }],
  }),
  // Two Finches (Milestone 6, d-24): floors with a second start mark, for Lesson 14.
  base({
    id: 'duet',
    name: 'Two-Finch dance floor',
    description: "Two Finches side by side for Lesson 14: Finch A on the left, Finch B on the right, both facing north. Finch('A') and Finch('B') drive them. Goal: dance in sync — B mirrors every move A makes.",
    width: 160,
    height: 120,
    start: { x: 55, y: 40, heading: 0 },
    startB: { x: 105, y: 40, heading: 0 },
    goals: [{ type: 'inSync', tolerance: 10, maxOff: 1 }],
  }),
  base({
    id: 'follow-leader',
    name: 'Follow the leader',
    description: 'Finch B starts behind Finch A, both facing east, inside four walls (Lesson 14). Goal: B follows A — when the program ends B is close behind A facing the same way, and A has gone somewhere.',
    width: 180,
    height: 120,
    start: { x: 50, y: 60, heading: 90 },
    startB: { x: 20, y: 60, heading: 90 },
    walls: frame(180, 120, 3),
    goals: [{ type: 'follow', distance: 30, tolerance: 30 }],
  }),
];

export function getFloor(id) {
  return BUILTIN_FLOORS.find((f) => f.id === id) || BUILTIN_FLOORS[0];
}
