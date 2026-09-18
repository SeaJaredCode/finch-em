// Submissions (itch-16, d-35): a student turns in their linked draft as immutable numbered attempts;
// the teacher reads attempts (not drafts), reviews and duplicates them; attempts stay the class's
// record after removal. One makeBrowser() per person on the memory store.
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
const tick = () => new Promise((r) => setTimeout(r, 5));

async function registered(username) {
  const b = browser();
  expect((await b('POST', '/api/account/register', { username, password: 'secret1' })).status).toBe(200);
  return b;
}

const firstProfile = async (b) => (await b('GET', '/api/profiles')).body.profiles[0];

/** A class with a teacher and two students, one assignment with a starter on a custom floor, and Sam's started draft. */
async function setup({ requireRun = false } = {}) {
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
  const assignment = (
    await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 5, exercise: 12, starterProgramId: starter.id, requireRun })
  ).body.assignment;
  const sp = await firstProfile(sam);
  const { program } = (await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: sp.id })).body;
  return {
    teacher,
    sam,
    riley,
    cls,
    tp,
    sp,
    assignment,
    program,
    samM: roster.find((m) => m.username === 'Sam'),
    rileyM: roster.find((m) => m.username === 'Riley'),
  };
}

const edit = (b, program, code) => b('PUT', `/api/programs/${program.id}`, { code });
const run = (b, profileId, program, code, extra = {}) =>
  b('POST', `/api/profiles/${profileId}/runs`, { programId: program.id, status: 'finished', elapsed: 3, floorName: 'Maze', data: { code }, ...extra });
const turnIn = (b, assignment, program) => b('POST', `/api/assignments/${assignment.id}/submissions`, { programId: program.id });

