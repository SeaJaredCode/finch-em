// The debugger box under the editor (Milestone 5, d-23): the Variables of the frame she is parked
// in, the call stack (every frame expandable to its own variables), and the watch box. Values are
// Skulpt objects straight from the runner's halt frames; lists and dictionaries expand in place.
//
//   const panel = createDebugPanel(root, { evalWatch });
//   panel.showHalt(halt | null) / panel.showFinal(frames, status) / panel.showRunning(line?, fresh?) / panel.clear()
//   panel.showPaused(frames)    — she pressed Pause: the variables as they are right now
//   panel.refreshWatch(force)   — main.js calls it every animation frame (throttled inside)

const MAX_ITEMS = 100; // entries shown per list / dictionary
const MAX_DEPTH = 4;
const WATCH_EVERY_MS = 150;

export function createDebugPanel(root, { evalWatch }) {
  const statusEl = root.querySelector('#debug-status');
  const varsEl = root.querySelector('#debug-vars');
  const stackEl = root.querySelector('#debug-stack');
  const watchInput = root.querySelector('#watch-expr');
  const watchValue = root.querySelector('#watch-value');
  let lastWatchAt = 0;

  const Sk = () => window.Sk;

  function isHidden(v) {
    const S = Sk();
    if (!S) return false;
    if (typeof v === 'function') return true; // a class
    if (v instanceof S.builtin.func || v instanceof S.builtin.module) return true;
    if (S.builtin.checkClass && S.builtin.checkClass(v)) return true;
    return false;
  }

  function repr(v) {
    try {
      return Sk().builtin.repr(v).v;
    } catch {
      return String(v);
    }
  }

  function short(text, n = 70) {
    return text.length > n ? text.slice(0, n - 1) + '…' : text;
  }

  function typeName(v) {
    try {
      return Sk().abstr.typeName(v);
    } catch {
      return typeof v;
    }
  }

  /** A DOM node for a value: a plain span, or a <details> for lists and dictionaries. */
  function renderValue(v, depth = 0) {
    const S = Sk();
    if (v && v.$robot) {
      const span = document.createElement('span');
      span.className = 'debug-value';
      span.textContent = `the Finch (robot ${v.$robot.name})`;
      return span;
    }
    const isList = S && (v instanceof S.builtin.list || v instanceof S.builtin.tuple);
    const isDict = S && v instanceof S.builtin.dict;
    if ((isList || isDict) && depth < MAX_DEPTH) {
      const entries = [];
      if (isList) {
        (v.v || []).forEach((item, i) => entries.push([String(i), item]));
      } else {
        try {
          const it = S.abstr.iter(v);
          for (let k = S.abstr.iternext(it); k !== undefined; k = S.abstr.iternext(it)) entries.push([repr(k), v.mp$subscript(k)]);
        } catch {
          /* an unusual dict; the repr below still shows it */
        }
      }
      const details = document.createElement('details');
      details.className = 'debug-tree';
      const summary = document.createElement('summary');
      const kind = isDict ? 'dict' : v instanceof S.builtin.tuple ? 'tuple' : 'list';
      summary.textContent = `${kind} (${entries.length} ${isDict ? (entries.length === 1 ? 'key' : 'keys') : entries.length === 1 ? 'item' : 'items'})  ${short(repr(v))}`;
      details.appendChild(summary);
      const list = document.createElement('div');
      list.className = 'debug-children';
      entries.slice(0, MAX_ITEMS).forEach(([key, item]) => list.appendChild(renderVar(isDict ? key : `[${key}]`, item, depth + 1)));
      if (entries.length > MAX_ITEMS) {
        const more = document.createElement('div');
        more.className = 'muted';
        more.textContent = `… ${entries.length - MAX_ITEMS} more`;
        list.appendChild(more);
      }
      details.appendChild(list);
      return details;
    }
    const span = document.createElement('span');
    span.className = 'debug-value';
    span.textContent = short(repr(v), 200);
    if (S && !(v instanceof S.builtin.int_ || v instanceof S.builtin.float_ || v instanceof S.builtin.str || v instanceof S.builtin.bool || v === S.builtin.none.none$)) {
      span.title = typeName(v);
    }
    return span;
  }

  function renderVar(name, value, depth = 0) {
    const row = document.createElement('div');
    row.className = 'debug-var';
    const nameEl = document.createElement('span');
    nameEl.className = 'debug-name';
    nameEl.textContent = name;
    row.append(nameEl, renderValue(value, depth));
    return row;
  }

  function renderVars(container, vars, emptyText) {
    container.textContent = '';
    const shown = vars.filter((v) => !isHidden(v.value));
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'debug-empty muted';
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }
    for (const v of shown) container.appendChild(renderVar(v.name, v.value));
  }

  /** Variables of the innermost frame (plus the globals, folded, when she is inside a function). */
  function renderFrames(frames) {
    varsEl.textContent = '';
    stackEl.textContent = '';
    if (!frames || !frames.length) {
      renderVars(varsEl, [], 'No variables yet.');
      return;
    }
    const top = frames[frames.length - 1];
    const box = document.createElement('div');
    renderVars(box, top.vars, top.isModule ? 'No variables yet — the program has not assigned any.' : `No variables in ${top.name}() yet.`);
    varsEl.appendChild(box);
    if (!top.isModule) {
      const details = document.createElement('details');
      details.className = 'debug-tree';
      const summary = document.createElement('summary');
      summary.textContent = 'globals (outside the function)';
      details.appendChild(summary);
      const inner = document.createElement('div');
      inner.className = 'debug-children';
      renderVars(inner, frames[0].vars, 'none');
      details.appendChild(inner);
      varsEl.appendChild(details);
    }
    // The call stack, innermost first; every frame opens to its own variables.
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      const details = document.createElement('details');
      details.className = 'debug-frame' + (i === frames.length - 1 ? ' current' : '');
      const summary = document.createElement('summary');
      summary.textContent = `${f.isModule ? f.name : f.name + '()'}${f.line ? ` — line ${f.line}` : ''}`;
      details.appendChild(summary);
      const inner = document.createElement('div');
      inner.className = 'debug-children';
      renderVars(inner, f.vars, 'no variables');
      details.appendChild(inner);
      stackEl.appendChild(details);
    }
    if (frames.length === 1) {
      const note = document.createElement('div');
      note.className = 'debug-empty muted';
      note.textContent = 'Not inside a function.';
      stackEl.appendChild(note);
    }
  }

  function setStatus(text, kind = '') {
    statusEl.textContent = text;
    statusEl.className = 'debug-status ' + kind;
  }

  function showHalt(halt) {
    root.classList.toggle('halted', !!halt);
    if (!halt) return;
    renderFrames(halt.frames);
    setStatus(halt.reason === 'breakpoint' ? `Breakpoint — paused before line ${halt.line}` : `Paused before line ${halt.line}`, 'halt');
    refreshWatch(true);
  }

  /**
   * The program is running; with a line, that line is the one Step just released. `fresh` is a run
   * starting: the previous run's variables and call stack go, so the box never shows stale values.
   */
  function showRunning(line, fresh) {
    root.classList.remove('halted');
    if (fresh) renderFrames([]);
    setStatus(line ? `Running line ${line} — the next line lights up when it is done.` : 'Running — press Step or Pause to look at the variables.');
  }

  /** She pressed Pause (not a debugger halt): the variables right now, where the program is waiting. */
  function showPaused(frames) {
    root.classList.remove('halted');
    renderFrames(frames);
    const top = frames && frames.length ? frames[frames.length - 1] : null;
    const where = top && top.line ? ` during line ${top.line}` : '';
    setStatus(`Paused${where} — these are the variables right now. Step runs one line at a time; Resume carries on.`, 'halt');
    refreshWatch(true);
  }

  function showFinal(frames, status) {
    root.classList.remove('halted');
    renderFrames(frames);
    const text = {
      error: 'The program stopped with an error — these are the variables as they were.',
      stopped: 'Stopped — these are the variables as they were.',
    }[status] || 'The program finished — final values.';
    setStatus(text, status === 'error' ? 'bad' : '');
    refreshWatch(true);
  }

  function clear() {
    root.classList.remove('halted');
    renderFrames([]);
    setStatus('Press Step to run one line at a time, or click a line number to set a breakpoint and press Run.');
    watchValue.textContent = '';
    watchValue.className = 'debug-watch-value';
  }

  /** Re-evaluate the watch expression (throttled unless forced). */
  function refreshWatch(force) {
    const expr = watchInput.value.trim();
    if (!expr) {
      watchValue.textContent = '';
      watchValue.className = 'debug-watch-value';
      return;
    }
    const now = performance.now();
    if (!force && now - lastWatchAt < WATCH_EVERY_MS) return;
    lastWatchAt = now;
    const r = evalWatch(expr);
    watchValue.textContent = r ? r.text : '';
    watchValue.className = 'debug-watch-value' + (r && !r.ok ? ' bad' : '');
  }

  watchInput.addEventListener('input', () => refreshWatch(true));
  watchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      refreshWatch(true);
    }
  });

  clear();

  return {
    showHalt,
    showRunning,
    showPaused,
    showFinal,
    clear,
    refreshWatch,
    get watchExpression() {
      return watchInput.value;
    },
    set watchExpression(v) {
      watchInput.value = v;
      refreshWatch(true);
    },
  };
}
