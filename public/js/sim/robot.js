import { clamp, normDeg } from './geometry.js';
import { textToColumns, frameAt } from './font5x5.js';

// Physical constants of the emulated Finch 2.0, in centimetres (see d-7).
export const ROBOT = {
  track: 10, // distance between the wheels; the pose is the midpoint of the track
  wheelDiameter: 5,
  bodyRadius: 6.5, // collision circle around the pose
  width: 10,
  frontLength: 8, // body extends this far ahead of the pose ...
  rearLength: 5, // ... and this far behind
  beakTip: 10.5, // beak tip / distance sensor origin, ahead of the pose
  lineSensorForward: 3.5,
  lineSensorLateral: 0.9,
  lightSensorForward: 5,
  lightSensorLateral: 4,
  maxSpeed: 25, // cm/s at speed 100 (roughly the real robot's pace)
  scrollColumnSeconds: 0.12, // bird.print() scroll rate
};

export const WHEEL_CIRC = Math.PI * ROBOT.wheelDiameter; // 15.708 cm per rotation
export const MAX_TURN_RATE = ((2 * ROBOT.maxSpeed) / ROBOT.track) * (180 / Math.PI); // deg/s at speed 100

const OFF = () => ({ r: 0, g: 0, b: 0 });

/**
 * What the panel does to a robot (Milestone 6, d-24: one bag per robot, so Finch A can be tilted
 * while Finch B stays level): buttons held, orientation, a shake in progress, a hand in front of
 * the beak, and the sound and temperature sliders. Kept across Restart like the pen.
 */
export const newInput = () => ({
  buttons: { A: false, B: false, Logo: false },
  orientation: 'Level',
  shakeUntil: -1,
  hand: null, // cm, or null for no hand in front of the beak
  sound: 0,
  temperature: 22,
});

export class Robot {
  constructor(name = 'A') {
    this.name = name;
    this.x = 0;
    this.y = 0;
    this.heading = 0;
    // The sandbox pen (Milestone 3, d-15): a marker taped under the robot at its pose. Attached in
    // the panel or by penDown()/setPenColor(); deliberately NOT reset by resetState, so a pen
    // attached in the panel survives Restart (the ink does not — see World.resetRun).
    this.pen = { down: false, color: '#d62828', width: 0.7 };
    this.stroke = null; // the ink stroke being drawn while the pen is down (a World.ink entry)
    this.input = newInput(); // the panel's touch on this robot (d-24)
    this.trail = []; // [x, y] points driven this run; World.resetRun and setFloor clear it (d-24)
    this.resetState();
  }

  /** Everything except the pose: motors, encoders, lights, display, buzzer, pending move. */
  resetState() {
    this.motors = { left: 0, right: 0 };
    this.wheelDist = { left: 0, right: 0 }; // cm since resetEncoders, forward positive
    this.odometer = { left: 0, right: 0 }; // cm per wheel this run; resetEncoders() leaves it alone (d-15)
    this.beak = OFF();
    this.tail = [OFF(), OFF(), OFF(), OFF()];
    this.display = new Array(25).fill(0);
    this.scroll = null; // { columns, start } while bird.print() is scrolling
    this.pending = null; // current blocking move/turn
    this.buzzer = null; // { note, until }
    this.blocked = false;
  }

  placeAt(x, y, heading) {
    this.x = x;
    this.y = y;
    this.heading = normDeg(heading);
  }

  /** stopAll(): motors, beak, tail and display off. */
  turnOffAll() {
    this.motors = { left: 0, right: 0 };
    this.pending = null;
    this.beak = OFF();
    this.tail = [OFF(), OFF(), OFF(), OFF()];
    this.display = new Array(25).fill(0);
    this.scroll = null;
    this.buzzer = null;
  }

  setMotors(left, right) {
    this.pending = null;
    this.motors = { left: clamp(left, -100, 100), right: clamp(right, -100, 100) };
  }

  stop() {
    this.setMotors(0, 0);
  }

  motorsOn() {
    return this.motors.left !== 0 || this.motors.right !== 0;
  }

  encoder(side) {
    return this.wheelDist[side] / WHEEL_CIRC;
  }

  resetEncoders() {
    this.wheelDist = { left: 0, right: 0 };
  }

  setBeak(r, g, b) {
    this.beak = { r: clamp(r, 0, 100), g: clamp(g, 0, 100), b: clamp(b, 0, 100) };
  }

  setTail(port, r, g, b) {
    const c = { r: clamp(r, 0, 100), g: clamp(g, 0, 100), b: clamp(b, 0, 100) };
    if (port === 'all') this.tail = [c, { ...c }, { ...c }, { ...c }];
    else this.tail[port - 1] = c;
  }

  setDisplay(values) {
    this.scroll = null;
    this.display = values.map((v) => (v ? 1 : 0));
  }

  setPoint(row, col, value) {
    this.scroll = null;
    this.display[(row - 1) * 5 + (col - 1)] = value ? 1 : 0;
  }

  /** Start scrolling text across the display (non-blocking, like the real print). */
  startScroll(text, now) {
    this.scroll = { columns: textToColumns(String(text).slice(0, 15)), start: now, text: String(text).slice(0, 15) };
  }

  /** The 25 LEDs as currently lit at simulation time `now`. */
  displayFrame(now) {
    if (this.scroll) {
      const offset = Math.floor((now - this.scroll.start) / ROBOT.scrollColumnSeconds);
      if (offset >= this.scroll.columns.length) {
        this.scroll = null;
        this.display = new Array(25).fill(0);
        return this.display;
      }
      return frameAt(this.scroll.columns, offset);
    }
    return this.display;
  }
}
