import { Robot, ROBOT, MAX_TURN_RATE } from './robot.js';
import {
  DEG,
  clamp,
  normDeg,
  headingVec,
  localToWorld,
  dist,
  pointInRect,
  circleRectHit,
  rayRect,
  rayCircle,
  polylineDist,
  hexLuminance,
  jitter,
} from './geometry.js';

export const OUT_OF_RANGE_DISTANCE = 300; // what getDistance() reports beyond ~200 cm or under 2 cm
const NO_JITTER = () => 0; // stands in for jitter() when a caller asks for steady readings
const BACKGROUND_LINE = { white: 90, wood: 60, carpet: 45 };
const ORIENTATION_ACCEL = {
  Level: [0, 0, -9.8],
  'Beak up': [9.8, 0, 0],
  'Beak down': [-9.8, 0, 0],
  'Tilt left': [0, 9.8, 0],
  'Tilt right': [0, -9.8, 0],
  'Upside down': [0, 0, 9.8],
  'In between': [5, 5, -6.9],
};

/**
 * The simulated floor with its robot(s). Time is simulation time in seconds; main.js advances it
 * with tick(dt), scaled by the Speed control and frozen while paused. Blocking Finch calls become
 * waiters that resolve from tick(), which is what makes Pause freeze a move in progress (d-5).
 *
 * Two Finches (Milestone 6, d-24): a floor whose startB is set holds a second robot, 'B', kept in
 * robots[1]; syncRobots() adds or drops it whenever the floor (or its startB) changes. Every robot
 * carries its own panel input, trail and pen; world.input and world.trail are robot A's, for the
 * single-robot callers and replay scenes that predate the second Finch. Robots block each other
 * (collides) and see each other with the distance sensor (distance).
 */
export class World {
  constructor() {
    this.floor = null;
    this.robots = [new Robot('A')];
    this.spareB = null; // robot B between two-robot floors, so its pen and panel state survive a floor change
    this.time = 0;
    this.ink = []; // pen strokes drawn this run: [{ color, width, robot, points: [[x, y, t], ...] }] (d-15)
    this.waiters = [];
    this.onBump = null; // callback(robot) when a blocking move is cut short by a wall
  }

  /** Robot A's panel input (buttons, orientation, hand, ...); each robot has its own (d-24). */
  get input() {
    return this.robots[0].input;
  }

  /** Robot A's trail this run; each robot has its own (d-24). */
  get trail() {
    return this.robots[0].trail;
  }

  robot(name = 'A') {
    return this.robots.find((r) => r.name === name) || null;
  }

  /** True while the floor holds a second Finch. */
  get twoRobots() {
    return this.robots.length > 1;
  }

  setFloor(floor) {
    this.floor = floor;
    this.syncRobots();
    this.clearInk();
    for (const robot of this.robots) {
      robot.trail = [];
      this.placeAtStart(robot);
    }
  }

  /**
   * Add or drop robot B so the robots match the floor's start marks: a floor with startB has two.
   * Called by setFloor and resetRun, and by the page when the floor editor sets or removes startB.
   */
  syncRobots() {
    const wantB = !!(this.floor && this.floor.startB);
    const hasB = this.robots.length > 1;
    if (wantB && !hasB) {
      const b = this.spareB || new Robot('B');
      this.spareB = null;
      b.resetState();
      b.trail = [];
      this.robots.push(b);
      this.placeAtStart(b);
    } else if (!wantB && hasB) {
      const b = this.robots.pop();
      b.turnOffAll();
      b.stroke = null;
      this.spareB = b;
    }
    return this.robots;
  }

  /** The start mark a robot belongs on: floor.start for A, floor.startB for B. */
  startOf(robot) {
    const f = this.floor;
    if (!f) return { x: 0, y: 0, heading: 0 };
    if (robot.name === 'B' && f.startB) return f.startB;
    return f.start || { x: f.width / 2, y: f.height / 2, heading: 0 };
  }

  placeAtStart(robot) {
    const start = this.startOf(robot);
    robot.placeAt(start.x, start.y, start.heading);
    robot.blocked = false;
  }

  /** Restart: robots back on their start marks, everything off, encoders, trails and ink cleared, clock at 0. */
  resetRun() {
    this.syncRobots();
    for (const robot of this.robots) {
      robot.resetState();
      robot.trail = [];
      robot.input.shakeUntil = -1;
      this.placeAtStart(robot);
    }
    this.clearInk();
    this.time = 0;
  }

