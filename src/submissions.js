// Submissions (itch-16, d-35): every turn-in and feedback rule lives here, in the src/assignments.js
// shape. Turn in inserts an immutable attempt the server builds from the student's own linked draft
// (never from the request body); the teacher reads attempts, not drafts, leaves one replaceable
// review per attempt, and may duplicate an attempt into their own profile. Attempts are keyed by
// class membership and never updated or deleted; they stay the class's record after a student is
// removed. Membership ids, never user, profile or program ids, name students to the teacher.
import { getStore } from './store/index.js';
import { floorData, sanitizeFloor } from './floorshape.js';
import { copyProgramWithFloor, attachToWorkbook } from './copy.js';
import { ClassError, requireTeacher, requireOpenStudent, runnableSnapshot, resourceView } from './classes.js';
import { exerciseRef } from '../public/js/lessons.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMENT_MAX = 4000;
const REVIEW_STATUSES = ['returned', 'reviewed'];
const RUNS_SCANNED = 5; // the newest runs looked at for one of exactly the turned-in code
const RACE_RETRIES = 3;
const NOTE_MAX = 500;
const TITLE_MAX = 80;
const ATTRIBUTIONS = ['anonymous', 'name'];

function uuid(value) {
  if (!UUID_RE.test(String(value))) throw new ClassError(404, 'not found');
  return String(value);
}

async function readableAssignment(req, id) {
  const a = await req.scope.getAssignment(uuid(id));
  if (!a) throw new ClassError(404, 'assignment not found');
  return a;
}

/** What a reader sees of an attempt: the runnable snapshot, the copied run summary and the review. */
function attemptView(s, a, { forTeacher = false } = {}) {
  const view = {
    id: s.id,
    assignmentId: s.assignmentId,
    attempt: s.attempt,
    submittedAt: s.createdAt,
    status: (s.review && s.review.status) || 'submitted',
    ...runnableSnapshot(s.snapshot, { floorId: a.floorId, exerciseRef: exerciseRef(a.lesson, a.exercise) }),
    run: s.run
      ? { status: s.run.status, elapsed: s.run.elapsed, verdict: s.run.verdict, passed: s.run.passed, floorName: s.run.floorName, createdAt: s.run.createdAt }
      : null,
    review: s.review ? { comment: s.review.comment, status: s.review.status, updatedAt: s.review.updatedAt } : null,
    shared: s.shared || null, // d-37: 'anonymous' | 'name' while a published example of it exists
  };
  if (forTeacher) view.membershipId = s.membershipId;
  return view;
}

/** The newest run of the program whose recorded code is exactly `code`, as a summary; else null. */
async function runOfCode(scope, program) {
  const runs = (await scope.listRuns(program.profileId, { programId: program.id })) || [];
  for (const summary of runs.slice(0, RUNS_SCANNED)) {
    const run = await scope.getRun(summary.id);
    if (run && run.data && run.data.code === program.code) {
      return { runId: run.id, status: run.status, elapsed: run.elapsed, verdict: run.verdict, passed: run.passed, floorName: run.floorName, createdAt: run.createdAt };
    }
  }
  return null;
}

/**
 * POST /assignments/:id/submissions { programId }: turn in the caller's own linked draft as the next
 * attempt. The draft stays theirs and editable; later edits never reach this attempt.
 */
export async function turnIn(req, id, body) {
  const a = await readableAssignment(req, id);
  const { role } = await requireOpenStudent(req, a.classId, { what: 'turn in work' });
  if (a.closedAt) throw new ClassError(409, 'this assignment is closed');

  const program = await req.scope.getProgram(uuid(body.programId));
  if (!program || program.assignmentId !== a.id) throw new ClassError(404, 'your work on this assignment was not found');
  let floor = null;
  let floorId = program.floorId || 'blank';
  if (UUID_RE.test(floorId)) {
    const f = await req.scope.getFloor(floorId);
    if (!f || f.assignmentId !== a.id || f.profileId !== program.profileId) {
      throw new ClassError(409, "this work runs on one of your own floors; switch it back to the assignment's floor to turn it in");
    }
    floor = { name: f.name, data: sanitizeFloor(floorData(f)) };
    floorId = null;
  }
  const run = await runOfCode(req.scope, program);
  if (a.requireRun && !run) throw new ClassError(409, 'this assignment needs a run: run the program as it is now, then turn it in');

  const snapshot = {
    program: { name: program.name, code: program.code, floorId, exerciseRef: program.exerciseRef || exerciseRef(a.lesson, a.exercise) },
    floor,
  };
  for (let i = 0; ; i++) {
    try {
      const s = await getStore().createSubmission({ assignmentId: a.id, membershipId: role.membership.id, sourceProgramId: program.id, snapshot, run });
      return { submission: attemptView(s, a) };
    } catch (err) {
      if (!(err && err.code === 'SUBMISSION_RACE') || i + 1 >= RACE_RETRIES) throw err;
    }
  }
}

/** GET /assignments/:id/submissions/mine: the caller's own attempts, oldest first. */
export async function mine(req, id) {
  const a = await readableAssignment(req, id);
  const rows = await req.scope.mySubmissions(a.id);
  if (!rows) throw new ClassError(403, 'only students have submissions');
  return rows.map((s) => attemptView(s, a));
}