describe('submissions', () => {
  it('turns in numbered snapshots the teacher reviews, the student reads, and nobody else sees', async () => {
    const { teacher, sam, riley, tp, sp, assignment, program, samM, rileyM } = await setup();
    await edit(sam, program, 'print("step 1")\n');
    await run(sam, sp.id, program, 'print("step 1")\n', { data: { code: 'print("step 1")\n', verdict: { pass: true, text: 'Reached the goal' } } });

    const first = await turnIn(sam, assignment, program);
    expect(first.status).toBe(201);
    expect(first.body.submission).toMatchObject({
      attempt: 1,
      status: 'submitted',
      program: { name: 'Maze starter', code: 'print("step 1")\n', floorId: null, exerciseRef: '5.12' },
      floor: { name: 'Maze', width: 160 },
      run: { status: 'finished', elapsed: 3, verdict: 'Reached the goal', passed: true },
      review: null,
    });

    await edit(sam, program, 'print("step 2")\n');
    const second = (await turnIn(sam, assignment, program)).body.submission;
    expect(second).toMatchObject({ attempt: 2, run: null, program: { code: 'print("step 2")\n' } });

    // Progress: submitted, attempt 2; editing afterwards is flagged.
    let progress = (await teacher('GET', `/api/assignments/${assignment.id}/progress`)).body.students;
    let samRow = progress.find((s) => s.username === 'Sam');
    expect(samRow).toMatchObject({ status: 'submitted', attempts: 2, latestAttempt: { attempt: 2, reviewStatus: null }, editedSinceSubmit: false });
    expect(progress.find((s) => s.username === 'Riley')).toMatchObject({ status: 'not started', attempts: 0, latestAttempt: null });
    await tick();
    await edit(sam, program, 'print("step 3")\n');
    samRow = (await teacher('GET', `/api/assignments/${assignment.id}/progress`)).body.students.find((s) => s.username === 'Sam');
    expect(samRow.editedSinceSubmit).toBe(true);

    // The teacher reads what was turned in, not the draft.
    const attempts = (await teacher('GET', `/api/assignments/${assignment.id}/submissions/${samM.id}`)).body.submissions;
    expect(attempts.map((a) => [a.attempt, a.program.code])).toEqual([
      [1, 'print("step 1")\n'],
      [2, 'print("step 2")\n'],
    ]);
    expect(attempts[0].membershipId).toBe(samM.id);
    expect(JSON.stringify(attempts)).not.toMatch(/profileId|sourceProgramId|userId|runId|reviewedBy/);
    expect(JSON.stringify(attempts)).not.toMatch(new RegExp(program.id));
    expect((await teacher('GET', `/api/assignments/${assignment.id}/submissions/${rileyM.id}`)).body.submissions).toEqual([]);

    // Review: comment and returned; validation.
    const reviewed = await teacher('PUT', `/api/submissions/${second.id}/review`, { comment: 'Nice. Now use the distance sensor.', status: 'returned' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.submission).toMatchObject({ status: 'returned', review: { comment: 'Nice. Now use the distance sensor.', status: 'returned' } });
    expect((await teacher('PUT', `/api/submissions/${second.id}/review`, { status: 'great' })).status).toBe(400);
    expect((await teacher('PUT', `/api/submissions/${second.id}/review`, {})).status).toBe(400);
    expect((await teacher('PUT', `/api/submissions/${second.id}/review`, { comment: 'x'.repeat(4001) })).status).toBe(400);
    const marked = (await teacher('PUT', `/api/submissions/${first.body.submission.id}/review`, { status: 'reviewed' })).body.submission;
    expect(marked.review).toMatchObject({ comment: '', status: 'reviewed' });
    progress = (await teacher('GET', `/api/assignments/${assignment.id}/progress`)).body.students;
    expect(progress.find((s) => s.username === 'Sam').status).toBe('returned');

    // Sam sees her own attempts and the feedback; Riley sees none of it.
    const mine = (await sam('GET', `/api/assignments/${assignment.id}/submissions/mine`)).body.submissions;
    expect(mine.map((a) => [a.attempt, a.status])).toEqual([
      [1, 'reviewed'],
      [2, 'returned'],
    ]);
    expect(mine[1].review.comment).toBe('Nice. Now use the distance sensor.');
    expect(mine[0].program.code).toBe('print("step 1")\n');
    expect(JSON.stringify(mine)).not.toMatch(/membershipId|sourceProgramId|reviewedBy/);
    expect((await riley('GET', `/api/assignments/${assignment.id}/submissions/mine`)).body.submissions).toEqual([]);
    expect((await riley('GET', `/api/assignments/${assignment.id}/submissions/${samM.id}`)).status).toBe(403);
    expect((await riley('PUT', `/api/submissions/${second.id}/review`, { comment: 'mean' })).status).toBe(404);
    expect((await riley('POST', `/api/submissions/${second.id}/duplicate`, { profileId: (await firstProfile(riley)).id })).status).toBe(404);
    expect((await sam('PUT', `/api/submissions/${second.id}/review`, { status: 'reviewed' })).status).toBe(403);
    expect((await teacher('GET', `/api/assignments/${assignment.id}/submissions/mine`)).status).toBe(403);
    const x = await registered('Xeno');
    expect((await x('GET', `/api/assignments/${assignment.id}/submissions/mine`)).status).toBe(404);
    expect((await x('PUT', `/api/submissions/${second.id}/review`, { comment: 'x' })).status).toBe(404);

    // Duplicate: an independent copy in the teacher's profile; Sam's rows do not move.
    expect((await sam('POST', `/api/submissions/${first.body.submission.id}/duplicate`, { profileId: sp.id })).status).toBe(403);
    expect((await teacher('POST', `/api/submissions/${first.body.submission.id}/duplicate`, { profileId: sp.id })).status).toBe(404);
    const dup = await teacher('POST', `/api/submissions/${first.body.submission.id}/duplicate`, { profileId: tp.id });
    expect(dup.status).toBe(201);
    expect(dup.body.program).toMatchObject({ profileId: tp.id, code: 'print("step 1")\n', assignmentId: null, name: 'Maze starter (Sam, attempt 1)' });
    expect(dup.body.floor).toMatchObject({ profileId: tp.id, name: 'Maze', width: 160, locked: false, assignmentId: null });
    expect(dup.body.program.floorId).toBe(dup.body.floor.id);
    await teacher('PUT', `/api/programs/${dup.body.program.id}`, { code: 'print("teacher fix")\n' });
    await teacher('PUT', `/api/floors/${dup.body.floor.id}`, { width: 300 });
    const again = (await sam('GET', `/api/assignments/${assignment.id}/submissions/mine`)).body.submissions[0];
    expect(again.program.code).toBe('print("step 1")\n');
    expect(again.floor.width).toBe(160);
    expect((await sam('GET', `/api/programs/${program.id}`)).body.program.code).toBe('print("step 3")\n');

    // The teacher still has no id-keyed way into Sam's rows.
    expect((await teacher('GET', `/api/programs/${program.id}`)).status).toBe(404);
    expect((await teacher('GET', `/api/profiles/${sp.id}/runs`)).status).toBe(404);
  });

  it('refuses turn-in from teachers, for foreign or unlinked programs, on personal floors, when closed, and without a required run', async () => {
    const { teacher, sam, riley, cls, sp, assignment, program } = await setup();
    const tp = await firstProfile(teacher);
    const teacherProgram = (await teacher('GET', `/api/profiles/${tp.id}/programs`)).body.programs[0];
    expect((await turnIn(teacher, assignment, teacherProgram)).status).toBe(403);
    expect((await turnIn(riley, assignment, program)).status).toBe(404);
    const unlinked = (await sam('POST', `/api/profiles/${sp.id}/programs`, { name: 'Mine' })).body.program;
    expect((await turnIn(sam, assignment, unlinked)).status).toBe(404);
    expect((await sam('POST', `/api/assignments/${assignment.id}/submissions`, { programId: 'nope' })).status).toBe(404);

    // A personal floor: switch back to turn in.
    const room = (await sam('POST', `/api/profiles/${sp.id}/floors`, { name: 'My room' })).body.floor;
    await sam('PUT', `/api/programs/${program.id}`, { floorId: room.id });
    const refused = await turnIn(sam, assignment, program);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/own floors/);
    await sam('PUT', `/api/programs/${program.id}`, { floorId: 'blank' });
    const onBuiltin = (await turnIn(sam, assignment, program)).body.submission;
    expect(onBuiltin).toMatchObject({ attempt: 1, floor: null, program: { floorId: 'blank' } });

    // Closed refuses; reopened accepts.
    await teacher('POST', `/api/assignments/${assignment.id}/close`);
    expect((await turnIn(sam, assignment, program)).status).toBe(409);
    await teacher('POST', `/api/assignments/${assignment.id}/reopen`);
    expect((await turnIn(sam, assignment, program)).body.submission.attempt).toBe(2);

    // A required run must be of exactly the code turned in.
    expect((await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 9, exercise: 4, requireRun: 'yes' })).status).toBe(400);
    const strict = (await teacher('POST', `/api/classes/${cls.id}/assignments`, { lesson: 9, exercise: 4, requireRun: true })).body.assignment;
    expect(strict.requireRun).toBe(true);
    expect((await sam('GET', `/api/classes/${cls.id}/assignments`)).body.assignments[0].requireRun).toBe(true);
    const draft = (await sam('POST', `/api/assignments/${strict.id}/start`, { profileId: sp.id })).body.program;
    const noRun = await turnIn(sam, strict, draft);
    expect(noRun.status).toBe(409);
    expect(noRun.body.error).toMatch(/needs a run/);
    await run(sam, sp.id, draft, 'print("older")\n');
    expect((await turnIn(sam, strict, draft)).status).toBe(409);
    await run(sam, sp.id, draft, draft.code);
    const ok = await turnIn(sam, strict, draft);
    expect(ok.status).toBe(201);
    expect(ok.body.submission.run).toMatchObject({ status: 'finished' });

    // Two at once still get distinct numbers.
    const both = await Promise.all([turnIn(sam, strict, draft), turnIn(sam, strict, draft)]);
    expect(both.map((r) => r.body.submission.attempt).sort()).toEqual([2, 3]);
  });

  it('keeps attempts as the class record: draft deletion, removal, rejoin and archive', async () => {
    const { teacher, sam, riley, cls, tp, sp, assignment, program, samM } = await setup();
    await run(sam, sp.id, program, program.code);
    const first = (await turnIn(sam, assignment, program)).body.submission;
    expect(first.run).not.toBeNull();

    // Deleting the draft (and so its runs) leaves the attempt and its run summary.
    expect((await sam('DELETE', `/api/programs/${program.id}`)).status).toBe(204);
    let attempts = (await teacher('GET', `/api/assignments/${assignment.id}/submissions/${samM.id}`)).body.submissions;
    expect(attempts).toHaveLength(1);
    expect(attempts[0].run).toMatchObject({ status: 'finished' });
    expect(attempts[0].program.code).toBe(program.code);

    // Removal: drafts close at once, attempts stay with the teacher, the student loses the class.
    await teacher('POST', `/api/classes/${cls.id}/members/${samM.id}/remove`, { allowRejoin: true });
    expect((await teacher('GET', `/api/assignments/${assignment.id}/drafts/${samM.id}`)).status).toBe(404);
    attempts = (await teacher('GET', `/api/assignments/${assignment.id}/submissions/${samM.id}`)).body.submissions;
    expect(attempts.map((a) => a.attempt)).toEqual([1]);
    const removedRow = (await teacher('GET', `/api/assignments/${assignment.id}/progress`)).body.students.find((s) => s.username === 'Sam');
    expect(removedRow).toMatchObject({ state: 'removed', status: 'submitted', programs: [], lastEditAt: null });
    expect((await teacher('PUT', `/api/submissions/${first.id}/review`, { comment: 'Kept for the record.' })).status).toBe(200);
    expect((await sam('GET', `/api/assignments/${assignment.id}/submissions/mine`)).status).toBe(404);
    expect((await sam('PUT', `/api/submissions/${first.id}/review`, { comment: 'x' })).status).toBe(404);

    // A membership of another class is not a student of this one.
    const other = (await teacher('POST', '/api/classes', { name: 'Other' })).body.class;
    await riley('POST', '/api/classes/join', { code: other.joinCode });
    const rileyOther = (await teacher('GET', `/api/classes/${other.id}/roster`)).body.roster[0];
    expect((await teacher('GET', `/api/assignments/${assignment.id}/submissions/${rileyOther.id}`)).status).toBe(404);
    const teacherM = (await teacher('GET', `/api/classes/${cls.id}`)).body.class.membership;
    expect((await teacher('GET', `/api/assignments/${assignment.id}/submissions/${teacherM.id}`)).status).toBe(404);

    // Rejoining continues the numbering and shows the feedback again.
    await sam('POST', '/api/classes/join', { code: (await teacher('GET', `/api/classes/${cls.id}`)).body.class.joinCode });
    const restarted = (await sam('POST', `/api/assignments/${assignment.id}/start`, { profileId: sp.id })).body.program;
    expect((await turnIn(sam, assignment, restarted)).body.submission.attempt).toBe(2);
    expect((await sam('GET', `/api/assignments/${assignment.id}/submissions/mine`)).body.submissions[0].review.comment).toBe('Kept for the record.');

    // Archive: reads and duplicates continue; turn-in and review stop.
    await teacher('POST', `/api/classes/${cls.id}/archive`);
    expect((await turnIn(sam, assignment, restarted)).status).toBe(409);
    expect((await teacher('PUT', `/api/submissions/${first.id}/review`, { status: 'reviewed' })).status).toBe(409);
    expect((await teacher('GET', `/api/assignments/${assignment.id}/submissions/${samM.id}`)).body.submissions).toHaveLength(2);
    expect((await sam('GET', `/api/assignments/${assignment.id}/submissions/mine`)).body.submissions).toHaveLength(2);
    expect((await teacher('POST', `/api/submissions/${first.id}/duplicate`, { profileId: tp.id })).status).toBe(201);
  });

  it('offers no way to change or remove an attempt', () => {
    const store = createMemoryStore();
    expect(Object.keys(store).filter((k) => /^(update|delete|remove)\w*Submission/i.test(k))).toEqual([]);
    const src = new URL('../src/', import.meta.url);
    const pg = readFileSync(new URL('store/pg.js', src), 'utf8');
    expect(pg).not.toMatch(/UPDATE\s+submissions\b|DELETE\s+FROM\s+submissions\b/i);
    expect(Object.keys(store).filter((k) => /Submission/.test(k)).sort()).toEqual(['createSubmission', 'getSubmission', 'listSubmissions', 'upsertSubmissionReview']);
    const routes = readFileSync(new URL('routes/api.js', src), 'utf8');
    expect(routes).not.toMatch(/apiRouter\.(delete|patch)\([^)]*submissions/);
    expect(routes.match(/apiRouter\.put\('[^']*submissions[^']*'/g)).toEqual(["apiRouter.put('/submissions/:id/review'"]);
    // Turn in takes the membership from the session, never from the body.
    expect(readFileSync(new URL('submissions.js', src), 'utf8')).not.toMatch(/body\.membershipId|body\.userId/);
  });
});
