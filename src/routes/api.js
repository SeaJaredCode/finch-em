import express from 'express';
import { requireSession, startSession } from '../auth.js';
import { register, signIn, signOut, split, listLegacy, claimLegacy } from '../account.js';
import * as classes from '../classes.js';
import * as assignments from '../assignments.js';
import * as submissions from '../submissions.js';
import * as sentCopies from '../sentcopies.js';
import { copyProgramWithFloor, attachToWorkbook } from '../copy.js';
import { LESSON_TEMPLATE } from '../seed.js';
import { sanitizeFloor, hasFloorFields, floorData } from '../floorshape.js';
import { sanitizeRun, sanitizeDrawing } from '../runshape.js';
import { lessonByNumber, exerciseRef } from '../../public/js/lessons.js';

const NAME_MAX = 80;
const CODE_MAX = 200_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireName(value, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'name is required');
  if (value.length > NAME_MAX) throw new HttpError(400, `name must be at most ${NAME_MAX} characters`);
  return value.trim();
}

function optionalString(value, field, max) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  if (max && value.length > max) throw new HttpError(400, `${field} is too long`);
  return value;
}

function requireUuid(value) {
  if (!UUID_RE.test(String(value))) throw new HttpError(404, 'not found');
  return value;
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// `store` is req.scope (d-29): a profile that exists but is not the caller's own is "not found".
async function requireProfile(store, id) {
  const profileId = requireUuid(id);
  const profile = await store.getProfile(profileId);
  if (!profile) throw new HttpError(404, 'profile not found');
  return profileId;
}

export const apiRouter = express.Router();

// ---- session (itch-12 phase 1, d-29) ---------------------------------------------------------
// POST /session is the one public data route: it resumes this browser's session or mints a user
// (claiming the remembered pre-session profile if it is still free, else seeding a 'Student'
// workspace) and answers with that user's profiles. Everything below runs behind requireSession
// and reaches data only through req.scope, a store that sees the caller's own profiles and
// answers null for anything else (src/store/scoped.js), so no handler here can name a row
// outside the caller's workspaces — a foreign row and a missing row are both 404.

apiRouter.post(
  '/session',
  wrap(async (req, res) => {
    const body = req.body || {};
    const { profiles, account } = await startSession(req, res, { rememberedProfileId: body.rememberedProfileId });
    res.json({ profiles, account });
  }),
);

apiRouter.get('/template', (_req, res) => res.json({ template: LESSON_TEMPLATE }));

apiRouter.use(requireSession);

// ---- accounts (itch-13, d-31) ----------------------------------------------------------------
// Every rule lives in src/account.js; these handlers only parse and delegate. All sit behind
// requireSession: a browser always holds a session after boot, so even sign-in needs no public
// route. Each answer is the session view { profiles, account } the client reloads into.

apiRouter.post('/account/register', wrap(async (req, res) => res.json(await register(req, res, req.body || {}))));
apiRouter.post('/account/signin', wrap(async (req, res) => res.json(await signIn(req, res, req.body || {}))));
apiRouter.post('/account/signout', wrap(async (req, res) => res.json(await signOut(req, res))));
apiRouter.post('/account/split', wrap(async (req, res) => res.json(await split(req, res, req.body || {}))));
apiRouter.get('/account/legacy', wrap(async (req, res) => res.json({ profiles: await listLegacy(req) })));
apiRouter.post('/account/legacy/:id/claim', wrap(async (req, res) => res.json({ profile: await claimLegacy(req, req.params.id) })));

// ---- classes (itch-14, d-32) -----------------------------------------------------------------
// Every rule lives in src/classes.js; reads are gated by req.scope.classRole (src/store/scoped.js).
// Membership ids, not user ids, name people; join codes travel in bodies, never URLs; nothing here
// is a DELETE — remove, archive and unpublish are state flips.

apiRouter.get('/classes', wrap(async (req, res) => res.json({ classes: await classes.listMine(req) })));
apiRouter.post('/classes', wrap(async (req, res) => res.status(201).json(await classes.createClass(req, req.body || {}))));
apiRouter.post('/classes/join', wrap(async (req, res) => res.json(await classes.joinByCode(req, req.body || {}))));
apiRouter.get('/classes/:id', wrap(async (req, res) => res.json({ class: await classes.getClass(req, req.params.id) })));
apiRouter.get('/classes/:id/roster', wrap(async (req, res) => res.json({ roster: await classes.roster(req, req.params.id) })));
apiRouter.post('/classes/:id/archive', wrap(async (req, res) => res.json(await classes.archiveClass(req, req.params.id))));
apiRouter.post('/classes/:id/code', wrap(async (req, res) => res.json(await classes.rotateCode(req, req.params.id))));
apiRouter.post('/classes/:id/members/:mid/remove', wrap(async (req, res) => res.json(await classes.removeMember(req, req.params.id, req.params.mid, req.body || {}))));
apiRouter.post('/classes/:id/members/:mid/password', wrap(async (req, res) => res.json(await classes.resetStudentPassword(req, req.params.id, req.params.mid, req.body || {}))));
apiRouter.get('/classes/:id/resources', wrap(async (req, res) => res.json({ resources: await classes.listResources(req, req.params.id) })));
apiRouter.post('/classes/:id/resources', wrap(async (req, res) => res.status(201).json(await classes.publish(req, req.params.id, req.body || {}))));
apiRouter.post('/class-resources/:id/unpublish', wrap(async (req, res) => res.json(await classes.unpublish(req, req.params.id))));
apiRouter.post('/class-resources/:id/copy', wrap(async (req, res) => res.status(201).json(await classes.copyResource(req, req.params.id, req.body || {}))));
apiRouter.get('/class-resources/:id/snapshot', wrap(async (req, res) => res.json(await classes.resourceSnapshot(req, req.params.id))));

// ---- assignments (itch-15, d-34) -------------------------------------------------------------
// Every rule lives in src/assignments.js. Start is the only writer of a program's assignment link;
// a teacher reads a student's linked drafts by assignment and membership id, never by program id.

apiRouter.get('/classes/:id/assignments', wrap(async (req, res) => res.json({ assignments: await assignments.list(req, req.params.id) })));
apiRouter.post('/classes/:id/assignments', wrap(async (req, res) => res.status(201).json(await assignments.create(req, req.params.id, req.body || {}))));
apiRouter.get('/assignments/:id', wrap(async (req, res) => res.json({ assignment: await assignments.get(req, req.params.id) })));
apiRouter.patch('/assignments/:id', wrap(async (req, res) => res.json(await assignments.edit(req, req.params.id, req.body || {}))));
apiRouter.post('/assignments/:id/close', wrap(async (req, res) => res.json(await assignments.close(req, req.params.id))));
apiRouter.post('/assignments/:id/reopen', wrap(async (req, res) => res.json(await assignments.reopen(req, req.params.id))));
apiRouter.post(
  '/assignments/:id/start',
  wrap(async (req, res) => {
    const result = await assignments.start(req, req.params.id, req.body || {});
    res.status(result.created ? 201 : 200).json(result);
  }),
);
apiRouter.get('/assignments/:id/progress', wrap(async (req, res) => res.json(await assignments.progress(req, req.params.id))));
apiRouter.get('/assignments/:id/drafts/:mid', wrap(async (req, res) => res.json({ drafts: await assignments.drafts(req, req.params.id, req.params.mid) })));

// ---- submissions (itch-16, d-35) -------------------------------------------------------------
// Every rule lives in src/submissions.js. An attempt is append-only: nothing here updates or deletes
// one; the teacher's review is its own row. Students name their draft by program id (their own row);
// the teacher names students by membership id and attempts by submission id.

apiRouter.post('/assignments/:id/submissions', wrap(async (req, res) => res.status(201).json(await submissions.turnIn(req, req.params.id, req.body || {}))));
apiRouter.get('/assignments/:id/submissions/mine', wrap(async (req, res) => res.json({ submissions: await submissions.mine(req, req.params.id) })));
apiRouter.get('/assignments/:id/submissions/:mid', wrap(async (req, res) => res.json({ submissions: await submissions.forStudent(req, req.params.id, req.params.mid) })));
apiRouter.put('/submissions/:id/review', wrap(async (req, res) => res.json(await submissions.review(req, req.params.id, req.body || {}))));
// ---- sent copies (itch-18, d-38) ---------------------------------------------------------------
// Every rule lives in src/sentcopies.js. A copy is append-only; the teacher's reply is its own row.

apiRouter.post('/classes/:id/sent-copies', wrap(async (req, res) => res.status(201).json(await sentCopies.send(req, req.params.id, req.body || {}))));
apiRouter.get('/classes/:id/sent-copies', wrap(async (req, res) => res.json({ copies: await sentCopies.listForTeacher(req, req.params.id) })));
apiRouter.get('/classes/:id/sent-copies/mine', wrap(async (req, res) => res.json({ copies: await sentCopies.mine(req, req.params.id) })));
apiRouter.put('/sent-copies/:id/reply', wrap(async (req, res) => res.json(await sentCopies.reply(req, req.params.id, req.body || {}))));
apiRouter.post('/sent-copies/:id/duplicate', wrap(async (req, res) => res.status(201).json(await sentCopies.duplicate(req, req.params.id, req.body || {}))));

// Peer examples (itch-17, d-37): the teacher publishes an attempt; the class comes from the attempt.
apiRouter.post('/submissions/:id/publish', wrap(async (req, res) => res.status(201).json(await submissions.publishExample(req, req.params.id, req.body || {}))));
apiRouter.post('/submissions/:id/duplicate', wrap(async (req, res) => res.status(201).json(await submissions.duplicate(req, req.params.id, req.body || {}))));

// ---- profiles -------------------------------------------------------------------------------

apiRouter.get(
  '/profiles',
  wrap(async (req, res) => {
    res.json({ profiles: await req.scope.listProfiles() });
  }),
);

apiRouter.post(
  '/profiles',
  wrap(async (req, res) => {
    const body = req.body || {};
    const name = requireName(body.name);
    const color = optionalString(body.color, 'color', 32) || '#2f80ed';
    const profile = await req.scope.createProfile({ name, color, prefs: { speed: 1, muted: false } });
    res.status(201).json({ profile });
  }),
);

apiRouter.get(
  '/profiles/:id',
  wrap(async (req, res) => {
    const profile = await req.scope.getProfile(requireUuid(req.params.id));
    if (!profile) throw new HttpError(404, 'profile not found');
    res.json({ profile });
  }),
);

apiRouter.patch(
  '/profiles/:id',
  wrap(async (req, res) => {
    const body = req.body || {};
    const patch = {};
    if (body.name !== undefined) patch.name = requireName(body.name);
    if (body.color !== undefined) patch.color = optionalString(body.color, 'color', 32);
    if (body.prefs !== undefined) {
      if (typeof body.prefs !== 'object' || body.prefs === null || Array.isArray(body.prefs)) {
        throw new HttpError(400, 'prefs must be an object');
      }
      patch.prefs = body.prefs;
    }
    const profile = await req.scope.updateProfile(requireUuid(req.params.id), patch);
    if (!profile) throw new HttpError(404, 'profile not found');
    res.json({ profile });
  }),
);

// Deleting a profile takes everything in it (d-40): its programs, floors, runs, drawings and
// workbook rows go with it. Class records do not — a turned-in attempt (d-35) and a sent copy
// (d-38) are the class's record, not the profile's, so they stay and only lose their link to the
// program they were built from. A user's last profile is refused: an account with none is a state
// the client has never had to show.
apiRouter.delete(
  '/profiles/:id',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    if ((await store.listProfiles()).length <= 1) {
      throw new HttpError(409, 'this is your only profile; make another one before deleting it');
    }
    if (!(await store.deleteProfile(profileId))) throw new HttpError(404, 'profile not found');
    res.status(204).end();
  }),
);

