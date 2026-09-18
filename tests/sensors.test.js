// Sensor jitter and the panel's "Steady readouts" option (d-7): every reading carries a little
// random noise by default; { noise: false } gives the exact underlying value. Run against the
// simulation engine itself — plain ES modules, no browser.
import { describe, expect, it } from 'vitest';
import { World } from '../public/js/sim/world.js';
import { getFloor } from '../public/js/floors.js';

function worldOn(floor = getFloor('blank')) {
  const world = new World();
  world.setFloor(floor);
  world.resetRun();
  return world;
}

const STEADY = { noise: false };

describe('steady sensor readings ({ noise: false })', () => {
  it('reports the exact hand distance, orientation accel, heading, sound and temperature', () => {
    const world = worldOn();
    const robot = world.robots[0];
    robot.input.hand = 15;
    robot.input.sound = 37;
    robot.input.temperature = 22;
    robot.placeAt(robot.x, robot.y, 123);
    const s = world.sensors(robot, STEADY);
    expect(s.distance).toBe(15);
    expect(s.acceleration).toEqual([0, 0, -9.8]);
    expect(s.compass).toBe(123);
    expect(s.sound).toBe(37);
    expect(s.temperature).toBe(22);
    expect(world.magnetometer(robot, STEADY)).toEqual(world.magnetometer(robot, STEADY));
  });

  it('is identical on every read while the robot is still', () => {
    const world = worldOn();
    const robot = world.robots[0];
    const first = world.sensors(robot, STEADY);
    for (let i = 0; i < 50; i++) expect(world.sensors(robot, STEADY)).toEqual(first);
  });

  it('still wobbles the accelerometer while the robot is being shaken', () => {
    const world = worldOn();
    const robot = world.robots[0];
    robot.input.shakeUntil = world.time + 1;
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(world.acceleration(robot, STEADY).join(','));
    expect(world.isShaking(robot)).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('default (noisy) sensor readings', () => {
  it('flicker around the steady value by at most the jitter amount', () => {
    const world = worldOn();
    const robot = world.robots[0];
    robot.input.hand = 15;
    robot.input.sound = 40;
    const steady = world.sensors(robot, STEADY);
    const seen = { distance: new Set(), sound: new Set(), accelZ: new Set() };
    for (let i = 0; i < 200; i++) {
      const s = world.sensors(robot);
      expect(Math.abs(s.distance - steady.distance)).toBeLessThanOrEqual(1);
      expect(Math.abs(s.sound - steady.sound)).toBeLessThanOrEqual(1);
      expect(Math.abs(s.lightL - steady.lightL)).toBeLessThanOrEqual(2);
      expect(Math.abs(s.lineL - steady.lineL)).toBeLessThanOrEqual(2);
      expect(Math.abs(s.acceleration[2] - steady.acceleration[2])).toBeLessThanOrEqual(0.15 + 1e-9);
      seen.distance.add(s.distance);
      seen.sound.add(s.sound);
      seen.accelZ.add(s.acceleration[2]);
    }
    // 200 draws of uniform noise: the readings do move (the realism a program has to cope with)
    expect(seen.distance.size + seen.sound.size + seen.accelZ.size).toBeGreaterThan(3);
  });

  it('is what the single-sensor methods give without options (what a program reads)', () => {
    const world = worldOn();
    const robot = world.robots[0];
    robot.input.hand = 15;
    const reads = new Set();
    for (let i = 0; i < 200; i++) reads.add(world.distance(robot));
    expect([...reads].every((v) => v >= 14 && v <= 16)).toBe(true);
  });
});
