// Accounts (itch-13, d-31): register, sign in and out, uniform sign-in failures, claiming an
// older profile, the sibling split, and the guard that only the session and account modules
// reach the raw store. Same fixture idea as tests/api.test.js: one browser() per person, with
// its own cookie jar; the memory store, so every branch runs without a database.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app.js';
import { resetStoreForTests } from '../src/store/index.js';
import { createMemoryStore } from '../src/store/memory.js';
import { SAMPLE_PROGRAM_NAME } from '../src/seed.js';

let server;
let base;
let store;
let api; // this test's first browser

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

/** One browser: keeps the cookie the server sets (including a cleared one) and starts a session first. */
function browser() {
  let cookie = '';
  let lastSetCookie = null;
  let started = false;
  async function raw(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const response = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = response.headers.get('set-cookie');
    if (set) {
      lastSetCookie = set;
      cookie = set.split(';')[0];
    }
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  const client = async (method, path, body) => {
    if (!started) {
      started = true;
      if (path !== '/api/session') await raw('POST', '/api/session', {});
    }
    return raw(method, path, body);
  };
  Object.defineProperty(client, 'cookie', { get: () => cookie });
  Object.defineProperty(client, 'lastSetCookie', { get: () => lastSetCookie });
  return client;
}

const ids = (rows) => rows.map((r) => r.id);

function runBody(programId) {
  return {
    programId,
    programName: 'Mine',
    floorId: 'blank',
    floorName: 'Blank floor',
    status: 'finished',
    elapsed: 1,
    wheelLeft: 0,
    wheelRight: 0,
    data: {
      code: 'print(1)\n',
      speed: 1,
      floor: { id: 'blank', name: 'Blank floor', builtin: true, width: 120, height: 90, background: 'white', start: { x: 60, y: 45, heading: 0 }, tape: [] },
      trail: [[60, 45]],
      trace: { fields: ['t', 'x', 'y', 'heading', 'lineL', 'lineR', 'lightL', 'lightR', 'distance', 'encoderL', 'encoderR'], samples: [[0, 60, 45, 0, 90, 90, 20, 20, 300, 0, 0]] },
      console: [],
      ink: [],
      error: null,
    },
  };
}

describe('accounts', () => {
  it('registers, signs out, and signs in from another browser to the same profiles', async () => {
    const start = (await api('POST', '/api/session', {})).body;
    expect(start.account).toEqual({ username: null });
    const mine = start.profiles;

    const reg = await api('POST', '/api/account/register', { username: 'Alice', password: 'secret1' });
    expect(reg.status).toBe(200);
    expect(reg.body.account.username).toBe('Alice');
    expect(ids(reg.body.profiles)).toEqual(ids(mine));
    expect((await api('POST', '/api/session', {})).body.account.username).toBe('Alice'); // the same session
    expect((await api('POST', '/api/account/register', { username: 'Alice2', password: 'secret1' })).status).toBe(409);

    // Sign out with no household behind this browser: the cookie is cleared, the next visit is a fresh anonymous user.
    const out = await api('POST', '/api/account/signout');
    expect(out.status).toBe(200);
    expect(out.body.account.username).toBeNull();
    expect(api.lastSetCookie).toMatch(/^finch_session=;/);
    expect(api.lastSetCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await api('GET', '/api/profiles')).status).toBe(401);
    const fresh = (await api('POST', '/api/session', {})).body;
    expect(fresh.account.username).toBeNull();
    expect(fresh.profiles).toHaveLength(1);
    expect(fresh.profiles[0].id).not.toBe(mine[0].id);

    // Another browser (with its own anonymous workspace) signs in; the username is case-insensitive.
    const other = browser();
    const theirs = (await other('GET', '/api/profiles')).body.profiles;
    const signedIn = await other('POST', '/api/account/signin', { username: 'alice', password: 'secret1' });
    expect(signedIn.status).toBe(200);
    expect(other.lastSetCookie).toMatch(/^finch_session=[A-Za-z0-9_-]{43}; /);
    expect(signedIn.body.account.username).toBe('Alice');
    expect(ids(signedIn.body.profiles)).toEqual(ids(mine));
    expect(ids((await other('GET', '/api/profiles')).body.profiles)).toEqual(ids(mine));
    expect((await other('GET', `/api/profiles/${mine[0].id}/programs`)).body.programs.map((p) => p.name)).toEqual([SAMPLE_PROGRAM_NAME]);
    expect((await other('GET', `/api/profiles/${theirs[0].id}`)).status).toBe(404); // the anonymous workspace is not Alice's

    // Sign out there: back to the anonymous household user that browser had before.
    const home = await other('POST', '/api/account/signout');
    expect(home.status).toBe(200);
    expect(home.body.account.username).toBeNull();
    expect(ids(home.body.profiles)).toEqual(ids(theirs));
    expect(ids((await other('GET', '/api/profiles')).body.profiles)).toEqual(ids(theirs));
    expect((await other('GET', `/api/profiles/${mine[0].id}`)).status).toBe(404);
  });

  it('answers every sign-in failure the same way and validates usernames and passwords', async () => {
    await api('POST', '/api/account/register', { username: 'Bob', password: 'secret1' });
    const c = browser();
    const unknown = await c('POST', '/api/account/signin', { username: 'nobody', password: 'secret1' });
    const wrong = await c('POST', '/api/account/signin', { username: 'Bob', password: 'secret2' });
    const junk = await c('POST', '/api/account/signin', { username: '', password: 42 });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(junk.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(junk.body).toEqual(wrong.body);
    expect(c.lastSetCookie).toMatch(/^finch_session=[A-Za-z0-9_-]{43}; /); // still the anonymous session it started with
    expect((await c('GET', '/api/profiles')).status).toBe(200);

    expect((await c('POST', '/api/account/register', { username: 'bob', password: 'secret1' })).status).toBe(409); // taken, any case
    expect((await c('POST', '/api/account/register', { username: 'ab', password: 'secret1' })).status).toBe(400);
    expect((await c('POST', '/api/account/register', { username: 'has space', password: 'secret1' })).status).toBe(400);
    expect((await c('POST', '/api/account/register', { username: '.dot', password: 'secret1' })).status).toBe(400);
    expect((await c('POST', '/api/account/register', { username: 'Carol', password: '12345' })).status).toBe(400);
    expect((await c('POST', '/api/account/register', { username: 'Carol', password: 'x'.repeat(129) })).status).toBe(400);
    expect((await c('POST', '/api/account/register', { username: ' Carol ', password: 'secret1' })).body.account.username).toBe('Carol');

    const everything = JSON.stringify([(await c('POST', '/api/session', {})).body, wrong.body, (await c('GET', '/api/profiles')).body]);
    expect(everything).not.toMatch(/scrypt\$/);
    expect(everything).not.toMatch(/passwordHash/);
  });

  it('lets a registered user claim an older profile once; anonymous users may not', async () => {
    const legacy = await store.createProfile({ name: 'Old Student', color: '#000000', prefs: { speed: 4 } });
    const legacy2 = await store.createProfile({ name: 'Old Sibling', color: '#111111', prefs: {} });
    expect((await api('GET', '/api/account/legacy')).status).toBe(403);
    expect((await api('POST', `/api/account/legacy/${legacy.id}/claim`)).status).toBe(403);

    await api('POST', '/api/account/register', { username: 'Alice', password: 'secret1' });
    const list = (await api('GET', '/api/account/legacy')).body.profiles;
    expect(list.map((p) => p.name)).toEqual(['Old Student', 'Old Sibling']);
    expect(Object.keys(list[0]).sort()).toEqual(['color', 'createdAt', 'id', 'name']);

    const claimed = await api('POST', `/api/account/legacy/${legacy.id}/claim`);
    expect(claimed.status).toBe(200);
    expect(claimed.body.profile.id).toBe(legacy.id);
    expect(claimed.body.profile.prefs.speed).toBe(4);
    expect((await api('GET', '/api/profiles')).body.profiles.map((p) => p.name).sort()).toEqual(['Old Student', 'Student']);
    expect((await api('GET', `/api/profiles/${legacy.id}/programs`)).body.programs).toEqual([]);
    expect((await api('GET', '/api/account/legacy')).body.profiles.map((p) => p.id)).toEqual([legacy2.id]);

    const b = browser();
    await b('POST', '/api/account/register', { username: 'Bob', password: 'secret1' });
    expect((await b('GET', '/api/account/legacy')).body.profiles.map((p) => p.id)).toEqual([legacy2.id]);
    expect((await b('POST', `/api/account/legacy/${legacy.id}/claim`)).status).toBe(404); // gone the moment Alice took it
    expect((await b('POST', '/api/account/legacy/nope/claim')).status).toBe(404);
    expect((await b('GET', `/api/profiles/${legacy.id}`)).status).toBe(404);
  });

  it('moves one profile to its own account (sibling split) with everything under it; the household keeps the rest', async () => {
    const student = (await api('GET', '/api/profiles')).body.profiles[0];
    const alice = (await api('POST', '/api/profiles', { name: 'Alice', color: '#e91e63' })).body.profile;
    const program = (await api('POST', `/api/profiles/${alice.id}/programs`, { name: 'Mine', code: 'print(1)\n' })).body.program;
    const floor = (await api('POST', `/api/profiles/${alice.id}/floors`, { name: 'My floor' })).body.floor;
    const run = (await api('POST', `/api/profiles/${alice.id}/runs`, runBody(program.id))).body.run;
    const drawing = (await api('POST', `/api/profiles/${alice.id}/drawings`, { title: 'Ink', strokes: [] })).body.drawing;
    expect((await api('PUT', `/api/profiles/${alice.id}/workbook/1/1`, { done: true, programId: program.id })).status).toBe(200);

    expect((await api('POST', '/api/account/split', { profileId: '00000000-0000-0000-0000-000000000000', username: 'Alice', password: 'secret1' })).status).toBe(404);
    expect((await api('POST', '/api/account/split', { profileId: alice.id, username: 'Alice', password: '123' })).status).toBe(400);

    const moved = await api('POST', '/api/account/split', { profileId: alice.id, username: 'Alice', password: 'secret1' });
    expect(moved.status).toBe(200);
    expect(moved.body.account.username).toBe('Alice');
    expect(moved.body.profile.id).toBe(alice.id);
    expect(ids(moved.body.profiles)).toEqual([alice.id]);
    expect(api.lastSetCookie).toMatch(/^finch_session=[A-Za-z0-9_-]{43}; /);

    // This browser is Alice now, with everything that was under her profile.
    expect(ids((await api('GET', '/api/profiles')).body.profiles)).toEqual([alice.id]);
    expect(ids((await api('GET', `/api/profiles/${alice.id}/programs`)).body.programs)).toEqual([program.id]);
    expect(ids((await api('GET', `/api/profiles/${alice.id}/floors`)).body.floors)).toEqual([floor.id]);
    expect(ids((await api('GET', `/api/profiles/${alice.id}/runs`)).body.runs)).toEqual([run.id]);
    expect(ids((await api('GET', `/api/profiles/${alice.id}/drawings`)).body.drawings)).toEqual([drawing.id]);
    expect((await api('GET', `/api/profiles/${alice.id}/workbook`)).body.entries[0]).toMatchObject({ lesson: 1, exercise: 1, done: true, programId: program.id });
    expect((await api('GET', `/api/profiles/${student.id}`)).status).toBe(404);
    expect((await api('POST', '/api/account/split', { profileId: alice.id, username: 'Alice', password: 'secret1' })).status).toBe(409); // already hers

    // Sign out: back to the household, which kept Student and can no longer see Alice's rows.
    const home = await api('POST', '/api/account/signout');
    expect(home.body.account.username).toBeNull();
    expect(ids(home.body.profiles)).toEqual([student.id]);
    expect((await api('GET', `/api/profiles/${alice.id}`)).status).toBe(404);
    expect((await api('GET', `/api/programs/${program.id}`)).status).toBe(404);
    expect((await api('GET', `/api/runs/${run.id}`)).status).toBe(404);

    // The last sibling takes the last profile into an existing account, proven by its password.
    expect((await api('POST', '/api/account/split', { profileId: student.id, username: 'Alice', password: 'wrong1' })).status).toBe(401);
    expect(ids((await api('GET', '/api/profiles')).body.profiles)).toEqual([student.id]); // nothing moved
    const second = await api('POST', '/api/account/split', { profileId: student.id, username: 'alice', password: 'secret1' });
    expect(second.status).toBe(200);
    expect(second.body.account.username).toBe('Alice');
    expect(ids(second.body.profiles).sort()).toEqual([alice.id, student.id].sort());

    // The emptied household reboots into a fresh Student rather than nothing.
    const again = await api('POST', '/api/account/signout');
    expect(again.body.account.username).toBeNull();
    expect(again.body.profiles).toHaveLength(1);
    expect(again.body.profiles[0].id).not.toBe(student.id);
    expect(again.body.profiles[0].name).toBe('Student');
    expect((await api('GET', `/api/profiles/${again.body.profiles[0].id}/programs`)).body.programs.map((p) => p.name)).toEqual([SAMPLE_PROGRAM_NAME]);
  });

  it('keeps every module but the session and account modules off the raw store', () => {
    // src/app.js is exempt: its only store use is the /health ping, which reads no data. The rules
    // modules (account.js, classes.js, assignments.js) may hold the raw store; the copy helper (d-32)
    // and the scoped store (whose teacher reads, d-34, take the raw store as an argument) must not.
    const src = new URL('../src/', import.meta.url);
    const offenders = ['seed.js', 'floorshape.js', 'runshape.js', 'copy.js', 'routes/api.js', 'store/scoped.js'].filter((f) =>
      /getStore/.test(readFileSync(new URL(f, src), 'utf8')),
    );
    expect(offenders).toEqual([]);
    expect(readFileSync(new URL('app.js', src), 'utf8')).not.toMatch(/req\.scope|listProfiles|getProfile/);
    expect(readFileSync(new URL('routes/api.js', src), 'utf8')).toMatch(/apiRouter\.use\(requireSession\)/);
  });
});
