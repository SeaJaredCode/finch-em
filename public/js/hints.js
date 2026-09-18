// "What this usually means" (Milestone 5, d-23): a plain-language hint for the handful of mistakes
// the BirdBrain lessons provoke — a wrong direction letter, a missing `from time import sleep`,
// forgetting `bird.` in front of a Finch method, using the Finch before `bird = Finch()`, and
// indentation. Pure functions: main.js prints the hint under the red error line, and
// tests/hints.test.js exercises them without a browser.

/** Every Finch method with an example call, for hints and "did you mean" matching. */
export const FINCH_METHODS = {
  setMove: "bird.setMove('F', 10, 50)  # direction 'F' or 'B', distance in cm, speed 0-100",
  setTurn: "bird.setTurn('R', 90, 50)  # direction 'R' or 'L', angle in degrees, speed 0-100",
  setMotors: 'bird.setMotors(50, 50)  # left speed, right speed, each -100 to 100',
  stop: 'bird.stop()',
  setBeak: 'bird.setBeak(100, 0, 0)  # red, green, blue, each 0-100',
  setTail: "bird.setTail('all', 0, 100, 0)  # port 1-4 or 'all', then red, green, blue",
  setDisplay: 'bird.setDisplay([1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1])  # 25 values, 0 or 1',
  setPoint: 'bird.setPoint(1, 1, 1)  # row 1-5, column 1-5, value 0 or 1',
  print: "bird.print('Hi')  # scrolls across the display",
  stopAll: 'bird.stopAll()',
  playNote: 'bird.playNote(60, 1)  # MIDI note 32-135, beats 0-16',
  getDistance: 'bird.getDistance()',
  getLight: "bird.getLight('L')  # 'L' or 'R'",
  getLine: "bird.getLine('L')  # 'L' or 'R'",
  resetEncoders: 'bird.resetEncoders()',
  getEncoder: "bird.getEncoder('L')  # 'L' or 'R'",
  getButton: "bird.getButton('A')  # 'A', 'B' or 'Logo'",
  isShaking: 'bird.isShaking()',
  getOrientation: 'bird.getOrientation()',
  getAcceleration: 'bird.getAcceleration()',
  getCompass: 'bird.getCompass()',
  getMagnetometer: 'bird.getMagnetometer()',
  getSound: 'bird.getSound()',
  getTemperature: 'bird.getTemperature()',
  penDown: 'bird.penDown()  # sandbox only',
  penUp: 'bird.penUp()  # sandbox only',
  setPenColor: 'bird.setPenColor(100, 0, 0)  # sandbox only',
};

const METHOD_NAMES = Object.keys(FINCH_METHODS);

/** The Finch method whose name matches `name` ignoring case, or null. */
export function matchMethod(name) {
  if (FINCH_METHODS[name]) return name;
  const lower = String(name).toLowerCase();
  return METHOD_NAMES.find((m) => m.toLowerCase() === lower) || null;
}

/** The first `<name> = Finch(...)` in the program: { name, line } or null. */
export function finchVariable(code) {
  const lines = String(code).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*([A-Za-z_]\w*)\s*=\s*Finch\s*\(/.exec(lines[i]);
    if (m) return { name: m[1], line: i + 1 };
  }
  return null;
}

/** Does the program call Finch methods on `name` (name.setMove(...) and the like)? */
export function usesAsFinch(code, name) {
  const re = new RegExp('\\b' + name + '\\s*\\.\\s*(' + METHOD_NAMES.join('|') + ')\\s*\\(');
  return re.test(String(code));
}

const BLOCK_START_RE = /^\s*(for|while|if|elif|else|def|try|except|finally|with|class)\b/;
const EXPECTED_BLOCK = 'The line above ends with a colon, so this line has to be indented — it is the first line of that block. The lessons indent by 4 spaces (the Tab key does it here).';
const UNEXPECTED_INDENT = 'This line is indented more than the line before it, but nothing above it starts a block (a for, while, if or def line ending with a colon). Remove the extra spaces at the start of the line.';
const INDENTATION = 'Python groups code by indentation. Every line inside a for, while, if or def block is indented by the same amount (the lessons use 4 spaces), the block ends when the indentation goes back, and tabs mixed with spaces look right but are not — the Tab key here inserts 4 spaces.';

