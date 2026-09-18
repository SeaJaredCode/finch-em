// Assignments (itch-15, d-34): every assignment rule lives here, in the src/classes.js shape. A
// teacher sets a workbook exercise for a class with an immutable starter snapshot; a student's
// Start copies it into their own profile as a program linked to the assignment (one per profile);
// the teacher follows progress and reads those linked drafts, and nothing else of the student's,
// through the link-keyed reads in src/store/scoped.js. Membership ids, never user or profile ids,
// name students; nothing is deleted (close and reopen flip closed_at).
import { getStore } from './store/index.js';
import { floorData, sanitizeFloor } from './floorshape.js';
import { copyProgramWithFloor } from './copy.js';
import { ClassError, requireTeacher, runnableSnapshot } from './classes.js';
import { LESSON_TEMPLATE } from './seed.js';
import { lessonByNumber, exerciseRef, suggestedFloor } from '../public/js/lessons.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTRUCTIONS_MAX = 4000;
const FLOOR_ID_MAX = 100;

function uuid(value) {
  if (!UUID_RE.test(String(value))) throw new ClassError(404, 'not found');
  return String(value);
}

function parseInstructions(value) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value !== 'string') throw new ClassError(400, 'instructions must be text');
  if (value.length > INSTRUCTIONS_MAX) throw new ClassError(400, `instructions must be at most ${INSTRUCTIONS_MAX} characters`);
  return value;
}

function parseDue(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const t = Date.parse(String(value));
  if (Number.isNaN(t)) throw new ClassError(400, 'dueAt must be a date');
  return new Date(t).toISOString();
}

const titleOf = (a) => `Lesson ${a.lesson} exercise ${a.exercise}`;