  // ---- blocking calls -------------------------------------------------------------------

  wait(test, onDone) {
    return new Promise((resolve, reject) => {
      this.waiters.push({ test, resolve: () => resolve(onDone ? onDone() : undefined), reject });
    });
  }

  rejectWaiters(err) {
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) w.reject(err);
  }

  sleep(seconds) {
    const until = this.time + Math.max(0, seconds);
    return this.wait(() => this.time >= until);
  }

  startMove(robot, direction, distanceCm, speed) {
    const p = {
      kind: 'move',
      remaining: Math.abs(distanceCm),
      speed: (clamp(speed, 0, 100) / 100) * ROBOT.maxSpeed,
      sign: direction === 'B' ? -1 : 1,
      bumped: false,
    };
    robot.motors = { left: 0, right: 0 };
    robot.pending = p;
    if (p.speed === 0 || p.remaining === 0) {
      robot.pending = null;
      return Promise.resolve();
    }
    return this.wait(
      () => robot.pending !== p || p.remaining <= 1e-9,
      () => {
        if (robot.pending === p) robot.pending = null;
      },
    );
  }

  startTurn(robot, direction, angleDeg, speed) {
    const p = {
      kind: 'turn',
      remaining: Math.abs(angleDeg),
      angSpeed: (clamp(speed, 0, 100) / 100) * MAX_TURN_RATE,
      sign: direction === 'L' ? -1 : 1,
    };
    robot.motors = { left: 0, right: 0 };
    robot.pending = p;
    if (p.angSpeed === 0 || p.remaining === 0) {
      robot.pending = null;
      return Promise.resolve();
    }
    return this.wait(
      () => robot.pending !== p || p.remaining <= 1e-9,
      () => {
        if (robot.pending === p) robot.pending = null;
      },
    );
  }

  playNote(robot, note, beats) {
    const until = this.time + beats;
    const tone = { note, until };
    robot.buzzer = tone;
    return this.wait(
      () => this.time >= until || robot.buzzer !== tone,
      () => {
        if (robot.buzzer === tone) robot.buzzer = null;
      },
    );
  }

  // ---- stepping -------------------------------------------------------------------------

  tick(dt) {
    this.time += dt;
    for (const robot of this.robots) this.stepRobot(robot, dt);
    for (const robot of this.robots) {
      if (robot.buzzer && this.time >= robot.buzzer.until) robot.buzzer = null;
    }
    if (this.waiters.length) {
      const still = [];
      for (const w of this.waiters) {
        if (w.test()) w.resolve();
        else still.push(w);
      }
      this.waiters = still;
    }
  }

  stepRobot(robot, dt) {
    let dl = 0;
    let dr = 0;
    const p = robot.pending;
    if (p) {
      if (p.kind === 'move') {
        const step = Math.min(p.remaining, p.speed * dt);
        dl = dr = p.sign * step;
        p.remaining -= step;
      } else {
        const ang = Math.min(p.remaining, p.angSpeed * dt);
        const arc = ((ang * DEG) * ROBOT.track) / 2;
        dl = p.sign * arc;
        dr = -p.sign * arc;
        p.remaining -= ang;
      }
    } else {
      dl = (robot.motors.left / 100) * ROBOT.maxSpeed * dt;
      dr = (robot.motors.right / 100) * ROBOT.maxSpeed * dt;
    }
    if (dl === 0 && dr === 0) {
      robot.blocked = false;
      return;
    }
    const advance = (dl + dr) / 2;
    const dTheta = (dl - dr) / ROBOT.track; // radians, clockwise positive
    const newHeading = robot.heading + dTheta / DEG;
    const mid = headingVec(robot.heading + dTheta / 2 / DEG);
    const nx = robot.x + advance * mid.x;
    const ny = robot.y + advance * mid.y;
    if (Math.abs(advance) > 1e-9 && this.collides(robot, nx, ny)) {
      // Walls, the floor edge and the other Finch stop the robot; encoders stop counting.
      robot.blocked = true;
      if (p) {
        p.remaining = 0;
        p.bumped = true;
        if (this.onBump) this.onBump(robot);
      }
      return;
    }
    robot.blocked = false;
    robot.x = nx;
    robot.y = ny;
    robot.heading = normDeg(newHeading);
    robot.wheelDist.left += dl;
    robot.wheelDist.right += dr;
    // The run's per-wheel distance is distance travelled, whichever way the wheel turned (d-15); the
    // encoders above stay signed, as on the real Finch.
    robot.odometer.left += Math.abs(dl);
    robot.odometer.right += Math.abs(dr);
    if (Math.abs(advance) > 1e-9) {
      const trail = robot.trail;
      const last = trail[trail.length - 1];
      if (!last || dist(last[0], last[1], nx, ny) > 0.4) trail.push([nx, ny]);
      if (robot.pen.down) this.inkPoint(robot);
    }
  }

  // ---- pen (Milestone 3, d-15) ----------------------------------------------------------

  /** Attach, lift or recolour the pen; a new stroke starts whenever it touches down or changes. */
  setPen(robot, { down, color, width } = {}) {
    const pen = robot.pen;
    const wasDown = pen.down;
    if (color !== undefined) pen.color = color;
    if (width !== undefined) pen.width = width;
    if (down !== undefined) pen.down = !!down;
    if (!pen.down) robot.stroke = null;
    else if (!wasDown || color !== undefined || width !== undefined) {
      robot.stroke = null;
      this.inkPoint(robot);
    }
  }

  /** Add the pen's position (the robot's pose) to the stroke in progress, starting one if needed. */
  inkPoint(robot) {
    if (!robot.pen.down) return;
    let s = robot.stroke;
    if (!s) {
      s = { color: robot.pen.color, width: robot.pen.width, robot: robot.name, points: [] };
      robot.stroke = s;
      this.ink.push(s);
    }
    const last = s.points[s.points.length - 1];
    if (!last || dist(last[0], last[1], robot.x, robot.y) > 0.25) {
      s.points.push([r2(robot.x), r2(robot.y), r2(this.time)]);
    }
  }

  clearInk() {
    this.ink = [];
    for (const robot of this.robots) robot.stroke = null;
  }

  collides(robot, x, y) {
    const r = ROBOT.bodyRadius;
    const f = this.floor;
    if (!f) return false;
    if (x - r < 0 || x + r > f.width || y - r < 0 || y + r > f.height) return true;
    for (const wall of f.walls || []) if (circleRectHit(x, y, r, wall)) return true;
    // The other Finch is an obstacle too (d-24): the robots cannot overlap. One that somehow already
    // overlaps the other (both start marks on one spot) may still move apart.
    for (const other of this.robots) {
      if (other === robot) continue;
      const d = dist(x, y, other.x, other.y);
      if (d < 2 * r && d < dist(robot.x, robot.y, other.x, other.y)) return true;
    }
    return false;
  }

  /** Clamp a pose inside the floor (used when the robot is dragged). */
  clampInside(x, y) {
    const f = this.floor;
    const r = ROBOT.bodyRadius;
    if (!f) return { x, y };
    return { x: clamp(x, r, f.width - r), y: clamp(y, r, f.height - r) };
  }

  // ---- sensors --------------------------------------------------------------------------
  // Every reading carries a little random jitter, like the real Finch's sensors, so a student's
  // `while bird.getDistance() > 30` sees the flicker the hardware would give. Each method takes an
  // optional { noise: false } that drops the jitter: the sensor panel uses it for its "Steady
  // readouts" toggle, which only calms the display — bird.getX() calls in a program keep the noise.

  distance(robot, { noise = true } = {}) {
    const j = noise ? jitter : NO_JITTER;
    const hand = robot.input.hand;
    if (hand !== null && hand !== undefined) {
      return hand < 2 || hand > 200 ? OUT_OF_RANGE_DISTANCE : Math.round(hand + j(0.6));
    }
    const origin = localToWorld(robot, ROBOT.beakTip, 0);
    const dir = headingVec(robot.heading);
    let best = Infinity;
    for (const wall of this.floor?.walls || []) {
      const t = rayRect(origin.x, origin.y, dir.x, dir.y, wall);
      if (t < best) best = t;
    }
    // ... and the other Finch, seen as its body circle (d-24)
    for (const other of this.robots) {
      if (other === robot) continue;
      const t = rayCircle(origin.x, origin.y, dir.x, dir.y, other.x, other.y, ROBOT.bodyRadius);
      if (t < best) best = t;
    }
    if (best < 2 || best > 200) return OUT_OF_RANGE_DISTANCE;
    return Math.max(2, Math.round(best + j(0.6)));
  }

  light(robot, side, { noise = true } = {}) {
    const j = noise ? jitter : NO_JITTER;
    const lateral = side === 'L' ? -ROBOT.lightSensorLateral : ROBOT.lightSensorLateral;
    const p = localToWorld(robot, ROBOT.lightSensorForward, lateral);
    const outward = headingVec(robot.heading + (side === 'L' ? -40 : 40));
    const f = this.floor;
    const inDark = (f?.darkAreas || []).some((a) => pointInRect(p.x, p.y, a));
    let value = inDark ? 3 : 20;
    for (const light of f?.lights || []) {
      const d = dist(p.x, p.y, light.x, light.y);
      const reach = light.reach || 80;
      if (d >= reach) continue;
      const falloff = 1 - d / reach;
      const tx = (light.x - p.x) / (d || 1);
      const ty = (light.y - p.y) / (d || 1);
      const facing = 0.55 + 0.45 * Math.max(0, tx * outward.x + ty * outward.y);
      value += (light.brightness || 100) * falloff * falloff * facing * (inDark ? 0.4 : 1);
    }
    return Math.round(clamp(value + j(1.5), 0, 100));
  }

  line(robot, side, { noise = true } = {}) {
    const j = noise ? jitter : NO_JITTER;
    const lateral = side === 'L' ? -ROBOT.lineSensorLateral : ROBOT.lineSensorLateral;
    const p = localToWorld(robot, ROBOT.lineSensorForward, lateral);
    const f = this.floor;
    let value = BACKGROUND_LINE[f?.background] ?? 90;
    for (const tape of f?.tape || []) {
      if (polylineDist(p.x, p.y, tape.points) <= (tape.width || 2.5) / 2) {
        value = tape.reading ?? tapeReading(tape.color);
        break;
      }
    }
    return Math.round(clamp(value + j(2), 0, 100));
  }

  orientation(robot) {
    const slope = (this.floor?.slopes || []).find((s) => pointInRect(robot.x, robot.y, s));
    if (slope) {
      const rel = normDeg(robot.heading - (slope.uphill ?? 0));
      if (rel < 45 || rel > 315) return 'Beak up';
      if (rel > 135 && rel < 225) return 'Beak down';
      return rel < 180 ? 'Tilt left' : 'Tilt right';
    }
    return robot.input.orientation;
  }

  isShaking(robot = this.robots[0]) {
    return robot.input.shakeUntil > this.time;
  }

  acceleration(robot, { noise = true } = {}) {
    const base = ORIENTATION_ACCEL[this.orientation(robot)] || ORIENTATION_ACCEL.Level;
    // A shake is the robot really being rattled, not sensor noise, so it shows even in steady mode.
    const wobble = this.isShaking(robot) ? jitter : noise ? jitter : NO_JITTER;
    const amount = this.isShaking(robot) ? 14 : 0.15;
    return base.map((v) => Math.round((v + wobble(amount)) * 100) / 100);
  }

  compass(robot, { noise = true } = {}) {
    const j = noise ? jitter : NO_JITTER;
    return Math.round(normDeg(robot.heading + j(0.4))) % 360;
  }

  magnetometer(robot, { noise = true } = {}) {
    const j = noise ? jitter : NO_JITTER;
    const r = robot.heading * DEG;
    return [Math.round(45 * Math.cos(r) + j(1)), Math.round(-45 * Math.sin(r) + j(1)), -30 + Math.round(j(1))];
  }

  /**
   * Everything the sensor panel shows for one robot, in one snapshot. { noise: false } gives the
   * steady readings (the panel's "Steady readouts" toggle); programs always read with noise.
   */
  sensors(robot, opts = {}) {
    const j = opts.noise === false ? NO_JITTER : jitter;
    return {
      distance: this.distance(robot, opts),
      lightL: this.light(robot, 'L', opts),
      lightR: this.light(robot, 'R', opts),
      lineL: this.line(robot, 'L', opts),
      lineR: this.line(robot, 'R', opts),
      encoderL: robot.encoder('left'),
      encoderR: robot.encoder('right'),
      compass: this.compass(robot, opts),
      orientation: this.orientation(robot),
      acceleration: this.acceleration(robot, opts),
      shaking: this.isShaking(robot),
      buttons: { ...robot.input.buttons },
      sound: Math.round(clamp(robot.input.sound + j(1), 0, 100)),
      temperature: Math.round(robot.input.temperature + j(0.3)),
    };
  }
}

const r2 = (v) => Math.round(v * 100) / 100;

function tapeReading(color) {
  const lum = hexLuminance(color);
  if (lum < 0.12) return 10;
  return Math.round(28 + 55 * lum);
}
