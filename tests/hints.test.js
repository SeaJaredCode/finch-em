// "What this usually means" hints (Milestone 5, d-23) — pure functions over the error and the code.
import { describe, expect, it } from 'vitest';
import { errorHint, finchVariable, matchMethod, usesAsFinch, FINCH_METHODS } from '../public/js/hints.js';

const TEMPLATE = 'from BirdBrain import Finch\nfrom time import sleep\nbird = Finch()\n';

describe('hints: the mistakes the lessons provoke', () => {
  it('explains a wrong direction letter for setMove and setTurn', () => {
    expect(errorHint({ type: 'ValueError', message: "direction must be 'F' or 'B', not 'R'", line: 4 }, TEMPLATE)).toMatch(/'F' to drive forward/);
    expect(errorHint({ type: 'ValueError', message: "direction must be 'R' or 'L', not 'F'", line: 4 }, TEMPLATE)).toMatch(/'R' to turn right/);
    expect(errorHint({ type: 'ValueError', message: "side must be 'L' or 'R', not 'left side'", line: 4 }, TEMPLATE)).toMatch(/'L' for the left sensor/);
  });

  it('points at the missing sleep import', () => {
    const code = 'from BirdBrain import Finch\nbird = Finch()\nsleep(1)\n';
    expect(errorHint({ type: 'NameError', message: "name 'sleep' is not defined", line: 3 }, code)).toMatch(/from time import sleep/);
    expect(errorHint({ type: 'NameError', message: "name 'Finch' is not defined", line: 1 }, 'bird = Finch()')).toMatch(/from BirdBrain import Finch/);
  });

  it('says a Finch method needs bird. in front of it', () => {
    const hint = errorHint({ type: 'NameError', message: "name 'setMove' is not defined", line: 4 }, TEMPLATE + "setMove('F', 10, 50)\n");
    expect(hint).toMatch(/bird\.setMove\(/);
    // ... using the robot's own name when she called it something else
    const hint2 = errorHint({ type: 'NameError', message: "name 'setBeak' is not defined", line: 2 }, 'from BirdBrain import Finch\nrobot = Finch()\nsetBeak(1,2,3)');
    expect(hint2).toMatch(/robot\.setBeak\(/);
  });

  it('explains calling a Finch method before bird = Finch()', () => {
    const late = "from BirdBrain import Finch\nbird.setMove('F', 10, 50)\nbird = Finch()\n";
    expect(errorHint({ type: 'NameError', message: "name 'bird' is not defined", line: 2 }, late)).toMatch(/Line 2 uses bird before line 3 creates it/);
    const never = "from BirdBrain import Finch\nbird.setMove('F', 10, 50)\n";
    expect(errorHint({ type: 'NameError', message: "name 'bird' is not defined", line: 2 }, never)).toMatch(/Add bird = Finch\(\)/);
  });

  it('suggests the right spelling of a Finch method', () => {
    expect(errorHint({ type: 'AttributeError', message: "'Finch' object has no attribute 'setmove'" }, TEMPLATE)).toMatch(/did you mean setMove/);
    expect(errorHint({ type: 'AttributeError', message: "'Finch' object has no attribute 'fly'" }, TEMPLATE)).toMatch(/Its methods are: setMove/);
  });

  it('explains indentation and missing colons', () => {
    expect(errorHint({ type: 'IndentationError', message: 'unindent does not match any outer indentation level', line: 5 }, TEMPLATE)).toMatch(/4 spaces/);
    // Skulpt reports this one as a SyntaxError
    expect(errorHint({ type: 'SyntaxError', message: 'unindent does not match any outer indentation level', line: 5 }, TEMPLATE)).toMatch(/groups code by indentation/);
    const noColon = TEMPLATE + 'for i in range(5)\n    bird.setMove("F", 10, 50)\n';
    expect(errorHint({ type: 'SyntaxError', message: 'bad input', line: 5 }, noColon)).toMatch(/Line 4 starts a block .* does not end with a colon/);
    const notIndented = TEMPLATE + 'for i in range(5):\nbird.setMove("F", 10, 50)\n';
    expect(errorHint({ type: 'SyntaxError', message: 'bad input', line: 5 }, notIndented)).toMatch(/line 5 has to be indented/);
    const unclosed = TEMPLATE + "print('hi\n";
    expect(errorHint({ type: 'SyntaxError', message: 'bad input', line: 4 }, unclosed)).toMatch(/unclosed quote/);
  });

  it('explains wrong argument counts and types on Finch methods', () => {
    expect(errorHint({ type: 'TypeError', message: 'setMove() takes exactly 3 arguments (2 given)' }, TEMPLATE)).toMatch(/needs 3 values inside the brackets, not 2/);
    expect(errorHint({ type: 'TypeError', message: 'distance must be a number, not str' }, TEMPLATE + 'd = input()')).toMatch(/int\(input/);
    expect(errorHint({ type: 'TypeError', message: "unsupported operand type(s) for +: 'int' and 'str'" }, TEMPLATE)).toMatch(/str\(d\)/);
  });

  it('stays quiet about errors it has nothing to add to', () => {
    expect(errorHint({ type: 'ZeroDivisionError', message: 'integer division or modulo by zero' }, TEMPLATE)).toBeNull();
    expect(errorHint(null, TEMPLATE)).toBeNull();
  });

  it('exposes the helpers the hints are built from', () => {
    expect(finchVariable(TEMPLATE)).toEqual({ name: 'bird', line: 3 });
    expect(matchMethod('SETTURN')).toBe('setTurn');
    expect(matchMethod('fly')).toBeNull();
    expect(usesAsFinch("robot.getLine('L')", 'robot')).toBe(true);
    expect(usesAsFinch('robot = 5', 'robot')).toBe(false);
    expect(Object.keys(FINCH_METHODS)).toContain('penDown');
  });
});
