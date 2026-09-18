// Validation of run and drawing documents (Milestone 3, d-13). A run document is what the client
// recorder (public/js/recorder.js) builds when a program ends: the code and floor as they were,
// the trail, the console log, a per-tick sensor trace and the pen ink. Everything is bounded here
// (over-long lists are truncated, never rejected) so a runaway program can never persist an
// unbounded row. Coordinates are centimetres, y up (d-7); times are simulation seconds.
// Milestone 4 (d-20) adds data.verdict, the goal verdict, whose text and pass flag are also
// returned as the row fields `verdict` and `passed` for the Runs list.
import { sanitizeFloor, BACKGROUNDS } from './floorshape.js';

export const RUN_STATUSES = ['finished', 'error', 'stopped'];
export const RUN_LIMITS = {
  code: 200_000,
  trail: 6000, // [x, y] points
  samples: 5000, // sensor-trace samples
  sampleWidth: 24, // numbers per sample (11 for one Finch, 21 with robot B's *B columns, d-24)
  strokes: 500,
  inkPoints: 30000, // [x, y, t] points across all strokes
  consoleLines: 1000, // the newest lines are kept
  consoleText: 2000,
  text: 80,
  verdictText: 200,
  goals: 10,
};

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round2 = (n) => Math.round(n * 100) / 100;

export class RunShapeError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function num(v, field, lo, hi) {
  const n = typeof v === 'number' ? v : v === '' || v === null || v === undefined ? NaN : Number(v);
  if (!Number.isFinite(n)) throw new RunShapeError(`${field} must be a number`);
  return round2(Math.min(hi, Math.max(lo, n)));
}

function optNum(v, field, lo, hi, dflt) {
  return v === undefined || v === null ? dflt : num(v, field, lo, hi);
}

function text(v, field, max, dflt = '') {
  if (v === undefined || v === null) return dflt;
  if (typeof v !== 'string') throw new RunShapeError(`${field} must be a string`);
  return v.slice(0, max);
}

function obj(v, field) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new RunShapeError(`${field} must be an object`);
  return v;
}

function list(v, field) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new RunShapeError(`${field} must be a list`);
  return v;
}

function point(p, field, withTime) {
  if (!Array.isArray(p) || p.length < 2) throw new RunShapeError(`${field} must be [x, y]`);
  const out = [num(p[0], field, -1e4, 1e4), num(p[1], field, -1e4, 1e4)];
  if (withTime) out.push(optNum(p[2], field, 0, 1e7, 0));
  return out;
}

/** Pen strokes: [{ color, width, points: [[x, y, t], ...] }], bounded to RUN_LIMITS.inkPoints. */
export function sanitizeStrokes(input, field = 'strokes') {
  const strokes = list(input, field).slice(0, RUN_LIMITS.strokes);
  let budget = RUN_LIMITS.inkPoints;
  const out = [];
  for (let i = 0; i < strokes.length && budget > 0; i++) {
    const s = obj(strokes[i], `${field}[${i}]`);
    const points = list(s.points, `${field}[${i}].points`)
      .slice(0, budget)
      .map((p, j) => point(p, `${field}[${i}].points[${j}]`, true));
    if (!points.length) continue;
    budget -= points.length;
    const stroke = {
      color: typeof s.color === 'string' && COLOR_RE.test(s.color) ? s.color.toLowerCase() : '#d62828',
      width: optNum(s.width, `${field}[${i}].width`, 0.1, 10, 0.7),
      points,
    };
    if (s.robot === 'A' || s.robot === 'B') stroke.robot = s.robot; // which Finch drew it (d-24)
    out.push(stroke);
  }
  return out;
}

