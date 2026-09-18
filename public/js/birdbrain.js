// The emulated BirdBrain library as Skulpt modules (d-5).
// `from BirdBrain import Finch` and `from time import sleep` resolve to the JS module builders
// below; every blocking call returns a Skulpt suspension around a World promise so the runner can
// pause, resume, speed up, and stop the program (see runner.js).

const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * Register the BirdBrain and time modules with Skulpt. `bridge` is
 * { world, getRobot(name) -> Robot, note(msg) } and is read at import time of each run.
 */
export function installBirdBrain(bridge) {
  window.__finchBridge = bridge;
  const Sk = window.Sk;
  Sk.builtinFiles.files['src/lib/BirdBrain.js'] =
    'var $builtinmodule = function (name) { return window.__finchBridge.buildBirdBrain(name); };';
  Sk.builtinFiles.files['src/lib/time.js'] =
    'var $builtinmodule = function (name) { return window.__finchBridge.buildTime(name); };';
  bridge.buildBirdBrain = () => buildBirdBrainModule(bridge);
  bridge.buildTime = () => buildTimeModule(bridge);
}

// ---- argument helpers ------------------------------------------------------------------------

function typeName(v) {
  const Sk = window.Sk;
  try {
    return Sk.abstr.typeName(v);
  } catch {
    return typeof v;
  }
}

function num(v, what) {
  const Sk = window.Sk;
  const ok = Sk.builtin.checkNumber ? Sk.builtin.checkNumber(v) : typeof Sk.ffi.remapToJs(v) === 'number';
  if (!ok) throw new Sk.builtin.TypeError(`${what} must be a number, not ${typeName(v)}`);
  const n = Number(Sk.ffi.remapToJs(v));
  if (Number.isNaN(n)) throw new Sk.builtin.ValueError(`${what} must be a number`);
  return n;
}

function str(v, what) {
  const Sk = window.Sk;
  if (!Sk.builtin.checkString(v)) throw new Sk.builtin.TypeError(`${what} must be a string, not ${typeName(v)}`);
  return v.v;
}

function side(v, what = 'side') {
  const Sk = window.Sk;
  const s = str(v, what).trim().toUpperCase();
  if (s === 'L' || s === 'LEFT') return 'L';
  if (s === 'R' || s === 'RIGHT') return 'R';
  throw new Sk.builtin.ValueError(`${what} must be 'L' or 'R', not '${v.v}'`);
}

const py = {
  none: () => window.Sk.builtin.none.none$,
  float: (x) => new window.Sk.builtin.float_(x),
  int: (x) => new window.Sk.builtin.int_(Math.round(x)),
  bool: (b) => (b ? window.Sk.builtin.bool.true$ : window.Sk.builtin.bool.false$),
  str: (s) => new window.Sk.builtin.str(s),
  list: (a) => window.Sk.ffi.remapToPy(a),
};

const block = (promise) => window.Sk.misceval.promiseToSuspension(promise);

// ---- BirdBrain ------------------------------------------------------------------------------

