import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app.js';
import { resetStoreForTests } from '../src/store/index.js';
import { createMemoryStore } from '../src/store/memory.js';
import { LESSON_TEMPLATE, SAMPLE_PROGRAM_NAME } from '../src/seed.js';

let server;
let base;
let store;
let api; // this test's browser (d-29): a client with its own session cookie

beforeEach(async () => {
  store = createMemoryStore();
  resetStoreForTests(store);
  await new Promise((resolve, reject) => {
    server = app.listen(0, () => {
      base = 'http://127.0.0.1:' + server.address().port;
      resolve();
    });
    server.once('error', reject);
  });
  api = browser();
});

afterEach(async () => {
  resetStoreForTests(null);
  await new Promise((resolve) => server.close(() => resolve()));
});

/**
 * One browser (d-29): keeps the session cookie the server sets and, before its first data call,
 * starts a session the way public/js/profiles.js does on boot — so a test's first GET /api/profiles
 * sees the seeded 'Student' workspace exactly as a first visit does. A second browser() is another
 * person; a second POST /api/profiles from the same browser is another workspace of the same user.
 */
function browser() {
  let cookie = '';
  let started = false;
  async function raw(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const response = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  return async (method, path, body) => {
    if (!started) {
      started = true;
      if (path !== '/api/session') await raw('POST', '/api/session', {});
    }
    return raw(method, path, body);
  };
}

describe('profiles', () => {
  it('seeds one default profile with the sample program on first visit', async () => {
    const first = await api('GET', '/api/profiles');
    expect(first.status).toBe(200);
    expect(first.body.profiles).toHaveLength(1);
    const profile = first.body.profiles[0];
    expect(profile.name).toBe('Student');
    expect(profile.prefs.lastProgramId).toBeTruthy();

    const programs = await api('GET', `/api/profiles/${profile.id}/programs`);
    expect(programs.body.programs).toHaveLength(1);
    expect(programs.body.programs[0].name).toBe(SAMPLE_PROGRAM_NAME);
    expect(programs.body.programs[0].code).toContain('from BirdBrain import Finch');

    // A second visit does not seed again.
    const again = await api('GET', '/api/profiles');
    expect(again.body.profiles).toHaveLength(1);
  });

  it('creates a second profile with an empty workspace and keeps the first untouched', async () => {
    const first = (await api('GET', '/api/profiles')).body.profiles[0];
    const created = await api('POST', '/api/profiles', { name: 'Sibling', color: '#e91e63' });
    expect(created.status).toBe(201);
    const sibling = created.body.profile;
    expect(sibling.name).toBe('Sibling');

    const siblingPrograms = await api('GET', `/api/profiles/${sibling.id}/programs`);
    expect(siblingPrograms.body.programs).toHaveLength(0);
    const firstPrograms = await api('GET', `/api/profiles/${first.id}/programs`);
    expect(firstPrograms.body.programs).toHaveLength(1);

    const list = await api('GET', '/api/profiles');
    expect(list.body.profiles.map((p) => p.name)).toEqual(['Student', 'Sibling']);
  });

  it('merges preference patches', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const patched = await api('PATCH', `/api/profiles/${profile.id}`, { prefs: { speed: 4 } });
    expect(patched.status).toBe(200);
    expect(patched.body.profile.prefs.speed).toBe(4);
    expect(patched.body.profile.prefs.lastProgramId).toBe(profile.prefs.lastProgramId);
  });

  it('rejects a profile without a name', async () => {
    const bad = await api('POST', '/api/profiles', { name: '   ' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/name/);
  });
});

describe('deleting a profile', () => {
  it('takes its programs, floors, runs, drawings and workbook progress with it', async () => {
    const student = (await api('GET', '/api/profiles')).body.profiles[0];
    const spare = (await api('POST', '/api/profiles', { name: 'Spare' })).body.profile;
    const program = (await api('POST', `/api/profiles/${student.id}/programs`, { name: 'Mine' })).body.program;
    const floor = (await api('POST', `/api/profiles/${student.id}/floors`, { name: 'My floor' })).body.floor;
    const run = (await api('POST', `/api/profiles/${student.id}/runs`, runBody(program.id))).body.run;
    const drawing = (await api('POST', `/api/profiles/${student.id}/drawings`, { title: 'Ink', strokes: [] })).body.drawing;
    expect((await api('PUT', `/api/profiles/${student.id}/workbook/1/1`, { done: true, programId: program.id })).status).toBe(200);

    expect((await api('DELETE', `/api/profiles/${student.id}`)).status).toBe(204);

    expect((await api('GET', '/api/profiles')).body.profiles.map((p) => p.id)).toEqual([spare.id]);
    expect((await api('GET', `/api/profiles/${student.id}`)).status).toBe(404);
    for (const path of [`/api/programs/${program.id}`, `/api/floors/${floor.id}`, `/api/runs/${run.id}`, `/api/drawings/${drawing.id}`]) {
      expect((await api('GET', path)).status).toBe(404);
    }
    expect(await store.listWorkbook(student.id)).toEqual([]); // the workbook row went too
    expect((await api('DELETE', `/api/profiles/${student.id}`)).status).toBe(404); // and it is gone for good
  });

  it('refuses the last profile, and another user\'s', async () => {
    const mine = (await api('GET', '/api/profiles')).body.profiles[0];
    const only = await api('DELETE', `/api/profiles/${mine.id}`);
    expect(only.status).toBe(409);
    expect(only.body.error).toMatch(/only profile/);
    expect((await api('GET', `/api/profiles/${mine.id}`)).status).toBe(200); // untouched

    // A second profile makes the first deletable, but never someone else's (d-29): not ours is
    // indistinguishable from not there.
    await api('POST', '/api/profiles', { name: 'Spare' });
    const other = browser();
    const theirs = (await other('GET', '/api/profiles')).body.profiles[0];
    expect((await api('DELETE', `/api/profiles/${theirs.id}`)).status).toBe(404);
    expect((await api('DELETE', '/api/profiles/not-a-uuid')).status).toBe(404);
    expect((await other('GET', `/api/profiles/${theirs.id}`)).status).toBe(200);
  });

  it('leaves the class its records, with the link to the deleted program cleared', async () => {
    const teacher = browser();
    const student = browser();
    expect((await teacher('POST', '/api/account/register', { username: 'Teach', password: 'secret1' })).status).toBe(200);
    expect((await student('POST', '/api/account/register', { username: 'Sam', password: 'secret1' })).status).toBe(200);

    const cls = (await teacher('POST', '/api/classes', { name: 'Robotics' })).body.class;
    await student('POST', '/api/classes/join', { code: cls.joinCode });
    const assignment = (await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 1, exercise: 1 })).body.assignment;

    const work = (await student('GET', '/api/profiles')).body.profiles[0];
    const spare = (await student('POST', '/api/profiles', { name: 'Spare' })).body.profile;
    const draft = (await student('POST', `/api/assignments/${assignment.id}/start`, { profileId: work.id })).body.program;
    const turnedIn = await student('POST', `/api/assignments/${assignment.id}/submissions`, { programId: draft.id });
    expect(turnedIn.status).toBe(201);
    const attempt = turnedIn.body.submission;
    const sent = (await student('POST', `/api/classes/${cls.id}/sent-copies`, { programId: draft.id })).body.copy;

    expect((await student('DELETE', `/api/profiles/${work.id}`)).status).toBe(204);
    expect((await student('GET', '/api/profiles')).body.profiles.map((p) => p.id)).toEqual([spare.id]);
    expect((await student('GET', `/api/programs/${draft.id}`)).status).toBe(404); // the draft went with the profile

    // The teacher still has both records, each with the snapshot taken when it was made (d-35, d-38).
    const roster = (await teacher('GET', `/api/classes/${cls.id}/roster`)).body.roster;
    const membership = roster.find((m) => m.username === 'Sam');
    const attempts = (await teacher('GET', `/api/assignments/${assignment.id}/submissions/${membership.id}`)).body.submissions;
    expect(attempts.map((s) => s.id)).toEqual([attempt.id]);
    expect(attempts[0].program.code).toBe(draft.code);
    const copies = (await teacher('GET', `/api/classes/${cls.id}/sent-copies`)).body.copies;
    expect(copies.map((c) => c.id)).toEqual([sent.id]);
    expect(copies[0].program).toBeTruthy();

    // Only the back-pointer went (SET NULL) — and no reader was ever shown it.
    expect((await store.getSubmission(attempt.id)).sourceProgramId).toBeNull();
    expect((await store.getSentCopy(sent.id)).sourceProgramId).toBeNull();
  });
});

