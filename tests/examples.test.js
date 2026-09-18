// Peer examples (itch-17, d-37): a teacher publishes a student's turned-in attempt to the class,
// anonymously or by name; classmates run and copy it and learn nothing else about the author; the
// author sees it is shared; it hides while the author is out of the class. One makeBrowser() per person.
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

/** Teacher, Sam (the author) and Riley (a classmate); Sam has turned in one attempt on the assignment's floor. */
async function setup() {
  const teacher = await registered('Teach');
  const cls = (await teacher('POST', '/api/classes', { name: 'Robotics 101' })).body.class;
  const sam = await registered('Sam');
  const riley = await registered('Riley');
  await sam('POST', '/api/classes/join', { code: cls.joinCode });
  await riley('POST', '/api/classes/join', { code: cls.joinCode });
  const roster = (await teacher('GET', `/api/classes/${cls.id}/roster`)).body.roster;
  const tp = await firstProfile(teacher);
  const floor = (await teacher('POST', `/api/profiles/${tp.id}/floors`, { name: 'Maze', width: 160 })).body.floor;
  const starter = (await teacher('POST', `/api/profiles/${tp.id}/programs`, { name: 'Maze starter', code: 'print("go")\n', floorId: floor.id })).body.program;
  const assignment = (await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 5, exercise: 12, starterProgramId: starter.id })).body.assignment;
  const sp = await firstProfile(sam);
  const started = (await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: sp.id })).body;
  // The author names her work after herself; that must not reach classmates.
  await sam('PUT', `/api/programs/${started.program.id}`, { name: "Sam's maze", code: 'print("left, left, right")\n' });
  const first = (await sam('POST', `/api/assignments/${assignment.id}/submissions`, { programId: started.program.id })).body.submission;
  return {
    teacher,
    sam,
    riley,
    cls,
    tp,
    sp,
    rp: await firstProfile(riley),
    assignment,
    program: started.program,
    floorCopy: started.floor,
    first,
    samM: roster.find((m) => m.username === 'Sam'),
  };
}

const publish = (b, submission, body = {}) => b('POST', `/api/submissions/${submission.id}/publish`, body);
const resources = async (b, cls) => (await b('GET', `/api/classes/${cls.id}/resources`)).body.resources;

