// The code editor: CodeMirror 5 (from cdnjs) with a plain textarea fallback if the CDN is blocked.
// The debugger (Milestone 5, d-23) uses the 'breakpoints' gutter: clicking a line number toggles a
// breakpoint (a red dot that follows the line as she edits), and the line the program is parked
// before is highlighted as the current line.
// Autocomplete (d-28) rides CodeMirror's show-hint addon: the popup opens as she types a name or a
// dot (or on Ctrl-Space), Up/Down move, Tab or Enter accept, Esc closes. The candidates come from
// completions.js; without the addon the editor simply has no popup.
import { completeAt } from './completions.js';

/** Sandbox-only pen helpers (Milestone 3, d-15) — they do not exist on the real Finch. */
export const SANDBOX_CALL_RE = /\.\s*(penDown|penUp|setPenColor)\s*\(/;

/** 1-based line numbers that call a sandbox-only helper (comments ignored). */
export function findSandboxLines(code) {
  const out = [];
  String(code)
    .split('\n')
    .forEach((line, i) => {
      if (SANDBOX_CALL_RE.test(line.replace(/#.*$/, ''))) out.push(i + 1);
    });
  return out;
}

export function createEditor(textarea, { onChange, onSandboxCalls, onBreakpointsChange, fontSize = 14 }) {
  const CM = window.CodeMirror;
  let cm = null;
  let errorLine = null;
  let currentLine = null;
  let sandboxLines = [];
  let readOnly = false; // the read-only viewer (d-34): code can be run and read, not typed into
  const bpHandles = new Set(); // CodeMirror line handles carrying a breakpoint (they move with the line)

  /** Highlight the lines that use the sandbox-only pen and tell the page about them. */
  function markSandbox(code) {
    const lines = findSandboxLines(code);
    if (cm) {
      for (const l of sandboxLines) if (l <= cm.lineCount()) cm.removeLineClass(l - 1, 'background', 'sandbox-line');
      for (const l of lines) cm.addLineClass(l - 1, 'background', 'sandbox-line');
    }
    sandboxLines = lines;
    onSandboxCalls && onSandboxCalls(lines);
  }

  if (CM) {
    cm = CM.fromTextArea(textarea, {
      mode: 'python',
      lineNumbers: true,
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      lineWrapping: false,
      gutters: ['CodeMirror-linenumbers', 'breakpoints'],
      extraKeys: {
        Tab: (inst) => {
          if (inst.somethingSelected()) inst.indentSelection('add');
          else inst.replaceSelection('    ', 'end');
        },
        'Shift-Tab': (inst) => inst.indentSelection('subtract'),
        'Ctrl-Space': (inst) => openCompletions(inst, true),
      },
    });
    // While the popup is open its own keymap comes first, so Tab and Enter pick the highlighted
    // name instead of indenting or breaking the line; the debugger's gutter and keys are untouched.
    cm.on('inputRead', (inst, change) => {
      if (change.origin !== '+input' || inst.state.completionActive) return;
      const typed = change.text[change.text.length - 1];
      if (/[\w.]$/.test(typed)) openCompletions(inst, false);
    });
    cm.on('change', () => {
      if (errorLine !== null) setErrorLine(null);
      onChange && onChange(cm.getValue());
      markSandbox(cm.getValue());
      breakpointsChanged(); // breakpoints follow their lines; tell the runner the new numbers
    });
    cm.on('gutterClick', (inst, n) => toggleBreakpoint(n + 1));
  } else {
    textarea.classList.add('plain-editor');
    textarea.addEventListener('input', () => {
      onChange && onChange(textarea.value);
      markSandbox(textarea.value);
    });
  }

  // ---- autocomplete (d-28) ----

  /** Ask show-hint for the popup; `explicit` (Ctrl-Space) lists names before she has typed a letter. */
  function openCompletions(inst, explicit) {
    if (!CM || !CM.showHint) return;
    inst.showHint({ hint: completionHint, completeSingle: false, explicit });
  }

  /** The show-hint provider: completions.js decides, this turns them into CodeMirror's shape. */
  function completionHint(inst, options) {
    const cur = inst.getCursor();
    const result = completeAt(inst.getValue(), { line: cur.line, ch: cur.ch }, { explicit: !!(options && options.explicit) });
    if (!result) return null;
    return {
      from: CM.Pos(result.from.line, result.from.ch),
      to: CM.Pos(result.to.line, result.to.ch),
      list: result.list.map((item) => ({
        text: item.text,
        className: 'hint-' + item.kind,
        render: (el) => {
          const name = document.createElement('span');
          name.className = 'hint-name';
          name.textContent = item.display;
          el.appendChild(name);
          if (item.detail) {
            const detail = document.createElement('span');
            detail.className = 'hint-detail';
            detail.textContent = item.detail;
            el.appendChild(detail);
          }
        },
      })),
    };
  }

  function setErrorLine(line) {
    if (!cm) return;
    if (errorLine !== null) cm.removeLineClass(errorLine - 1, 'background', 'error-line');
    errorLine = line;
    if (line !== null && line >= 1 && line <= cm.lineCount()) {
      cm.addLineClass(line - 1, 'background', 'error-line');
      cm.scrollIntoView({ line: line - 1, ch: 0 }, 60);
    } else {
      errorLine = null;
    }
  }

  /** The line the debugger is parked before (null clears it). */
  function setCurrentLine(line) {
    if (!cm) return;
    if (currentLine !== null && currentLine <= cm.lineCount()) cm.removeLineClass(currentLine - 1, 'background', 'current-line');
    currentLine = null;
    if (line !== null && line >= 1 && line <= cm.lineCount()) {
      currentLine = line;
      cm.addLineClass(line - 1, 'background', 'current-line');
      cm.scrollIntoView({ line: line - 1, ch: 0 }, 60);
    }
  }

  // ---- breakpoints (Milestone 5, d-23) ----

  function marker() {
    const el = document.createElement('div');
    el.className = 'breakpoint-marker';
    el.title = 'Breakpoint — Run pauses before this line (click to remove)';
    el.textContent = '●';
    return el;
  }

  function toggleBreakpoint(line) {
    if (!cm || line < 1 || line > cm.lineCount()) return;
    const info = cm.lineInfo(line - 1);
    const has = !!(info.gutterMarkers && info.gutterMarkers.breakpoints);
    cm.setGutterMarker(line - 1, 'breakpoints', has ? null : marker());
    const handle = info.handle;
    if (has) bpHandles.delete(handle);
    else {
      bpHandles.add(handle);
      handle.on('delete', () => {
        bpHandles.delete(handle);
        breakpointsChanged();
      });
    }
    breakpointsChanged();
  }

  /** Current 1-based breakpoint lines, ascending. */
  function getBreakpoints() {
    if (!cm) return [];
    const lines = [];
    for (const h of bpHandles) {
      const n = cm.getLineNumber(h);
      if (n !== null && n !== undefined) lines.push(n + 1);
    }
    return lines.sort((a, b) => a - b);
  }

  function clearBreakpoints() {
    if (cm) cm.clearGutter('breakpoints');
    bpHandles.clear();
    breakpointsChanged();
  }

  function breakpointsChanged() {
    onBreakpointsChange && onBreakpointsChange(getBreakpoints());
  }

  function setFontSize(px) {
    const wrapper = cm ? cm.getWrapperElement() : textarea;
    wrapper.style.fontSize = px + 'px';
    if (cm) cm.refresh();
  }

  function setReadOnly(v) {
    readOnly = !!v;
    if (cm) cm.setOption('readOnly', readOnly);
    else textarea.readOnly = readOnly;
    (cm ? cm.getWrapperElement() : textarea).classList.toggle('read-only', readOnly);
  }

  setFontSize(fontSize);

  return {
    getValue: () => (cm ? cm.getValue() : textarea.value),
    setValue: (v) => {
      if (cm) {
        cm.setValue(v);
        cm.clearHistory();
      } else textarea.value = v;
      setErrorLine(null);
      setCurrentLine(null);
      clearBreakpoints();
      markSandbox(v);
    },
    setErrorLine,
    setCurrentLine,
    toggleBreakpoint,
    getBreakpoints,
    clearBreakpoints,
    get sandboxLines() {
      return sandboxLines;
    },
    get currentLine() {
      return currentLine;
    },
    setFontSize,
    setReadOnly,
    get readOnly() {
      return readOnly;
    },
    focus: () => (cm ? cm.focus() : textarea.focus()),
    refresh: () => cm && cm.refresh(),
    hasCodeMirror: !!cm,
    hasCompletions: !!(cm && CM.showHint),
  };
}
