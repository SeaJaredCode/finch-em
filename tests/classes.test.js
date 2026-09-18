// Classes (itch-14, d-32): create and join, what a student may and may not see, the roster and
// removal, code rotation, archiving, a teacher's password reset, publishing snapshots and taking
// copies. One makeBrowser() per person on the memory store.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app.js';
import { resetStoreForTests } from '../src/store/index.js';
import { createMemoryStore } from '../src/store/memory.js';
import { makeBrowser } from './helpers/browser.js';

let server;
let base;
let store;

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
});

afterEach(async () => {
  resetStoreForTests(null);
  await new Promise((resolve) => server.close(() => resolve()));
});

const browser = () => makeBrowser(base);
const ids = (rows) => rows.map((r) => r.id);

/** A browser that registered as `username` (password secret1). */
async function registered(username) {
  const b = browser();
  const r = await b('POST', '/api/account/register', { username, password: 'secret1' });
  expect(r.status).toBe(200);
  return b;
}

async function classroom() {
  const teacher = await registered('Teach');
  const created = await teacher('POST', '/api/classes', { name: 'Robotics 101' });
  expect(created.status).toBe(201);
  const cls = created.body.class;
  const student = await registered('Sam');
  expect((await student('POST', '/api/classes/join', { code: cls.joinCode })).status).toBe(200);
  const roster = (await teacher('GET', `/api/classes/${cls.id}/roster`)).body.roster;
  return { teacher, student, cls, sam: roster[0] };
}

