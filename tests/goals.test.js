// Goal evaluation (Milestone 4, d-20) run against the simulation engine itself — no browser, no
// Skulpt: the World, the built-in floors and goals.js are plain ES modules.
import { describe, expect, it } from 'vitest';
import { World } from '../public/js/sim/world.js';
import { getFloor } from '../public/js/floors.js';
import { createGoalTracker, wallClearance, describeGoal, newGoal } from '../public/js/goals.js';
import { dist } from '../public/js/sim/geometry.js';

const STEP = 0.01;

function worldOn(floor) {
  const world = new World();
  world.setFloor(floor);
  world.resetRun();
  return world;
}

/** Advance the simulation and the tracker together, like main.js tick() does. */
function advance(world, tracker, seconds) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    world.tick(STEP);
    tracker.tick();
  }
}

/** Teleport the robot along a straight line over `seconds` (motors off), ticking as we go. */
function walk(world, tracker, from, to, seconds, heading = 0) {
  const robot = world.robots[0];
  const n = Math.round(seconds / STEP);
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    robot.placeAt(from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, heading);
    world.tick(STEP);
    tracker.tick();
  }
}

describe('goals: the walled box (acceptance criterion 16)', () => {
  it('passes when the robot stops within 30 cm of the wall without touching it', () => {
    const world = worldOn(getFloor('walled-box'));
    const robot = world.robots[0];
    const tracker = createGoalTracker(world);
    expect(tracker.goals).toEqual([{ type: 'stopNearWall', distance: 30 }]);
    // like `while bird.getDistance() > 30: bird.setMotors(50, 50)`, measured without sensor jitter
    robot.setMotors(50, 50);
    let guard = 0;
    while (wallClearance(world) > 30 && guard++ < 5000) {
      world.tick(STEP);
      tracker.tick();
    }
    robot.stop();
    advance(world, tracker, 0.5);
    const verdict = tracker.finish('finished');
    expect(verdict.pass).toBe(true);
    expect(verdict.text).toMatch(/^Pass — stopped (29|30)(\.\d)? cm from the wall$/);
    expect(verdict.goals[0]).toMatchObject({ type: 'stopNearWall', pass: true });
    expect(verdict.goals[0].label).toBe(describeGoal({ type: 'stopNearWall', distance: 30 }));
  });

  it('fails the moment the robot touches the wall, and says when', () => {
    const world = worldOn(getFloor('walled-box'));
    const robot = world.robots[0];
    const tracker = createGoalTracker(world);
    world.startMove(robot, 'F', 200, 100); // drives too far: the north wall is ~86 cm from the beak
    advance(world, tracker, 10);
    expect(tracker.failed).toBe(true);
    const verdict = tracker.finish('finished');
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toMatch(/^Fail — touched wall at \d+\.\d s$/);
    // 90.5 cm of travel at 25 cm/s: contact at about 3.6 s
    expect(verdict.time).toBeGreaterThan(3);
    expect(verdict.time).toBeLessThan(4.5);
    expect(verdict.goals[0].reason).toBe(`touched wall at ${verdict.time.toFixed(1)} s`);
  });

  it('fails when the program ends while the robot is still rolling, or stopped too far away', () => {
    const world = worldOn(getFloor('walled-box'));
    const robot = world.robots[0];
    let tracker = createGoalTracker(world);
    robot.setMotors(50, 50);
    advance(world, tracker, 1);
    expect(tracker.finish('finished').text).toMatch(/still moving/);
    world.resetRun();
    tracker = createGoalTracker(world);
    advance(world, tracker, 1);
    const v = tracker.finish('finished');
    expect(v.pass).toBe(false);
    expect(v.text).toBe('Fail — stopped 86.5 cm from the wall, not within 30 cm'); // the north wall, ahead; the wall behind does not count
    // a real `while getDistance() > 30` loop overshoots a little: up to 3 cm of grace passes, more fails
    for (const [clearance, pass] of [[32, true], [34, false]]) {
      world.resetRun();
      world.robots[0].placeAt(60, 117 - clearance - 10.5, 0);
      tracker = createGoalTracker(world);
      advance(world, tracker, 0.1);
      const r = tracker.finish('finished');
      expect(r.pass).toBe(pass);
      expect(r.text).toContain(`stopped ${clearance} cm from the wall`);
    }
    // facing away from every wall there is nothing to measure against
    world.resetRun();
    world.robots[0].placeAt(60, 60, 45);
    tracker = createGoalTracker(world);
    advance(world, tracker, 0.1);
    expect(tracker.finish('finished').text).toMatch(/^Fail — stopped \d+(\.\d)? cm from the wall, not within 30 cm$/);
  });
});

