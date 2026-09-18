// Goal evaluation (Milestone 4, d-20). A floor may carry goals (floor.goals, each one of GOAL_TYPES)
// and the markers they refer to (floor.finishZones; floor.checkpoints in visiting order). main.js
// makes one tracker per run — createGoalTracker(world) right after world.resetRun() — calls tick()
// after every world.tick (also inside finchSandbox.advance) and finish(status) when the program
// ends. finish() returns the verdict, or null when the floor has no goal:
//   { pass, text: 'Pass — …' | 'Fail — <reason> at <t> s', time, goals: [{ type, label, pass, reason, time, robot }] }
// A goal fails the moment its condition breaks (wall contact, too long off the tape, out of time, a
// checkpoint out of order) and that moment is what the verdict reports; success conditions are
// checked when the program ends. Units: centimetres, y up, headings clockwise from north (d-7).
// Two Finches (Milestone 6, d-24): a goal may name the robot it judges (goal.robot 'A' | 'B',
// A when absent) and two goal types judge both robots together: inSync (B mirrors A's moves) and
// follow (B ends close behind A, facing the same way). On a two-robot floor every goal's label says
// which Finch it is about.
// The server clamps goal parameters in src/floorshape.js GOAL_TYPES; keep the two lists in step.
import { ROBOT } from './sim/robot.js';
import { dist, pointInRect, polylineDist, localToWorld, headingVec, normDeg, circleRectHit, rayRect } from './sim/geometry.js';

export const GOAL_TYPES = [
  { id: 'finish', label: 'Reach the finish zone', params: [] },
  { id: 'checkpoints', label: 'Visit the checkpoints in order', params: [] },
  { id: 'stayOnTape', label: 'Stay on the tape', params: [{ key: 'maxOff', label: 'max s off the tape', min: 0.1, max: 60, step: 0.5, dflt: 2 }] },
  { id: 'lap', label: 'Complete a lap on the tape', params: [{ key: 'maxOff', label: 'max s off the tape', min: 0.1, max: 60, step: 0.5, dflt: 3 }] },
  { id: 'stopNearWall', label: 'Stop near a wall without touching it', params: [{ key: 'distance', label: 'within cm', min: 1, max: 200, step: 1, dflt: 30 }] },
  { id: 'timeLimit', label: 'Finish within a time limit', params: [{ key: 'seconds', label: 'seconds', min: 1, max: 3600, step: 1, dflt: 30 }] },
  { id: 'returnToStart', label: 'End on the start mark', params: [{ key: 'tolerance', label: 'within cm', min: 1, max: 50, step: 1, dflt: 7 }] },
  {
    id: 'endFacing',
    label: 'End facing a heading',
    params: [
      { key: 'heading', label: 'heading °', min: 0, max: 359, step: 1, dflt: 0 },
      { key: 'tolerance', label: '± °', min: 1, max: 90, step: 1, dflt: 10 },
    ],
  },
  // Two-Finch goals (Milestone 6, d-24): judged on both robots, so they need a floor with startB.
  {
    id: 'inSync',
    label: 'Dance in sync (B mirrors A)',
    two: true,
    params: [
      { key: 'tolerance', label: 'within cm', min: 1, max: 100, step: 1, dflt: 10 },
      { key: 'maxOff', label: 'max s out of step', min: 0.1, max: 60, step: 0.5, dflt: 1 },
    ],
  },
  {
    id: 'follow',
    label: 'B follows A',
    two: true,
    params: [
      { key: 'distance', label: 'ends within cm of A', min: 5, max: 200, step: 1, dflt: 30 },
      { key: 'tolerance', label: 'heading ± °', min: 1, max: 180, step: 1, dflt: 30 },
    ],
  },
];

const TAPE_TOLERANCE = 1.5; // cm beyond the tape edge the line-sensor midpoint may stray and still count as "on"
const LAP_AWAY = 40; // cm from the start mark the robot must get before coming home counts as a lap
const LAP_HOME = 10; // ... and how close to the start mark "home" is
const WALL_TOUCH = ROBOT.bodyRadius + 1; // a blocked robot this close to a wall touched the wall (else the floor edge)
// getDistance() rounds and jitters (+/-0.6 cm) and a `while getDistance() > 30` loop only reacts a few
// ticks later, so a correct program stops a little past the line; "within X cm" allows this much extra.
const WALL_GRACE = 3;
const SYNC_HEADING = 45; // degrees the two dancers' headings may differ before they are out of step
const FOLLOW_TRAVEL = 30; // cm the leader must cover for "B follows A" to mean anything

