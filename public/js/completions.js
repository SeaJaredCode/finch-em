// Editor autocomplete (d-28): the names the program can use, offered as she types. Pure functions
// over the code and the cursor — editor.js wraps them for CodeMirror's show-hint addon, and
// tests/completions.test.js exercises them without a browser.
//
// Two kinds of completion:
//   * after `bird.` (any name given a Finch(...)), the Finch methods with an example call;
//     after `random.`, `time.` or `math.`, the functions the lessons use from those modules;
//   * a bare identifier: names defined in the program (variables, def names, loop variables,
//     parameters, imports), the names the lesson template imports, Python keywords and the
//     builtins the lessons use — plus, last, any other word in the program.
import { FINCH_METHODS } from './hints.js';

const IDENT = /[A-Za-z_]\w*/;
const IDENT_G = /[A-Za-z_]\w*/g;

/** Python keywords. */
export const KEYWORDS = [
  'and', 'as', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'False', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'not', 'or', 'pass', 'raise',
  'return', 'True', 'try', 'while', 'with', 'yield',
];

/** Builtins the lessons use: name -> example call. */
export const BUILTINS = {
  print: "print('Hello')",
  input: "input('How far? ')",
  int: "int('42')",
  float: "float('1.5')",
  str: 'str(42)',
  len: 'len(items)',
  range: 'range(5)',
  list: 'list(range(5))',
  abs: 'abs(-3)',
  min: 'min(2, 7)',
  max: 'max(2, 7)',
  round: 'round(2.5)',
  sum: 'sum([1, 2, 3])',
  sorted: 'sorted(items)',
  enumerate: 'enumerate(items)',
  bool: 'bool(0)',
  type: 'type(x)',
};

/** Modules the lessons import: module -> { name -> example call, or null for a constant }. */
export const MODULES = {
  random: {
    randint: 'random.randint(1, 6)  # a whole number from 1 to 6',
    choice: "random.choice(['red', 'green', 'blue'])",
    random: 'random.random()  # a number from 0 to 1',
    uniform: 'random.uniform(0, 10)',
    shuffle: 'random.shuffle(items)',
  },
  time: {
    sleep: 'time.sleep(1)  # seconds',
    time: 'time.time()',
  },
  math: {
    sqrt: 'math.sqrt(16)',
    floor: 'math.floor(2.7)',
    ceil: 'math.ceil(2.1)',
    pi: null,
    sin: 'math.sin(math.pi / 2)',
    cos: 'math.cos(0)',
    radians: 'math.radians(90)',
    degrees: 'math.degrees(math.pi)',
  },
};

/** `bird.setMove('F', 10, 50)  # ...` -> "setMove('F', 10, 50)": the call without the receiver and comment. */
function signature(example) {
  if (!example) return '';
  return String(example).replace(/\s*#.*$/, '').replace(/^[A-Za-z_]\w*\./, '').trim();
}

/** The text to insert for a callable: `name(` when it takes values, `name()` when it takes none. */
function callText(name, example, nextChar) {
  if (nextChar === '(') return name; // she already typed the bracket
  const sig = signature(example);
  return /\(\s*\)$/.test(sig) ? name + '()' : name + '(';
}

/** Every `<name> = Finch(...)` in the program — both robots of a two-robot floor (d-24). */
export function finchVariables(code) {
  const names = [];
  const re = /^\s*([A-Za-z_]\w*)\s*=\s*Finch\s*\(/gm;
  let m;
  while ((m = re.exec(String(code)))) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}

/** Names the program defines or imports, in order of first definition: Map name -> { kind, detail }. */
export function definedNames(code) {
  const out = new Map();
  const add = (name, kind, detail = '') => {
    if (name && IDENT.test(name) && !out.has(name)) out.set(name, { kind, detail });
  };
  const lines = String(code).split('\n');
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '');
    let m;
    if ((m = /^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/.exec(line))) {
      for (const part of m[2].split(',')) {
        const p = part.trim().split(/\s+as\s+/);
        add((p[1] || p[0]).trim(), 'import', `from ${m[1]}`);
      }
    } else if ((m = /^\s*import\s+(.+)$/.exec(line))) {
      for (const part of m[1].split(',')) {
        const p = part.trim().split(/\s+as\s+/);
        add((p[1] || p[0]).trim().split('.')[0], 'module', 'module');
      }
    } else if ((m = /^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(line))) {
      add(m[1], 'function', `def ${m[1]}(${m[2].trim()})`);
      for (const p of m[2].split(',')) add(p.trim().split(/[=:]/)[0].trim(), 'variable', 'parameter');
    } else if ((m = /^\s*class\s+([A-Za-z_]\w*)/.exec(line))) {
      add(m[1], 'class', 'class');
    } else if ((m = /^\s*for\s+(.+?)\s+in\b/.exec(line))) {
      for (const p of m[1].split(',')) add(p.trim(), 'variable', 'loop variable');
    } else if ((m = /^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?:[+\-*/%]?=)(?!=)/.exec(line))) {
      const isFinch = /=\s*Finch\s*\(/.test(line);
      for (const p of m[1].split(',')) add(p.trim(), 'variable', isFinch ? 'Finch robot' : 'variable');
    }
  }
  return out;
}