describe('classes', () => {
  it('creates a class with a code and link, lets a student join, and keeps classmates and the roster private', async () => {
    const t = await registered('Teach');
    const created = await t('POST', '/api/classes', { name: 'Robotics 101' });
    expect(created.status).toBe(201);
    const cls = created.body.class;
    expect(cls.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
    expect(cls.joinUrl).toBe('/?join=' + cls.joinCode.replace('-', ''));
    expect(created.body.membership).toMatchObject({ role: 'teacher', state: 'active' });
    expect((await t('POST', '/api/classes', { name: '   ' })).status).toBe(400);

    // Joining is case-insensitive and ignores the dash; a student never sees the code.
    const s = await registered('Sam');
    const joined = await s('POST', '/api/classes/join', { code: ' ' + cls.joinCode.toLowerCase() + ' ' });
    expect(joined.status).toBe(200);
    expect(joined.body.membership).toMatchObject({ role: 'student', state: 'active' });
    expect(joined.body.class.joinCode).toBeUndefined();
    expect((await s('POST', '/api/classes/join', { code: cls.joinCode })).status).toBe(200); // idempotent
    expect((await s('POST', '/api/classes/join', { code: 'ZZZ-ZZZ' })).status).toBe(404);
    expect((await s('POST', '/api/classes/join', { code: 'nope' })).status).toBe(404);

    const mine = (await s('GET', '/api/classes')).body.classes;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: cls.id, name: 'Robotics 101', teacher: { username: 'Teach' } });
    expect(mine[0].joinCode).toBeUndefined();
    const view = (await s('GET', `/api/classes/${cls.id}`)).body.class;
    expect(view.membership.state).toBe('active');
    expect(view.teacher.username).toBe('Teach');
    expect(view.joinCode).toBeUndefined();
    expect((await s('GET', `/api/classes/${cls.id}/roster`)).status).toBe(403);

    // A classmate joins; Sam never learns of them.
    const r = await registered('Riley');
    await r('POST', '/api/classes/join', { code: cls.joinCode });
    const everything = JSON.stringify([
      (await s('GET', '/api/classes')).body,
      (await s('GET', `/api/classes/${cls.id}`)).body,
      (await s('GET', `/api/classes/${cls.id}/resources`)).body,
    ]);
    expect(everything).not.toMatch(/Riley/);

    // The teacher sees both, by membership id, never by user id; the teacher's own view has the code.
    const roster = (await t('GET', `/api/classes/${cls.id}/roster`)).body.roster;
    expect(roster.map((m) => m.username)).toEqual(['Sam', 'Riley']);
    expect(roster[0]).not.toHaveProperty('userId');
    expect(roster[0]).toMatchObject({ state: 'active', rejoinAllowed: false });
    expect((await t('GET', `/api/classes/${cls.id}`)).body.class.joinCode).toBe(cls.joinCode);
    expect((await t('GET', '/api/classes')).body.classes[0].membership.role).toBe('teacher');

    // Non-members and anonymous users.
    const x = await registered('Xeno');
    expect((await x('GET', `/api/classes/${cls.id}`)).status).toBe(404);
    expect((await x('GET', `/api/classes/${cls.id}/roster`)).status).toBe(404);
    expect((await x('GET', `/api/classes/${cls.id}/resources`)).status).toBe(404);
    const anon = browser();
    expect((await anon('POST', '/api/classes', { name: 'Mine' })).status).toBe(403);
    expect((await anon('POST', '/api/classes/join', { code: cls.joinCode })).status).toBe(403);
    expect((await anon('GET', '/api/classes')).body.classes).toEqual([]);
  });

  it('removes and re-admits students, rotates the code, and archives the class', async () => {
    const { teacher: t, student: s, cls, sam } = await classroom();
    expect((await s('POST', `/api/classes/${cls.id}/members/${sam.id}/remove`, {})).status).toBe(403);
    expect((await t('POST', `/api/classes/${cls.id}/members/00000000-0000-0000-0000-000000000000/remove`, {})).status).toBe(404);

    const removed = await t('POST', `/api/classes/${cls.id}/members/${sam.id}/remove`, {});
    expect(removed.status).toBe(200);
    expect(removed.body.membership).toMatchObject({ state: 'removed', rejoinAllowed: false });
    expect((await s('GET', `/api/classes/${cls.id}`)).status).toBe(404);
    expect((await s('GET', '/api/classes')).body.classes).toEqual([]);
    expect((await s('POST', '/api/classes/join', { code: cls.joinCode })).status).toBe(403);
    expect((await t('GET', `/api/classes/${cls.id}/roster`)).body.roster[0].state).toBe('removed');

    await t('POST', `/api/classes/${cls.id}/members/${sam.id}/remove`, { allowRejoin: true });
    const back = await s('POST', '/api/classes/join', { code: cls.joinCode });
    expect(back.status).toBe(200);
    expect(back.body.membership.state).toBe('active');
    expect((await s('GET', `/api/classes/${cls.id}`)).status).toBe(200);

    // Rotate: the old code dies at once, the new one works.
    const old = cls.joinCode;
    expect((await s('POST', `/api/classes/${cls.id}/code`)).status).toBe(403);
    const rotated = (await t('POST', `/api/classes/${cls.id}/code`)).body.class;
    expect(rotated.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
    expect(rotated.joinCode).not.toBe(old);
    const r = await registered('Riley');
    expect((await r('POST', '/api/classes/join', { code: old })).status).toBe(404);
    expect((await r('POST', '/api/classes/join', { code: rotated.joinCode })).status).toBe(200);

    // Archive: no more joins or teacher writes; members read it as archived.
    expect((await s('POST', `/api/classes/${cls.id}/archive`)).status).toBe(403);
    const archived = await t('POST', `/api/classes/${cls.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.class.archivedAt).toBeTruthy();
    expect(archived.body.archivedMemberships).toBe(3);
    const z = await registered('Zed');
    expect((await z('POST', '/api/classes/join', { code: rotated.joinCode })).status).toBe(409);
    expect((await t('POST', `/api/classes/${cls.id}/code`)).status).toBe(409);
    expect((await t('POST', `/api/classes/${cls.id}/archive`)).status).toBe(409);
    expect((await t('POST', `/api/classes/${cls.id}/members/${sam.id}/remove`, {})).status).toBe(409);
    expect((await s('GET', `/api/classes/${cls.id}`)).body.class).toMatchObject({ archivedAt: expect.any(String), membership: { state: 'archived' } });
    expect((await t('GET', `/api/classes/${cls.id}`)).body.class.membership.state).toBe('archived');
    expect((await t('GET', `/api/classes/${cls.id}/roster`)).body.roster.map((m) => m.state)).toEqual(['archived', 'archived']);
  });

  it("lets the teacher reset an active student's password and signs that student out everywhere", async () => {
    const { teacher: t, student: s, cls, sam } = await classroom();
    const samProfiles = ids((await s('GET', '/api/profiles')).body.profiles);
    expect((await s('POST', `/api/classes/${cls.id}/members/${sam.id}/password`, { password: 'newpass1' })).status).toBe(403);
    expect((await t('POST', `/api/classes/${cls.id}/members/${sam.id}/password`, { password: '123' })).status).toBe(400);

    // A household browser signed in as Sam: after the reset it is back to its own anonymous user.
    const h = browser();
    const home = ids((await h('GET', '/api/profiles')).body.profiles);
    expect((await h('POST', '/api/account/signin', { username: 'Sam', password: 'secret1' })).status).toBe(200);
    expect(ids((await h('GET', '/api/profiles')).body.profiles)).toEqual(samProfiles);

    const reset = await t('POST', `/api/classes/${cls.id}/members/${sam.id}/password`, { password: 'newpass1' });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ ok: true, revokedSessions: 2 });
    expect((await s('GET', '/api/profiles')).status).toBe(401); // Sam's own browser had no household behind it
    expect(ids((await h('GET', '/api/profiles')).body.profiles)).toEqual(home);
    expect((await h('POST', '/api/session', {})).body.account.username).toBeNull();

    const s2 = browser();
    expect((await s2('POST', '/api/account/signin', { username: 'Sam', password: 'secret1' })).status).toBe(401);
    const back = await s2('POST', '/api/account/signin', { username: 'Sam', password: 'newpass1' });
    expect(back.status).toBe(200);
    expect(ids(back.body.profiles)).toEqual(samProfiles);

    // Only an active student of this class: not a removed one, not a stranger's membership id.
    await t('POST', `/api/classes/${cls.id}/members/${sam.id}/remove`, {});
    expect((await t('POST', `/api/classes/${cls.id}/members/${sam.id}/password`, { password: 'newpass2' })).status).toBe(404);
    const other = await registered('Other');
    const otherClass = (await other('POST', '/api/classes', { name: 'Elsewhere' })).body.class;
    expect((await other('POST', `/api/classes/${otherClass.id}/members/${sam.id}/password`, { password: 'newpass2' })).status).toBe(404);
    expect(JSON.stringify([reset.body, back.body])).not.toMatch(/scrypt\$|passwordHash/);
  });

  it('publishes snapshots the teacher cannot later change, and students copy them into their own profile', async () => {
    const { teacher: t, student: s, cls } = await classroom();
    const tp = (await t('GET', '/api/profiles')).body.profiles[0];
    const floor = (await t('POST', `/api/profiles/${tp.id}/floors`, { name: 'Maze', width: 160 })).body.floor;
    const program = (await t('POST', `/api/profiles/${tp.id}/programs`, { name: 'Solve the maze', code: 'print(1)\n', floorId: floor.id, exerciseRef: '9.3' })).body.program;
    const sp = (await s('GET', '/api/profiles')).body.profiles[0];
    const sProgram = (await s('POST', `/api/profiles/${sp.id}/programs`, { name: 'Mine' })).body.program;
    const before = (await s('GET', `/api/profiles/${sp.id}/programs`)).body.programs.length;

    expect((await s('POST', `/api/classes/${cls.id}/resources`, { programId: sProgram.id })).status).toBe(403);
    expect((await t('POST', `/api/classes/${cls.id}/resources`, { programId: sProgram.id })).status).toBe(404); // not the teacher's row
    expect((await t('POST', `/api/classes/${cls.id}/resources`, {})).status).toBe(400);

    const published = await t('POST', `/api/classes/${cls.id}/resources`, { programId: program.id });
    expect(published.status).toBe(201);
    const res = published.body.resource;
    expect(res).toMatchObject({ kind: 'program', name: 'Solve the maze', floorName: 'Maze', exerciseRef: '9.3', unpublishedAt: null, example: null });
    expect(res).not.toHaveProperty('publishedBy');
    expect(res).not.toHaveProperty('snapshot');
    expect(ids((await s('GET', `/api/classes/${cls.id}/resources`)).body.resources)).toEqual([res.id]);

    // The teacher keeps editing; the snapshot does not move.
    await t('PUT', `/api/programs/${program.id}`, { code: 'print(2)\n' });
    await t('PUT', `/api/floors/${floor.id}`, { width: 200 });

    expect((await s('POST', `/api/class-resources/${res.id}/copy`, { profileId: tp.id })).status).toBe(404);
    expect((await s('POST', `/api/class-resources/${res.id}/copy`, {})).status).toBe(404);
    const copied = await s('POST', `/api/class-resources/${res.id}/copy`, { profileId: sp.id });
    expect(copied.status).toBe(201);
    expect(copied.body.program).toMatchObject({ profileId: sp.id, name: 'Solve the maze', code: 'print(1)\n', exerciseRef: '9.3' });
    expect(copied.body.floor).toMatchObject({ profileId: sp.id, name: 'Maze', width: 160 });
    expect(copied.body.floor.id).not.toBe(floor.id);
    expect(copied.body.program.floorId).toBe(copied.body.floor.id);
    expect(copied.body.entries).toHaveLength(1);
    expect(copied.body.entries[0]).toMatchObject({ profileId: sp.id, lesson: 9, exercise: 3, done: false, programId: copied.body.program.id, floorId: copied.body.floor.id });
    expect((await s('GET', `/api/profiles/${sp.id}/programs`)).body.programs).toHaveLength(before + 1);
    // A second copy is another independent copy; the workbook attachment already made is left alone.
    const again = await s('POST', `/api/class-resources/${res.id}/copy`, { profileId: sp.id });
    expect(again.status).toBe(201);
    expect(again.body.entries).toEqual([]);
    expect((await s('GET', `/api/profiles/${sp.id}/workbook`)).body.entries[0].programId).toBe(copied.body.program.id);

    // Republish makes a second row; unpublish hides it from the student but not the teacher.
    const second = (await t('POST', `/api/classes/${cls.id}/resources`, { programId: program.id })).body.resource;
    expect(ids((await s('GET', `/api/classes/${cls.id}/resources`)).body.resources)).toEqual([second.id, res.id]);
    expect((await s('POST', `/api/class-resources/${res.id}/unpublish`)).status).toBe(403);
    expect((await t('POST', `/api/class-resources/${res.id}/unpublish`)).status).toBe(200);
    expect(ids((await s('GET', `/api/classes/${cls.id}/resources`)).body.resources)).toEqual([second.id]);
    expect(ids((await t('GET', `/api/classes/${cls.id}/resources`)).body.resources)).toEqual([second.id, res.id]);
    expect((await s('POST', `/api/class-resources/${res.id}/copy`, { profileId: sp.id })).status).toBe(404);
    expect((await t('POST', `/api/class-resources/${res.id}/unpublish`)).status).toBe(409);

    // A floor alone.
    const floorOnly = (await t('POST', `/api/classes/${cls.id}/resources`, { floorId: floor.id })).body.resource;
    expect(floorOnly).toMatchObject({ kind: 'floor', name: 'Maze', floorName: 'Maze', exerciseRef: null });
    const floorCopy = await s('POST', `/api/class-resources/${floorOnly.id}/copy`, { profileId: sp.id });
    expect(floorCopy.status).toBe(201);
    expect(floorCopy.body.program).toBeNull();
    expect(floorCopy.body.floor).toMatchObject({ profileId: sp.id, width: 200 });
    expect(floorCopy.body.entries).toEqual([]);

    // Nobody outside the class sees or copies anything; after archiving, nobody copies.
    const x = await registered('Xeno');
    expect((await x('GET', `/api/classes/${cls.id}/resources`)).status).toBe(404);
    const xp = (await x('GET', '/api/profiles')).body.profiles[0];
    expect((await x('POST', `/api/class-resources/${second.id}/copy`, { profileId: xp.id })).status).toBe(404);
    await t('POST', `/api/classes/${cls.id}/archive`);
    expect((await s('POST', `/api/class-resources/${second.id}/copy`, { profileId: sp.id })).status).toBe(409);
    expect(ids((await s('GET', `/api/classes/${cls.id}/resources`)).body.resources)).toEqual([floorOnly.id, second.id]);
  });
});
