// Classes (itch-14, d-32): every membership rule lives here, in the src/account.js shape. Reads go
// through req.scope (src/store/scoped.js gates them by classRole, so a non-member sees "no such
// class"); writes go to the raw store only after that check. Membership ids, never user ids,
// travel in URLs, and join codes travel in bodies. Nothing here deletes: remove, archive and
// unpublish are state flips. Usernames reach a caller only as their class's teacher or, for a
// teacher, their own roster.
import { randomInt } from 'node:crypto';
import { getStore } from './store/index.js';
import { requireRegistered, resetPassword } from './account.js';
import { floorData, sanitizeFloor } from './floorshape.js';
import { copyProgramWithFloor, attachToWorkbook } from './copy.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LENGTH = 6;
const NAME_MAX = 80;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ClassError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function newJoinCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** What a student typed, as stored: upper case, no spaces or dashes. */
export function normalizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '');
}

const pretty = (code) => code.slice(0, 3) + '-' + code.slice(3);
const nowIso = () => new Date().toISOString();

function requireName(value) {
  if (typeof value !== 'string' || !value.trim()) throw new ClassError(400, 'name is required');
  if (value.length > NAME_MAX) throw new ClassError(400, `name must be at most ${NAME_MAX} characters`);
  return value.trim();
}

function uuid(value) {
  if (!UUID_RE.test(String(value))) throw new ClassError(404, 'not found');
  return String(value);
}

/** What the client sees of a class. The code (and the join link) only when the caller may see it. */
function classView(cls) {
  const out = { id: cls.id, name: cls.name, archivedAt: cls.archivedAt, createdAt: cls.createdAt };
  if (cls.joinCode !== undefined && cls.joinCode !== null) {
    out.joinCode = pretty(cls.joinCode);
    out.joinUrl = '/?join=' + cls.joinCode;
  }
  return out;
}

/**
 * A peer example as src/store/scoped.js resolved it (d-37), field by field: { byline, note } for
 * everyone, plus attribution, author and hidden when the scoped store gave them to the teacher.
 */
function exampleView(e) {
  if (!e) return null;
  const out = { byline: e.byline, note: e.note };
  if (e.attribution !== undefined) out.attribution = e.attribution;
  if (e.author !== undefined) out.author = e.author ? { username: e.author.username, state: e.author.state } : null;
  if (e.hidden !== undefined) out.hidden = !!e.hidden;
  return out;
}

/** What anyone in the class sees of a published resource: never the publisher's user id or the code. */
export function resourceView(r) {
  const snap = r.snapshot || {};
  return {
    id: r.id,
    classId: r.classId,
    kind: r.kind,
    name: r.name,
    floorName: snap.floor ? snap.floor.name : null,
    exerciseRef: snap.program ? snap.program.exerciseRef || null : null,
    publishedAt: r.publishedAt,
    unpublishedAt: r.unpublishedAt,
    example: exampleView(r.example),
  };
}

/**
 * A snapshot { program, floor } as the read-only runner takes it (d-34): the floor flattened to a
 * floor document, the program with the floor id it runs on (null when the snapshot carries its floor).
 */
export function runnableSnapshot(snap, { floorId = 'blank', exerciseRef = null } = {}) {
  const s = snap || {};
  const floor = s.floor ? { name: s.floor.name, ...(s.floor.data || {}) } : null;
  const program = s.program
    ? { name: s.program.name, code: s.program.code || '', floorId: floor ? null : s.program.floorId || floorId, exerciseRef: s.program.exerciseRef || exerciseRef }
    : null;
  return { program, floor };
}

/** The caller must be the class's teacher; the class must be open unless allowArchived. */
export async function requireTeacher(req, classId, { allowArchived = false } = {}) {
  const id = uuid(classId);
  const role = await req.scope.classRole(id);
  if (!role) throw new ClassError(404, 'class not found');
  if (role.role !== 'teacher') throw new ClassError(403, 'only the teacher can do that');
  const cls = await getStore().getClass(id);
  if (!cls) throw new ClassError(404, 'class not found');
  if (cls.archivedAt && !allowArchived) throw new ClassError(409, 'this class is archived');
  return { cls, role };
}

/**
 * The caller must be an active student of an open class (d-38; turn-in and send a copy share it).
 * `what` completes "only students ..." in the refusal.
 */
export async function requireOpenStudent(req, classId, { what = 'do that' } = {}) {
  const id = uuid(classId);
  const role = await req.scope.classRole(id);
  if (!role) throw new ClassError(404, 'class not found');
  if (role.role !== 'student') throw new ClassError(403, `only students ${what}`);
  if (role.state !== 'active') throw new ClassError(409, 'this class is archived');
  const cls = await getStore().getClass(id); // archiving flips the class before its memberships
  if (!cls || cls.archivedAt) throw new ClassError(409, 'this class is archived');
  return { cls, role };
}

