// Assignments (itch-15, d-34): a teacher sets a workbook exercise with a starter; students Start
// their own linked copy; the teacher follows progress and reads those drafts and nothing else.
// One makeBrowser() per person on the memory store.
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

/** A class with a teacher, two students, and one assignment with a starter on a custom floor. */
async function setup({ allowFloorEdit = false } = {}) {
  const teacher = await registered('Teach');
  const cls = (await teacher('POST', '/api/classes', { name: 'Robotics 101' })).body.class;
  const sam = await registered('Sam');
  const riley = await registered('Riley');
  await sam('POST', '/api/classes/join', { code: cls.joinCode });
  await riley('POST', '/api/classes/join', { code: cls.joinCode });
  const roster = (await teacher('GET', `/api/classes/${cls.id}/roster`)).body.roster;
  const tp = await firstProfile(teacher);
  const floor = (await teacher('POST', `/api/profiles/${tp.id}/floors`, { name: 'Maze', width: 160 })).body.floor;
  const program = (await teacher('POST', `/api/profiles/${tp.id}/programs`, { name: 'Maze starter', code: 'print("go")\n', floorId: floor.id })).body.program;
  const created = await teacher('POST', `/api/classes/${cls.id}/assignments`, {
    lesson: 5,
    exercise: 12,
    starterProgramId: program.id,
    instructions: 'Get through the maze.',
    dueAt: '2026-10-01T12:00:00Z',
    allowFloorEdit,
  });
  expect(created.status).toBe(201);
  return {
    teacher,
    sam,
    riley,
    cls,
    floor,
    program,
    assignment: created.body.assignment,
    samM: roster.find((m) => m.username === 'Sam'),
    rileyM: roster.find((m) => m.username === 'Riley'),
  };
}