describe('programs', () => {
  it('creates with the lesson template, updates, and deletes a program', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const created = await api('POST', `/api/profiles/${profile.id}/programs`, { name: 'Square' });
    expect(created.status).toBe(201);
    const program = created.body.program;
    expect(program.code).toBe(LESSON_TEMPLATE);
    expect(program.floorId).toBe('blank');

    const updated = await api('PUT', `/api/programs/${program.id}`, {
      code: 'print(1)\n',
      floorId: 'oval',
      name: 'Square v2',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.program.code).toBe('print(1)\n');
    expect(updated.body.program.floorId).toBe('oval');
    expect(updated.body.program.name).toBe('Square v2');

    const fetched = await api('GET', `/api/programs/${program.id}`);
    expect(fetched.body.program.code).toBe('print(1)\n');

    const list = await api('GET', `/api/profiles/${profile.id}/programs`);
    expect(list.body.programs.map((p) => p.name)).toEqual(['Square v2', SAMPLE_PROGRAM_NAME]);

    const deleted = await api('DELETE', `/api/programs/${program.id}`);
    expect(deleted.status).toBe(204);
    const gone = await api('GET', `/api/programs/${program.id}`);
    expect(gone.status).toBe(404);
  });

  it('returns 404 for unknown ids and 400 for bad payloads', async () => {
    const missing = await api('GET', '/api/programs/00000000-0000-0000-0000-000000000000');
    expect(missing.status).toBe(404);
    const notUuid = await api('GET', '/api/programs/nope');
    expect(notUuid.status).toBe(404);
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const bad = await api('POST', `/api/profiles/${profile.id}/programs`, { name: 'x', code: 42 });
    expect(bad.status).toBe(400);
  });
});

// ---- floors (Milestone 2, d-8) --------------------------------------------------------------

const Y_FLOOR = {
  name: 'My Y track',
  description: 'A Y with a box on the left branch',
  width: 160,
  height: 120,
  background: 'wood',
  start: { x: 80, y: 14, heading: 0 },
  tape: [
    { points: [[80, 6], [80, 60]], width: 2.5, color: '#111111' },
    { points: [[80, 60], [44, 108]], width: 2.5, color: '#D62828' },
  ],
  walls: [{ x: 30, y: 104, w: 14, h: 14, kind: 'box' }],
  lights: [{ x: 150, y: 110, brightness: 80, reach: 90 }],
  darkAreas: [{ x: 0, y: 0, w: 20, h: 20 }],
  slopes: [{ x: 100, y: 20, w: 40, h: 30, uphill: 90 }],
};

