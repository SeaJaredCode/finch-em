// Runs student Python on Skulpt (d-5). One runner per page.
//
//   const runner = createRunner({ world, out, onState, onHalt });
//   runner.run(code, { step }) / pause() / resume() / step() / stop()
//   runner.setBreakpoints(lines) / runner.halt / runner.evalWatch(expr) / runner.globalsFrame()
//   runner.currentFrames()  — where the program is waiting right now (for a user Pause)
//
// Every blocking Finch call is a "Sk.promise" suspension whose promise is resolved by the World
// from the simulation clock, so Pause (clock frozen) freezes robot and program together, and Stop
// rejects the pending suspension without resuming Python. Loops yield every `yieldLimit` ms so a
// `while True:` can be paused or stopped too.
//
// The debugger (Milestone 5, d-23) rides the same seam rather than a second execution path: the
// student's file is always compiled with Sk.debugging on, so every statement first asks
// Sk.breakpoints(file, line). That says yes while stepping or on a breakpoint line, which makes
// Skulpt yield a 'Sk.debug' suspension into the same '*' handler; the handler parks it — program
// and clock frozen before that line — until Step, Continue or Stop. The parked suspension chain is
// the call stack: each frame carries its line, its globals and (for functions) its locals.

export const MAIN_FILE = '<stdin>.py';

export class StopSignal extends Error {
  constructor() {
    super('stopped');
    this.isStop = true;
  }
}