/** GET /assignments/:id/submissions/:mid: one student's attempts, for the teacher, whatever the student's state. */
export async function forStudent(req, id, membershipId) {
  const a = await readableAssignment(req, id);
  await requireTeacher(req, a.classId, { allowArchived: true });
  const rows = await req.scope.studentSubmissions(a.id, uuid(membershipId));
  if (!rows) throw new ClassError(404, 'student not found');
  return rows.map((s) => attemptView(s, a, { forTeacher: true }));
}

async function teacherAttempt(req, submissionId, { allowArchived }) {
  const found = await req.scope.submissionFor(uuid(submissionId));
  if (!found) throw new ClassError(404, 'submission not found');
  if (!found.asTeacher) throw new ClassError(403, 'only the teacher can do that');
  await requireTeacher(req, found.assignment.classId, { allowArchived });
  return found;
}

function parseComment(value) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value !== 'string') throw new ClassError(400, 'comment must be text');
  if (value.length > COMMENT_MAX) throw new ClassError(400, `comment must be at most ${COMMENT_MAX} characters`);
  return value;
}

function parseStatus(value) {
  if (value === undefined || value === null) return value;
  if (!REVIEW_STATUSES.includes(value)) throw new ClassError(400, 'status must be returned, reviewed or null');
  return value;
}

/** PUT /submissions/:id/review { comment?, status? }: the teacher's one review of an attempt; an archived class is frozen. */
export async function review(req, submissionId, body) {
  const { submission, assignment } = await teacherAttempt(req, submissionId, { allowArchived: false });
  const comment = parseComment(body.comment);
  const status = parseStatus(body.status);
  if (comment === undefined && status === undefined) throw new ClassError(400, 'nothing to change: send comment or status');
  const patch = { reviewedBy: req.userId };
  if (comment !== undefined) patch.comment = comment;
  if (status !== undefined) patch.status = status;
  const updated = await getStore().upsertSubmissionReview(submission.id, patch);
  return { submission: attemptView(updated, assignment, { forTeacher: true }) };
}

/**
 * POST /submissions/:id/publish { attribution?, note?, title? }: publish the attempt to its class as a
 * peer example (itch-17, d-37). The class comes from the attempt; the store copies the attempt's own
 * snapshot. Anonymous unless the teacher asks for the student's name.
 */
export async function publishExample(req, submissionId, body) {
  const { submission, assignment } = await teacherAttempt(req, submissionId, { allowArchived: false });
  const attribution = body.attribution === undefined || body.attribution === null ? 'anonymous' : body.attribution;
  if (!ATTRIBUTIONS.includes(attribution)) throw new ClassError(400, 'attribution must be anonymous or name');
  let note = body.note === undefined || body.note === null ? '' : body.note;
  if (typeof note !== 'string') throw new ClassError(400, 'note must be text');
  note = note.trim();
  if (note.length > NOTE_MAX) throw new ClassError(400, `note must be at most ${NOTE_MAX} characters`);
  let name = `Example: Lesson ${assignment.lesson} exercise ${assignment.exercise}`;
  if (body.title !== undefined && body.title !== null && body.title !== '') {
    if (typeof body.title !== 'string' || !body.title.trim()) throw new ClassError(400, 'title must be text');
    if (body.title.length > TITLE_MAX) throw new ClassError(400, `title must be at most ${TITLE_MAX} characters`);
    name = body.title.trim();
  }
  const m = await getStore().getMembership(submission.membershipId);
  if (!m || m.role !== 'student' || !(m.state === 'active' || m.state === 'archived')) {
    throw new ClassError(409, 'this student is no longer in the class');
  }
  let created;
  try {
    created = await getStore().createExample({
      classId: assignment.classId,
      publishedBy: req.userId,
      submissionId: submission.id,
      attribution,
      note,
      name,
      floorName: `${name} floor`,
    });
  } catch (err) {
    if (err && err.code === 'EXAMPLE_LIVE') throw new ClassError(409, 'this attempt is already published; unpublish it first');
    throw err;
  }
  if (!created) throw new ClassError(404, 'submission not found');
  return { resource: resourceView(await req.scope.getResource(created.id)) };
}

/**
 * POST /submissions/:id/duplicate { profileId }: an independent editable copy of the attempt in one of
 * the teacher's own profiles (d-25 copy rules: unlinked, unlocked, attached to the exercise).
 */
export async function duplicate(req, submissionId, body) {
  const { submission, assignment } = await teacherAttempt(req, submissionId, { allowArchived: true });
  const profileId = uuid(body.profileId);
  if (!(await req.scope.getProfile(profileId))) throw new ClassError(404, 'profile not found');
  const snap = submission.snapshot || {};
  if (!snap.program) throw new ClassError(404, 'submission not found');
  const m = await getStore().getMembership(submission.membershipId);
  const user = m ? await getStore().getUser(m.userId) : null;
  const who = user && user.username ? `${user.username}, ` : '';
  const floorDoc = snap.floor ? { name: snap.floor.name, ...(snap.floor.data || {}) } : null;
  const program = { ...snap.program, name: `${snap.program.name} (${who}attempt ${submission.attempt})` };
  const copy = await copyProgramWithFloor(req.scope, profileId, { program, floor: floorDoc });
  const ref = /^(\d+)\.(\d+)$/.exec(String(snap.program.exerciseRef || exerciseRef(assignment.lesson, assignment.exercise)));
  const attachments = ref ? [{ lesson: Number(ref[1]), exercise: Number(ref[2]), program: true, floor: !!copy.floor }] : [];
  const entries = await attachToWorkbook(req.scope, profileId, attachments, copy);
  return { program: copy.program, floor: copy.floor, entries };
}
