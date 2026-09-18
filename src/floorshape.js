// Validation of a floor geometry document (Milestone 2, d-8). The shape mirrors the client floor
// object in public/js/floors.js (d-7): centimetres, y up, headings in degrees clockwise from north.
// sanitizeFloor() returns a clean copy or throws a 400-style error; nothing malformed is stored.

export const FLOOR_DATA_KEYS = ['description', 'width', 'height', 'background', 'start', 'startB', 'tape', 'walls', 'lights', 'darkAreas', 'slopes', 'checkpoints', 'finishZones', 'goals'];
export const BACKGROUNDS = ['white', 'wood', 'carpet'];
export const FLOOR_LIMITS = {
  minSize: 30,
  maxSize: 400,
  tape: 200,
  tapePoints: 2000,
  walls: 300,
  lights: 50,
  darkAreas: 100,
  slopes: 100,
  checkpoints: 50,
  finishZones: 20,
  goals: 10,
  description: 300,
};

// Goals a floor may carry (Milestone 4, d-20): { type, ...params }. Each param is [min, max,
// default]; the client (public/js/goals.js) evaluates them. 'finish' uses the floor's finishZones
// and 'checkpoints' its checkpoints (array order = visiting order), so neither has params.
export const GOAL_TYPES = {
  finish: {},
  checkpoints: {},
  stayOnTape: { maxOff: [0.1, 60, 2] },
  lap: { maxOff: [0.1, 60, 3] },
  stopNearWall: { distance: [1, 200, 30] },
  timeLimit: { seconds: [1, 3600, 30] },
  returnToStart: { tolerance: [1, 50, 7] },
  endFacing: { heading: [-36000, 36000, 0], tolerance: [1, 90, 10] }, // heading is normalised to 0-359.99 after clamping
  // Two-Finch goals (Milestone 6, d-24); they need a floor with startB. Any goal may also carry
  // robot: 'A' | 'B' to say which Finch it judges (A when absent).
  inSync: { tolerance: [1, 100, 10], maxOff: [0.1, 60, 1] },
  follow: { distance: [5, 200, 30], tolerance: [1, 180, 30] },
};
export const ROBOT_NAMES = ['A', 'B'];

const POS = 1000; // coordinates are clamped to +/- 1000 cm; objects may hang off the floor edge
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export class FloorShapeError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const round2 = (n) => Math.round(n * 100) / 100;

function num(v, field, lo, hi) {
  const n = typeof v === 'number' ? v : v === '' || v === null || v === undefined ? NaN : Number(v);
  if (!Number.isFinite(n)) throw new FloorShapeError(`${field} must be a number`);
  return round2(Math.min(hi, Math.max(lo, n)));
}

function optNum(v, field, lo, hi, dflt) {
  return v === undefined || v === null ? dflt : num(v, field, lo, hi);
}

function normDeg(d) {
  d = d % 360;
  return round2(d < 0 ? d + 360 : d);
}

function obj(v, field) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new FloorShapeError(`${field} must be an object`);
  return v;
}

function list(v, field, max) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new FloorShapeError(`${field} must be a list`);
  if (v.length > max) throw new FloorShapeError(`${field} can hold at most ${max} items`);
  return v;
}

function rect(v, field) {
  const r = obj(v, field);
  return {
    x: num(r.x, `${field}.x`, -POS, POS),
    y: num(r.y, `${field}.y`, -POS, POS),
    w: num(r.w, `${field}.w`, 0.5, POS),
    h: num(r.h, `${field}.h`, 0.5, POS),
  };
}

/** True when a request body carries any floor geometry key (as opposed to only a name). */
export function hasFloorFields(body) {
  return !!body && FLOOR_DATA_KEYS.some((k) => body[k] !== undefined);
}

/** The geometry document of a floor row or floor object (drops id, name, timestamps ...). */
export function floorData(floor) {
  const out = {};
  for (const k of FLOOR_DATA_KEYS) if (floor && floor[k] !== undefined) out[k] = floor[k];
  return out;
}