/**
 * An immutable snapshot of one of the caller's own programs (d-32 publish, d-38 send a copy):
 * { program: { name, code, floorId, exerciseRef }, floor: { name, data } | null }, embedding the
 * program's custom floor, read through the caller's scope, so only their own floor can be included.
 */
export async function programSnapshot(scope, program) {
  const custom = UUID_RE.test(String(program.floorId)) ? await scope.getFloor(program.floorId) : null;
  return {
    program: { name: program.name, code: program.code, floorId: custom ? 'blank' : program.floorId || 'blank', exerciseRef: program.exerciseRef || null },
    floor: custom ? { name: custom.name, data: sanitizeFloor(floorData(custom)) } : null,
  };
}

async function withFreshCode(attempt) {
  for (let i = 0; i < 5; i++) {
    try {
      return await attempt(newJoinCode());
    } catch (err) {
      if (!(err && err.code === 'JOIN_CODE_TAKEN')) throw err;
    }
  }
  throw new ClassError(500, 'could not make a join code');
}

/** POST /classes { name }: a new class with the caller as its teacher. */
export async function createClass(req, body) {
  const store = getStore();
  await requireRegistered(store, req.userId);
  const name = requireName(body.name);
  const cls = await withFreshCode((joinCode) => store.createClass({ name, createdBy: req.userId, joinCode }));
  const membership = await store.createMembership({ classId: cls.id, userId: req.userId, role: 'teacher', state: 'active' });
  req.scope.invalidateMemberships();
  return { class: classView(cls), membership };
}

/** POST /classes/join { code }: become an active student of the class the code names. */
export async function joinByCode(req, body) {
  const store = getStore();
  await requireRegistered(store, req.userId);
  const code = normalizeCode(body.code);
  const cls = code.length === CODE_LENGTH ? await store.findClassByJoinCode(code) : null;
  if (!cls) throw new ClassError(404, 'that code does not work');
  if (cls.archivedAt) throw new ClassError(409, 'this class is closed');
  let membership = await store.findMembership(cls.id, req.userId);
  if (!membership) {
    membership = await store.createMembership({ classId: cls.id, userId: req.userId, role: 'student', state: 'active' });
  } else if (membership.state === 'active') {
    // already in: joining again is harmless
  } else if (membership.state === 'invited' || (membership.state === 'removed' && membership.rejoinAllowed)) {
    membership = await store.updateMembership(membership.id, { state: 'active', joinedAt: nowIso() });
  } else if (membership.state === 'removed') {
    throw new ClassError(403, 'you were removed from this class; ask your teacher');
  } else {
    throw new ClassError(409, 'this class is closed');
  }
  req.scope.invalidateMemberships();
  return { class: classView(membership.role === 'teacher' ? cls : { ...cls, joinCode: undefined }), membership };
}

/** GET /classes: the caller's classes, with their own membership and the teacher's username. */
export async function listMine(req) {
  const rows = await req.scope.listClasses();
  return rows.map((r) => ({ ...classView(r), membership: r.membership, teacher: { username: r.teacherUsername } }));
}

/** GET /classes/:id: one class as the caller may see it. */
export async function getClass(req, classId) {
  const id = uuid(classId);
  const cls = await req.scope.getClass(id);
  if (!cls) throw new ClassError(404, 'class not found');
  const role = await req.scope.classRole(id);
  const mine = (await req.scope.listClasses()).find((r) => r.id === id);
  return { ...classView(cls), membership: role.membership, teacher: { username: mine ? mine.teacherUsername : null } };
}

/** GET /classes/:id/roster: the students, for the teacher only. No user ids. */
export async function roster(req, classId) {
  const id = uuid(classId);
  const role = await req.scope.classRole(id);
  if (!role) throw new ClassError(404, 'class not found');
  if (role.role !== 'teacher') throw new ClassError(403, 'only the teacher can see the roster');
  const rows = (await req.scope.listRoster(id)) || [];
  return rows
    .filter((m) => m.role === 'student')
    .map((m) => ({ id: m.id, username: m.username, state: m.state, joinedAt: m.joinedAt, rejoinAllowed: m.rejoinAllowed }));
}

/** POST /classes/:id/members/:mid/remove { allowRejoin? }: the student is out; the code lets them back only if allowed. */
export async function removeMember(req, classId, membershipId, body) {
  const store = getStore();
  const { cls } = await requireTeacher(req, classId);
  const m = await store.getMembership(uuid(membershipId));
  if (!m || m.classId !== cls.id || m.role !== 'student') throw new ClassError(404, 'student not found');
  const membership = await store.updateMembership(m.id, { state: 'removed', rejoinAllowed: !!body.allowRejoin });
  return { membership };
}

/** POST /classes/:id/archive: close the class; every active membership becomes archived, the teacher's too. */
export async function archiveClass(req, classId) {
  const store = getStore();
  const { cls } = await requireTeacher(req, classId);
  const archived = await store.updateClass(cls.id, { archivedAt: nowIso() });
  const archivedMemberships = await store.archiveClassMemberships(cls.id);
  req.scope.invalidateMemberships();
  return { class: classView(archived), archivedMemberships };
}

