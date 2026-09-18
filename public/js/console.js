// The console pane: print() output, notes (buzzer, display), errors, and the input() prompt.
// Every line is also kept in `log` so a run can record it (Milestone 3, d-15); during a replay
// showEntries() renders a run's recorded lines instead, and restore() brings the live lines back.

export function createConsole(root, { getTime }) {
  const lines = root.querySelector('.console-lines');
  const promptBox = root.querySelector('.console-prompt');
  const promptLabel = promptBox.querySelector('label');
  const promptInput = promptBox.querySelector('input');
  const promptButton = promptBox.querySelector('button');
  const LOG_MAX = 2000;
  let log = []; // { t, kind, text } for every line written this session (cleared with the pane)
  let partial = null; // current unfinished output line element
  let partialEntry = null; // ... and its log entry
  let pending = null; // { resolve, reject } for input()
  let showing = false; // true while a replay's recorded lines are on screen

  const round2 = (v) => Math.round(v * 100) / 100;

  /** Append a line element (DOM only). */
  function appendLine(kind, text, t) {
    const el = document.createElement('div');
    el.className = 'console-line ' + kind;
    const stamp = document.createElement('span');
    stamp.className = 'console-time';
    stamp.textContent = `[${Number(t).toFixed(2)}s]`;
    const body = document.createElement('span');
    body.className = 'console-text';
    body.textContent = text;
    el.append(stamp, body);
    lines.appendChild(el);
    if (lines.childElementCount > LOG_MAX) lines.firstElementChild.remove();
    lines.scrollTop = lines.scrollHeight;
    return body;
  }

  /** Record a line and, unless a replay is being shown, display it. */
  function addLine(kind, text) {
    const entry = { t: round2(getTime()), kind, text };
    log.push(entry);
    if (log.length > LOG_MAX) log.shift();
    return { entry, body: showing ? null : appendLine(kind, text, entry.t) };
  }

  function write(text) {
    const parts = String(text).split('\n');
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i];
      if (!partialEntry) {
        if (chunk === '' && i === parts.length - 1) break;
        const added = addLine('out', chunk);
        partialEntry = added.entry;
        partial = added.body;
      } else {
        partialEntry.text += chunk;
        if (partial) {
          partial.textContent += chunk;
          lines.scrollTop = lines.scrollHeight;
        }
      }
      if (i < parts.length - 1) {
        partial = null;
        partialEntry = null;
      }
    }
  }

  function flush() {
    partial = null;
    partialEntry = null;
  }

  function prompt(text) {
    cancelPrompt();
    flush();
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      promptLabel.textContent = text ? String(text) : 'input():';
      promptInput.value = '';
      promptBox.hidden = false;
      promptInput.focus();
    });
  }

  function submitPrompt() {
    if (!pending) return;
    const value = promptInput.value;
    const p = pending;
    pending = null;
    promptBox.hidden = true;
    addLine('input', `${promptLabel.textContent} ${value}`);
    p.resolve(value);
  }

  function cancelPrompt() {
    if (pending) {
      const p = pending;
      pending = null;
      promptBox.hidden = true;
      p.reject(Object.assign(new Error('stopped'), { isStop: true }));
    }
  }

  promptButton.addEventListener('click', submitPrompt);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitPrompt();
    }
  });
  root.querySelector('.console-clear').addEventListener('click', () => clear());

  function clear() {
    lines.textContent = '';
    partial = null;
    partialEntry = null;
    log = [];
    showing = false;
  }

  function render(entries) {
    lines.textContent = '';
    for (const e of entries) appendLine(e.kind, e.text, e.t);
  }

  /** Show a run's recorded lines ([t, kind, text] or {t, kind, text}) up to `upTo` seconds (replay). */
  function showEntries(entries, upTo) {
    showing = true;
    flush();
    const list = [];
    for (const e of entries || []) {
      const entry = Array.isArray(e) ? { t: e[0], kind: e[1], text: e[2] } : e;
      if (upTo === undefined || entry.t <= upTo + 1e-9) list.push(entry);
    }
    render(list);
  }

  /** Back to the live lines after a replay. */
  function restore() {
    if (!showing) return;
    showing = false;
    render(log);
  }

  return {
    write,
    flush,
    prompt,
    cancelPrompt,
    clear,
    showEntries,
    restore,
    info: (t) => {
      flush();
      addLine('info', t);
    },
    note: (t) => {
      flush();
      addLine('note', t);
    },
    error: (t) => {
      flush();
      addLine('err', t);
    },
    hint: (t) => {
      flush();
      addLine('hint', t);
    },
    /** The goal verdict at the end of a run (Milestone 4, d-20): { pass, text } -> a verdict-pass / verdict-fail line. */
    verdict: (v) => {
      flush();
      addLine(v.pass ? 'verdict-pass' : 'verdict-fail', v.text);
    },
    /** The recorded lines as compact [t, kind, text] rows (what a run stores). */
    get entries() {
      return log.map((e) => [e.t, e.kind, e.text]);
    },
    get showing() {
      return showing;
    },
  };
}