const r1 = (v) => Math.round(v * 10) / 10;
const fmt = (t) => r1(t).toFixed(1);
const headingDiff = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

export function goalType(id) {
  return GOAL_TYPES.find((g) => g.id === id) || null;
}

/** True for a goal type that judges both Finches together (inSync, follow). */
export function isTwoRobotGoal(id) {
  const t = goalType(id);
  return !!(t && t.two);
}

/** A fresh goal of a type with its default parameters, or null for an unknown type. */
export function newGoal(id) {
  const t = goalType(id);
  if (!t) return null;
  const g = { type: id };
  for (const p of t.params) g[p.key] = p.dflt;
  return g;
}

export function headingName(h) {
  const d = Math.round(normDeg(h)) % 360;
  return { 0: 'north', 90: 'east', 180: 'south', 270: 'west' }[d] || `${d}°`;
}

/** One line that says what a goal asks for, e.g. "Stop within 30 cm of a wall without touching it". */
export function describeGoal(g) {
  switch (g.type) {
    case 'finish':
      return 'Reach the finish zone';
    case 'checkpoints':
      return 'Visit the checkpoints in order';
    case 'stayOnTape':
      return `Stay on the tape (never off it for more than ${g.maxOff} s)`;
    case 'lap':
      return `Complete a lap on the tape (never off it for more than ${g.maxOff} s)`;
    case 'stopNearWall':
      return `Stop within ${g.distance} cm of a wall without touching it`;
    case 'timeLimit':
      return `Finish within ${g.seconds} s`;
    case 'returnToStart':
      return `End on the start mark (within ${g.tolerance} cm)`;
    case 'endFacing':
      return `End facing ${headingName(g.heading)} (± ${g.tolerance}°)`;
    case 'inSync':
      return `Dance in sync: B mirrors A's moves (within ${g.tolerance} cm, never out of step for more than ${g.maxOff} s)`;
    case 'follow':
      return `B follows A: ends within ${g.distance} cm behind A, facing the same way (± ${g.tolerance}°)`;
    default:
      return String(g.type);
  }
}

/** describeGoal(), prefixed with the Finch it judges on a two-robot floor ("Finch B: End on the start mark …"). */
export function goalLabel(g, twoRobots) {
  if (!twoRobots || isTwoRobotGoal(g.type)) return describeGoal(g);
  return `Finch ${g.robot === 'B' ? 'B' : 'A'}: ${describeGoal(g)}`;
}

export const hasGoals = (floor) => !!floor && Array.isArray(floor.goals) && floor.goals.length > 0;

/**
 * Centimetres from the beak tip to the first wall or box straight ahead — what "within X cm of the
 * wall" measures, and what getDistance() reads without its jitter and range limits (Infinity when
 * nothing is ahead). Measured along the heading, so a wall behind the robot never counts.
 */
export function wallClearance(world, robot = world.robots[0]) {
  const tip = localToWorld(robot, ROBOT.beakTip, 0);
  const dir = headingVec(robot.heading);
  let best = Infinity;
  for (const w of world.floor?.walls || []) best = Math.min(best, rayRect(tip.x, tip.y, dir.x, dir.y, w));
  return best;
}

/** True when the midpoint between the line sensors is over a piece of tape (with a little tolerance). */
export function onTape(world, robot = world.robots[0]) {
  const p = localToWorld(robot, ROBOT.lineSensorForward, 0);
  return (world.floor?.tape || []).some((t) => t.points && t.points.length > 1 && polylineDist(p.x, p.y, t.points) <= (t.width || 2.5) / 2 + TAPE_TOLERANCE);
}