// ---- programs -------------------------------------------------------------------------------

apiRouter.get(
  '/profiles/:id/programs',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    res.json({ programs: await store.listPrograms(profileId) });
  }),
);

apiRouter.post(
  '/profiles/:id/programs',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    const body = req.body || {};
    const program = await store.createProgram(profileId, {
      name: requireName(body.name, 'Untitled program'),
      code: optionalString(body.code, 'code', CODE_MAX) ?? LESSON_TEMPLATE,
      floorId: optionalString(body.floorId, 'floorId', 100) || 'blank',
      exerciseRef: optionalString(body.exerciseRef, 'exerciseRef', 100) || null,
    });
    res.status(201).json({ program });
  }),
);

apiRouter.get(
  '/programs/:id',
  wrap(async (req, res) => {
    const program = await req.scope.getProgram(requireUuid(req.params.id));
    if (!program) throw new HttpError(404, 'program not found');
    res.json({ program });
  }),
);

apiRouter.put(
  '/programs/:id',
  wrap(async (req, res) => {
    const body = req.body || {};
    const patch = {};
    if (body.name !== undefined) patch.name = requireName(body.name);
    if (body.code !== undefined) patch.code = optionalString(body.code, 'code', CODE_MAX);
    if (body.floorId !== undefined) patch.floorId = optionalString(body.floorId, 'floorId', 100);
    if (body.exerciseRef !== undefined) {
      patch.exerciseRef = body.exerciseRef === null ? null : optionalString(body.exerciseRef, 'exerciseRef', 100);
    }
    const program = await req.scope.updateProgram(requireUuid(req.params.id), patch);
    if (!program) throw new HttpError(404, 'program not found');
    res.json({ program });
  }),
);