/** Is position `ch` of this line inside a string or a comment (no completion there)? */
export function inStringOrComment(lineText, ch) {
  const before = String(lineText).slice(0, ch);
  let quote = null;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (quote) {
      if (c === '\\') i++;
      else if (before.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = null;
      }
    } else if (c === '#') return true;
    else if (c === '"' || c === "'") {
      quote = before.startsWith(c + c + c, i) ? c + c + c : c;
      i += quote.length - 1;
    }
  }
  return quote !== null;
}

/**
 * Completions at { line (0-based), ch } in `code`: { from: {line, ch}, to: {line, ch}, list } or
 * null when there is nothing to offer. Each list item is { text, display, detail, kind } — `text`
 * replaces the range from..to. `explicit` (Ctrl-Space) offers names even before she has typed a
 * letter.
 */
export function completeAt(code, cursor, { explicit = false } = {}) {
  const lines = String(code).split('\n');
  const lineText = lines[cursor.line] || '';
  const before = lineText.slice(0, cursor.ch);
  const nextChar = lineText[cursor.ch] || '';
  if (inStringOrComment(lineText, cursor.ch)) return null;

  const wordMatch = /[A-Za-z_]\w*$/.exec(before);
  const word = wordMatch ? wordMatch[0] : '';
  const start = cursor.ch - word.length;
  const from = { line: cursor.line, ch: start };
  const to = { line: cursor.line, ch: cursor.ch };
  const matches = (name) => name.toLowerCase().startsWith(word.toLowerCase());
  const rank = (name) => (name.startsWith(word) ? 0 : 1); // exact-case prefix first

  // -- `receiver.` : methods of the Finch, or functions of a module --
  const member = /([A-Za-z_]\w*)\s*\.\s*$/.exec(before.slice(0, start));
  if (member) {
    const receiver = member[1];
    let entries = null;
    let kind = 'method';
    if (finchVariables(code).includes(receiver)) entries = FINCH_METHODS;
    else if (MODULES[receiver]) {
      entries = MODULES[receiver];
      kind = 'function';
    }
    if (!entries) return null;
    const list = Object.keys(entries)
      .filter(matches)
      .sort((a, b) => rank(a) - rank(b))
      .map((name) => {
        const example = entries[name];
        const callable = example !== null;
        return {
          text: callable ? callText(name, example, nextChar) : name,
          display: callable ? signature(example) || name + '()' : name,
          detail: sandboxOnly(name) ? 'sandbox only' : kind === 'method' ? 'Finch' : receiver,
          kind,
        };
      });
    return list.length ? { from, to, list } : null;
  }

  if (!word && !explicit) return null;

  // -- a bare name --
  const seen = new Set();
  const list = [];
  const push = (name, item) => {
    if (seen.has(name) || !matches(name)) return;
    seen.add(name);
    list.push({ text: name, display: name, detail: '', kind: 'name', ...item });
  };
  for (const [name, info] of definedNames(code)) {
    // The word she is typing right now defines nothing yet (its own `x =` line still counts).
    if (name === word && countOccurrences(code, name) < 2) continue;
    const callable = info.kind === 'function' || info.kind === 'class';
    push(name, {
      text: callable ? callText(name, info.detail.includes('()') ? 'f()' : 'f(x)', nextChar) : name,
      display: info.kind === 'function' ? info.detail.replace(/^def\s+/, '') : name,
      detail: info.detail,
      kind: info.kind,
    });
  }
  for (const name of Object.keys(BUILTINS)) push(name, { text: callText(name, BUILTINS[name], nextChar), display: signature(BUILTINS[name]), detail: 'builtin', kind: 'function' });
  push('Finch', { text: callText('Finch', 'Finch()', nextChar), display: 'Finch()', detail: 'from BirdBrain', kind: 'class' });
  push('sleep', { text: callText('sleep', 'sleep(1)', nextChar), display: 'sleep(1)', detail: 'from time', kind: 'function' });
  for (const name of KEYWORDS) push(name, { detail: 'keyword', kind: 'keyword' });
  for (const name of Object.keys(MODULES)) push(name, { detail: 'module', kind: 'module' });
  // Any other word in the program (a name she typed earlier and has not defined the usual way).
  const words = String(code).match(IDENT_G) || [];
  for (const name of words) if (name !== word) push(name, { detail: 'in this program', kind: 'word' });

  list.sort((a, b) => rank(a.text) - rank(b.text));
  return list.length ? { from, to, list } : null;
}

function countOccurrences(code, name) {
  const re = new RegExp('\\b' + name + '\\b', 'g');
  return (String(code).match(re) || []).length;
}

function sandboxOnly(name) {
  return name === 'penDown' || name === 'penUp' || name === 'setPenColor';
}
