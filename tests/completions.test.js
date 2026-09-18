// Editor autocomplete (d-28) — pure functions over the code and the cursor.
import { describe, expect, it } from 'vitest';
import { completeAt, definedNames, finchVariables, inStringOrComment, BUILTINS, KEYWORDS, MODULES } from '../public/js/completions.js';
import { FINCH_METHODS } from '../public/js/hints.js';

const TEMPLATE = 'from BirdBrain import Finch\nfrom time import sleep\nbird = Finch()\n';
const texts = (r) => (r ? r.list.map((i) => i.text) : null);
const at = (code, line, ch, opts) => completeAt(code, { line, ch }, opts);
/** Complete at the end of the last line of `code`. */
const atEnd = (code, opts) => {
  const lines = code.split('\n');
  return at(code, lines.length - 1, lines[lines.length - 1].length, opts);
};

describe('completions: after bird.', () => {
  it('offers every Finch method, with the example signature, after the robot name and a dot', () => {
    const r = atEnd(TEMPLATE + 'bird.');
    expect(r.from).toEqual({ line: 3, ch: 5 });
    expect(r.to).toEqual({ line: 3, ch: 5 });
    expect(r.list.map((i) => i.display)).toEqual(Object.values(FINCH_METHODS).map((ex) => ex.replace(/\s*#.*$/, '').replace(/^bird\./, '')));
    expect(r.list.every((i) => i.kind === 'method')).toBe(true);
  });

  it('filters by the typed prefix, ignoring case, and replaces it', () => {
    const r = atEnd(TEMPLATE + 'bird.setm');
    expect(r.from).toEqual({ line: 3, ch: 5 });
    expect(r.to).toEqual({ line: 3, ch: 9 });
    expect(texts(r)).toEqual(['setMove(', 'setMotors(']);
  });

  it('inserts name( for methods that take values and name() for those that do not', () => {
    expect(texts(atEnd(TEMPLATE + 'bird.getDist'))).toEqual(['getDistance()']);
    expect(texts(atEnd(TEMPLATE + 'bird.getLi'))).toEqual(['getLight(', 'getLine(']);
  });

  it('leaves out the bracket she already typed', () => {
    const code = TEMPLATE + 'bird.sto()';
    expect(texts(at(code, 3, 8))).toEqual(['stop', 'stopAll']);
  });

  it('marks the sandbox-only pen helpers', () => {
    const r = atEnd(TEMPLATE + 'bird.pen');
    expect(r.list.map((i) => [i.text, i.detail])).toEqual([
      ['penDown()', 'sandbox only'],
      ['penUp()', 'sandbox only'],
    ]);
  });

  it("knows every name given a Finch(...), including Finch('B'), and no other", () => {
    const two = TEMPLATE + "robot2 = Finch('B')\nrobot2.setB";
    expect(texts(atEnd(two))).toEqual(['setBeak(']);
    expect(finchVariables(two)).toEqual(['bird', 'robot2']);
    expect(atEnd('x = 5\nx.')).toBeNull();
    expect(atEnd(TEMPLATE + 'bird.fly')).toBeNull();
  });

  it('offers the module functions after random., time. and math.', () => {
    expect(texts(atEnd('import random\nrandom.ra'))).toEqual(['randint(', 'random()']);
    expect(texts(atEnd('import time\ntime.'))).toEqual(['sleep(', 'time()']);
    expect(texts(atEnd('import math\nmath.p'))).toEqual(['pi']);
    expect(Object.keys(MODULES)).toEqual(['random', 'time', 'math']);
  });
});

describe('completions: a bare name', () => {
  it("offers the program's own variables, functions, parameters and loop variables", () => {
    const code = TEMPLATE + 'speed = 50\ndef dance(times):\n    pass\nfor i in range(3):\n    pass\n';
    const names = definedNames(code);
    expect([...names.keys()]).toEqual(['Finch', 'sleep', 'bird', 'speed', 'dance', 'times', 'i']);
    expect(names.get('bird')).toEqual({ kind: 'variable', detail: 'Finch robot' });
    expect(names.get('dance')).toEqual({ kind: 'function', detail: 'def dance(times)' });
    expect(texts(atEnd(code + 'sp'))).toEqual(['speed']);
    expect(texts(atEnd(code + 'da'))).toEqual(['dance(']);
    expect(atEnd(code + 'da').list[0].display).toBe('dance(times)');
    expect(texts(atEnd(code + 'ti'))).toEqual(['times', 'time']); // her parameter first, then the module
  });

  it('offers the imports, keywords and builtins', () => {
    expect(texts(atEnd(TEMPLATE + 'Fi'))).toEqual(['Finch', 'finally']); // matching ignores case; the exact case comes first
    expect(texts(atEnd(TEMPLATE + 'sl'))).toEqual(['sleep']);
    expect(texts(atEnd(TEMPLATE + 'whi'))).toEqual(['while']);
    expect(texts(atEnd(TEMPLATE + 'pri'))).toEqual(['print(']);
    expect(texts(atEnd(TEMPLATE + 'inp'))).toEqual(['input(']);
    expect(KEYWORDS).toContain('elif');
    expect(Object.keys(BUILTINS)).toContain('range');
  });

  it('offers Finch and sleep even before the imports are written', () => {
    expect(texts(atEnd('Fin'))[0]).toBe('Finch()');
    expect(atEnd('Fin').list[0].detail).toBe('from BirdBrain');
    expect(texts(atEnd('sle'))).toEqual(['sleep(']);
  });

  it('puts exact-case matches first and never offers the word being typed as itself', () => {
    const names = texts(atEnd(TEMPLATE + 'f'));
    expect(names.indexOf('for')).toBeLessThan(names.indexOf('Finch'));
    expect(texts(atEnd(TEMPLATE + 'colour = 1\ncol'))).toEqual(['colour']);
    // while she is still typing a new name there is nothing to complete it with
    expect(atEnd(TEMPLATE + 'spee')).toBeNull();
  });

  it('offers any other word already in the program as a last resort', () => {
    const r = atEnd(TEMPLATE + 'print(distance_now)\ndis');
    expect(texts(r)).toEqual(['distance_now']);
    expect(r.list[0].detail).toBe('in this program');
  });

  it('stays quiet until she types a letter unless asked explicitly (Ctrl-Space)', () => {
    expect(atEnd(TEMPLATE)).toBeNull();
    const r = atEnd(TEMPLATE, { explicit: true });
    expect(r.from).toEqual({ line: 3, ch: 0 });
    expect(texts(r).slice(0, 3)).toEqual(['Finch', 'sleep', 'bird']);
  });

  it('stays quiet inside strings and comments', () => {
    expect(atEnd(TEMPLATE + "print('sp")).toBeNull();
    expect(atEnd(TEMPLATE + '# sp')).toBeNull();
    expect(atEnd(TEMPLATE + "bird.print('he")).toBeNull();
    expect(inStringOrComment("print('a', b", 11)).toBe(false);
    expect(inStringOrComment("s = '''a", 7)).toBe(true);
    expect(inStringOrComment('x = "a\\"b', 8)).toBe(true);
  });

  it('completes in the middle of a line, replacing only the word before the cursor', () => {
    const code = TEMPLATE + 'speed = 50\nbird.setMove(direction, 10, sp)';
    const r = at(code, 4, 30);
    expect(r.from).toEqual({ line: 4, ch: 28 });
    expect(r.to).toEqual({ line: 4, ch: 30 });
    expect(texts(r)).toEqual(['speed']);
    expect(texts(at(code, 4, 1))).toEqual(expect.arrayContaining(['bird', 'break'])); // "b|ird": the word before the cursor is "b"
  });
});