function indentOf(text) {
  return /^(\s*)/.exec(text || '')[1].length;
}

function stripComment(text) {
  return String(text || '').replace(/#.*$/, '').trimEnd();
}

function unbalanced(text) {
  const t = stripComment(text);
  const singles = (t.match(/'/g) || []).length;
  const doubles = (t.match(/"/g) || []).length;
  if (singles % 2 || doubles % 2) return 'an unclosed quote';
  const open = (t.match(/[([{]/g) || []).length;
  const close = (t.match(/[)\]}]/g) || []).length;
  if (open > close) return 'a bracket that is never closed';
  if (close > open) return 'a closing bracket without an opening one';
  return null;
}

/**
 * A hint for an error { type, message, line } raised by `code`, or null when there is nothing
 * useful to add to the Python message itself.
 */
export function errorHint(error, code = '') {
  if (!error) return null;
  const type = String(error.type || '');
  const msg = String(error.message || '');
  const lines = String(code).split('\n');
  const line = Number(error.line) || null;
  const robot = finchVariable(code);
  const bird = robot ? robot.name : 'bird';
  let m;

  if (type === 'ValueError') {
    if ((m = /^direction must be 'F' or 'B', not '(.*)'$/.exec(msg))) {
      return `setMove needs a direction letter in quotes: 'F' to drive forward or 'B' to drive backward — not '${m[1]}'. For example ${FINCH_METHODS.setMove}.`;
    }
    if ((m = /^direction must be 'R' or 'L', not '(.*)'$/.exec(msg))) {
      return `setTurn needs a direction letter in quotes: 'R' to turn right or 'L' to turn left — not '${m[1]}'. For example ${FINCH_METHODS.setTurn}.`;
    }
    if ((m = /^side must be 'L' or 'R', not '(.*)'$/.exec(msg))) {
      return `getLine, getLight and getEncoder need the side in quotes: 'L' for the left sensor or 'R' for the right one — not '${m[1]}'.`;
    }
    if (/^button must be/.test(msg)) return "getButton needs the button name in quotes: 'A', 'B' or 'Logo'.";
    if (/^port must be/.test(msg)) return `setTail's first value is the tail light: 1, 2, 3, 4 or 'all' — ${FINCH_METHODS.setTail}.`;
    if (/^setDisplay needs a list/.test(msg)) return 'setDisplay wants one list of exactly 25 values (five rows of five, top row first), each 0 (off) or 1 (on).';
    if (/^note must be|^beats must be/.test(msg)) return `playNote takes a MIDI note number from 32 to 135 (60 is middle C) and a number of beats from 0 to 16: ${FINCH_METHODS.playNote}.`;
    if (/invalid literal for int\(\)/.test(msg)) {
      return "int() was given text that is not a whole number — usually an answer typed at input() like 'ten' or nothing at all. Type digits, or check the text before converting it.";
    }
  }

  if (type === 'NameError' && (m = /^name '(.+?)' is not defined/.exec(msg))) {
    const name = m[1];
    if (name === 'sleep') return "sleep() comes from Python's time module, so the program needs `from time import sleep` at the top (the lesson template starts with it).";
    if (name === 'Finch') return 'Finch comes from the BirdBrain library: put `from BirdBrain import Finch` on the first line of the program.';
    if (name === 'random') return 'random is a module: add `import random` at the top, then use random.randint(1, 6) or random.choice([...]).';
    const method = matchMethod(name);
    if (method) {
      return `${name} is something the Finch does, so the robot's name goes in front of it with a dot: ${bird}.${method}(...). The robot's name is whatever you wrote before = Finch() — usually bird.`;
    }
    if (usesAsFinch(code, name)) {
      if (robot && robot.name === name && line && robot.line > line) {
        return `Line ${line} uses ${name} before line ${robot.line} creates it with ${name} = Finch(). Move that line up — right after the import lines is the usual place — so the Finch exists before the first ${name}. call.`;
      }
      return `${name} is used like a Finch robot, but nothing creates it. Add ${name} = Finch() after the import lines and before the first ${name}. call.`;
    }
    return `Python does not know anything called ${name}. Check the spelling and the capital letters (Python treats Bird and bird as different names), and make sure a line above this one gives it a value.`;
  }

  if (type === 'AttributeError' && (m = /^'Finch' object has no attribute '(.+?)'$/.exec(msg))) {
    const method = matchMethod(m[1]);
    if (method && method !== m[1]) {
      return `The Finch has no method called ${m[1]} — did you mean ${method}? Method names are case-sensitive: ${FINCH_METHODS[method]}.`;
    }
    return `The Finch has no method called ${m[1]}. Its methods are: ${METHOD_NAMES.join(', ')}.`;
  }

  if (type === 'TypeError') {
    if ((m = /^(\w+)\(\) takes (?:exactly|at least|at most) (\d+) arguments? \((\d+) given\)/.exec(msg)) && FINCH_METHODS[m[1]]) {
      return `${bird}.${m[1]} needs ${m[2]} value${m[2] === '1' ? '' : 's'} inside the brackets, not ${m[3]}: ${FINCH_METHODS[m[1]]}.`;
    }
    if ((m = /^(\w+) must be a number, not (\w+)$/.exec(msg))) {
      const what = m[2] === 'str' ? 'text in quotes' : 'a ' + m[2];
      let hint = `${m[1]} has to be a number, but the program gave it ${what}. Only the direction or side letter goes in quotes; numbers do not — for example ${FINCH_METHODS.setMove}.`;
      if (m[2] === 'str' && /\binput\s*\(/.test(code)) hint += " If the number came from input(), turn the typed text into a number first: int(input('How far? '))";
      return hint;
    }
    if ((m = /^(\w+) must be a string, not (\w+)$/.exec(msg))) {
      return `${m[1]} has to be a letter in quotes, like 'F' or 'L' — the program gave it a ${m[2]} without quotes.`;
    }
    if (/unsupported operand type\(s\) for \+.*'(int|float)' and 'str'|'str' and '(int|float)'|cannot concatenate|Can't convert .* to str/.test(msg)) {
      return "The program is joining a number and text with +. print() can take several things separated by commas — print('Distance:', d) — or turn the number into text with str(d). If the text came from input(), make it a number with int(...) first.";
    }
    if (/object is not callable/.test(msg)) return 'There are brackets after something that is not a function — check for a variable named like a function, or a missing operator before the bracket.';
  }

  // Skulpt raises some indentation mistakes as IndentationError and others as SyntaxError.
  if (type === 'IndentationError' || type === 'SyntaxError') {
    if (/expected an indented block/.test(msg)) return EXPECTED_BLOCK;
    if (/unexpected indent/.test(msg)) return UNEXPECTED_INDENT;
    if (/unindent does not match|indentation/i.test(msg) || type === 'IndentationError') return INDENTATION;
  }

  if (type === 'SyntaxError') {
    const here = line ? lines[line - 1] : '';
    const above = line && line > 1 ? lines[line - 2] : '';
    const headerWithoutColon = (text) => BLOCK_START_RE.test(text) && !/:\s*$/.test(stripComment(text)) && !unbalanced(text);
    if (headerWithoutColon(above)) return `Line ${line - 1} starts a block (for, while, if or def) but does not end with a colon. Python needs the : at the end of that line — the error shows up on the line after it.`;
    if (headerWithoutColon(here)) return `Line ${line} starts a block (for, while, if or def) but does not end with a colon. Add : at the end of the line.`;
    if (above && /:\s*$/.test(stripComment(above)) && here.trim() && indentOf(here) <= indentOf(above)) {
      return `Line ${line - 1} ends with a colon, so line ${line} has to be indented — it is the first line of that block. The lessons indent by 4 spaces (the Tab key does it here).`;
    }
    if (above && here.trim() && indentOf(here) > indentOf(above) && !/:\s*$/.test(stripComment(above)) && !BLOCK_START_RE.test(above)) {
      return `Line ${line} is indented more than the line before it, but nothing above it starts a block. Remove the extra spaces at the start of the line.`;
    }
    const problem = unbalanced(here) || (above && unbalanced(above) ? `${unbalanced(above)} on line ${line - 1}` : null);
    if (problem) return `This line (or the one above it) has ${problem}. Every ( needs a ), every [ a ], and quotes come in pairs.`;
    return 'Python could not read this line. Look for a missing colon after for/while/if/def, unbalanced brackets, an unclosed quote or a stray character — and check the line above it too, since a mistake there often shows up here.';
  }

  return null;
}