describe('peer examples', () => {
  it('publishes an attempt anonymously or by name; classmates run and copy it and learn nothing else about the author', async () => {
    const { teacher, sam, riley, cls, sp, rp, assignment, program, floorCopy, first, samM } = await setup();

    // Refusals and validation.
    expect((await publish(riley, first)).status).toBe(404);
    expect((await publish(sam, first)).status).toBe(403);
    expect((await publish(teacher, first, { attribution: 'everyone' })).status).toBe(400);
    expect((await publish(teacher, first, { note: 'x'.repeat(501) })).status).toBe(400);
    expect((await publish(teacher, first, { title: 42 })).status).toBe(400);
    expect((await teacher('POST', '/api/submissions/nope/publish', {})).status).toBe(404);

    const made = await publish(teacher, first, { note: 'Look at how the turns are ordered.' });
    expect(made.status).toBe(201);
    const example = made.body.resource;
    expect(example).toMatchObject({
      kind: 'program',
      name: 'Example: Lesson 5 exercise 12',
      exerciseRef: '5.12',
      example: { byline: 'A classmate', note: 'Look at how the turns are ordered.', attribution: 'anonymous', author: { username: 'Sam', state: 'active' }, hidden: false },
    });
    expect((await publish(teacher, first)).status).toBe(409);

    // Riley sees it with the byline and note only, runs it and copies it.
    const seen = (await resources(riley, cls)).find((r) => r.id === example.id);
    expect(seen.example).toEqual({ byline: 'A classmate', note: 'Look at how the turns are ordered.' });
    const snap = (await riley('GET', `/api/class-resources/${example.id}/snapshot`)).body;
    expect(snap.program).toMatchObject({ name: 'Example: Lesson 5 exercise 12', code: 'print("left, left, right")\n', floorId: null });
    expect(snap.floor).toMatchObject({ name: 'Example: Lesson 5 exercise 12 floor', width: 160 });
    const copy = await riley('POST', `/api/class-resources/${example.id}/copy`, { profileId: rp.id });
    expect(copy.status).toBe(201);
    expect(copy.body.program).toMatchObject({ profileId: rp.id, name: 'Example: Lesson 5 exercise 12', code: 'print("left, left, right")\n', assignmentId: null });
    expect(copy.body.floor).toMatchObject({ profileId: rp.id, locked: false, assignmentId: null });

    // Nothing Riley receives names or identifies Sam.
    const everything = JSON.stringify([
      await resources(riley, cls),
      snap,
      copy.body,
      (await riley('GET', `/api/classes/${cls.id}`)).body,
      (await riley('GET', `/api/assignments/${assignment.id}/submissions/mine`)).body,
    ]);
    expect(everything).not.toMatch(/Sam/);
    for (const id of [samM.id, sp.id, program.id, floorCopy.id, first.id]) expect(everything).not.toContain(id);

    // Sam and the teacher see the attempt as shared, anonymously.
    let mine = (await sam('GET', `/api/assignments/${assignment.id}/submissions/mine`)).body.submissions;
    expect(mine[0].shared).toBe('anonymous');
    expect((await teacher('GET', `/api/assignments/${assignment.id}/submissions/${samM.id}`)).body.submissions[0].shared).toBe('anonymous');

    // Later work does not move the example.
    await sam('PUT', `/api/programs/${program.id}`, { code: 'print("rewritten")\n' });
    const second = (await sam('POST', `/api/assignments/${assignment.id}/submissions`, { programId: program.id })).body.submission;
    expect(second.shared).toBeNull();
    expect((await riley('GET', `/api/class-resources/${example.id}/snapshot`)).body.program.code).toBe('print("left, left, right")\n');

    // By name, with a title.
    const named = (await publish(teacher, second, { attribution: 'name', title: 'A tidy rewrite' })).body.resource;
    expect(named).toMatchObject({ name: 'A tidy rewrite', example: { byline: 'Sam', attribution: 'name', note: '' } });
    expect((await resources(riley, cls)).find((r) => r.id === named.id).example).toEqual({ byline: 'Sam', note: '' });
    mine = (await sam('GET', `/api/assignments/${assignment.id}/submissions/mine`)).body.submissions;
    expect(mine.map((a) => a.shared)).toEqual(['anonymous', 'name']);

    // Unpublish hides it and frees the attempt; publishing again makes a new row.
    const off = await teacher('POST', `/api/class-resources/${example.id}/unpublish`);
    expect(off.status).toBe(200);
    expect(off.body.resource).toMatchObject({ unpublishedAt: expect.any(String), example: { byline: 'A classmate', attribution: 'anonymous' } });
    expect((await resources(riley, cls)).map((r) => r.id)).not.toContain(example.id);
    expect((await riley('GET', `/api/class-resources/${example.id}/snapshot`)).status).toBe(404);
    expect((await sam('GET', `/api/assignments/${assignment.id}/submissions/mine`)).body.submissions[0].shared).toBeNull();
    const again = await publish(teacher, first, { attribution: 'name' });
    expect(again.status).toBe(201);
    expect(again.body.resource.id).not.toBe(example.id);
    expect((await sam('GET', `/api/assignments/${assignment.id}/submissions/mine`)).body.submissions[0].shared).toBe('name');

    // Teacher resources are unchanged: no example.
    const own = (await teacher('POST', `/api/classes/${cls.id}/resources`, { programId: (await teacher('GET', `/api/profiles/${(await firstProfile(teacher)).id}/programs`)).body.programs[0].id })).body.resource;
    expect(own.example).toBeNull();
  });

  it('hides a removed author\'s examples from classmates, shows them again on rejoin, keeps them through archive, and refuses what it should', async () => {
    const { teacher, sam, riley, cls, rp, assignment, program, first, samM } = await setup();
    const second = (await sam('POST', `/api/assignments/${assignment.id}/submissions`, { programId: program.id })).body.submission;
    const example = (await publish(teacher, first, { attribution: 'name', note: 'Nice' })).body.resource;
    expect((await resources(riley, cls)).map((r) => r.id)).toContain(example.id);

    await teacher('POST', `/api/classes/${cls.id}/members/${samM.id}/remove`, { allowRejoin: true });
    expect((await resources(riley, cls)).map((r) => r.id)).not.toContain(example.id);
    expect((await riley('GET', `/api/class-resources/${example.id}/snapshot`)).status).toBe(404);
    expect((await riley('POST', `/api/class-resources/${example.id}/copy`, { profileId: rp.id })).status).toBe(404);
    const forTeacher = (await resources(teacher, cls)).find((r) => r.id === example.id);
    expect(forTeacher.example).toMatchObject({ hidden: true, author: { username: 'Sam', state: 'removed' } });
    expect((await publish(teacher, second)).status).toBe(409); // the author is out of the class

    // Rejoining brings the example back.
    await sam('POST', '/api/classes/join', { code: (await teacher('GET', `/api/classes/${cls.id}`)).body.class.joinCode });
    expect((await resources(riley, cls)).find((r) => r.id === example.id).example).toEqual({ byline: 'Sam', note: 'Nice' });
    expect((await sam('GET', `/api/classes/${cls.id}/resources`)).body.resources.map((r) => r.id)).toContain(example.id);

    // A teacher of another class cannot publish this attempt.
    const other = await registered('Otto');
    await other('POST', '/api/classes', { name: 'Elsewhere' });
    expect((await publish(other, second)).status).toBe(404);

    // Archive: classmates still see it; nothing new is published.
    await teacher('POST', `/api/classes/${cls.id}/archive`);
    expect((await resources(riley, cls)).map((r) => r.id)).toContain(example.id);
    expect((await publish(teacher, second)).status).toBe(409);
  });

  it('lets only createExample write a peer example', async () => {
    const store = createMemoryStore();
    await expect(store.createResource({ classId: 'c', publishedBy: 'u', kind: 'program', name: 'x', snapshot: {}, submissionId: 's' })).rejects.toThrow(/createExample/);
    expect(await store.createExample({ classId: 'c', publishedBy: 'u', submissionId: 'missing', attribution: 'anonymous', note: '', name: 'x' })).toBeNull();
  });
});
