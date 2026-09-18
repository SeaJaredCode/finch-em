// Sent copies (itch-18, d-38): a student sends the teacher an immutable copy of any of their programs
// with a message; the teacher reads, duplicates and replies; nobody else sees it; copies stay the
// class's record. One makeBrowser() per person on the memory store.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app.js';
import { resetStoreForTests } from '../src/store/index.js';
import { createMemoryStore } from '../src/store/memory.js';
import { makeBrowser } from './helpers/browser.js';

let server;
let base;

beforeEach(async () => {
  resetStoreForTests(createMemoryStore());
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

async function registered(username) {
  const b = browser();
  expect((await b('POST', '/api/account/register', { username, password: 'secret1' })).status).toBe(200);
  return b;
}

const firstProfile = async (b) => (await b('GET', '/api/profiles')).body.profiles[0];

/** Teacher, Sam and Riley in one class; Sam has a personal program on her own floor. */
async function setup() {
  const teacher = await registered('Teach');
  const cls = (await teacher('POST', '/api/classes', { name: 'Robotics 101' })).body.class;
  const sam = await registered('Sam');
  const riley = await registered('Riley');
  await sam('POST', '/api/classes/join', { code: cls.joinCode });
  await riley('POST', '/api/classes/join', { code: cls.joinCode });
  const roster = (await teacher('GET', `/api/classes/${cls.id}/roster`)).body.roster;
  const sp = await firstProfile(sam);
  const room = (await sam('POST', `/api/profiles/${sp.id}/floors`, { name: 'Sam room', width: 150 })).body.floor;
  const program = (await sam('POST', `/api/profiles/${sp.id}/programs`, { name: 'Stuck loop', code: 'while True:\n    pass\n', floorId: room.id })).body.program;
  return {
    teacher,
    sam,
    riley,
    cls,
    sp,
    tp: await firstProfile(teacher),
    rp: await firstProfile(riley),
    room,
    program,
    samM: roster.find((m) => m.username === 'Sam'),
    rileyM: roster.find((m) => m.username === 'Riley'),
  };
}

const send = (b, cls, program, message) => b('POST', `/api/classes/${cls.id}/sent-copies`, { programId: program.id, message });
const teacherList = async (b, cls) => (await b('GET', `/api/classes/${cls.id}/sent-copies`)).body.copies;
const mine = (b, cls) => b('GET', `/api/classes/${cls.id}/sent-copies/mine`);

describe('sent copies', () => {
  it('sends an immutable copy the teacher opens, duplicates and answers; nobody else sees it', async () => {
    const { teacher, sam, riley, cls, sp, tp, rp, room, program, samM } = await setup();

    const sent = await send(sam, cls, program, '  Why does this never stop?  ');
    expect(sent.status).toBe(201);
    expect(sent.body.copy).toMatchObject({
      classId: cls.id,
      message: 'Why does this never stop?',
      program: { name: 'Stuck loop', code: 'while True:\n    pass\n', floorId: null },
      floor: { name: 'Sam room', width: 150 },
      reply: null,
    });
    const copy = sent.body.copy;

    // Later edits do not reach the copy.
    await sam('PUT', `/api/programs/${program.id}`, { code: 'print("fixed")\n' });
    await sam('PUT', `/api/floors/${room.id}`, { width: 300 });
    let list = await teacherList(teacher, cls);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: copy.id, message: 'Why does this never stop?', author: { username: 'Sam', state: 'active' } });
    expect(list[0].program.code).toBe('while True:\n    pass\n');
    expect(list[0].floor.width).toBe(150);

    // Duplicate into the teacher's profile.
    expect((await teacher('POST', `/api/sent-copies/${copy.id}/duplicate`, { profileId: sp.id })).status).toBe(404);
    const dup = await teacher('POST', `/api/sent-copies/${copy.id}/duplicate`, { profileId: tp.id });
    expect(dup.status).toBe(201);
    expect(dup.body.program).toMatchObject({ profileId: tp.id, name: "Stuck loop (Sam's copy)", code: 'while True:\n    pass\n', assignmentId: null });
    expect(dup.body.floor).toMatchObject({ profileId: tp.id, name: 'Sam room', width: 150, locked: false });
    expect(dup.body.program.floorId).toBe(dup.body.floor.id);

    // Reply, and Sam reads it.
    expect((await teacher('PUT', `/api/sent-copies/${copy.id}/reply`, {})).status).toBe(400);
    expect((await teacher('PUT', `/api/sent-copies/${copy.id}/reply`, { comment: 'x'.repeat(4001) })).status).toBe(400);
    const replied = await teacher('PUT', `/api/sent-copies/${copy.id}/reply`, { comment: 'Add a break when it reaches the wall.' });
    expect(replied.status).toBe(200);
    expect(replied.body.copy.reply.comment).toBe('Add a break when it reaches the wall.');
    const own = (await mine(sam, cls)).body.copies;
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ id: copy.id, reply: { comment: 'Add a break when it reaches the wall.' } });
    expect(own[0]).not.toHaveProperty('author');

    // Nobody else.
    expect((await mine(riley, cls)).body.copies).toEqual([]);
    expect((await riley('GET', `/api/classes/${cls.id}/sent-copies`)).status).toBe(403);
    expect((await riley('PUT', `/api/sent-copies/${copy.id}/reply`, { comment: 'hi' })).status).toBe(404);
    expect((await riley('POST', `/api/sent-copies/${copy.id}/duplicate`, { profileId: rp.id })).status).toBe(404);
    expect((await sam('PUT', `/api/sent-copies/${copy.id}/reply`, { comment: 'me' })).status).toBe(403);
    expect((await sam('POST', `/api/sent-copies/${copy.id}/duplicate`, { profileId: sp.id })).status).toBe(403);
    expect((await mine(teacher, cls)).status).toBe(403);
    const x = await registered('Xeno');
    expect((await mine(x, cls)).status).toBe(404);
    expect((await x('GET', `/api/classes/${cls.id}/sent-copies`)).status).toBe(404);
    expect((await x('PUT', `/api/sent-copies/${copy.id}/reply`, { comment: 'x' })).status).toBe(404);

    // No ids leak to either reader.
    const blob = JSON.stringify([own, list, replied.body]);
    for (const id of [sp.id, program.id, room.id, samM.id]) expect(blob).not.toContain(id);
    expect(blob).not.toMatch(/sourceProgramId|membershipId|userId|profileId|repliedBy/);

    // A sent copy is not an attempt: the submission routes do not know it, and progress is unchanged.
    expect((await teacher('PUT', `/api/submissions/${copy.id}/review`, { status: 'reviewed' })).status).toBe(404);
    expect((await teacher('POST', `/api/submissions/${copy.id}/publish`, {})).status).toBe(404);
    expect((await teacher('POST', `/api/submissions/${copy.id}/duplicate`, { profileId: tp.id })).status).toBe(404);
    const a = (await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 1, exercise: 1 })).body.assignment;
    const progress = (await teacher('GET', `/api/assignments/${a.id}/progress`)).body.students.find((s) => s.username === 'Sam');
    expect(progress).toMatchObject({ status: 'not started', attempts: 0 });

    // Riley's own sends are hers, whatever the body claims; she cannot send Sam's program.
    list = await teacherList(teacher, cls);
    expect((await send(riley, cls, program, 'not mine')).status).toBe(404);
    const rileyProgram = (await riley('GET', `/api/profiles/${rp.id}/programs`)).body.programs[0];
    const forged = await riley('POST', `/api/classes/${cls.id}/sent-copies`, { programId: rileyProgram.id, membershipId: samM.id });
    expect(forged.status).toBe(201);
    expect((await teacherList(teacher, cls))[0].author.username).toBe('Riley');
    expect((await mine(sam, cls)).body.copies).toHaveLength(1);
  });

  it('refuses teachers, strangers and bad input, and keeps copies as the class record', async () => {
    const { teacher, sam, cls, sp, tp, program, samM } = await setup();
    const tprog = (await teacher('GET', `/api/profiles/${tp.id}/programs`)).body.programs[0];
    expect((await send(teacher, cls, tprog)).status).toBe(403);
    expect((await sam('POST', `/api/classes/${cls.id}/sent-copies`, { programId: 'nope' })).status).toBe(404);
    expect((await send(sam, cls, program, 'x'.repeat(1001))).status).toBe(400);
    expect((await send(sam, cls, program, 42)).status).toBe(400);
    const plain = (await sam('POST', `/api/profiles/${sp.id}/programs`, { name: 'Plain', floorId: 'y-branch' })).body.program;
    const onBuiltin = (await send(sam, cls, plain)).body.copy;
    expect(onBuiltin).toMatchObject({ message: '', floor: null, program: { floorId: 'y-branch' } });
    const copy = (await send(sam, cls, program, 'help')).body.copy;

    // Removal: the teacher keeps the record; Sam loses it and cannot send.
    await teacher('POST', `/api/classes/${cls.id}/members/${samM.id}/remove`, { allowRejoin: true });
    const list = await teacher('GET', `/api/classes/${cls.id}/sent-copies`);
    expect(list.body.copies.map((c) => c.author.state)).toEqual(['removed', 'removed']);
    expect((await mine(sam, cls)).status).toBe(404);
    expect((await send(sam, cls, program)).status).toBe(404);
    expect((await teacher('PUT', `/api/sent-copies/${copy.id}/reply`, { comment: 'Still here.' })).status).toBe(200);

    // Rejoin brings them back.
    await sam('POST', '/api/classes/join', { code: (await teacher('GET', `/api/classes/${cls.id}`)).body.class.joinCode });
    expect((await mine(sam, cls)).body.copies.map((c) => c.id)).toEqual([copy.id, onBuiltin.id]);

    // Archive: reads and duplicates continue; sending and replying stop.
    await teacher('POST', `/api/classes/${cls.id}/archive`);
    expect((await send(sam, cls, program)).status).toBe(409);
    expect((await teacher('PUT', `/api/sent-copies/${copy.id}/reply`, { comment: 'late' })).status).toBe(409);
    expect((await teacher('GET', `/api/classes/${cls.id}/sent-copies`)).body.copies).toHaveLength(2);
    expect((await mine(sam, cls)).body.copies[0].reply.comment).toBe('Still here.');
    expect((await teacher('POST', `/api/sent-copies/${copy.id}/duplicate`, { profileId: tp.id })).status).toBe(201);

    // Deleting the source program leaves the copy.
    expect((await sam('DELETE', `/api/programs/${program.id}`)).status).toBe(204);
    expect((await mine(sam, cls)).body.copies[0].program.code).toBe('while True:\n    pass\n');
  });

  it('offers no way to change or remove a sent copy', () => {
    const store = createMemoryStore();
    expect(Object.keys(store).filter((k) => /SentCop/.test(k)).sort()).toEqual(['createSentCopy', 'getSentCopy', 'listSentCopies', 'upsertSentCopyReply']);
    const src = new URL('../src/', import.meta.url);
    expect(readFileSync(new URL('store/pg.js', src), 'utf8')).not.toMatch(/UPDATE\s+sent_copies\b|DELETE\s+FROM\s+sent_copies\b/i);
    const routes = readFileSync(new URL('routes/api.js', src), 'utf8');
    expect(routes).not.toMatch(/apiRouter\.(delete|patch)\([^)]*sent-copies/);
    expect(routes.match(/apiRouter\.put\('[^']*sent-copies[^']*'/g)).toEqual(["apiRouter.put('/sent-copies/:id/reply'"]);
    expect(readFileSync(new URL('sentcopies.js', src), 'utf8')).not.toMatch(/body\.membershipId|body\.userId|body\.classId/);
  });
});