apiRouter.delete(
  '/programs/:id',
  wrap(async (req, res) => {
    const ok = await req.scope.deleteProgram(requireUuid(req.params.id));
    if (!ok) throw new HttpError(404, 'program not found');
    res.status(204).end();
  }),
);

// ---- hand-off to another profile (Milestone 6, d-25) ----------------------------------------
// POST /programs/:id/handoff { profileId }: a copy of the program in the other profile, with a
// copy of its custom floor (a built-in floor id is the same everywhere) and the same Workbook
// exercises attached there (done stays false; an attachment they already made is left alone).
// Runs and drawings stay with the profile that made them (d-13). Composed from the ordinary
// store methods (src/copy.js, shared with class resources since d-32), so both stores support it
// without a new table, column or method. The target must be one of the caller's own profiles
// (d-29): any other id is "profile not found".

apiRouter.post(
  '/programs/:id/handoff',
  wrap(async (req, res) => {
    const store = req.scope;
    const program = await store.getProgram(requireUuid(req.params.id));
    if (!program) throw new HttpError(404, 'program not found');
    const body = req.body || {};
    if (!UUID_RE.test(String(body.profileId))) throw new HttpError(400, 'profileId must be the id of another profile');
    const targetId = String(body.profileId);
    if (targetId === program.profileId) throw new HttpError(400, 'that program is already in this profile');
    const target = await store.getProfile(targetId);
    if (!target) throw new HttpError(404, 'profile not found');
    const source = UUID_RE.test(String(program.floorId)) ? await store.getFloor(program.floorId) : null;
    const { program: copy, floor } = await copyProgramWithFloor(store, targetId, { program, floor: source });
    const attachments = (await store.listWorkbook(program.profileId))
      .map((e) => ({ lesson: e.lesson, exercise: e.exercise, program: e.programId === program.id, floor: !!source && e.floorId === source.id }))
      .filter((a) => a.program || a.floor);
    const entries = await attachToWorkbook(store, targetId, attachments, { program: copy, floor });
    res.status(201).json({ program: copy, floor, entries });
  }),
);