/** What any member sees in a list. Never createdBy. */
function listView(a) {
  const s = a.starter || {};
  const lesson = lessonByNumber(a.lesson);
  return {
    id: a.id,
    classId: a.classId,
    lesson: a.lesson,
    exercise: a.exercise,
    exerciseRef: exerciseRef(a.lesson, a.exercise),
    title: titleOf(a),
    lessonName: lesson ? lesson.name : null,
    lessonUrl: lesson ? lesson.url : null,
    instructions: a.instructions,
    dueAt: a.dueAt,
    allowFloorEdit: a.allowFloorEdit,
    requireRun: !!a.requireRun,
    floorId: a.floorId,
    starterName: s.program ? s.program.name : null,
    floorName: s.floor ? s.floor.name : null,
    closedAt: a.closedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/** The detail adds the runnable starter { program | null, floor | null } for read-only running. */
function detailView(a) {
  return { ...listView(a), starter: runnableSnapshot(a.starter, { floorId: a.floorId, exerciseRef: exerciseRef(a.lesson, a.exercise) }) };
}

async function readable(req, id) {
  const a = await req.scope.getAssignment(uuid(id));
  if (!a) throw new ClassError(404, 'assignment not found');
  return a;
}

/** POST /classes/:id/assignments { lesson, exercise, starterProgramId?, floorId?, instructions?, dueAt?, allowFloorEdit?, requireRun? } */
export async function create(req, classId, body) {
  const { cls } = await requireTeacher(req, classId);
  const lesson = Number(body.lesson);
  const exercise = Number(body.exercise);
  const info = lessonByNumber(lesson);
  if (!info || !Number.isInteger(exercise) || exercise < 1 || exercise > info.exercises) throw new ClassError(404, 'no such exercise');
  if (body.allowFloorEdit !== undefined && typeof body.allowFloorEdit !== 'boolean') throw new ClassError(400, 'allowFloorEdit must be true or false');
  if (body.requireRun !== undefined && typeof body.requireRun !== 'boolean') throw new ClassError(400, 'requireRun must be true or false');
  const ref = exerciseRef(lesson, exercise);

  let program = null;
  let floorId = suggestedFloor(lesson, exercise) || 'blank';
  if (body.starterProgramId !== undefined && body.starterProgramId !== null && body.starterProgramId !== '') {
    const p = await req.scope.getProgram(uuid(body.starterProgramId)); // the teacher's own rows only
    if (!p) throw new ClassError(404, 'program not found');
    program = { name: p.name, code: p.code, exerciseRef: ref };
    floorId = p.floorId || 'blank';
  }
  if (body.floorId !== undefined && body.floorId !== null && body.floorId !== '') {
    if (typeof body.floorId !== 'string' || body.floorId.length > FLOOR_ID_MAX) throw new ClassError(400, 'floorId must be a floor id');
    floorId = body.floorId;
  }
  let floor = null;
  if (UUID_RE.test(floorId)) {
    const f = await req.scope.getFloor(floorId);
    if (!f) throw new ClassError(404, 'floor not found');
    floor = { name: f.name, data: sanitizeFloor(floorData(f)) };
    floorId = 'blank';
  }

  const assignment = await getStore().createAssignment({
    classId: cls.id,
    createdBy: req.userId,
    lesson,
    exercise,
    instructions: parseInstructions(body.instructions) ?? '',
    dueAt: parseDue(body.dueAt) ?? null,
    allowFloorEdit: !!body.allowFloorEdit,
    requireRun: !!body.requireRun,
    floorId,
    starter: { program, floor },
  });
  return { assignment: detailView(assignment) };
}

/** GET /classes/:id/assignments: every assignment of the class, open and closed, newest first. */
export async function list(req, classId) {
  const rows = await req.scope.listAssignments(uuid(classId));
  if (!rows) throw new ClassError(404, 'class not found');
  return rows.map(listView);
}

/** GET /assignments/:id */
export async function get(req, id) {
  return detailView(await readable(req, id));
}

/** PATCH /assignments/:id { instructions?, dueAt? }: the only edits; starter, floor, permission and requireRun are fixed. */
export async function edit(req, id, body) {
  const a = await readable(req, id);
  await requireTeacher(req, a.classId);
  const patch = {};
  const instructions = parseInstructions(body.instructions);
  const dueAt = parseDue(body.dueAt);
  if (instructions !== undefined) patch.instructions = instructions;
  if (dueAt !== undefined) patch.dueAt = dueAt;
  if (!Object.keys(patch).length) throw new ClassError(400, 'nothing to change: send instructions or dueAt');
  return { assignment: detailView(await getStore().updateAssignment(a.id, patch)) };
}

async function setClosed(req, id, closed) {
  const a = await readable(req, id);
  await requireTeacher(req, a.classId);
  if (!!a.closedAt === closed) throw new ClassError(409, closed ? 'already closed' : 'already open');
  const updated = await getStore().updateAssignment(a.id, { closedAt: closed ? new Date().toISOString() : null });
  return { assignment: detailView(updated) };
}

/** POST /assignments/:id/close */
export const close = (req, id) => setClosed(req, id, true);
/** POST /assignments/:id/reopen */
export const reopen = (req, id) => setClosed(req, id, false);

async function existingStart(req, a, profileId) {
  const program = (await req.scope.myLinkedPrograms(a.id)).find((p) => p.profileId === profileId);
  if (!program) return null;
  const floor = UUID_RE.test(String(program.floorId)) ? await req.scope.getFloor(program.floorId) : null;
  return { program, floor, created: false };
}

/**
 * POST /assignments/:id/start { profileId }: the student's own linked program in that profile, made
 * from the starter (and a floor copy, locked unless the assignment allows floor edits). Idempotent:
 * a second Start answers the program already there. The personal Workbook is not touched.
 */
export async function start(req, id, body) {
  const a = await readable(req, id);
  const role = await req.scope.classRole(a.classId);
  if (role.role !== 'student') throw new ClassError(403, 'only students start an assignment');
  if (role.state !== 'active') throw new ClassError(409, 'this class is archived');
  const profileId = uuid(body.profileId);
  if (!(await req.scope.getProfile(profileId))) throw new ClassError(404, 'profile not found');
  const already = await existingStart(req, a, profileId);
  if (already) return already;
  if (a.closedAt) throw new ClassError(409, 'this assignment is closed');

  const snap = a.starter || {};
  const floor = snap.floor ? { name: snap.floor.name, ...(snap.floor.data || {}) } : null;
  const program = {
    name: snap.program ? snap.program.name : titleOf(a),
    code: snap.program ? snap.program.code : LESSON_TEMPLATE,
    floorId: a.floorId,
    exerciseRef: exerciseRef(a.lesson, a.exercise),
  };
  try {
    const copy = await copyProgramWithFloor(req.scope, profileId, { program, floor }, { classId: a.classId, assignmentId: a.id, locked: !a.allowFloorEdit });
    return { ...copy, created: true };
  } catch (err) {
    if (!(err && err.code === 'ASSIGNMENT_STARTED')) throw err;
    return existingStart(req, a, profileId); // a concurrent Start won the race
  }
}

/**
 * GET /assignments/:id/progress: per student, not started / started (with the last edit) / submitted,
 * returned or reviewed (the latest attempt and its review, d-35). A removed student is listed only
 * with their attempts; their drafts stay closed.
 */
export async function progress(req, id) {
  const a = await readable(req, id);
  await requireTeacher(req, a.classId, { allowArchived: true });
  const rows = (await req.scope.assignmentProgress(a.id)) || [];
  return {
    assignment: listView(a),
    students: rows.map((r) => {
      const subs = r.submissions || [];
      const latest = subs.length ? subs[subs.length - 1] : null;
      const lastEditAt = r.programs.reduce((max, p) => (!max || p.updatedAt > max ? p.updatedAt : max), null);
      return {
        membershipId: r.membershipId,
        username: r.username,
        state: r.state,
        status: latest ? latest.reviewStatus || 'submitted' : r.programs.length ? 'started' : 'not started',
        lastEditAt,
        programs: r.programs,
        attempts: subs.length,
        latestAttempt: latest ? { id: latest.id, attempt: latest.attempt, submittedAt: latest.createdAt, reviewStatus: latest.reviewStatus } : null,
        editedSinceSubmit: !!(latest && lastEditAt && lastEditAt > latest.createdAt),
      };
    }),
  };
}

/** GET /assignments/:id/drafts/:mid: one student's linked programs, read-only; no profile ids. */
export async function drafts(req, id, membershipId) {
  const a = await readable(req, id);
  await requireTeacher(req, a.classId, { allowArchived: true });
  const rows = await req.scope.linkedDrafts(a.id, uuid(membershipId));
  if (!rows) throw new ClassError(404, 'student not found');
  return rows.map(({ program: p, floor: f, latestRun: r }) => ({
    // floorId: a built-in id, or null when the floor is the copy below or a personal floor of theirs
    program: { id: p.id, name: p.name, code: p.code, floorId: f || UUID_RE.test(String(p.floorId)) ? null : p.floorId, exerciseRef: p.exerciseRef, createdAt: p.createdAt, updatedAt: p.updatedAt },
    floor: f ? { name: f.name, ...floorData(f) } : null,
    latestRun: r
      ? { id: r.id, status: r.status, elapsed: r.elapsed, verdict: r.verdict, passed: r.passed, floorName: r.floorName, createdAt: r.createdAt }
      : null,
  }));
}