/** The persisted shape of a run: row fields plus the bounded `data` document. */
export function sanitizeRun(input) {
  const b = obj(input, 'run');
  const d = b.data === undefined || b.data === null ? {} : obj(b.data, 'data');
  const floorIn = d.floor === undefined || d.floor === null ? {} : obj(d.floor, 'data.floor');
  const floor = sanitizeFloor(floorIn);
  floor.id = text(floorIn.id, 'data.floor.id', 100, 'blank') || 'blank';
  floor.name = text(floorIn.name, 'data.floor.name', RUN_LIMITS.text, 'Floor');
  floor.builtin = !!floorIn.builtin;

  const trail = list(d.trail, 'data.trail')
    .slice(0, RUN_LIMITS.trail)
    .map((p, i) => point(p, `data.trail[${i}]`, false));
  const traceIn = d.trace === undefined || d.trace === null ? {} : obj(d.trace, 'data.trace');
  const fields = list(traceIn.fields, 'data.trace.fields')
    .slice(0, RUN_LIMITS.sampleWidth)
    .map((f, i) => text(String(f), `data.trace.fields[${i}]`, 24));
  const samples = list(traceIn.samples, 'data.trace.samples')
    .slice(0, RUN_LIMITS.samples)
    .map((s, i) => {
      if (!Array.isArray(s)) throw new RunShapeError(`data.trace.samples[${i}] must be a list of numbers`);
      return s.slice(0, RUN_LIMITS.sampleWidth).map((v, j) => num(v, `data.trace.samples[${i}][${j}]`, -1e7, 1e7));
    });
  const consoleLines = list(d.console, 'data.console')
    .slice(-RUN_LIMITS.consoleLines)
    .map((e, i) => {
      if (!Array.isArray(e) || e.length < 3) throw new RunShapeError(`data.console[${i}] must be [time, kind, text]`);
      return [
        num(e[0], `data.console[${i}][0]`, 0, 1e7),
        text(String(e[1]), `data.console[${i}][1]`, 16, 'out'),
        text(String(e[2]), `data.console[${i}][2]`, RUN_LIMITS.consoleText),
      ];
    });
  const ink = sanitizeStrokes(d.ink, 'data.ink');
  let error = null;
  if (d.error !== undefined && d.error !== null) {
    const e = obj(d.error, 'data.error');
    error = {
      type: text(e.type, 'data.error.type', RUN_LIMITS.text, 'Error'),
      message: text(e.message, 'data.error.message', 500),
      line: e.line === undefined || e.line === null ? null : Math.round(num(e.line, 'data.error.line', 0, 1e6)),
    };
  }
  // The goal verdict (Milestone 4, d-20): { pass, text, time, goals: [{type, label, pass, reason, time}] }.
  let verdict = null;
  if (d.verdict !== undefined && d.verdict !== null) {
    const v = obj(d.verdict, 'data.verdict');
    const pass = !!v.pass;
    verdict = {
      pass,
      text: text(v.text, 'data.verdict.text', RUN_LIMITS.verdictText, pass ? 'Pass' : 'Fail'),
      time: optNum(v.time, 'data.verdict.time', 0, 1e7, 0),
      goals: list(v.goals, 'data.verdict.goals')
        .slice(0, RUN_LIMITS.goals)
        .map((g, i) => {
          const o = obj(g, `data.verdict.goals[${i}]`);
          const result = {
            type: text(o.type, `data.verdict.goals[${i}].type`, 24, 'goal'),
            label: text(o.label, `data.verdict.goals[${i}].label`, 120),
            pass: !!o.pass,
            reason: text(o.reason, `data.verdict.goals[${i}].reason`, RUN_LIMITS.verdictText),
            time: o.time === undefined || o.time === null ? null : num(o.time, `data.verdict.goals[${i}].time`, 0, 1e7),
          };
          if (o.robot === 'A' || o.robot === 'B') result.robot = o.robot; // the Finch it judged (d-24)
          return result;
        }),
    };
  }
  return {
    programName: text(b.programName, 'programName', RUN_LIMITS.text, 'Program'),
    floorId: text(b.floorId, 'floorId', 100, floor.id) || 'blank',
    floorName: text(b.floorName, 'floorName', RUN_LIMITS.text, floor.name),
    status: RUN_STATUSES.includes(b.status) ? b.status : 'finished',
    elapsed: optNum(b.elapsed, 'elapsed', 0, 1e7, 0),
    wheelLeft: optNum(b.wheelLeft, 'wheelLeft', -1e7, 1e7, 0),
    wheelRight: optNum(b.wheelRight, 'wheelRight', -1e7, 1e7, 0),
    hasPen: ink.length > 0,
    verdict: verdict ? verdict.text : null,
    passed: verdict ? verdict.pass : null,
    data: {
      code: text(d.code, 'data.code', RUN_LIMITS.code),
      speed: optNum(d.speed, 'data.speed', 0.1, 16, 1),
      floor,
      trail,
      trace: { fields, samples },
      console: consoleLines,
      ink,
      error,
      verdict,
    },
  };
}

/** The persisted shape of a gallery drawing (the title is validated by the route). */
export function sanitizeDrawing(input) {
  const b = obj(input, 'drawing');
  const runId = b.runId === undefined || b.runId === null || b.runId === '' ? null : String(b.runId);
  if (runId !== null && !UUID_RE.test(runId)) throw new RunShapeError('runId must be a uuid');
  return {
    runId,
    programName: text(b.programName, 'programName', RUN_LIMITS.text),
    floorName: text(b.floorName, 'floorName', RUN_LIMITS.text),
    data: {
      width: optNum(b.width, 'width', 30, 400, 120),
      height: optNum(b.height, 'height', 30, 400, 90),
      background: BACKGROUNDS.includes(b.background) ? b.background : 'white',
      strokes: sanitizeStrokes(b.strokes, 'strokes'),
    },
  };
}