export function createGoalTracker(world, floor = world.floor) {
  const goals = hasGoals(floor) ? floor.goals : [];
  const robotA = world.robots[0];
  const robotB = world.robot('B');
  const two = !!robotB;
  const zones = (floor && floor.finishZones) || [];
  const cps = (floor && floor.checkpoints) || [];
  // Each robot's own start mark (d-24): A's is floor.start, B's is floor.startB.
  const startOf = (robot) => (robot.name === 'B' && floor && floor.startB) || (floor && floor.start) || { x: 0, y: 0, heading: 0 };
  // The robot a goal judges: the one it names when the floor has it, else A.
  const robotOf = (g) => (g.robot === 'B' && robotB) || robotA;
  const states = goals.map((goal) => ({ goal, robot: robotOf(goal), fail: null, offSince: null, next: 0, inside: new Set(), reached: null, farthest: 0 }));
  const needsTape = goals.some((g) => g.type === 'stayOnTape' || g.type === 'lap');
  let done = false;

  const failAt = (s, reason, time) => {
    if (!s.fail) s.fail = { reason, time: r1(time) };
  };

  /** How far B's move from its own start mark differs from A's (cm): 0 while they dance in step. */
  const syncError = () => {
    const a = startOf(robotA);
    const b = startOf(robotB);
    return dist(robotA.x - a.x, robotA.y - a.y, robotB.x - b.x, robotB.y - b.y);
  };
  const travelled = (robot) => (Math.abs(robot.odometer.left) + Math.abs(robot.odometer.right)) / 2;

  /** Called after every world.tick: decide failures the moment they happen, note progress. */
  function tick() {
    if (done || !states.length) return;
    const t = world.time;
    const tape = new Map(); // robot -> on the tape right now
    const onTapeNow = (robot) => {
      if (!tape.has(robot)) tape.set(robot, needsTape ? onTape(world, robot) : true);
      return tape.get(robot);
    };
    for (const s of states) {
      if (s.fail) continue;
      const g = s.goal;
      const robot = s.robot;
      switch (g.type) {
        case 'finish':
          if (s.reached === null && zones.some((z) => pointInRect(robot.x, robot.y, z))) s.reached = t;
          break;
        case 'checkpoints':
          for (let i = 0; i < cps.length; i++) {
            const c = cps[i];
            const hit = dist(robot.x, robot.y, c.x, c.y) <= (c.r || 8);
            if (hit && !s.inside.has(i)) {
              if (i === s.next) {
                s.next++;
                if (s.next === cps.length && s.reached === null) s.reached = t;
              } else if (i > s.next) failAt(s, `reached checkpoint ${i + 1} before checkpoint ${s.next + 1} at ${fmt(t)} s`, t);
            }
            if (hit) s.inside.add(i);
            else s.inside.delete(i);
          }
          break;
        case 'stayOnTape':
        case 'lap':
          if (onTapeNow(robot)) s.offSince = null;
          else if (s.offSince === null) s.offSince = t;
          else if (t - s.offSince > g.maxOff) failAt(s, `left the tape for more than ${g.maxOff} s at ${fmt(t)} s`, t);
          if (g.type === 'lap' && !s.fail) {
            const start = startOf(robot);
            const d = dist(robot.x, robot.y, start.x, start.y);
            if (d > s.farthest) s.farthest = d;
            if (s.reached === null && s.farthest >= LAP_AWAY && d <= LAP_HOME) s.reached = t;
          }
          break;
        case 'stopNearWall':
          if (robot.blocked) {
            const wall = (world.floor?.walls || []).some((w) => circleRectHit(robot.x, robot.y, WALL_TOUCH, w));
            failAt(s, `touched ${wall ? 'wall' : 'the edge of the floor'} at ${fmt(t)} s`, t);
          }
          break;
        case 'timeLimit':
          if (t > g.seconds) failAt(s, `ran out of time (limit ${g.seconds} s) at ${fmt(g.seconds)} s`, g.seconds);
          break;
        case 'inSync': {
          if (!two) break; // judged at the end
          const err = syncError();
          const hd = headingDiff(robotA.heading, robotB.heading);
          if (err <= g.tolerance && hd <= SYNC_HEADING) s.offSince = null;
          else if (s.offSince === null) s.offSince = t;
          else if (t - s.offSince > g.maxOff) {
            failAt(s, `fell out of step (their moves ${r1(err)} cm apart, headings ${Math.round(hd)}° apart) for more than ${g.maxOff} s at ${fmt(t)} s`, t);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /** The program ended with `status` ('finished' | 'error' | 'stopped'): judge every goal and sum up. */
  function finish(status = 'finished') {
    if (!states.length) return null;
    done = true;
    const t = world.time;
    const results = states.map((s) => {
      const g = s.goal;
      const robot = s.robot;
      const label = goalLabel(g, two || !!(floor && floor.startB));
      const tag = (r) => (two ? { ...r, robot: isTwoRobotGoal(g.type) ? 'AB' : robot.name } : r);
      const ok = (reason, time = t) => tag({ type: g.type, label, pass: true, reason, time: r1(time) });
      const bad = (reason, time = t) => tag({ type: g.type, label, pass: false, reason, time: r1(time) });
      if (s.fail) return bad(s.fail.reason, s.fail.time);
      if (status === 'error') return bad(`the program stopped with an error at ${fmt(t)} s`);
      if (status !== 'finished') return bad(`the program was stopped at ${fmt(t)} s`);
      switch (g.type) {
        case 'finish':
          if (!zones.length) return bad('this floor has no finish zone');
          return s.reached !== null ? ok(`reached the finish zone at ${fmt(s.reached)} s`, s.reached) : bad('never reached the finish zone');
        case 'checkpoints':
          if (!cps.length) return bad('this floor has no checkpoints');
          return s.next >= cps.length ? ok(`visited all ${cps.length} checkpoints in order by ${fmt(s.reached)} s`, s.reached) : bad(`reached ${s.next} of ${cps.length} checkpoints`);
        case 'stayOnTape':
          return ok('stayed on the tape');
        case 'lap':
          if (s.reached !== null) return ok(`completed a lap on the tape in ${fmt(s.reached)} s`, s.reached);
          return bad(s.farthest >= LAP_AWAY ? 'did not get back round to the start' : 'did not go round the track');
        case 'stopNearWall': {
          if (robot.motorsOn() || robot.pending) return bad(`was still moving when the program ended at ${fmt(t)} s`);
          const c = wallClearance(world, robot);
          if (!Number.isFinite(c)) return bad('ended with no wall ahead of the beak');
          return c <= g.distance + WALL_GRACE ? ok(`stopped ${r1(c)} cm from the wall`) : bad(`stopped ${r1(c)} cm from the wall, not within ${g.distance} cm`);
        }
        case 'timeLimit':
          return ok(`finished in ${fmt(t)} s`);
        case 'returnToStart': {
          const start = startOf(robot);
          const d = dist(robot.x, robot.y, start.x, start.y);
          return d <= g.tolerance ? ok(`ended on the start mark (${r1(d)} cm off)`) : bad(`ended ${r1(d)} cm from the start mark`);
        }
        case 'endFacing': {
          const diff = headingDiff(robot.heading, g.heading);
          return diff <= g.tolerance
            ? ok(`ended facing ${headingName(g.heading)} (${Math.round(robot.heading)}°)`)
            : bad(`ended facing ${Math.round(robot.heading)}° instead of ${headingName(g.heading)}`);
        }
        case 'inSync': {
          if (!two) return bad('this floor has no second Finch (add its start mark with the Start B tool)');
          if (travelled(robotA) < 1 && travelled(robotB) < 1) return bad('the Finches never moved');
          return ok('danced in step the whole way');
        }
        case 'follow': {
          if (!two) return bad('this floor has no second Finch (add its start mark with the Start B tool)');
          const led = travelled(robotA);
          if (led < FOLLOW_TRAVEL) return bad(`Finch A only went ${r1(led)} cm — the leader has to go somewhere`);
          const d = dist(robotA.x, robotA.y, robotB.x, robotB.y);
          const hd = headingDiff(robotA.heading, robotB.heading);
          const v = headingVec(robotA.heading);
          const ahead = (robotB.x - robotA.x) * v.x + (robotB.y - robotA.y) * v.y;
          if (d > g.distance) return bad(`B ended ${r1(d)} cm from A, not within ${g.distance} cm`);
          if (hd > g.tolerance) return bad(`B ended facing ${Math.round(hd)}° away from A's heading (± ${g.tolerance}°)`);
          if (ahead > 0) return bad(`B ended in front of A instead of behind it`);
          return ok(`B ended ${r1(d)} cm behind A, facing the same way`);
        }
        default:
          return bad(`unknown goal "${g.type}"`);
      }
    });
    const failed = results.filter((r) => !r.pass).sort((a, b) => a.time - b.time);
    const pass = failed.length === 0;
    const text = pass
      ? 'Pass — ' + results.map((r) => r.reason).join('; ')
      : 'Fail — ' + failed[0].reason + (failed.length > 1 ? ` (and ${failed.length - 1} more)` : '');
    return { pass, text, time: r1(pass ? t : failed[0].time), goals: results };
  }

  return {
    tick,
    finish,
    get goals() {
      return goals;
    },
    get done() {
      return done;
    },
    /** True once any goal has already failed (used to still report a verdict for a stopped run). */
    get failed() {
      return states.some((s) => !!s.fail);
    },
  };
}