describe('assignments', () => {
  it('lets only the teacher of an open class create one, with a snapshotted starter and floor', async () => {
    const { teacher, sam, cls, floor, program, assignment } = await setup();
    expect(assignment).toMatchObject({
      classId: cls.id,
      lesson: 5,
      exercise: 12,
      exerciseRef: '5.12',
      title: 'Lesson 5 exercise 12',
      instructions: 'Get through the maze.',
      dueAt: '2026-10-01T12:00:00.000Z',
      allowFloorEdit: false,
      requireRun: false,
      starterName: 'Maze starter',
      floorName: 'Maze',
      closedAt: null,
    });
    expect(assignment.starter.program).toMatchObject({ name: 'Maze starter', code: 'print("go")\n', floorId: null, exerciseRef: '5.12' });
    expect(assignment.starter.floor).toMatchObject({ name: 'Maze', width: 160 });
    expect(assignment).not.toHaveProperty('createdBy');

    // The teacher keeps editing; the starter does not move.
    await teacher('PUT', `/api/programs/${program.id}`, { code: 'print("changed")\n' });
    await teacher('PUT', `/api/floors/${floor.id}`, { width: 200 });
    const seen = (await sam('GET', `/api/assignments/${assignment.id}`)).body.assignment;
    expect(seen.starter.program.code).toBe('print("go")\n');
    expect(seen.starter.floor.width).toBe(160);
    expect(JSON.stringify(seen)).not.toMatch(/createdBy|joinCode/);

    // Refusals.
    const sp = await firstProfile(sam);
    const samProgram = (await sam('POST', `/api/profiles/${sp.id}/programs`, { name: 'Mine' })).body.program;
    expect((await sam('POST', `/api/classes/${cls.id}/assignments`, { lesson: 1, exercise: 1 })).status).toBe(403);
    expect((await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 99, exercise: 1 })).status).toBe(404);
    expect((await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 1, exercise: 7 })).status).toBe(404);
    expect((await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 1, exercise: 1, starterProgramId: samProgram.id })).status).toBe(404);
    expect((await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 1, exercise: 1, dueAt: 'soon' })).status).toBe(400);
    const x = await registered('Xeno');
    expect((await x('GET', `/api/classes/${cls.id}/assignments`)).status).toBe(404);
    expect((await x('GET', `/api/assignments/${assignment.id}`)).status).toBe(404);

    // No starter: a built-in floor, the lesson's suggestion by default.
    const plain = (await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 9, exercise: 4 })).body.assignment;
    expect(plain).toMatchObject({ floorId: 'y-branch', starterName: null, floorName: null, starter: { program: null, floor: null } });
    const list = (await sam('GET', `/api/classes/${cls.id}/assignments`)).body.assignments;
    expect(list.map((a) => a.id)).toEqual([plain.id, assignment.id]);
    expect(list[0]).not.toHaveProperty('starter');
  });

  it('Start makes one linked copy in the student profile with a locked floor, and leaves the personal workbook alone', async () => {
    const { teacher, sam, assignment } = await setup();
    const sp = await firstProfile(sam);
    const workbookBefore = (await sam('GET', `/api/profiles/${sp.id}/workbook`)).body.entries;
    const tp = await firstProfile(teacher);
    expect((await teacher('POST', `/api/assignments/${assignment.id}/start`, { profileId: tp.id })).status).toBe(403);
    expect((await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: tp.id })).status).toBe(404);

    const started = await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: sp.id });
    expect(started.status).toBe(201);
    const { program, floor } = started.body;
    expect(program).toMatchObject({ profileId: sp.id, name: 'Maze starter', code: 'print("go")\n', exerciseRef: '5.12', assignmentId: assignment.id, floorId: floor.id });
    expect(floor).toMatchObject({ profileId: sp.id, name: 'Maze', width: 160, locked: true, assignmentId: assignment.id });

    const again = await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: sp.id });
    expect(again.status).toBe(200);
    expect(again.body.program.id).toBe(program.id);
    expect(again.body.created).toBe(false);

    // The floor copy is read-only; a copy of it is not, and the program is still hers to edit.
    expect((await sam('PUT', `/api/floors/${floor.id}`, { width: 300 })).status).toBe(409);
    expect((await sam('DELETE', `/api/floors/${floor.id}`)).status).toBe(409);
    const copy = await sam('POST', `/api/profiles/${sp.id}/floors`, { name: 'Maze copy', width: 160 });
    expect(copy.body.floor.locked).toBe(false);
    expect((await sam('PUT', `/api/programs/${program.id}`, { code: 'print("mine")\n' })).status).toBe(200);
    // The program routes cannot write the link.
    const forged = (await sam('POST', `/api/profiles/${sp.id}/programs`, { name: 'Forged', assignmentId: assignment.id })).body.program;
    expect(forged.assignmentId).toBeNull();
    // A hand-off copy of the linked program is an ordinary program.
    const second = (await sam('POST', '/api/profiles', { name: 'Second' })).body.profile;
    const handed = (await sam('POST', `/api/programs/${program.id}/handoff`, { profileId: second.id })).body;
    expect(handed.program.assignmentId).toBeNull();
    expect(handed.floor.locked).toBe(false);

    expect((await sam('GET', `/api/profiles/${sp.id}/workbook`)).body.entries).toEqual(workbookBefore);

    // Another profile of hers may start its own copy.
    expect((await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: second.id })).status).toBe(201);
  });

  it('allows floor edits when the assignment says so, and starts an empty program when there is no starter', async () => {
    const { teacher, sam, cls, assignment } = await setup({ allowFloorEdit: true });
    const sp = await firstProfile(sam);
    const { floor } = (await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: sp.id })).body;
    expect(floor.locked).toBe(false);
    expect((await sam('PUT', `/api/floors/${floor.id}`, { width: 300 })).status).toBe(200);

    const plain = (await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 9, exercise: 4 })).body.assignment;
    const started = (await sam('POST', `/api/assignments/${plain.id}/start`, { profileId: sp.id })).body;
    expect(started.floor).toBeNull();
    expect(started.program).toMatchObject({ name: 'Lesson 9 exercise 4', floorId: 'y-branch', exerciseRef: '9.4', assignmentId: plain.id });
    expect(started.program.code).toMatch(/from BirdBrain import Finch/);
  });

  it('shows the teacher progress and linked drafts only, never other work of the student', async () => {
    const { teacher, sam, riley, assignment, samM, rileyM } = await setup();
    const sp = await firstProfile(sam);
    const secret = (await sam('POST', `/api/profiles/${sp.id}/programs`, { name: 'Secret diary', code: 'print("private")\n' })).body.program;
    const personalFloor = (await sam('POST', `/api/profiles/${sp.id}/floors`, { name: 'My room' })).body.floor;
    const { program } = (await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: sp.id })).body;
    await sam('PUT', `/api/programs/${program.id}`, { code: 'print("step 1")\n' });
    await sam('POST', `/api/profiles/${sp.id}/runs`, { programId: program.id, status: 'finished', elapsed: 2.5, floorName: 'Maze' });
    await sam('POST', `/api/profiles/${sp.id}/runs`, { programId: secret.id, status: 'finished', elapsed: 9 });

    expect((await sam('GET', `/api/assignments/${assignment.id}/progress`)).status).toBe(403);
    const progress = (await teacher('GET', `/api/assignments/${assignment.id}/progress`)).body;
    const byName = Object.fromEntries(progress.students.map((s) => [s.username, s]));
    expect(byName.Riley).toMatchObject({ membershipId: rileyM.id, status: 'not started', lastEditAt: null, programs: [], attempts: 0, latestAttempt: null, editedSinceSubmit: false });
    expect(byName.Sam).toMatchObject({ membershipId: samM.id, status: 'started', state: 'active' });
    expect(byName.Sam.lastEditAt).toEqual(expect.any(String));
    expect(byName.Sam.programs.map((p) => p.id)).toEqual([program.id]);
    expect(JSON.stringify(progress)).not.toMatch(/Secret diary|userId|profileId/);

    const drafts = (await teacher('GET', `/api/assignments/${assignment.id}/drafts/${samM.id}`)).body.drafts;
    expect(drafts).toHaveLength(1);
    expect(drafts[0].program).toMatchObject({ id: program.id, code: 'print("step 1")\n', floorId: null });
    expect(drafts[0].floor).toMatchObject({ name: 'Maze', width: 160 });
    expect(drafts[0].latestRun).toMatchObject({ status: 'finished', elapsed: 2.5 });
    expect(JSON.stringify(drafts)).not.toMatch(/profileId|private|"data"/);
    expect((await teacher('GET', `/api/assignments/${assignment.id}/drafts/${rileyM.id}`)).body.drafts).toEqual([]);
    expect((await riley('GET', `/api/assignments/${assignment.id}/drafts/${samM.id}`)).status).toBe(403);

    // Every id-keyed read and write of her rows stays closed to the teacher.
    expect((await teacher('GET', `/api/programs/${program.id}`)).status).toBe(404);
    expect((await teacher('PUT', `/api/programs/${program.id}`, { code: 'x' })).status).toBe(404);
    expect((await teacher('GET', `/api/programs/${secret.id}`)).status).toBe(404);
    expect((await teacher('GET', `/api/floors/${personalFloor.id}`)).status).toBe(404);
    expect((await teacher('PUT', `/api/floors/${personalFloor.id}`, { width: 50 })).status).toBe(404);
    expect((await teacher('GET', `/api/profiles/${sp.id}/programs`)).status).toBe(404);
    expect((await teacher('GET', `/api/profiles/${sp.id}/runs`)).status).toBe(404);

    // She points the draft at a personal floor: the teacher sees no floor and no floor id.
    await sam('PUT', `/api/programs/${program.id}`, { floorId: personalFloor.id });
    const repointed = (await teacher('GET', `/api/assignments/${assignment.id}/drafts/${samM.id}`)).body.drafts[0];
    expect(repointed.floor).toBeNull();
    expect(repointed.program.floorId).toBeNull();
    expect(JSON.stringify(repointed)).not.toMatch(new RegExp(personalFloor.id));

    // Removal ends access at once; rejoining restores it.
    await teacher('POST', `/api/classes/${assignment.classId}/members/${samM.id}/remove`, { allowRejoin: true });
    expect((await teacher('GET', `/api/assignments/${assignment.id}/drafts/${samM.id}`)).status).toBe(404);
    expect((await teacher('GET', `/api/assignments/${assignment.id}/progress`)).body.students.map((s) => s.username)).toEqual(['Riley']);
    expect((await sam('GET', `/api/assignments/${assignment.id}`)).status).toBe(404);
    await sam('POST', '/api/classes/join', { code: (await teacher('GET', `/api/classes/${assignment.classId}`)).body.class.joinCode });
    expect((await teacher('GET', `/api/assignments/${assignment.id}/drafts/${samM.id}`)).body.drafts).toHaveLength(1);
  });

  it('edits, closes and reopens; an archived class keeps teacher reads and refuses new work', async () => {
    const { teacher, sam, riley, cls, assignment, samM } = await setup();
    const sp = await firstProfile(sam);
    const rp = await firstProfile(riley);
    await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: sp.id });

    expect((await sam('PATCH', `/api/assignments/${assignment.id}`, { instructions: 'x' })).status).toBe(403);
    expect((await teacher('PATCH', `/api/assignments/${assignment.id}`, {})).status).toBe(400);
    const edited = (await teacher('PATCH', `/api/assignments/${assignment.id}`, { instructions: 'Use the distance sensor.', dueAt: null })).body.assignment;
    expect(edited).toMatchObject({ instructions: 'Use the distance sensor.', dueAt: null, starterName: 'Maze starter' });

    expect((await sam('POST', `/api/assignments/${assignment.id}/close`)).status).toBe(403);
    expect((await teacher('POST', `/api/assignments/${assignment.id}/close`)).body.assignment.closedAt).toEqual(expect.any(String));
    expect((await teacher('POST', `/api/assignments/${assignment.id}/close`)).status).toBe(409);
    expect((await riley('POST', `/api/assignments/${assignment.id}/start`, { profileId: rp.id })).status).toBe(409);
    expect((await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: sp.id })).status).toBe(200); // her draft stays hers
    expect((await sam('GET', `/api/classes/${cls.id}/assignments`)).body.assignments[0].closedAt).toEqual(expect.any(String));
    expect((await teacher('POST', `/api/assignments/${assignment.id}/reopen`)).body.assignment.closedAt).toBeNull();
    expect((await riley('POST', `/api/assignments/${assignment.id}/start`, { profileId: rp.id })).status).toBe(201);

    await teacher('POST', `/api/classes/${cls.id}/archive`);
    expect((await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 1, exercise: 1 })).status).toBe(409);
    expect((await teacher('PATCH', `/api/assignments/${assignment.id}`, { instructions: 'late' })).status).toBe(409);
    expect((await teacher('POST', `/api/assignments/${assignment.id}/close`)).status).toBe(409);
    expect((await teacher('GET', `/api/assignments/${assignment.id}/progress`)).body.students.map((s) => s.status)).toEqual(['started', 'started']);
    expect((await teacher('GET', `/api/assignments/${assignment.id}/drafts/${samM.id}`)).body.drafts).toHaveLength(1);
    expect((await sam('GET', `/api/assignments/${assignment.id}`)).status).toBe(200);
    const second = (await sam('POST', '/api/profiles', { name: 'Second' })).body.profile;
    expect((await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: second.id })).status).toBe(409);
  });

  it('serves runnable snapshots of published resources to members only', async () => {
    const { teacher, sam, cls, program } = await setup();
    const res = (await teacher('POST', `/api/classes/${cls.id}/resources`, { programId: program.id })).body.resource;
    const snap = await sam('GET', `/api/class-resources/${res.id}/snapshot`);
    expect(snap.status).toBe(200);
    expect(snap.body.program).toMatchObject({ name: 'Maze starter', code: 'print("go")\n', floorId: null });
    expect(snap.body.floor).toMatchObject({ name: 'Maze', width: 160 });
    expect(snap.body.resource).not.toHaveProperty('snapshot');
    const x = await registered('Xeno');
    expect((await x('GET', `/api/class-resources/${res.id}/snapshot`)).status).toBe(404);
    await teacher('POST', `/api/class-resources/${res.id}/unpublish`);
    expect((await sam('GET', `/api/class-resources/${res.id}/snapshot`)).status).toBe(404);
    expect((await teacher('GET', `/api/class-resources/${res.id}/snapshot`)).status).toBe(200);
  });
});