/** POST /classes/:id/code: a fresh join code; the old one stops working at once. */
export async function rotateCode(req, classId) {
  const store = getStore();
  const { cls } = await requireTeacher(req, classId);
  const updated = await withFreshCode((joinCode) => store.updateClass(cls.id, { joinCode }));
  return { class: classView(updated) };
}

/** POST /classes/:id/members/:mid/password { password }: a new password for an active student; their browsers are signed out. */
export async function resetStudentPassword(req, classId, membershipId, body) {
  const store = getStore();
  const { cls } = await requireTeacher(req, classId);
  const m = await store.getMembership(uuid(membershipId));
  if (!m || m.classId !== cls.id || m.role !== 'student' || m.state !== 'active') throw new ClassError(404, 'student not found');
  const { revokedSessions } = await resetPassword(store, m.userId, body.password);
  return { ok: true, revokedSessions };
}

/** POST /classes/:id/resources { programId } | { floorId }: an immutable snapshot of one of the teacher's own rows. */
export async function publish(req, classId, body) {
  const store = getStore();
  const { cls } = await requireTeacher(req, classId);
  let kind;
  let name;
  let snapshot;
  let sourceId;
  if (body.programId !== undefined) {
    const program = await req.scope.getProgram(uuid(body.programId));
    if (!program) throw new ClassError(404, 'program not found');
    kind = 'program';
    name = program.name;
    sourceId = program.id;
    snapshot = await programSnapshot(req.scope, program);
  } else if (body.floorId !== undefined) {
    const floor = await req.scope.getFloor(uuid(body.floorId));
    if (!floor) throw new ClassError(404, 'floor not found');
    kind = 'floor';
    name = floor.name;
    sourceId = floor.id;
    snapshot = { program: null, floor: { name: floor.name, data: sanitizeFloor(floorData(floor)) } };
  } else {
    throw new ClassError(400, 'programId or floorId is required');
  }
  const resource = await store.createResource({ classId: cls.id, publishedBy: req.userId, kind, name, snapshot, sourceId });
  return { resource: resourceView(resource) };
}

/** GET /classes/:id/resources: what the class can see (a teacher also sees what they unpublished). */
export async function listResources(req, classId) {
  const rows = await req.scope.listResources(uuid(classId));
  if (!rows) throw new ClassError(404, 'class not found');
  return rows.map(resourceView);
}

/** GET /class-resources/:id/snapshot: what a member runs read-only without copying (d-34). */
export async function resourceSnapshot(req, resourceId) {
  const resource = await req.scope.getResource(uuid(resourceId));
  if (!resource) throw new ClassError(404, 'resource not found');
  return { resource: resourceView(resource), ...runnableSnapshot(resource.snapshot) };
}

/** POST /class-resources/:id/unpublish: hide it from students; the snapshot row stays. */
export async function unpublish(req, resourceId) {
  const store = getStore();
  const resource = await req.scope.getResource(uuid(resourceId));
  if (!resource) throw new ClassError(404, 'resource not found');
  await requireTeacher(req, resource.classId, { allowArchived: true });
  const updated = await store.unpublishResource(resource.id);
  if (!updated) throw new ClassError(409, 'already unpublished');
  return { resource: resourceView((await req.scope.getResource(resource.id)) || { ...updated, example: null }) };
}

/**
 * POST /class-resources/:id/copy { profileId }: an independent editable copy in one of the caller's
 * own profiles — the program, its custom floor if the snapshot carries one, and the d-25 workbook
 * attachment for the exercise the program names. Same answer shape as hand-off.
 */
export async function copyResource(req, resourceId, body) {
  const resource = await req.scope.getResource(uuid(resourceId));
  if (!resource || resource.unpublishedAt) throw new ClassError(404, 'resource not found');
  const role = await req.scope.classRole(resource.classId);
  if (!role || role.state !== 'active') throw new ClassError(409, 'this class is archived');
  const profileId = uuid(body.profileId);
  const target = await req.scope.getProfile(profileId);
  if (!target) throw new ClassError(404, 'profile not found');
  const snap = resource.snapshot || {};
  const floorDoc = snap.floor ? { name: snap.floor.name, ...(snap.floor.data || {}) } : null;
  if (!snap.program) {
    if (!floorDoc) throw new ClassError(404, 'resource not found');
    const floor = await req.scope.createFloor(profileId, { name: floorDoc.name, data: sanitizeFloor(floorData(floorDoc)) });
    return { program: null, floor, entries: [] };
  }
  const { program, floor } = await copyProgramWithFloor(req.scope, profileId, { program: snap.program, floor: floorDoc });
  const ref = /^(\d+)\.(\d+)$/.exec(String(snap.program.exerciseRef || ''));
  const attachments = ref ? [{ lesson: Number(ref[1]), exercise: Number(ref[2]), program: true, floor: !!floor }] : [];
  const entries = await attachToWorkbook(req.scope, profileId, attachments, { program, floor });
  return { program, floor, entries };
}
