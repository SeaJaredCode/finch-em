// Records a run while it happens (Milestone 3, d-15): the program and floor as they were, the
// trail, the console log, a bounded per-tick sensor trace, elapsed time, per-wheel distance and
// the pen ink. main.js calls start() when Run is pressed, sample() after every world.tick, and
// finish() when the program ends; finish() returns what POST /api/profiles/:id/runs takes (it is
// bounded again server-side by src/runshape.js, d-13). Milestone 4 (d-20) passes the goal verdict
// into finish(), which stores it as data.verdict. With two Finches (Milestone 6, d-24) every
// sample row continues with robot B's pose and sensors under the same names suffixed B, so one
// timeline and one scrubber serve both robots; trace.fields says which columns a run has.
import { floorData } from './floorlib.js';

/** One trace sample is a row of numbers in this order (robot A). */
export const TRACE_FIELDS = ['t', 'x', 'y', 'heading', 'lineL', 'lineR', 'lightL', 'lightR', 'distance', 'encoderL', 'encoderR'];
/** ... continued with robot B's columns on a two-robot floor (d-24). */
export const TRACE_FIELDS_B = ['xB', 'yB', 'headingB', 'lineLB', 'lineRB', 'lightLB', 'lightRB', 'distanceB', 'encoderLB', 'encoderRB'];
export const SAMPLE_INTERVAL = 0.05; // seconds of simulation time (20 Hz)
export const SAMPLE_CAP = 3000; // past this many samples the rate halves, so a long run stays bounded
const TRAIL_CAP = 4000;
const INK_CAP = 20000;
const CONSOLE_CAP = 500;

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/** Keep at most `cap` items by dropping every other one (repeatedly), always keeping the last. */
function decimate(arr, cap) {
  let out = arr;
  while (out.length > cap) {
    const last = out[out.length - 1];
    out = out.filter((_, i) => i % 2 === 0);
    if (out[out.length - 1] !== last) out.push(last);
  }
  return out;
}

function boundInk(ink) {
  const strokes = ink.map((s) => ({ color: s.color, width: s.width, robot: s.robot || 'A', points: s.points }));
  let total = strokes.reduce((n, s) => n + s.points.length, 0);
  while (total > INK_CAP) {
    total = 0;
    for (const s of strokes) {
      if (s.points.length > 2) s.points = decimate(s.points, Math.ceil(s.points.length / 2));
      total += s.points.length;
    }
  }
  return strokes;
}

export function createRecorder({ world, consoleUi }) {
  let current = null;

  /** Begin recording the run that is about to start (the world has just been reset). */
  function start({ profileId, program, code, speed }) {
    if (current) finish('stopped');
    const floor = world.floor;
    const twoRobots = world.robots.length > 1;
    current = {
      profileId,
      programId: program.id,
      programName: program.name,
      code,
      speed,
      floor: { ...floorData(floor), id: floor.id, name: floor.name, builtin: !!floor.builtin },
      floorId: floor.id,
      floorName: floor.name,
      fields: twoRobots ? TRACE_FIELDS.concat(TRACE_FIELDS_B) : TRACE_FIELDS.slice(),
      twoRobots,
      samples: [],
      interval: SAMPLE_INTERVAL,
      nextAt: 0,
    };
    sample(true);
  }

  /** One robot's part of a sample row: pose and sensors, in TRACE_FIELDS order after t. */
  function robotColumns(robot) {
    if (!robot) return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    return [
      r1(robot.x),
      r1(robot.y),
      Math.round(robot.heading),
      world.line(robot, 'L'),
      world.line(robot, 'R'),
      world.light(robot, 'L'),
      world.light(robot, 'R'),
      world.distance(robot),
      r2(robot.encoder('left')),
      r2(robot.encoder('right')),
    ];
  }

  /** Called after every world.tick; takes a sample when the simulation clock reaches the next slot. */
  function sample(force) {
    const rec = current;
    if (!rec) return;
    if (!force && world.time + 1e-9 < rec.nextAt) return;
    const row = [r2(world.time), ...robotColumns(world.robots[0])];
    if (rec.twoRobots) row.push(...robotColumns(world.robot('B')));
    rec.samples.push(row);
    rec.nextAt = world.time + rec.interval;
    if (rec.samples.length > SAMPLE_CAP) {
      rec.samples = decimate(rec.samples, Math.ceil(rec.samples.length / 2));
      rec.interval *= 2;
    }
  }

  /** Stop recording; returns { profileId, body } for api.createRun, or null when nothing was recording. */
  function finish(status, error, verdict) {
    const rec = current;
    if (!rec) return null;
    sample(true);
    current = null;
    const robot = world.robots[0];
    return {
      profileId: rec.profileId,
      body: {
        programId: rec.programId,
        programName: rec.programName,
        floorId: rec.floorId,
        floorName: rec.floorName,
        status: status || 'finished',
        elapsed: r2(world.time),
        wheelLeft: r1(robot.odometer.left),
        wheelRight: r1(robot.odometer.right),
        data: {
          code: rec.code,
          speed: rec.speed,
          floor: rec.floor,
          trail: decimate(
            world.trail.map(([x, y]) => [r1(x), r1(y)]),
            TRAIL_CAP,
          ),
          trace: { fields: rec.fields, samples: rec.samples },
          console: consoleUi.entries.slice(-CONSOLE_CAP),
          ink: boundInk(world.ink),
          error: error ? { type: error.type, message: error.message, line: error.line ?? null } : null,
          verdict: verdict || null,
        },
      },
    };
  }

  return {
    start,
    sample,
    finish,
    get recording() {
      return current !== null;
    },
    get samples() {
      return current ? current.samples.length : 0;
    },
  };
}