// ---- floors (Milestone 2, d-8) --------------------------------------------------------------
// A floor row is { id, profileId, name, description, width, height, background, start, tape,
// walls, lights, darkAreas, slopes, builtin: false, classId, assignmentId, locked, createdAt, updatedAt }
// — the same shape the client uses for built-in floors, so a program's floorId may name either. A
// locked floor (an assignment's copy, d-34) refuses edits and delete; Copy makes an editable one.
const LOCKED_FLOOR = 'this floor belongs to an assignment and is read-only; copy it to edit';

apiRouter.get(
  '/profiles/:id/floors',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    res.json({ floors: await store.listFloors(profileId) });
  }),
);

apiRouter.post(
  '/profiles/:id/floors',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    const body = req.body || {};
    const floor = await store.createFloor(profileId, {
      name: requireName(body.name, 'Untitled floor'),
      data: sanitizeFloor(body),
    });
    res.status(201).json({ floor });
  }),
);

apiRouter.get(
  '/floors/:id',
  wrap(async (req, res) => {
    const floor = await req.scope.getFloor(requireUuid(req.params.id));
    if (!floor) throw new HttpError(404, 'floor not found');
    res.json({ floor });
  }),
);

apiRouter.put(
  '/floors/:id',
  wrap(async (req, res) => {
    const store = req.scope;
    const id = requireUuid(req.params.id);
    const body = req.body || {};
    const existing = await store.getFloor(id);
    if (!existing) throw new HttpError(404, 'floor not found');
    if (existing.locked) throw new HttpError(409, LOCKED_FLOOR);
    const patch = {};
    if (body.name !== undefined) patch.name = requireName(body.name);
    // Geometry keys that are present replace the stored ones; absent keys keep their value.
    if (hasFloorFields(body)) patch.data = sanitizeFloor({ ...floorData(existing), ...floorData(body) });
    const floor = await store.updateFloor(id, patch);
    res.json({ floor });
  }),
);