describe('floors', () => {
  it('creates a custom floor from a document, lists it per profile, and returns the floor shape', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const created = await api('POST', `/api/profiles/${profile.id}/floors`, Y_FLOOR);
    expect(created.status).toBe(201);
    const floor = created.body.floor;
    expect(floor.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(floor.profileId).toBe(profile.id);
    expect(floor.name).toBe('My Y track');
    expect(floor.builtin).toBe(false);
    expect(floor.width).toBe(160);
    expect(floor.background).toBe('wood');
    expect(floor.start).toEqual({ x: 80, y: 14, heading: 0 });
    expect(floor.tape).toHaveLength(2);
    expect(floor.tape[1].color).toBe('#d62828'); // colours are normalised to lower case
    expect(floor.walls[0].kind).toBe('box');
    expect(floor.slopes[0].uphill).toBe(90);
    expect(floor.createdAt).toBeTruthy();

    const list = await api('GET', `/api/profiles/${profile.id}/floors`);
    expect(list.status).toBe(200);
    expect(list.body.floors.map((f) => f.id)).toEqual([floor.id]);

    const fetched = await api('GET', `/api/floors/${floor.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.floor.tape[0].points).toEqual([[80, 6], [80, 60]]);
  });

  it('fills in defaults for a minimal document', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const created = await api('POST', `/api/profiles/${profile.id}/floors`, { name: 'Empty' });
    expect(created.status).toBe(201);
    const floor = created.body.floor;
    expect(floor.width).toBe(120);
    expect(floor.height).toBe(90);
    expect(floor.background).toBe('white');
    expect(floor.start).toEqual({ x: 60, y: 45, heading: 0 });
    expect(floor.tape).toEqual([]);
    expect(floor.walls).toEqual([]);
    expect(floor.lights).toEqual([]);
    expect(floor.darkAreas).toEqual([]);
    expect(floor.slopes).toEqual([]);
    expect(floor.checkpoints).toEqual([]);
    expect(floor.finishZones).toEqual([]);
    expect(floor.goals).toEqual([]);
  });

  it('updates the name and geometry independently and keeps the untouched keys', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const floor = (await api('POST', `/api/profiles/${profile.id}/floors`, Y_FLOOR)).body.floor;

    const renamed = await api('PUT', `/api/floors/${floor.id}`, { name: 'Y track v2' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.floor.name).toBe('Y track v2');
    expect(renamed.body.floor.tape).toHaveLength(2);

    const moved = await api('PUT', `/api/floors/${floor.id}`, {
      walls: [{ x: 110, y: 104, w: 14, h: 14 }],
      start: { x: 80, y: 20, heading: 45 },
    });
    expect(moved.status).toBe(200);
    expect(moved.body.floor.name).toBe('Y track v2');
    expect(moved.body.floor.walls).toEqual([{ x: 110, y: 104, w: 14, h: 14 }]);
    expect(moved.body.floor.start).toEqual({ x: 80, y: 20, heading: 45 });
    expect(moved.body.floor.tape).toHaveLength(2); // untouched
    expect(moved.body.floor.updatedAt >= floor.updatedAt).toBe(true);
  });

  it('a program remembers a custom floor, and deleting the floor sends it back to blank', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const floor = (await api('POST', `/api/profiles/${profile.id}/floors`, Y_FLOOR)).body.floor;
    const program = (await api('POST', `/api/profiles/${profile.id}/programs`, { name: 'Tracker', floorId: floor.id })).body.program;
    expect(program.floorId).toBe(floor.id);

    const deleted = await api('DELETE', `/api/floors/${floor.id}`);
    expect(deleted.status).toBe(204);
    expect((await api('GET', `/api/floors/${floor.id}`)).status).toBe(404);
    expect((await api('DELETE', `/api/floors/${floor.id}`)).status).toBe(404);
    const after = await api('GET', `/api/programs/${program.id}`);
    expect(after.body.program.floorId).toBe('blank');
  });

  it('keeps floors isolated per profile', async () => {
    const student = (await api('GET', '/api/profiles')).body.profiles[0];
    const sibling = (await api('POST', '/api/profiles', { name: 'Sibling' })).body.profile;
    await api('POST', `/api/profiles/${student.id}/floors`, Y_FLOOR);
    const siblingFloors = await api('GET', `/api/profiles/${sibling.id}/floors`);
    expect(siblingFloors.body.floors).toEqual([]);
    const studentFloors = await api('GET', `/api/profiles/${student.id}/floors`);
    expect(studentFloors.body.floors).toHaveLength(1);
  });

  it('keeps a second start mark (startB) for a two-robot floor, and null without one (Milestone 6, d-24)', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const one = (await api('POST', `/api/profiles/${profile.id}/floors`, Y_FLOOR)).body.floor;
    expect(one.startB).toBeNull();
    const two = await api('POST', `/api/profiles/${profile.id}/floors`, {
      ...Y_FLOOR,
      name: 'Duet',
      startB: { x: 500, y: 30, heading: -90 },
      goals: [{ type: 'inSync' }, { type: 'finish', robot: 'B' }, { type: 'lap', robot: 'C' }],
    });
    expect(two.status).toBe(201);
    expect(two.body.floor.startB).toEqual({ x: 160, y: 30, heading: 270 });
    expect(two.body.floor.goals).toEqual([{ type: 'inSync', tolerance: 10, maxOff: 1 }, { type: 'finish', robot: 'B' }, { type: 'lap', maxOff: 3 }]);
    const renamed = await api('PUT', `/api/floors/${two.body.floor.id}`, { name: 'Duet 2' });
    expect(renamed.body.floor.startB).toEqual({ x: 160, y: 30, heading: 270 });
    const gone = await api('PUT', `/api/floors/${two.body.floor.id}`, { startB: null });
    expect(gone.body.floor.startB).toBeNull();
    expect(gone.body.floor.goals).toHaveLength(3);
    expect((await api('POST', `/api/profiles/${profile.id}/floors`, { name: 'x', startB: 'here' })).status).toBe(400);
  });

  it('rejects malformed documents with 400 and unknown ids with 404', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const badWidth = await api('POST', `/api/profiles/${profile.id}/floors`, { name: 'x', width: 'wide' });
    expect(badWidth.status).toBe(400);
    expect(badWidth.body.error).toMatch(/width/);
    const badTape = await api('POST', `/api/profiles/${profile.id}/floors`, { name: 'x', tape: [{ points: [[1, 1]] }] });
    expect(badTape.status).toBe(400);
    expect(badTape.body.error).toMatch(/tape/);
    const badWalls = await api('POST', `/api/profiles/${profile.id}/floors`, { name: 'x', walls: { x: 1 } });
    expect(badWalls.status).toBe(400);
    const clamped = await api('POST', `/api/profiles/${profile.id}/floors`, { name: 'x', width: 5000, lights: [{ x: 1, y: 1, brightness: 500 }] });
    expect(clamped.status).toBe(201);
    expect(clamped.body.floor.width).toBe(400);
    expect(clamped.body.floor.lights[0].brightness).toBe(100);
    expect(clamped.body.floor.lights[0].reach).toBe(80);

    expect((await api('GET', '/api/floors/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await api('PUT', '/api/floors/nope', { name: 'x' })).status).toBe(404);
    expect((await api('GET', '/api/profiles/00000000-0000-0000-0000-000000000000/floors')).status).toBe(404);
  });
});

// ---- goals on floors (Milestone 4, d-20) ----------------------------------------------------

describe('goals on floors', () => {
  it('keeps goals, checkpoints and finish zones on a floor, clamps their parameters and rejects unknown types', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const created = await api('POST', `/api/profiles/${profile.id}/floors`, {
      ...Y_FLOOR,
      name: 'Course',
      checkpoints: [{ x: 80, y: 40 }, { x: 60, y: 90, r: 12 }],
      finishZones: [{ x: 100, y: 100, w: 20, h: 16 }],
      goals: [{ type: 'checkpoints' }, { type: 'finish' }, { type: 'stopNearWall', distance: 500 }, { type: 'endFacing', heading: 450 }],
    });
    expect(created.status).toBe(201);
    const floor = created.body.floor;
    expect(floor.checkpoints).toEqual([{ x: 80, y: 40, r: 8 }, { x: 60, y: 90, r: 12 }]);
    expect(floor.finishZones).toEqual([{ x: 100, y: 100, w: 20, h: 16 }]);
    expect(floor.goals).toEqual([
      { type: 'checkpoints' },
      { type: 'finish' },
      { type: 'stopNearWall', distance: 200 },
      { type: 'endFacing', heading: 90, tolerance: 10 },
    ]);

    const bad = await api('POST', `/api/profiles/${profile.id}/floors`, { name: 'x', goals: [{ type: 'teleport' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/goals\[0\]\.type/);

    // A rename keeps the goals; sending goals replaces them and leaves the markers alone.
    const renamed = await api('PUT', `/api/floors/${floor.id}`, { name: 'Course 2' });
    expect(renamed.body.floor.goals).toHaveLength(4);
    const cleared = await api('PUT', `/api/floors/${floor.id}`, { goals: [] });
    expect(cleared.body.floor.goals).toEqual([]);
    expect(cleared.body.floor.checkpoints).toHaveLength(2);
  });
});

// ---- runs and drawings (Milestone 3, d-13) --------------------------------------------------

function runBody(programId, overrides = {}) {
  return {
    programId,
    programName: 'Tracker',
    floorId: 'oval',
    floorName: 'Oval tape track',
    status: 'finished',
    elapsed: 4.2,
    wheelLeft: 30.5,
    wheelRight: 28.1,
    data: {
      code: 'print(1)\n',
      speed: 2,
      floor: {
        id: 'oval',
        name: 'Oval tape track',
        builtin: true,
        width: 120,
        height: 90,
        background: 'white',
        start: { x: 60, y: 45, heading: 0 },
        tape: [{ points: [[10, 10], [50, 50]] }],
      },
      trail: [[60, 45], [60, 50], [60, 55]],
      trace: {
        fields: ['t', 'x', 'y', 'heading', 'lineL', 'lineR', 'lightL', 'lightR', 'distance', 'encoderL', 'encoderR'],
        samples: [
          [0, 60, 45, 0, 90, 90, 20, 20, 300, 0, 0],
          [0.05, 60, 46, 0, 12, 88, 20, 21, 300, 0.06, 0.06],
        ],
      },
      console: [[0, 'info', 'Running'], [1.5, 'out', 'hello']],
      ink: [{ color: '#D62828', width: 0.7, points: [[60, 45, 0], [60, 50, 0.2]] }],
      error: null,
    },
    ...overrides,
  };
}

describe('runs', () => {
  it('records a run with its snapshots, lists it newest first without data, and returns it whole', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const program = (await api('GET', `/api/profiles/${profile.id}/programs`)).body.programs[0];
    const first = await api('POST', `/api/profiles/${profile.id}/runs`, runBody(program.id));
    expect(first.status).toBe(201);
    const run = first.body.run;
    expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.programId).toBe(program.id);
    expect(run.floorName).toBe('Oval tape track');
    expect(run.elapsed).toBe(4.2);
    expect(run.wheelLeft).toBe(30.5);
    expect(run.hasPen).toBe(true);
    expect(run.data.code).toBe('print(1)\n');
    expect(run.data.floor.id).toBe('oval');
    expect(run.data.floor.tape[0].width).toBe(2.5); // the floor snapshot is sanitised like a floor
    expect(run.data.ink[0].color).toBe('#d62828');
    expect(run.data.trace.samples).toHaveLength(2);

    const errored = runBody(program.id, { status: 'error' });
    errored.data.error = { type: 'NameError', message: 'x is not defined', line: 3 };
    const second = (await api('POST', `/api/profiles/${profile.id}/runs`, errored)).body.run;
    expect(second.status).toBe('error');
    expect(second.data.error).toEqual({ type: 'NameError', message: 'x is not defined', line: 3 });

    const list = await api('GET', `/api/profiles/${profile.id}/runs`);
    expect(list.status).toBe(200);
    expect(list.body.runs.map((r) => r.id)).toEqual([second.id, run.id]);
    expect(list.body.runs[0].data).toBeUndefined();
    expect(list.body.runs[1].hasPen).toBe(true);

    const fetched = await api('GET', `/api/runs/${run.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.run.data.trail).toEqual([[60, 45], [60, 50], [60, 55]]);
    expect(fetched.body.run.data.console).toEqual([[0, 'info', 'Running'], [1.5, 'out', 'hello']]);

    expect((await api('DELETE', `/api/runs/${run.id}`)).status).toBe(204);
    expect((await api('GET', `/api/runs/${run.id}`)).status).toBe(404);
    expect((await api('DELETE', `/api/runs/${run.id}`)).status).toBe(404);
    expect((await api('GET', `/api/profiles/${profile.id}/runs`)).body.runs).toHaveLength(1);
  });

  it('filters by program and floor, prunes per program, and drops runs with their program', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const runsPath = `/api/profiles/${profile.id}/runs`;
    const sample = (await api('GET', `/api/profiles/${profile.id}/programs`)).body.programs[0];
    const other = (await api('POST', `/api/profiles/${profile.id}/programs`, { name: 'Other' })).body.program;
    for (let i = 0; i < 3; i++) await api('POST', runsPath, runBody(sample.id));
    for (let i = 0; i < 2; i++) await api('POST', runsPath, runBody(other.id, { floorId: 'blank', floorName: 'Blank floor' }));

    expect((await api('GET', `${runsPath}?programId=${other.id}`)).body.runs).toHaveLength(2);
    expect((await api('GET', `${runsPath}?floorId=oval`)).body.runs).toHaveLength(3);
    expect((await api('GET', `${runsPath}?programId=${other.id}&floorId=oval`)).body.runs).toHaveLength(0);
    expect((await api('GET', `${runsPath}?programId=nope`)).status).toBe(400);

    const pruned = await api('POST', `${runsPath}/prune`, { keep: 1 });
    expect(pruned.status).toBe(200);
    expect(pruned.body.deleted).toBe(3);
    expect((await api('GET', runsPath)).body.runs).toHaveLength(2);
    expect((await api('POST', `${runsPath}/prune`, { keep: -1 })).status).toBe(400);

    expect((await api('DELETE', `/api/programs/${other.id}`)).status).toBe(204);
    const left = (await api('GET', runsPath)).body.runs;
    expect(left).toHaveLength(1);
    expect(left[0].programId).toBe(sample.id);
  });

  it('stores the goal verdict on the run and summarises it in the list (Milestone 4, d-20)', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const runsPath = `/api/profiles/${profile.id}/runs`;
    const program = (await api('GET', `/api/profiles/${profile.id}/programs`)).body.programs[0];
    const failed = runBody(program.id);
    failed.data.verdict = {
      pass: false,
      text: 'Fail — touched wall at 4.2 s',
      time: 4.2,
      goals: [{ type: 'stopNearWall', label: 'Stop within 30 cm of a wall without touching it', pass: false, reason: 'touched wall at 4.2 s', time: 4.2 }],
    };
    const saved = await api('POST', runsPath, failed);
    expect(saved.status).toBe(201);
    expect(saved.body.run.verdict).toBe('Fail — touched wall at 4.2 s');
    expect(saved.body.run.passed).toBe(false);
    expect(saved.body.run.data.verdict.goals[0]).toEqual({
      type: 'stopNearWall',
      label: 'Stop within 30 cm of a wall without touching it',
      pass: false,
      reason: 'touched wall at 4.2 s',
      time: 4.2,
    });

    const plain = await api('POST', runsPath, runBody(program.id));
    expect(plain.body.run.verdict).toBeNull();
    expect(plain.body.run.passed).toBeNull();
    expect(plain.body.run.data.verdict).toBeNull();

    const list = await api('GET', runsPath);
    expect(list.body.runs.map((r) => r.verdict)).toEqual([null, 'Fail — touched wall at 4.2 s']);
    expect(list.body.runs[1].passed).toBe(false);
    const fetched = await api('GET', `/api/runs/${saved.body.run.id}`);
    expect(fetched.body.run.data.verdict.pass).toBe(false);
  });

  it("bounds oversized documents and rejects runs for another profile's program", async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const runsPath = `/api/profiles/${profile.id}/runs`;
    const program = (await api('GET', `/api/profiles/${profile.id}/programs`)).body.programs[0];
    const big = runBody(program.id);
    big.data.trail = Array.from({ length: 7000 }, (_, i) => [i, i]);
    big.data.console = Array.from({ length: 1200 }, (_, i) => [i, 'out', 'line ' + i]);
    const saved = await api('POST', runsPath, big);
    expect(saved.status).toBe(201);
    expect(saved.body.run.data.trail).toHaveLength(6000);
    expect(saved.body.run.data.console).toHaveLength(1000);
    expect(saved.body.run.data.console[0][2]).toBe('line 200'); // the newest lines are kept

    const bad = await api('POST', runsPath, runBody(program.id, { data: { trail: 'nope' } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/trail/);
    expect((await api('POST', runsPath, { programId: 'nope' })).status).toBe(400);

    const sibling = (await api('POST', '/api/profiles', { name: 'Sibling' })).body.profile;
    const wrong = await api('POST', `/api/profiles/${sibling.id}/runs`, runBody(program.id));
    expect(wrong.status).toBe(400);
    expect((await api('GET', `/api/profiles/${sibling.id}/runs`)).body.runs).toEqual([]);
    expect((await api('GET', '/api/runs/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await api('GET', '/api/profiles/00000000-0000-0000-0000-000000000000/runs')).status).toBe(404);
  });
});

describe('drawings', () => {
  it('keeps a titled drawing in the gallery, lists newest first, deletes, and outlives its run', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const drawingsPath = `/api/profiles/${profile.id}/drawings`;
    const created = await api('POST', drawingsPath, {
      title: 'My circle',
      runId: null,
      programName: 'Circle',
      floorName: 'Blank floor',
      width: 120,
      height: 90,
      background: 'white',
      strokes: [{ color: '#1D4ED8', width: 0.7, points: [[10, 10, 0], [20, 10, 1]] }],
    });
    expect(created.status).toBe(201);
    const drawing = created.body.drawing;
    expect(drawing.title).toBe('My circle');
    expect(drawing.runId).toBeNull();
    expect(drawing.width).toBe(120);
    expect(drawing.strokes[0].color).toBe('#1d4ed8');
    expect(drawing.createdAt).toBeTruthy();

    const untitled = (await api('POST', drawingsPath, { strokes: [] })).body.drawing;
    expect(untitled.title).toBe('Untitled drawing');
    expect(untitled.strokes).toEqual([]);
    expect((await api('POST', drawingsPath, { title: '   ', strokes: [] })).status).toBe(400);
    expect((await api('POST', drawingsPath, { title: 'x', strokes: 'nope' })).status).toBe(400);

    const list = await api('GET', drawingsPath);
    expect(list.body.drawings.map((d) => d.id)).toEqual([untitled.id, drawing.id]);
    expect((await api('GET', `/api/drawings/${drawing.id}`)).body.drawing.strokes[0].points).toEqual([[10, 10, 0], [20, 10, 1]]);
    expect((await api('DELETE', `/api/drawings/${drawing.id}`)).status).toBe(204);
    expect((await api('GET', `/api/drawings/${drawing.id}`)).status).toBe(404);

    // A drawing saved from a run keeps a plain runId reference and survives the run's deletion.
    const program = (await api('GET', `/api/profiles/${profile.id}/programs`)).body.programs[0];
    const run = (await api('POST', `/api/profiles/${profile.id}/runs`, runBody(program.id))).body.run;
    const fromRun = (await api('POST', drawingsPath, { title: 'From a run', runId: run.id, strokes: run.data.ink })).body.drawing;
    expect(fromRun.runId).toBe(run.id);
    expect((await api('DELETE', `/api/runs/${run.id}`)).status).toBe(204);
    expect((await api('GET', `/api/drawings/${fromRun.id}`)).status).toBe(200);

    const sibling = (await api('POST', '/api/profiles', { name: 'Sibling' })).body.profile;
    expect((await api('GET', `/api/profiles/${sibling.id}/drawings`)).body.drawings).toEqual([]);
  });
});

// ---- workbook (Milestone 4, d-21) -----------------------------------------------------------

describe('workbook', () => {
  it('starts empty, upserts done marks and attachments per exercise, and links the program back', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const path = `/api/profiles/${profile.id}/workbook`;
    expect((await api('GET', path)).body.entries).toEqual([]);
    const program = (await api('GET', `/api/profiles/${profile.id}/programs`)).body.programs[0];

    // Lesson 9 exercise 3: attach a program (acceptance criterion 17)
    const attached = await api('PUT', `${path}/9/3`, { programId: program.id });
    expect(attached.status).toBe(200);
    expect(attached.body.entry).toMatchObject({ profileId: profile.id, lesson: 9, exercise: 3, done: false, programId: program.id, floorId: null });
    expect(attached.body.entry.updatedAt).toBeTruthy();
    expect((await api('GET', `/api/programs/${program.id}`)).body.program.exerciseRef).toBe('9.3');

    // ... then mark it done and give it a floor; absent keys keep their value
    const done = await api('PUT', `${path}/9/3`, { done: true, floorId: 'oval' });
    expect(done.body.entry).toMatchObject({ done: true, programId: program.id, floorId: 'oval' });
    await api('PUT', `${path}/1/1`, { done: true });
    const list = (await api('GET', path)).body.entries;
    expect(list.map((e) => [e.lesson, e.exercise, e.done])).toEqual([[1, 1, true], [9, 3, true]]);

    // detach the program and clear the floor; the done mark stays
    const cleared = await api('PUT', `${path}/9/3`, { programId: null, floorId: null });
    expect(cleared.body.entry).toMatchObject({ done: true, programId: null, floorId: null });
  });

  it('rejects exercises outside the catalogue and other profiles\' programs; deletions clear references', async () => {
    const profile = (await api('GET', '/api/profiles')).body.profiles[0];
    const path = `/api/profiles/${profile.id}/workbook`;
    expect((await api('PUT', `${path}/16/1`, { done: true })).status).toBe(404);
    expect((await api('PUT', `${path}/9/7`, { done: true })).status).toBe(404); // Lesson 9 has six exercises
    expect((await api('PUT', `${path}/9/0`, { done: true })).status).toBe(404);
    expect((await api('PUT', `${path}/9/1`, { done: 'yes' })).status).toBe(400);
    expect((await api('PUT', `${path}/9/1`, { programId: 'nope' })).status).toBe(400);
    const sibling = (await api('POST', '/api/profiles', { name: 'Sibling' })).body.profile;
    const theirs = (await api('POST', `/api/profiles/${sibling.id}/programs`, { name: 'Theirs' })).body.program;
    expect((await api('PUT', `${path}/9/1`, { programId: theirs.id })).status).toBe(400);
    expect((await api('PUT', `/api/profiles/00000000-0000-0000-0000-000000000000/workbook/9/1`, { done: true })).status).toBe(404);

    const mine = (await api('POST', `/api/profiles/${profile.id}/programs`, { name: 'Mine' })).body.program;
    const floor = (await api('POST', `/api/profiles/${profile.id}/floors`, Y_FLOOR)).body.floor;
    await api('PUT', `${path}/5/4`, { programId: mine.id, floorId: floor.id });
    expect((await api('DELETE', `/api/programs/${mine.id}`)).status).toBe(204);
    expect((await api('DELETE', `/api/floors/${floor.id}`)).status).toBe(204);
    const [entry] = (await api('GET', path)).body.entries;
    expect(entry).toMatchObject({ lesson: 5, exercise: 4, programId: null, floorId: null });
    expect((await api('GET', `/api/profiles/${sibling.id}/workbook`)).body.entries).toEqual([]);
  });
});

// ---- hand-off to another profile (Milestone 6, d-25) ---------------------------------------

describe('hand-off', () => {
  it('copies a program, its custom floor and its workbook attachment into another profile, but not its runs', async () => {
    const student = (await api('GET', '/api/profiles')).body.profiles[0];
    const floor = (await api('POST', `/api/profiles/${student.id}/floors`, Y_FLOOR)).body.floor;
    const mine = (await api('POST', `/api/profiles/${student.id}/programs`, { name: 'Y challenge', code: 'print(9)\n', floorId: floor.id })).body.program;
    await api('PUT', `/api/profiles/${student.id}/workbook/9/6`, { programId: mine.id, floorId: floor.id, done: true });
    await api('POST', `/api/profiles/${student.id}/runs`, runBody(mine.id));
    const sibling = (await api('POST', '/api/profiles', { name: 'Sibling' })).body.profile;

    const handed = await api('POST', `/api/programs/${mine.id}/handoff`, { profileId: sibling.id });
    expect(handed.status).toBe(201);
    const { program, floor: theirFloor, entries } = handed.body;
    expect(program.profileId).toBe(sibling.id);
    expect(program.id).not.toBe(mine.id);
    expect(program).toMatchObject({ name: 'Y challenge', code: 'print(9)\n', exerciseRef: '9.6' });
    expect(theirFloor.profileId).toBe(sibling.id);
    expect(theirFloor.id).not.toBe(floor.id);
    expect(theirFloor.name).toBe('My Y track');
    expect(theirFloor.tape).toHaveLength(2);
    expect(program.floorId).toBe(theirFloor.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ profileId: sibling.id, lesson: 9, exercise: 6, done: false, programId: program.id, floorId: theirFloor.id });

    expect((await api('GET', `/api/profiles/${sibling.id}/programs`)).body.programs.map((p) => p.id)).toEqual([program.id]);
    expect((await api('GET', `/api/profiles/${sibling.id}/floors`)).body.floors.map((f) => f.id)).toEqual([theirFloor.id]);
    expect((await api('GET', `/api/profiles/${sibling.id}/runs`)).body.runs).toEqual([]);
    expect((await api('GET', `/api/profiles/${sibling.id}/workbook`)).body.entries).toHaveLength(1);
    // the source is untouched
    expect((await api('GET', `/api/programs/${mine.id}`)).body.program.floorId).toBe(floor.id);
    expect((await api('GET', `/api/profiles/${student.id}/runs`)).body.runs).toHaveLength(1);
    expect((await api('GET', `/api/profiles/${student.id}/workbook`)).body.entries[0]).toMatchObject({ done: true, programId: mine.id, floorId: floor.id });
  });

  it('keeps a built-in floor id, leaves an attachment the sibling already made alone, and rejects bad targets', async () => {
    const student = (await api('GET', '/api/profiles')).body.profiles[0];
    const sample = (await api('GET', `/api/profiles/${student.id}/programs`)).body.programs[0];
    await api('PUT', `/api/profiles/${student.id}/workbook/1/1`, { programId: sample.id });
    const sibling = (await api('POST', '/api/profiles', { name: 'Sibling' })).body.profile;
    const theirs = (await api('POST', `/api/profiles/${sibling.id}/programs`, { name: 'Theirs' })).body.program;
    await api('PUT', `/api/profiles/${sibling.id}/workbook/1/1`, { programId: theirs.id });

    const handed = await api('POST', `/api/programs/${sample.id}/handoff`, { profileId: sibling.id });
    expect(handed.status).toBe(201);
    expect(handed.body.floor).toBeNull();
    expect(handed.body.program.floorId).toBe('blank');
    expect(handed.body.entries).toEqual([]);
    expect((await api('GET', `/api/profiles/${sibling.id}/workbook`)).body.entries[0].programId).toBe(theirs.id);
    expect((await api('GET', `/api/profiles/${sibling.id}/programs`)).body.programs).toHaveLength(2);

    expect((await api('POST', `/api/programs/${sample.id}/handoff`, { profileId: student.id })).status).toBe(400);
    expect((await api('POST', `/api/programs/${sample.id}/handoff`, { profileId: 'nope' })).status).toBe(400);
    expect((await api('POST', `/api/programs/${sample.id}/handoff`, { profileId: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);
    expect((await api('POST', '/api/programs/00000000-0000-0000-0000-000000000000/handoff', { profileId: sibling.id })).status).toBe(404);
  });
});

// ---- sessions and tenancy (itch-12 phase 1, d-29) ------------------------------------------

describe('sessions and tenancy', () => {
  it('answers 401 without a session cookie and resumes the same session on a later call', async () => {
    const bare = await fetch(base + '/api/profiles');
    expect(bare.status).toBe(401);
    expect((await bare.json()).error).toBe('no session');
    const first = (await api('GET', '/api/profiles')).body.profiles;
    expect(first).toHaveLength(1);
    expect(first[0].name).toBe('Student');
    const again = (await api('POST', '/api/session', {})).body.profiles;
    expect(again.map((p) => p.id)).toEqual(first.map((p) => p.id));
    expect((await api('GET', '/api/profiles')).body.profiles).toHaveLength(1); // no second seed
  });

  it('gives each browser its own Student workspace and answers 404 for anything of another user', async () => {
    const mine = (await api('GET', '/api/profiles')).body.profiles[0];
    const other = browser();
    const theirs = (await other('GET', '/api/profiles')).body.profiles[0];
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.name).toBe('Student');
    expect((await other('GET', '/api/profiles')).body.profiles.map((p) => p.id)).toEqual([theirs.id]);
    expect((await other('GET', `/api/profiles/${theirs.id}/programs`)).body.programs.map((p) => p.name)).toEqual([SAMPLE_PROGRAM_NAME]);

    const program = (await api('GET', `/api/profiles/${mine.id}/programs`)).body.programs[0];
    const floor = (await api('POST', `/api/profiles/${mine.id}/floors`, Y_FLOOR)).body.floor;
    const run = (await api('POST', `/api/profiles/${mine.id}/runs`, runBody(program.id))).body.run;
    const drawing = (await api('POST', `/api/profiles/${mine.id}/drawings`, { title: 'Mine', strokes: [] })).body.drawing;
    await api('PUT', `/api/profiles/${mine.id}/workbook/1/1`, { done: true });

    const reads = [
      `/api/profiles/${mine.id}`,
      `/api/profiles/${mine.id}/programs`,
      `/api/profiles/${mine.id}/floors`,
      `/api/profiles/${mine.id}/runs`,
      `/api/profiles/${mine.id}/drawings`,
      `/api/profiles/${mine.id}/workbook`,
      `/api/programs/${program.id}`,
      `/api/floors/${floor.id}`,
      `/api/runs/${run.id}`,
      `/api/drawings/${drawing.id}`,
    ];
    for (const path of reads) expect((await other('GET', path)).status, path).toBe(404);
    const writes = [
      ['PATCH', `/api/profiles/${mine.id}`, { name: 'Hijacked' }],
      ['POST', `/api/profiles/${mine.id}/programs`, { name: 'Planted' }],
      ['PUT', `/api/programs/${program.id}`, { code: 'print(0)\n' }],
      ['DELETE', `/api/programs/${program.id}`],
      ['POST', `/api/profiles/${mine.id}/floors`, Y_FLOOR],
      ['PUT', `/api/floors/${floor.id}`, { name: 'Vandalised' }],
      ['DELETE', `/api/floors/${floor.id}`],
      ['POST', `/api/profiles/${mine.id}/runs`, runBody(program.id)],
      ['POST', `/api/profiles/${mine.id}/runs/prune`, { keep: 0 }],
      ['DELETE', `/api/runs/${run.id}`],
      ['POST', `/api/profiles/${mine.id}/drawings`, { title: 'Planted', strokes: [] }],
      ['DELETE', `/api/drawings/${drawing.id}`],
      ['PUT', `/api/profiles/${mine.id}/workbook/1/1`, { done: false }],
      ['POST', `/api/programs/${program.id}/handoff`, { profileId: theirs.id }],
    ];
    for (const [method, path, body] of writes) expect((await other(method, path, body)).status, `${method} ${path}`).toBe(404);
    // ... and a hand-off cannot reach into their workspace from mine either
    expect((await api('POST', `/api/programs/${program.id}/handoff`, { profileId: theirs.id })).status).toBe(404);
    // nothing of mine changed
    expect((await api('GET', `/api/profiles/${mine.id}`)).body.profile.name).toBe('Student');
    expect((await api('GET', `/api/programs/${program.id}`)).body.program.code).not.toBe('print(0)\n');
    expect((await api('GET', `/api/profiles/${mine.id}/programs`)).body.programs).toHaveLength(1);
    expect((await api('GET', `/api/profiles/${mine.id}/floors`)).body.floors.map((f) => f.name)).toEqual(['My Y track']);
    expect((await api('GET', `/api/profiles/${mine.id}/runs`)).body.runs).toHaveLength(1);
    expect((await api('GET', `/api/profiles/${mine.id}/drawings`)).body.drawings).toHaveLength(1);
    expect((await api('GET', `/api/profiles/${mine.id}/workbook`)).body.entries[0].done).toBe(true);
    expect((await other('GET', `/api/profiles/${theirs.id}/programs`)).body.programs).toHaveLength(1);
  });

  it('lets a new browser claim the pre-session profile it remembers, once', async () => {
    // A row from before sessions existed: no user.
    const legacy = await store.createProfile({ name: 'Old Student', color: '#000000', prefs: { speed: 2 } });
    expect(legacy.userId).toBeNull();
    const first = browser();
    const claimed = (await first('POST', '/api/session', { rememberedProfileId: legacy.id })).body.profiles;
    expect(claimed.map((p) => p.id)).toEqual([legacy.id]); // claimed, not seeded
    expect(claimed[0].prefs.speed).toBe(2);
    expect((await first('GET', `/api/profiles/${legacy.id}/programs`)).body.programs).toEqual([]);
    const second = browser();
    const fresh = (await second('POST', '/api/session', { rememberedProfileId: legacy.id })).body.profiles;
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).not.toBe(legacy.id); // already taken: seeded instead
    expect(fresh[0].name).toBe('Student');
    expect((await second('GET', `/api/profiles/${legacy.id}`)).status).toBe(404);
    // a bad or unknown remembered id just seeds
    const third = browser();
    expect((await third('POST', '/api/session', { rememberedProfileId: 'nope' })).body.profiles[0].name).toBe('Student');
  });

  it('keeps the router off the raw store: every handler goes through req.scope', () => {
    const source = readFileSync(new URL('../src/routes/api.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/getStore/);
    expect(source).toMatch(/apiRouter\.use\(requireSession\)/);
  });
});