describe('goals: the oval track', () => {
  const ellipse = (a) => [80 + 60 * Math.cos(a), 55 + 35 * Math.sin(a)];

  it('passes a lap that stays on the tape', () => {
    const world = worldOn(getFloor('oval'));
    const robot = world.robots[0];
    const tracker = createGoalTracker(world);
    const n = 2000; // 20 s round the ellipse, starting at the start mark (bottom, heading east)
    for (let i = 1; i <= n; i++) {
      const [x, y] = ellipse(-Math.PI / 2 + (i / n) * Math.PI * 2);
      robot.placeAt(x, y, 90);
      world.tick(STEP);
      tracker.tick();
    }
    const v = tracker.finish('finished');
    expect(v.pass).toBe(true);
    expect(v.text).toMatch(/^Pass — completed a lap on the tape in \d+\.\d s$/);
  });

  it('fails after more than 3 s off the tape, at that moment', () => {
    const world = worldOn(getFloor('oval'));
    const tracker = createGoalTracker(world);
    walk(world, tracker, [80, 20], [80, 55], 1); // straight into the middle of the oval
    walk(world, tracker, [80, 55], [80, 55], 5); // and sit there
    const v = tracker.finish('finished');
    expect(v.pass).toBe(false);
    expect(v.text).toMatch(/^Fail — left the tape for more than 3 s at \d\.\d s$/);
    expect(v.time).toBeGreaterThanOrEqual(3); // heading north from the start mark, the sensors leave the east-west tape at once
    expect(v.time).toBeLessThan(4.5);
  });

  it('fails a run that never went round', () => {
    const world = worldOn(getFloor('oval'));
    const tracker = createGoalTracker(world);
    advance(world, tracker, 2);
    expect(tracker.finish('finished').text).toBe('Fail — did not go round the track');
  });
});

