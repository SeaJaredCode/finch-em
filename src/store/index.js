import { createPgStore } from './pg.js';
import { createMemoryStore } from './memory.js';

// The store interface (see d-6, d-8, d-29, d-31):
//   kind: 'pg' | 'memory'
//   ping()
//   createUser({username?, usernameKey?, passwordHash?}) / getUser(id)
//   — a user is { id, username, registeredAt, createdAt }; anonymous users have username null; the
//   password hash is never on a user row  (d-29, d-31)
//   findCredential(usernameKey) -> { userId, passwordHash } | null — the only method that returns a hash
//   setCredential(userId, {username, usernameKey, passwordHash}) -> user | null when missing or already
//   registered; createUser and setCredential reject with err.code 'USERNAME_TAKEN' on a duplicate key  (d-31)
//   createSession({tokenHash, userId, homeUserId?, expiresAt}) / getSession(tokenHash) / touchSession(tokenHash, expiresAt)
//   deleteSession(tokenHash) -> boolean — a session is { tokenHash, userId, homeUserId, createdAt, lastSeenAt, expiresAt }  (d-29, d-31)
//   listProfiles(userId) / getProfile(id) / createProfile({userId,name,color,prefs}) / updateProfile(id, patch)
//   claimProfile(id, userId) — gives an unclaimed (user_id NULL) profile to a user, null if taken  (d-29)
//   moveProfile(id, fromUserId, toUserId) — re-homes a profile the giver owns, null otherwise  (d-31)
//   listUnclaimedProfiles() -> [{id, name, color, createdAt}] for user_id NULL rows  (d-31)
//   claimProfile and moveProfile are the ONLY writers of profiles.user_id, each one conditional
//   UPDATE; nothing in this interface copies or deletes a profile's rows on an ownership change.
//   deleteProfile(id) -> boolean — removes the profile and everything profile-owned with it:
//   programs, floors, runs, drawings and workbook entries. In pg that is the schema's ON DELETE
//   CASCADE doing the work; the memory store hand-writes the same chain. Class records are NOT
//   profile-owned and outlive the profile: an attempt (d-35) and a sent copy (d-38) key off a
//   membership, and losing the program they were built from only clears source_program_id, so the
//   teacher keeps the snapshot. Refusing a user's LAST profile is a route rule, not a store rule  (d-40)
//   setPassword(userId, passwordHash) -> user | null (registered users only)  (d-32)
//   revokeUserSessions(userId) -> count — sessions that remember a home user go back to it (user_id =
//   home_user_id, home cleared); the rest are deleted  (d-32)
//   createClass({name, createdBy, joinCode}) (err.code 'JOIN_CODE_TAKEN' on a duplicate) / getClass(id)
//   findClassByJoinCode(code) / updateClass(id, {joinCode?, archivedAt?})
//   — a class is { id, name, createdBy, joinCode, archivedAt, createdAt, updatedAt }  (d-32)
//   listClassesForUser(userId) -> [{ class, membership, teacherUsername }], one per membership  (d-32)
//   findMembership(classId, userId) / getMembership(id) / createMembership({classId, userId, role, state})
//   updateMembership(id, {state?, rejoinAllowed?, joinedAt?}) / archiveClassMemberships(classId) -> count
//   (active -> archived) / listClassMembers(classId) -> membership rows with username
//   — a membership is { id, classId, userId, role, state, rejoinAllowed, joinedAt, updatedAt }; another
//   user's username leaves the store ONLY through listClassesForUser (the teacher's) and
//   listClassMembers (the roster)  (d-32)
//   createResource({classId, publishedBy, kind, name, snapshot, sourceId}) / listResources(classId,
//   {includeUnpublished?}) (newest first) / getResource(id) / unpublishResource(id) (null once unpublished)
//   — a resource is { id, classId, publishedBy, kind, name, snapshot, sourceId, publishedAt, unpublishedAt, example }  (d-32)
//   createExample({classId, publishedBy, submissionId, attribution, note, name, floorName}) -> a resource whose
//   snapshot is copied from that submission with program (and floor) names replaced; null when the submission is
//   missing; err.code 'EXAMPLE_LIVE' while the submission already has a published example. It is the ONLY writer
//   of a peer example: createResource throws if given example fields, and unpublishResource frees the attempt.
//   example is null for teacher resources, else { submissionId, authorMembershipId, attribution, note } —
//   store-internal; src/store/scoped.js turns it into what a reader may see  (d-37)
//   createAssignment({classId, createdBy, lesson, exercise, instructions, dueAt, allowFloorEdit, requireRun, floorId, starter})
//   getAssignment(id) / listAssignments(classId) (newest first) / updateAssignment(id, {instructions?, dueAt?,
//   closedAt?}) (a present date key replaces the value; null clears it)
//   — an assignment is { id, classId, createdBy, lesson, exercise, instructions, dueAt, allowFloorEdit, requireRun,
//   floorId, starter: { program: {name, code, exerciseRef} | null, floor: {name, data} | null }, closedAt, createdAt,
//   updatedAt }  (d-34; requireRun d-35, fixed at creation like allowFloorEdit)
//   createSubmission({assignmentId, membershipId, sourceProgramId, snapshot, run}) -> the row with the next attempt
//   number for that (assignment, membership); a concurrent insert of the same number rejects with err.code
//   'SUBMISSION_RACE' / listSubmissions(assignmentId, {membershipId?}) (attempt ascending) / getSubmission(id)
//   upsertSubmissionReview(submissionId, {comment?, status?, reviewedBy}) — absent keys keep their value
//   — a submission is { id, assignmentId, membershipId, attempt, sourceProgramId, snapshot, run, createdAt,
//   shared: 'anonymous' | 'name' | null (its published example, d-37), review: { comment, status, reviewedBy, updatedAt } | null }. There is NO update or delete of a submission:
//   attempts are append-only and only the review row changes  (d-35)
//   listAssignmentPrograms(assignmentId) -> program rows linked to it, each with its owner's userId; the ONLY
//   method that returns another user's program rows — src/store/scoped.js filters it and strips userId  (d-34)
//   createSentCopy({membershipId, sourceProgramId, snapshot, message}) / listSentCopies({classId} | {membershipId})
//   (newest first) / getSentCopy(id) / upsertSentCopyReply(id, {comment, repliedBy})
//   — a sent copy is { id, membershipId, classId (its membership's), sourceProgramId, snapshot, message, createdAt,
//   reply: { comment, repliedBy, updatedAt } | null }. There is NO update or delete of a sent copy; only the
//   reply row changes. Sent copies are never submissions  (d-38)
//   listPrograms(profileId) / getProgram(id) / createProgram(profileId, {name,code,floorId,exerciseRef,classId?,assignmentId?})
//   updateProgram(id, patch) / deleteProgram(id)
//   — program rows carry classId and assignmentId (null unless made by Start); a second program linked to the
//   same assignment in one profile rejects with err.code 'ASSIGNMENT_STARTED'; updateProgram never writes them  (d-34)
//   listFloors(profileId) / getFloor(id) / createFloor(profileId, {name,data,classId?,assignmentId?,locked?}) / updateFloor(id, {name?,data?})
//   — floor rows carry classId, assignmentId and locked (d-34); updateFloor never writes them
//   deleteFloor(id)  — also resets programs that used the floor to floor_id 'blank'
//   listRuns(profileId, {programId?, floorId?}) (newest first, WITHOUT data) / getRun(id) (with data)
//   createRun(profileId, {programId, programName, floorId, floorName, status, elapsed, wheelLeft,
//   wheelRight, hasPen, verdict, passed, data}) / deleteRun(id) / pruneRuns(profileId, keep) -> deleted count  (d-13, d-20)
//   listDrawings(profileId) / getDrawing(id) / createDrawing(profileId, {title, runId, programName,
//   floorName, data}) / deleteDrawing(id)  (d-13)
//   listWorkbook(profileId) (lesson, exercise ascending) / upsertWorkbookEntry(profileId, lesson,
//   exercise, {done?, programId?, floorId?}) — absent keys keep their value; deleting a program
//   clears programId, deleting a floor clears floorId  (d-21)
// Routes never hold this raw store: they get src/store/scoped.js (d-29), which wraps every method
// so only the session user's own profiles and rows are reachable.
// Rows are returned as camelCase plain objects with ISO-8601 timestamps. A floor row is the
// geometry document flattened with id, profileId, name, builtin:false, createdAt, updatedAt; a
// drawing row is its {width, height, background, strokes} document flattened the same way.

let store = null;

export function getStore() {
  if (!store) {
    if (process.env.DATABASE_URL) {
      store = createPgStore();
    } else {
      console.warn('[store] DATABASE_URL is not set: using the in-memory store. Data will NOT persist.');
      store = createMemoryStore();
    }
  }
  return store;
}

// Test hook: replace the singleton (used by tests/api.test.js to start from an empty store).
export function resetStoreForTests(next) {
  store = next || null;
}
