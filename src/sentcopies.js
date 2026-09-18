// Sent copies (itch-18, d-38): "Send a copy to teacher". A student sends an immutable snapshot of any
// of their own programs to the teacher of a class they are active in, with an optional message; the
// teacher opens it read-only, duplicates it into their own profile and leaves one replaceable reply.
// Copies are keyed by class membership (taken from the session, never the request), never updated or
// deleted, never assignment attempts, and stay the class's record after a student is removed.
import { getStore } from './store/index.js';
import { copyProgramWithFloor, attachToWorkbook } from './copy.js';
import { ClassError, requireTeacher, requireOpenStudent, programSnapshot, runnableSnapshot } from './classes.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_MAX = 1000;
const REPLY_MAX = 4000;

function uuid(value) {
  if (!UUID_RE.test(String(value))) throw new ClassError(404, 'not found');
  return String(value);
}

function text(value, field, max, { required = false } = {}) {
  if (value === undefined && required) throw new ClassError(400, `${field} is required`);
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ClassError(400, `${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ClassError(400, `${field} must be at most ${max} characters`);
  return trimmed;
}

/** What a reader sees of a copy: the runnable snapshot, the message and the reply. No ids but its own and its class's. */
function copyView(c, { author } = {}) {
  const view = {
    id: c.id,
    classId: c.classId,
    sentAt: c.createdAt,
    message: c.message || '',
    ...runnableSnapshot(c.snapshot),
    reply: c.reply ? { comment: c.reply.comment, updatedAt: c.reply.updatedAt } : null,
  };
  if (author !== undefined) view.author = author ? { username: author.username, state: author.state } : null;
  return view;
}

/** POST /classes/:id/sent-copies { programId, message? }: send the teacher a copy of one of my programs. */
export async function send(req, classId, body) {
  const { cls, role } = await requireOpenStudent(req, classId, { what: 'send copies to the teacher' });
  const program = await req.scope.getProgram(uuid(body.programId)); // the caller's own rows only
  if (!program) throw new ClassError(404, 'program not found');
  const message = text(body.message, 'message', MESSAGE_MAX);
  const snapshot = await programSnapshot(req.scope, program);
  const copy = await getStore().createSentCopy({ membershipId: role.membership.id, sourceProgramId: program.id, snapshot, message });
  return { copy: copyView({ ...copy, classId: cls.id }) };
}

/** GET /classes/:id/sent-copies: every copy sent in the class, for its teacher (archived classes too). */
export async function listForTeacher(req, classId) {
  const { cls } = await requireTeacher(req, classId, { allowArchived: true });
  const rows = (await req.scope.classSentCopies(cls.id)) || [];
  return rows.map((c) => copyView(c, { author: c.author }));
}

/** GET /classes/:id/sent-copies/mine: the caller's own copies in this class. */
export async function mine(req, classId) {
  const id = uuid(classId);
  const rows = await req.scope.mySentCopies(id);
  if (rows) return rows.map((c) => copyView(c));
  if (!(await req.scope.classRole(id))) throw new ClassError(404, 'class not found');
  throw new ClassError(403, 'only students send copies');
}

async function teacherCopy(req, id, { allowArchived }) {
  const found = await req.scope.sentCopyFor(uuid(id));
  if (!found) throw new ClassError(404, 'copy not found');
  if (!found.asTeacher) throw new ClassError(403, 'only the teacher can do that');
  await requireTeacher(req, found.copy.classId, { allowArchived });
  return found.copy;
}

/** PUT /sent-copies/:id/reply { comment }: the teacher's one reply; '' clears it; an archived class is frozen. */
export async function reply(req, id, body) {
  const copy = await teacherCopy(req, id, { allowArchived: false });
  const comment = text(body.comment, 'comment', REPLY_MAX, { required: true });
  const updated = await getStore().upsertSentCopyReply(copy.id, { comment, repliedBy: req.userId });
  return { copy: copyView(updated) };
}

/** POST /sent-copies/:id/duplicate { profileId }: an editable copy in one of the teacher's own profiles. */
export async function duplicate(req, id, body) {
  const copy = await teacherCopy(req, id, { allowArchived: true });
  const profileId = uuid(body.profileId);
  if (!(await req.scope.getProfile(profileId))) throw new ClassError(404, 'profile not found');
  const snap = copy.snapshot || {};
  if (!snap.program) throw new ClassError(404, 'copy not found');
  const m = await getStore().getMembership(copy.membershipId);
  const user = m ? await getStore().getUser(m.userId) : null;
  const whose = user && user.username ? `${user.username}'s copy` : 'a student copy';
  const floorDoc = snap.floor ? { name: snap.floor.name, ...(snap.floor.data || {}) } : null;
  const program = { ...snap.program, floorId: floorDoc ? null : snap.program.floorId, name: `${snap.program.name} (${whose})` };
  const made = await copyProgramWithFloor(req.scope, profileId, { program, floor: floorDoc });
  const ref = /^(\d+)\.(\d+)$/.exec(String(snap.program.exerciseRef || ''));
  const attachments = ref ? [{ lesson: Number(ref[1]), exercise: Number(ref[2]), program: true, floor: !!made.floor }] : [];
  const entries = await attachToWorkbook(req.scope, profileId, attachments, made);
  return { program: made.program, floor: made.floor, entries };
}