describe('goals: checkpoints, finish zone, time limit, start mark and heading', () => {
  const course = () => ({
    id: 'course',
    name: 'Course',
    width: 100,
    height: 100,
    background: 'white',
    start: { x: 20, y: 20, heading: 0 },
    tape: [],
    walls: [],
    lights: [],
    darkAreas: [],
    slopes: [],
    checkpoints: [
      { x: 20, y: 60, r: 8 },
      { x: 60, y: 60, r: 8 },
    ],
    finishZones: [{ x: 50, y: 10, w: 20, h: 20 }],
    goals: [
      newGoal('checkpoints'),
      newGoal('finish'),
      { type: 'timeLimit', seconds: 10 },
      newGoal('returnToStart'),
      { type: 'endFacing', heading: 90, tolerance: 10 },
    ],
  });

  it('passes a run that does everything in order', () => {
    const world = worldOn(course());
    const tracker = createGoalTracker(world);
    walk(world, tracker, [20, 20], [20, 60], 1);
    walk(world, tracker, [20, 60], [60, 60], 1, 90);
    walk(world, tracker, [60, 60], [60, 20], 1, 180);
    walk(world, tracker, [60, 20], [20, 20], 1, 270);
    world.robots[0].placeAt(20, 20, 88);
    world.tick(STEP);
    tracker.tick();
    const v = tracker.finish('finished');
    expect(v.goals.map((g) => g.pass)).toEqual([true, true, true, true, true]);
    expect(v.pass).toBe(true);
    expect(v.text).toContain('visited all 2 checkpoints in order');
    expect(v.text).toContain('reached the finish zone');
    expect(v.text).toContain('ended facing east (88°)');
  });

  it('fails on the first checkpoint out of order, then reports every other miss', () => {
    const world = worldOn(course());
    const tracker = createGoalTracker(world);
    walk(world, tracker, [20, 20], [60, 60], 2, 45); // checkpoint 2 first
    const v = tracker.finish('finished');
    expect(v.pass).toBe(false);
    expect(v.text).toMatch(/^Fail — reached checkpoint 2 before checkpoint 1 at \d\.\d s \(and 3 more\)$/);
    expect(v.goals.find((g) => g.type === 'finish').reason).toBe('never reached the finish zone');
    expect(v.goals.find((g) => g.type === 'returnToStart').reason).toMatch(/^ended 5[0-9](\.\d)? cm from the start mark$/);
    expect(v.goals.find((g) => g.type === 'endFacing').reason).toBe('ended facing 45° instead of east');
    expect(v.goals.find((g) => g.type === 'timeLimit').pass).toBe(true);
  });

  it('runs out of time at the limit, and an error or a stop fails the open goals', () => {
    const world = worldOn(course());
    let tracker = createGoalTracker(world);
    advance(world, tracker, 12);
    let v = tracker.finish('finished');
    expect(v.goals.find((g) => g.type === 'timeLimit')).toMatchObject({ pass: false, reason: 'ran out of time (limit 10 s) at 10.0 s', time: 10 });
    world.resetRun();
    tracker = createGoalTracker(world);
    advance(world, tracker, 1);
    v = tracker.finish('error');
    expect(v.text).toMatch(/^Fail — the program stopped with an error at 1\.0 s/);
    expect(tracker.failed).toBe(false); // nothing had failed on its own before the error
  });

  it('gives no verdict on a floor without goals', () => {
    const world = worldOn(getFloor('blank'));
    const tracker = createGoalTracker(world);
    advance(world, tracker, 1);
    expect(tracker.finish('finished')).toBeNull();
  });
});

// ---- two Finches (Milestone 6, d-24) ----------------------------------------------------------