/** Validate and normalise a floor document. Missing collections become empty lists. */
export function sanitizeFloor(input) {
  const f = obj(input, 'floor');
  const L = FLOOR_LIMITS;
  const out = {
    description: typeof f.description === 'string' ? f.description.slice(0, L.description) : '',
    width: num(f.width ?? 120, 'width', L.minSize, L.maxSize),
    height: num(f.height ?? 90, 'height', L.minSize, L.maxSize),
    background: BACKGROUNDS.includes(f.background) ? f.background : 'white',
  };
  const start = f.start === undefined || f.start === null ? {} : obj(f.start, 'start');
  out.start = {
    x: optNum(start.x, 'start.x', 0, out.width, out.width / 2),
    y: optNum(start.y, 'start.y', 0, out.height, out.height / 2),
    heading: normDeg(optNum(start.heading, 'start.heading', -36000, 36000, 0)),
  };
  // The second Finch's start mark (Milestone 6, d-24): null means a one-robot floor.
  if (f.startB === undefined || f.startB === null) out.startB = null;
  else {
    const sb = obj(f.startB, 'startB');
    out.startB = {
      x: optNum(sb.x, 'startB.x', 0, out.width, out.width / 2),
      y: optNum(sb.y, 'startB.y', 0, out.height, out.height / 2),
      heading: normDeg(optNum(sb.heading, 'startB.heading', -36000, 36000, 0)),
    };
  }
  out.tape = list(f.tape, 'tape', L.tape).map((t, i) => {
    const seg = obj(t, `tape[${i}]`);
    const pts = list(seg.points, `tape[${i}].points`, L.tapePoints);
    if (pts.length < 2) throw new FloorShapeError(`tape[${i}] needs at least two points`);
    const points = pts.map((p, j) => {
      if (!Array.isArray(p) || p.length < 2) throw new FloorShapeError(`tape[${i}].points[${j}] must be [x, y]`);
      return [num(p[0], `tape[${i}].points[${j}][0]`, -POS, POS), num(p[1], `tape[${i}].points[${j}][1]`, -POS, POS)];
    });
    const o = {
      points,
      width: optNum(seg.width, `tape[${i}].width`, 0.5, 20, 2.5),
      color: typeof seg.color === 'string' && COLOR_RE.test(seg.color) ? seg.color.toLowerCase() : '#111111',
    };
    if (seg.reading !== undefined && seg.reading !== null) o.reading = num(seg.reading, `tape[${i}].reading`, 0, 100);
    return o;
  });
  out.walls = list(f.walls, 'walls', L.walls).map((w, i) => {
    const r = rect(w, `walls[${i}]`);
    if (w.kind === 'box') r.kind = 'box';
    return r;
  });
  out.lights = list(f.lights, 'lights', L.lights).map((l, i) => {
    const o = obj(l, `lights[${i}]`);
    return {
      x: num(o.x, `lights[${i}].x`, -POS, POS),
      y: num(o.y, `lights[${i}].y`, -POS, POS),
      brightness: optNum(o.brightness, `lights[${i}].brightness`, 0, 100, 100),
      reach: optNum(o.reach, `lights[${i}].reach`, 5, POS, 80),
    };
  });
  out.darkAreas = list(f.darkAreas, 'darkAreas', L.darkAreas).map((a, i) => rect(a, `darkAreas[${i}]`));
  out.slopes = list(f.slopes, 'slopes', L.slopes).map((s, i) => {
    const r = rect(s, `slopes[${i}]`);
    r.uphill = normDeg(optNum(s.uphill, `slopes[${i}].uphill`, -36000, 36000, 0));
    return r;
  });
  // Goal markers and goals (Milestone 4, d-20).
  out.checkpoints = list(f.checkpoints, 'checkpoints', L.checkpoints).map((c, i) => {
    const o = obj(c, `checkpoints[${i}]`);
    return {
      x: num(o.x, `checkpoints[${i}].x`, -POS, POS),
      y: num(o.y, `checkpoints[${i}].y`, -POS, POS),
      r: optNum(o.r, `checkpoints[${i}].r`, 2, 100, 8),
    };
  });
  out.finishZones = list(f.finishZones, 'finishZones', L.finishZones).map((z, i) => rect(z, `finishZones[${i}]`));
  out.goals = list(f.goals, 'goals', L.goals).map((g, i) => {
    const o = obj(g, `goals[${i}]`);
    const spec = GOAL_TYPES[o.type];
    if (!spec) throw new FloorShapeError(`goals[${i}].type must be one of ${Object.keys(GOAL_TYPES).join(', ')}`);
    const clean = { type: o.type };
    for (const [key, [lo, hi, dflt]] of Object.entries(spec)) clean[key] = optNum(o[key], `goals[${i}].${key}`, lo, hi, dflt);
    if (clean.heading !== undefined) clean.heading = normDeg(clean.heading);
    if (ROBOT_NAMES.includes(o.robot)) clean.robot = o.robot;
    return clean;
  });
  return out;
}