apiRouter.delete(
  '/floors/:id',
  wrap(async (req, res) => {
    const id = requireUuid(req.params.id);
    const existing = await req.scope.getFloor(id);
    if (!existing) throw new HttpError(404, 'floor not found');
    if (existing.locked) throw new HttpError(409, LOCKED_FLOOR);
    const ok = await req.scope.deleteFloor(id);
    if (!ok) throw new HttpError(404, 'floor not found');
    res.status(204).end();
  }),
);

// ---- runs (Milestone 3, d-13) ---------------------------------------------------------------
// A run row is { id, profileId, programId, programName, floorId, floorName, status, elapsed,
// wheelLeft, wheelRight, hasPen, createdAt } plus, on creation and on GET /runs/:id, `data`:
// { code, speed, floor, trail, trace: {fields, samples}, console, ink, error } bounded by
// src/runshape.js. The list omits data so it stays cheap; newest first.

apiRouter.get(
  '/profiles/:id/runs',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    const filters = {};
    if (req.query.programId !== undefined && req.query.programId !== '') {
      if (!UUID_RE.test(String(req.query.programId))) throw new HttpError(400, 'programId must be a uuid');
      filters.programId = String(req.query.programId);
    }
    if (req.query.floorId !== undefined && req.query.floorId !== '') filters.floorId = String(req.query.floorId).slice(0, 100);
    res.json({ runs: await store.listRuns(profileId, filters) });
  }),
);

apiRouter.post(
  '/profiles/:id/runs',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    const body = req.body || {};
    const notOurs = new HttpError(400, 'programId must be the id of a program in this profile');
    if (!UUID_RE.test(String(body.programId))) throw notOurs;
    const program = await store.getProgram(body.programId);
    if (!program || program.profileId !== profileId) throw notOurs;
    const run = await store.createRun(profileId, { programId: program.id, ...sanitizeRun(body) });
    if (!run) throw notOurs;
    res.status(201).json({ run });
  }),
);

// "Keep the last N runs per program" (default 50).
apiRouter.post(
  '/profiles/:id/runs/prune',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    const body = req.body || {};
    const keep = body.keep === undefined ? 50 : Number(body.keep);
    if (!Number.isInteger(keep) || keep < 0 || keep > 10000) throw new HttpError(400, 'keep must be a whole number from 0 to 10000');
    res.json({ deleted: await store.pruneRuns(profileId, keep) });
  }),
);