describe('two Finches: a floor with startB holds robot B', () => {
  it('adds robot B on its own start mark and drops it again with a one-robot floor', () => {
    const world = worldOn(getFloor('follow-leader'));
    expect(world.robots.map((r) => r.name)).toEqual(['A', 'B']);
    expect(world.robot('B')).toMatchObject({ x: 20, y: 60, heading: 90 });
    expect(world.robots[0]).toMatchObject({ x: 50, y: 60, heading: 90 });
    world.setFloor(getFloor('blank'));
    expect(world.robots).toHaveLength(1);
    expect(world.robot('B')).toBeNull();
  });

  it("A's distance sensor sees B approaching, and A stops on contact with B (acceptance criterion 21)", () => {
    const world = worldOn(getFloor('duet'));
    const [a, b] = world.robots;
    a.placeAt(a.x, a.y, 90); // face B, 50 cm to the east
    const before = world.distance(a);
    expect(before).toBeGreaterThan(30); // beak tip 10.5 cm ahead of A's pose, B's body 6.5 cm around its own
    expect(before).toBeLessThan(37);
    const tracker = createGoalTracker(world);
    let bumped = null;
    world.onBump = (r) => (bumped = r.name);
    world.startMove(a, 'F', 100, 100);
    advance(world, tracker, 0.5);
    expect(world.distance(a)).toBeLessThan(before - 8);
    advance(world, tracker, 5);
    expect(bumped).toBe('A'); // the 100 cm move was cut short on contact ...
    expect(a.pending).toBeNull();
    expect(a.x).toBeLessThan(93); // ... well short of the 155 it asked for
    expect(dist(a.x, a.y, b.x, b.y)).toBeGreaterThanOrEqual(12.99); // the bodies touch, never overlap
    expect(dist(a.x, a.y, b.x, b.y)).toBeLessThan(14);
    expect(b.x).toBe(105); // B was not pushed
  });

  it('panel input is per robot: tilting A leaves B level, and world.input is A\'s', () => {
    const world = worldOn(getFloor('duet'));
    world.robot('A').input.orientation = 'Tilt left';
    expect(world.orientation(world.robot('A'))).toBe('Tilt left');
    expect(world.orientation(world.robot('B'))).toBe('Level');
    expect(world.input).toBe(world.robot('A').input);
    world.robot('B').input.shakeUntil = world.time + 1;
    expect(world.isShaking(world.robot('B'))).toBe(true);
    expect(world.isShaking(world.robot('A'))).toBe(false);
  });

  it('inSync passes a mirrored dance and fails when B lags behind A', () => {
    let world = worldOn(getFloor('duet'));
    let [a, b] = world.robots;
    let tracker = createGoalTracker(world);
    expect(tracker.goals[0].type).toBe('inSync');
    world.startMove(a, 'F', 30, 50);
    world.startMove(b, 'F', 30, 50);
    advance(world, tracker, 4);
    world.startTurn(a, 'R', 90, 50);
    world.startTurn(b, 'R', 90, 50);
    advance(world, tracker, 4);
    let v = tracker.finish('finished');
    expect(v.pass).toBe(true);
    expect(v.text).toMatch(/^Pass — danced in step/);
    // A moves first and B only afterwards: out of step by up to 30 cm for more than a second
    world = worldOn(getFloor('duet'));
    [a, b] = world.robots;
    tracker = createGoalTracker(world);
    world.startMove(a, 'F', 30, 50);
    advance(world, tracker, 3);
    world.startMove(b, 'F', 30, 50);
    advance(world, tracker, 3);
    v = tracker.finish('finished');
    expect(v.pass).toBe(false);
    expect(v.text).toMatch(/^Fail — fell out of step/);
  });

  it('follow passes when B ends close behind A facing the same way, and fails when B stays put', () => {
    let world = worldOn(getFloor('follow-leader'));
    let [a, b] = world.robots;
    let tracker = createGoalTracker(world);
    world.startMove(a, 'F', 40, 50);
    advance(world, tracker, 4);
    world.startMove(b, 'F', 40, 50);
    advance(world, tracker, 4);
    let v = tracker.finish('finished');
    expect(v.pass).toBe(true);
    expect(v.text).toMatch(/^Pass — B ended 30(\.\d)? cm behind A, facing the same way$/);
    world = worldOn(getFloor('follow-leader'));
    [a, b] = world.robots;
    tracker = createGoalTracker(world);
    world.startMove(a, 'F', 60, 50);
    advance(world, tracker, 6);
    v = tracker.finish('finished');
    expect(v.text).toMatch(/^Fail — B ended 90(\.\d)? cm from A, not within 30 cm$/);
  });

  it('a goal that names Finch B judges B and says so in its label', () => {
    const floor = { ...getFloor('duet'), goals: [{ type: 'returnToStart', tolerance: 7, robot: 'B' }, { type: 'returnToStart', tolerance: 7 }] };
    const world = worldOn(floor);
    const tracker = createGoalTracker(world);
    world.startMove(world.robots[0], 'F', 30, 100);
    advance(world, tracker, 3);
    const v = tracker.finish('finished');
    expect(v.goals[0]).toMatchObject({ robot: 'B', pass: true, label: 'Finch B: End on the start mark (within 7 cm)' });
    expect(v.goals[1]).toMatchObject({ robot: 'A', pass: false });
    expect(v.goals[1].label).toMatch(/^Finch A: /);
    expect(v.text).toMatch(/^Fail — ended 30(\.\d)? cm from the start mark$/);
  });
});