/** Resolve on the next macrotask via MessageChannel (not subject to setTimeout throttling). */
export function nextMacrotask() {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

/** `def` lines of a program, for naming call-stack frames: [{ line, indent, name }]. */
export function findDefs(code) {
  const defs = [];
  String(code)
    .split('\n')
    .forEach((text, i) => {
      const m = /^(\s*)def\s+([A-Za-z_]\w*)\s*\(/.exec(text);
      if (m) defs.push({ line: i + 1, indent: m[1].length, name: m[2] });
    });
  return defs;
}

/** The name of the function whose body contains `line` (by indentation), or null at module level. */
export function enclosingDef(code, defs, line) {
  const text = String(code).split('\n')[line - 1] || '';
  const indent = /^(\s*)/.exec(text)[1].length;
  for (let i = defs.length - 1; i >= 0; i--) {
    const d = defs[i];
    if (d.line < line && d.indent < indent) return d.name;
  }
  return null;
}

export function createRunner({ world, out, onState, onHalt }) {
  const Sk = window.Sk;
  let state = 'idle'; // idle | running | paused | finished | error
  let stopped = false;
  let paused = false;
  let active = null; // promise of the current run
  let generation = 0;
  let runSeq = 0; // claimed by run() before it waits for the previous program to unwind
  let stepping = false; // halt before the next statement of the student's file
  let breakpoints = new Set(); // 1-based lines
  let halt = null; // { line, reason, frames, release(mode), reject(err) } while parked before a line
  let waiting = null; // the suspension the program is waiting at (a blocking call or a yield)
  let code = '';
  let defs = [];
  let watchCache = null; // { text, modscope } — the last compiled watch expression

  const setState = (s) => {
    state = s;
    onState && onState(s);
  };
  // onHalt(halt) when parked; onHalt(null, 'step' | 'continue' | 'stop') when the program moves on.
  const notifyHalt = (mode) => onHalt && onHalt(halt, mode);

  function waitWhilePaused() {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (stopped) return reject(new StopSignal());
        if (!paused) return resolve();
        setTimeout(check, 25);
      };
      check();
    });
  }

  /** Skulpt asks this before every statement of a debug-compiled file. */
  function shouldBreak(filename, line) {
    if (stopped || filename !== MAIN_FILE) return false;
    return stepping || breakpoints.has(line);
  }

  function suspensionHandler(susp) {
    if (stopped) return Promise.reject(new StopSignal());
    waiting = susp; // every suspension of her file carries its line, globals and locals
    if (susp.data.type === 'Sk.debug') {
      return park(susp).then(() => susp.resume());
    }
    if (susp.data.type === 'Sk.promise') {
      return susp.data.promise.then(
        (value) => {
          if (stopped) throw new StopSignal();
          susp.data.result = value;
          return susp.resume();
        },
        (err) => {
          if (stopped || (err && err.isStop)) throw new StopSignal();
          susp.data.error = err;
          return susp.resume();
        },
      );
    }
    // Sk.yield / Sk.delay: honour Pause, then continue on a fresh macrotask so the page can
    // render and handle events between slices of a busy loop.
    return waitWhilePaused()
      .then(nextMacrotask)
      .then(() => {
        if (stopped) throw new StopSignal();
        return susp.resume();
      });
  }

  /** Park a 'Sk.debug' suspension: the program waits before its line until Step / Continue / Stop. */
  function park(susp) {
    const frames = framesOf(susp);
    const line = frames.length ? frames[frames.length - 1].line : null;
    const reason = stepping ? 'step' : 'breakpoint';
    stepping = false;
    paused = true;
    return new Promise((resolve, reject) => {
      const h = { line, reason, frames, release: null, reject: null };
      h.release = (mode) => {
        if (halt !== h) return;
        stepping = mode === 'step';
        halt = null;
        paused = false;
        setState('running');
        notifyHalt(mode);
        resolve();
      };
      h.reject = (err) => {
        if (halt === h) halt = null;
        reject(err);
      };
      halt = h;
      setState('paused');
      notifyHalt();
    });
  }

  /** The suspension chain as frames, outermost first; the last frame is where the program is. */
  function framesOf(susp) {
    const frames = [];
    for (let s = susp; s; s = s.child) {
      if (s.$lineno === undefined || s.$filename !== MAIN_FILE) continue;
      const isModule = s.$loc === s.$gbl;
      frames.push({
        line: s.$lineno,
        isModule,
        name: isModule ? '<module>' : enclosingDef(code, defs, s.$lineno) || '<function>',
        vars: varsOf(isModule ? s.$gbl : s.$tmps),
        globals: s.$gbl,
      });
    }
    return frames;
  }

  /** Python names -> values from a Skulpt globals object or a frame's saved locals ($tmps). */
  function varsOf(obj) {
    const vars = [];
    for (const key of Object.keys(obj || {})) {
      if (key.startsWith('$') || key.startsWith('__')) continue;
      const value = obj[key];
      if (value === undefined) continue; // a local that has no value yet
      // `key` is Skulpt's mangled name (a reserved word gets _$rw$); `name` is what she wrote.
      vars.push({ name: key.replace(/_\$rw\$$/, ''), key, value });
    }
    return vars;
  }

  function describeError(err) {
    if (err instanceof Sk.builtin.BaseException) {
      const tb = err.traceback || [];
      const line = tb.length ? tb[0].lineno : null;
      let message = '';
      try {
        message = err.args && err.args.v && err.args.v.length ? String(Sk.ffi.remapToJs(err.args.v[0])) : '';
      } catch {
        message = '';
      }
      return { type: err.tp$name || 'Error', message, line };
    }
    return { type: 'Error', message: err && err.message ? err.message : String(err), line: null };
  }

  function configure() {
    Sk.configure({
      output: (text) => out.write(text),
      read: (name) => {
        if (Sk.builtinFiles === undefined || Sk.builtinFiles.files[name] === undefined) {
          throw "File not found: '" + name + "'";
        }
        return Sk.builtinFiles.files[name];
      },
      inputfun: (prompt) => out.prompt(prompt),
      inputfunTakesPrompt: true,
      __future__: Sk.python3,
      yieldLimit: 40,
      killableWhile: true,
      killableFor: true,
      execLimit: null,
      retainGlobals: false,
      debugging: true,
      breakpoints: shouldBreak,
    });
    Sk.execLimit = null;
  }

  /**
   * Run a program. { step: true } parks it before its first line (Step from idle). A run() made
   * while an earlier program is still unwinding waits for it; if yet another run() arrives in the
   * meantime, the earlier request gives way ({ status: 'stopped' }) so that two programs can never
   * share the robot.
   */
  async function run(source, opts = {}) {
    const seq = ++runSeq;
    await stop();
    if (seq !== runSeq) return { status: 'stopped' };
    const gen = ++generation;
    stopped = false;
    paused = false;
    halt = null;
    stepping = !!opts.step;
    waiting = null;
    code = String(source);
    defs = findDefs(code);
    watchCache = null;
    configure();
    Sk.lastYield = Date.now();
    Sk.execStart = Date.now();
    setState('running');
    active = Sk.misceval
      .asyncToPromise(() => Sk.importMainWithBody('<stdin>', false, code, true), { '*': suspensionHandler })
      .then(
        () => {
          if (gen !== generation) return { status: 'stopped' };
          setState('finished');
          return { status: 'finished' };
        },
        (err) => {
          if (gen !== generation || (err && err.isStop)) {
            if (gen === generation) setState('idle');
            return { status: 'stopped' };
          }
          const info = describeError(err);
          setState('error');
          return { status: 'error', error: info };
        },
      )
      .finally(() => {
        if (gen === generation) {
          active = null;
          paused = false;
          stepping = false;
          waiting = null;
        }
      });
    return active;
  }

  function pause() {
    if (state !== 'running') return;
    paused = true;
    setState('paused');
  }

  /** Resume after Pause, or Continue after a debugger halt (runs to the next breakpoint). */
  function resume() {
    if (halt) return halt.release('continue');
    if (state !== 'paused') return;
    paused = false;
    setState('running');
  }

  /**
   * One line: from a halt, run this line and park before the next; from Pause, finish the current
   * line and park; while running, park before the next statement. Returns false when there is no
   * program to step (the caller starts one with run(code, { step: true })).
   */
  function step() {
    if (halt) {
      halt.release('step');
      return true;
    }
    if (state === 'paused') {
      stepping = true;
      paused = false;
      setState('running');
      return true;
    }
    if (state === 'running') {
      stepping = true;
      return true;
    }
    return false;
  }

  function setBreakpoints(lines) {
    breakpoints = new Set((lines || []).map(Number));
  }

  /** Stop the current program; resolves once Skulpt has unwound. */
  async function stop() {
    if (!active) {
      stepping = false;
      if (state !== 'idle') setState('idle');
      return;
    }
    stopped = true;
    paused = false;
    stepping = false;
    if (halt) {
      const h = halt;
      halt = null;
      h.reject(new StopSignal());
      notifyHalt('stop');
    }
    world.rejectWaiters(new StopSignal());
    out.cancelPrompt && out.cancelPrompt();
    const p = active;
    generation++;
    try {
      await p;
    } catch {
      /* already reported */
    }
    // Only tidy up if no newer run() has taken over while we waited.
    if (active === p) {
      active = null;
      stopped = false;
      setState('idle');
    }
  }

  // ---- the watch box ------------------------------------------------------------------------

  function reprOf(v) {
    try {
      return Sk.builtin.repr(v).v;
    } catch {
      return String(v);
    }
  }

  /**
   * Evaluate a Python expression against the program's globals (plus the locals of the frame she
   * is parked in). The expression runs on a copy of the globals, so it cannot rename anything, and
   * it cannot block: a setMove there is reported, not performed.
   */
  function evalWatch(expr) {
    const text = String(expr || '').trim();
    if (!text) return null;
    const frames = halt ? halt.frames : [];
    const gbl = frames.length ? frames[0].globals : Sk.globals;
    if (!gbl) return { ok: false, text: 'run or step the program first' };
    const scope = Object.assign({}, gbl);
    if (frames.length && !frames[frames.length - 1].isModule) {
      for (const v of frames[frames.length - 1].vars) scope[v.key] = v.value;
    }
    try {
      if (!watchCache || watchCache.text !== text) {
        const co = Sk.compile('__watch__ = (' + text + '\n)', '<watch>.py', 'exec', false);
        watchCache = { text, modscope: new Function(co.code + '\nreturn ' + co.funcname + ';')() };
      }
      watchCache.modscope(scope);
      return { ok: true, text: reprOf(scope.__watch__) };
    } catch (err) {
      const info = describeError(err);
      if (/suspend|block/i.test(info.message) && !(err instanceof Sk.builtin.BaseException)) {
        return { ok: false, text: 'a watch expression cannot call something that waits (setMove, setTurn, playNote, sleep, input)' };
      }
      return { ok: false, text: `${info.type}: ${info.message}` };
    }
  }

  /** The module's variables right now (after a run has ended), as a one-frame stack. */
  function globalsFrame() {
    if (!Sk.globals) return [];
    return [{ line: null, isModule: true, name: '<module>', vars: varsOf(Sk.globals), globals: Sk.globals }];
  }

  /**
   * Where the program is right now: at a halt, the parked frames; while running or paused by the
   * user, the frames of the blocking call (or loop yield) it is waiting at — the line in progress,
   * the enclosing function and its locals; otherwise the module's variables.
   */
  function currentFrames() {
    if (halt) return halt.frames;
    const frames = active && waiting ? framesOf(waiting) : [];
    return frames.length ? frames : globalsFrame();
  }

  return {
    run,
    pause,
    resume,
    step,
    stop,
    setBreakpoints,
    evalWatch,
    globalsFrame,
    currentFrames,
    describeError,
    get state() {
      return state;
    },
    get paused() {
      return paused;
    },
    get busy() {
      return active !== null;
    },
    get halt() {
      return halt;
    },
    get stepping() {
      return stepping;
    },
  };
}