export function buildBirdBrainModule(bridge) {
  const Sk = window.Sk;
  const mod = {};
  const world = bridge.world;

  function finchClass($gbl, $loc) {
    $loc.__init__ = new Sk.builtin.func(function (self, device) {
      Sk.builtin.pyCheckArgsLen('Finch', arguments.length - 1, 0, 1);
      let name = 'A';
      if (device !== undefined && device !== Sk.builtin.none.none$) name = str(device, 'device').trim().toUpperCase();
      // Finch() is A; Finch('B') is the second robot of a two-robot floor (Milestone 6, d-24). The
      // sandbox holds at most two, so 'C' and beyond stay an error (a non-goal of the spec).
      if (name !== 'A' && name !== 'B') {
        throw new Sk.builtin.ValueError(
          `Finch('${name}') is not available: the sandbox holds at most two Finches, 'A' and 'B'. Use Finch() or Finch('A') for the first and Finch('B') for the second.`,
        );
      }
      const robot = bridge.getRobot(name);
      if (!robot) {
        throw new Sk.builtin.ValueError(
          "No second Finch on this floor: Finch('B') needs a floor with a second start mark. Pick a two-robot floor (Lesson 14) or add one in the floor editor with the Start B tool.",
        );
      }
      self.$robot = robot;
      return py.none();
    });

    const method = (name, min, max, fn) => {
      $loc[name] = new Sk.builtin.func(function (self, ...args) {
        Sk.builtin.pyCheckArgsLen(name, arguments.length - 1, min, max);
        if (!self.$robot) throw new Sk.builtin.RuntimeError('Finch is not connected');
        return fn(self.$robot, ...args);
      });
    };

    // -- movement --
    method('setMove', 3, 3, (robot, direction, distance, speed) => {
      const d = str(direction, 'direction').trim().toUpperCase();
      if (d !== 'F' && d !== 'B' && d !== 'FORWARD' && d !== 'BACKWARD') {
        throw new Sk.builtin.ValueError(`direction must be 'F' or 'B', not '${direction.v}'`);
      }
      const dist = num(distance, 'distance');
      const spd = num(speed, 'speed');
      return block(world.startMove(robot, d[0], dist, spd));
    });
    method('setTurn', 3, 3, (robot, direction, angle, speed) => {
      const d = str(direction, 'direction').trim().toUpperCase();
      if (d !== 'R' && d !== 'L' && d !== 'RIGHT' && d !== 'LEFT') {
        throw new Sk.builtin.ValueError(`direction must be 'R' or 'L', not '${direction.v}'`);
      }
      const ang = num(angle, 'angle');
      const spd = num(speed, 'speed');
      return block(world.startTurn(robot, d[0], ang, spd));
    });
    method('setMotors', 2, 2, (robot, left, right) => {
      robot.setMotors(num(left, 'leftSpeed'), num(right, 'rightSpeed'));
      return py.none();
    });
    method('stop', 0, 0, (robot) => {
      robot.stop();
      return py.none();
    });

    // -- lights and display --
    method('setBeak', 3, 3, (robot, r, g, b) => {
      robot.setBeak(num(r, 'red'), num(g, 'green'), num(b, 'blue'));
      return py.none();
    });
    method('setTail', 4, 4, (robot, port, r, g, b) => {
      let p;
      if (Sk.builtin.checkString(port)) {
        if (port.v.trim().toLowerCase() !== 'all') throw new Sk.builtin.ValueError(`port must be 1-4 or "all", not '${port.v}'`);
        p = 'all';
      } else {
        p = Math.round(num(port, 'port'));
        if (p < 1 || p > 4) throw new Sk.builtin.ValueError(`port must be 1-4 or "all", not ${p}`);
      }
      robot.setTail(p, num(r, 'red'), num(g, 'green'), num(b, 'blue'));
      return py.none();
    });
    method('setDisplay', 1, 1, (robot, values) => {
      const list = Sk.ffi.remapToJs(values);
      if (!Array.isArray(list) || list.length !== 25) {
        throw new Sk.builtin.ValueError('setDisplay needs a list of exactly 25 values (0 or 1)');
      }
      robot.setDisplay(list.map((v) => (Number(v) ? 1 : 0)));
      return py.none();
    });
    method('setPoint', 3, 3, (robot, row, col, value) => {
      const r = Math.round(num(row, 'row'));
      const c = Math.round(num(col, 'column'));
      if (r < 1 || r > 5 || c < 1 || c > 5) throw new Sk.builtin.ValueError('row and column must be 1-5');
      robot.setPoint(r, c, num(value, 'value') ? 1 : 0);
      return py.none();
    });
    method('print', 1, 1, (robot, message) => {
      const text = Sk.builtin.checkString(message) ? message.v : String(Sk.ffi.remapToJs(message));
      robot.startScroll(text, world.time);
      bridge.note(`display scrolls "${text.slice(0, 15)}"`);
      return py.none();
    });
    method('stopAll', 0, 0, (robot) => {
      robot.turnOffAll();
      return py.none();
    });

    // -- sound --
    method('playNote', 2, 2, (robot, note, beats) => {
      const n = Math.round(num(note, 'note'));
      const b = num(beats, 'beats');
      if (n < 32 || n > 135) throw new Sk.builtin.ValueError('note must be a MIDI number from 32 to 135');
      if (b < 0 || b > 16) throw new Sk.builtin.ValueError('beats must be from 0 to 16');
      bridge.note(`buzzer plays note ${n} (${midiToFreq(n).toFixed(0)} Hz) for ${b} beat${b === 1 ? '' : 's'}`);
      return block(world.playNote(robot, n, b));
    });

    // -- sensors --
    method('getDistance', 0, 0, (robot) => py.int(world.distance(robot)));
    method('getLight', 1, 1, (robot, s) => py.int(world.light(robot, side(s))));
    method('getLine', 1, 1, (robot, s) => py.int(world.line(robot, side(s))));
    method('resetEncoders', 0, 0, (robot) => {
      robot.resetEncoders();
      return py.none();
    });
    method('getEncoder', 1, 1, (robot, s) => py.float(Math.round(robot.encoder(side(s) === 'L' ? 'left' : 'right') * 1000) / 1000));
    method('getButton', 1, 1, (robot, which) => {
      const w = str(which, 'button').trim().toUpperCase();
      const key = w === 'A' ? 'A' : w === 'B' ? 'B' : w === 'LOGO' ? 'Logo' : null;
      if (!key) throw new Sk.builtin.ValueError(`button must be 'A', 'B' or 'Logo', not '${which.v}'`);
      return py.bool(robot.input.buttons[key]);
    });
    method('isShaking', 0, 0, (robot) => py.bool(world.isShaking(robot)));
    method('getOrientation', 0, 0, (robot) => py.str(world.orientation(robot)));
    method('getAcceleration', 0, 0, (robot) => py.list(world.acceleration(robot)));
    method('getCompass', 0, 0, (robot) => py.int(world.compass(robot)));
    method('getMagnetometer', 0, 0, (robot) => py.list(world.magnetometer(robot)));
    method('getSound', 0, 0, (robot) => py.int(world.sensors(robot).sound));
    method('getTemperature', 0, 0, (robot) => py.int(world.sensors(robot).temperature));
    method('getVersion', 0, 0, () => py.str('Finch Sandbox emulator'));

    // -- sandbox-only pen (Milestone 3, d-15) --
    // These do NOT exist on the real Finch (the lessons tape a marker to it). The editor flags
    // them so she removes them before downloading, and the panel documents them.
    method('penDown', 0, 0, (robot) => {
      world.setPen(robot, { down: true });
      return py.none();
    });
    method('penUp', 0, 0, (robot) => {
      world.setPen(robot, { down: false });
      return py.none();
    });
    method('setPenColor', 3, 3, (robot, r, g, b) => {
      const hex = (v) => Math.round(Math.min(100, Math.max(0, v)) * 2.55).toString(16).padStart(2, '0');
      world.setPen(robot, { color: `#${hex(num(r, 'red'))}${hex(num(g, 'green'))}${hex(num(b, 'blue'))}` });
      return py.none();
    });
  }

  mod.Finch = Sk.misceval.buildClass(mod, finchClass, 'Finch', []);
  mod.__name__ = new Sk.builtin.str('BirdBrain');
  return mod;
}

// ---- time -----------------------------------------------------------------------------------

export function buildTimeModule(bridge) {
  const Sk = window.Sk;
  const mod = {};
  const world = bridge.world;
  mod.sleep = new Sk.builtin.func(function (secs) {
    Sk.builtin.pyCheckArgsLen('sleep', arguments.length, 1, 1);
    const s = num(secs, 'seconds');
    if (s < 0) throw new Sk.builtin.ValueError('sleep length must be non-negative');
    return block(world.sleep(s));
  });
  const now = new Sk.builtin.func(function () {
    return py.float(world.time);
  });
  mod.time = now;
  mod.perf_counter = now;
  mod.monotonic = now;
  mod.__name__ = new Sk.builtin.str('time');
  return mod;
}