apiRouter.get(
  '/runs/:id',
  wrap(async (req, res) => {
    const run = await req.scope.getRun(requireUuid(req.params.id));
    if (!run) throw new HttpError(404, 'run not found');
    res.json({ run });
  }),
);

apiRouter.delete(
  '/runs/:id',
  wrap(async (req, res) => {
    const ok = await req.scope.deleteRun(requireUuid(req.params.id));
    if (!ok) throw new HttpError(404, 'run not found');
    res.status(204).end();
  }),
);

// ---- drawings (Milestone 3, d-13) -----------------------------------------------------------
// A drawing row is { id, profileId, runId, title, programName, floorName, width, height,
// background, strokes: [{color, width, points: [[x, y, t]...]}], createdAt }; newest first.

apiRouter.get(
  '/profiles/:id/drawings',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    res.json({ drawings: await store.listDrawings(profileId) });
  }),
);

apiRouter.post(
  '/profiles/:id/drawings',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    const body = req.body || {};
    const drawing = await store.createDrawing(profileId, { title: requireName(body.title, 'Untitled drawing'), ...sanitizeDrawing(body) });
    res.status(201).json({ drawing });
  }),
);

apiRouter.get(
  '/drawings/:id',
  wrap(async (req, res) => {
    const drawing = await req.scope.getDrawing(requireUuid(req.params.id));
    if (!drawing) throw new HttpError(404, 'drawing not found');
    res.json({ drawing });
  }),
);

apiRouter.delete(
  '/drawings/:id',
  wrap(async (req, res) => {
    const ok = await req.scope.deleteDrawing(requireUuid(req.params.id));
    if (!ok) throw new HttpError(404, 'drawing not found');
    res.status(204).end();
  }),
);

// ---- workbook (Milestone 4, d-21) ---------------------------------------------------------
// The lesson catalogue is fixed code (public/js/lessons.js). An entry row is { id, profileId,
// lesson, exercise, done, programId, floorId, updatedAt }; one exists only for exercises she has
// touched. PUT upserts by lesson/exercise number: absent keys keep their value, null clears.
// Attaching a program also records the exercise on the program (programs.exercise_ref, d-6).

apiRouter.get(
  '/profiles/:id/workbook',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    res.json({ entries: await store.listWorkbook(profileId) });
  }),
);

apiRouter.put(
  '/profiles/:id/workbook/:lesson/:exercise',
  wrap(async (req, res) => {
    const store = req.scope;
    const profileId = await requireProfile(store, req.params.id);
    const lesson = Number(req.params.lesson);
    const exercise = Number(req.params.exercise);
    const info = lessonByNumber(lesson);
    if (!info || !Number.isInteger(exercise) || exercise < 1 || exercise > info.exercises) throw new HttpError(404, 'no such exercise');
    const body = req.body || {};
    const patch = {};
    if (body.done !== undefined) {
      if (typeof body.done !== 'boolean') throw new HttpError(400, 'done must be true or false');
      patch.done = body.done;
    }
    if (body.programId !== undefined) {
      if (body.programId === null || body.programId === '') patch.programId = null;
      else {
        const notOurs = new HttpError(400, 'programId must be the id of a program in this profile');
        if (!UUID_RE.test(String(body.programId))) throw notOurs;
        const program = await store.getProgram(body.programId);
        if (!program || program.profileId !== profileId) throw notOurs;
        patch.programId = program.id;
      }
    }
    if (body.floorId !== undefined) {
      patch.floorId = body.floorId === null || body.floorId === '' ? null : optionalString(body.floorId, 'floorId', 100);
    }
    const entry = await store.upsertWorkbookEntry(profileId, lesson, exercise, patch);
    if (!entry) throw new HttpError(404, 'profile not found');
    if (patch.programId) await store.updateProgram(patch.programId, { exerciseRef: exerciseRef(lesson, exercise) });
    res.json({ entry });
  }),
);

apiRouter.use((_req, res) => res.status(404).json({ error: 'not found' }));

// eslint-disable-next-line no-unused-vars
apiRouter.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
});
