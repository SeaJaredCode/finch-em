// Client for the /api JSON routes (d-6, floors d-8, runs and drawings d-13, workbook d-21,
// sessions d-29). The browser's session cookie rides along on every same-origin fetch.

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error('Cannot reach the server (' + err.message + ')');
  }
  if (response.status === 204) return null;
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (response.status === 401) throw new Error('Your session has ended. Reload the page to start again.');
  if (!response.ok) {
    throw new Error((data && data.error) || `${method} ${path} failed (${response.status})`);
  }
  return data;
}

export const api = {
  // session (d-29): resume this browser's session or start one (claiming the remembered
  // pre-session profile if it is still free, else seeding a 'Student' workspace)
  // -> { profiles: this user's profiles, account: { username | null } }
  startSession: (rememberedProfileId) => request('POST', '/api/session', { rememberedProfileId }),
  // accounts (d-31): each answers the same { profiles, account } view; split adds the moved profile
  register: (body) => request('POST', '/api/account/register', body),
  signIn: (body) => request('POST', '/api/account/signin', body),
  signOut: () => request('POST', '/api/account/signout', {}),
  split: (body) => request('POST', '/api/account/split', body),
  listLegacy: () => request('GET', '/api/account/legacy').then((d) => d.profiles),
  claimLegacy: (id) => request('POST', `/api/account/legacy/${id}/claim`, {}).then((d) => d.profile),
  // classes (d-32): a class is { id, name, archivedAt, createdAt, joinCode?, joinUrl?, membership, teacher };
  // a resource is { id, classId, kind, name, floorName, exerciseRef, publishedAt, unpublishedAt }
  listClasses: () => request('GET', '/api/classes').then((d) => d.classes),
  createClass: (body) => request('POST', '/api/classes', body),
  joinClass: (code) => request('POST', '/api/classes/join', { code }),
  getClass: (id) => request('GET', `/api/classes/${id}`).then((d) => d.class),
  classRoster: (id) => request('GET', `/api/classes/${id}/roster`).then((d) => d.roster),
  archiveClass: (id) => request('POST', `/api/classes/${id}/archive`, {}),
  rotateClassCode: (id) => request('POST', `/api/classes/${id}/code`, {}),
  removeMember: (classId, membershipId, allowRejoin) => request('POST', `/api/classes/${classId}/members/${membershipId}/remove`, { allowRejoin }),
  resetMemberPassword: (classId, membershipId, password) => request('POST', `/api/classes/${classId}/members/${membershipId}/password`, { password }),
  listClassResources: (id) => request('GET', `/api/classes/${id}/resources`).then((d) => d.resources),
  publishResource: (classId, body) => request('POST', `/api/classes/${classId}/resources`, body).then((d) => d.resource),
  unpublishResource: (id) => request('POST', `/api/class-resources/${id}/unpublish`, {}).then((d) => d.resource),
  // -> { program | null, floor | null, entries }, like hand-off
  copyResource: (id, profileId) => request('POST', `/api/class-resources/${id}/copy`, { profileId }),
  // -> { resource, program | null, floor | null } to run read-only (d-34)
  resourceSnapshot: (id) => request('GET', `/api/class-resources/${id}/snapshot`),
  // assignments (d-34): an assignment is { id, classId, lesson, exercise, exerciseRef, title, lessonName,
  // instructions, dueAt, allowFloorEdit, floorId, starterName, floorName, closedAt, ... }; the detail adds
  // starter: { program | null, floor | null } for read-only running
  listAssignments: (classId) => request('GET', `/api/classes/${classId}/assignments`).then((d) => d.assignments),
  createAssignment: (classId, body) => request('POST', `/api/classes/${classId}/assignments`, body).then((d) => d.assignment),
  getAssignment: (id) => request('GET', `/api/assignments/${id}`).then((d) => d.assignment),
  editAssignment: (id, patch) => request('PATCH', `/api/assignments/${id}`, patch).then((d) => d.assignment),
  closeAssignment: (id) => request('POST', `/api/assignments/${id}/close`, {}).then((d) => d.assignment),
  reopenAssignment: (id) => request('POST', `/api/assignments/${id}/reopen`, {}).then((d) => d.assignment),
  // -> { program, floor | null, created }
  startAssignment: (id, profileId) => request('POST', `/api/assignments/${id}/start`, { profileId }),
  // -> { assignment, students: [{ membershipId, username, state, status, lastEditAt, programs }] }
  assignmentProgress: (id) => request('GET', `/api/assignments/${id}/progress`),
  // -> [{ program, floor | null, latestRun | null }]
  assignmentDrafts: (id, membershipId) => request('GET', `/api/assignments/${id}/drafts/${membershipId}`).then((d) => d.drafts),
  // submissions (d-35): an attempt is { id, assignmentId, attempt, submittedAt, status, program, floor | null,
  // run | null, review: { comment, status, updatedAt } | null } (+ membershipId for the teacher); append-only
  turnIn: (assignmentId, programId) => request('POST', `/api/assignments/${assignmentId}/submissions`, { programId }).then((d) => d.submission),
  mySubmissions: (assignmentId) => request('GET', `/api/assignments/${assignmentId}/submissions/mine`).then((d) => d.submissions),
  studentSubmissions: (assignmentId, membershipId) => request('GET', `/api/assignments/${assignmentId}/submissions/${membershipId}`).then((d) => d.submissions),
  // patch: { comment?, status?: 'returned' | 'reviewed' | null }
  reviewSubmission: (id, patch) => request('PUT', `/api/submissions/${id}/review`, patch).then((d) => d.submission),
  // -> { program, floor | null, entries }, like hand-off
  // sent copies (d-38): a copy is { id, classId, sentAt, message, program, floor | null, reply: { comment, updatedAt } | null }
  // (+ author { username, state } for the teacher); append-only
  sendCopy: (classId, programId, message) => request('POST', `/api/classes/${classId}/sent-copies`, { programId, message }).then((d) => d.copy),
  classSentCopies: (classId) => request('GET', `/api/classes/${classId}/sent-copies`).then((d) => d.copies),
  mySentCopies: (classId) => request('GET', `/api/classes/${classId}/sent-copies/mine`).then((d) => d.copies),
  replySentCopy: (id, comment) => request('PUT', `/api/sent-copies/${id}/reply`, { comment }).then((d) => d.copy),
  // -> { program, floor | null, entries }, like hand-off
  duplicateSentCopy: (id, profileId) => request('POST', `/api/sent-copies/${id}/duplicate`, { profileId }),
  // peer examples (d-37): body { attribution: 'anonymous' | 'name', note?, title? } -> the class resource, whose
  // example is { byline, note } (+ attribution, author, hidden for the teacher)
  publishSubmission: (id, body) => request('POST', `/api/submissions/${id}/publish`, body).then((d) => d.resource),
  duplicateSubmission: (id, profileId) => request('POST', `/api/submissions/${id}/duplicate`, { profileId }),
  listProfiles: () => request('GET', '/api/profiles').then((d) => d.profiles),
  createProfile: (body) => request('POST', '/api/profiles', body).then((d) => d.profile),
  updateProfile: (id, patch) => request('PATCH', `/api/profiles/${id}`, patch).then((d) => d.profile),
  // -> null (204). Takes the profile's programs, floors, runs, drawings and workbook rows with it;
  // class records stay (d-40). The caller's last profile is refused (409).
  deleteProfile: (id) => request('DELETE', `/api/profiles/${id}`),
  listPrograms: (profileId) => request('GET', `/api/profiles/${profileId}/programs`).then((d) => d.programs),
  createProgram: (profileId, body) => request('POST', `/api/profiles/${profileId}/programs`, body).then((d) => d.program),
  getProgram: (id) => request('GET', `/api/programs/${id}`).then((d) => d.program),
  updateProgram: (id, patch) => request('PUT', `/api/programs/${id}`, patch).then((d) => d.program),
  deleteProgram: (id) => request('DELETE', `/api/programs/${id}`),
  // hand-off (Milestone 6, d-25): a copy of the program, its custom floor and its workbook attachments
  // in another profile -> { program, floor | null, entries }
  handoffProgram: (id, profileId) => request('POST', `/api/programs/${id}/handoff`, { profileId }),
  template: () => request('GET', '/api/template').then((d) => d.template),
  // floors (Milestone 2): a floor body is { name, description, width, height, background, start,
  // tape, walls, lights, darkAreas, slopes }; the response row adds id, profileId, builtin:false,
  // createdAt, updatedAt.
  listFloors: (profileId) => request('GET', `/api/profiles/${profileId}/floors`).then((d) => d.floors),
  createFloor: (profileId, body) => request('POST', `/api/profiles/${profileId}/floors`, body).then((d) => d.floor),
  getFloor: (id) => request('GET', `/api/floors/${id}`).then((d) => d.floor),
  updateFloor: (id, patch) => request('PUT', `/api/floors/${id}`, patch).then((d) => d.floor),
  deleteFloor: (id) => request('DELETE', `/api/floors/${id}`),
  // runs (Milestone 3): the list is newest first and omits `data`; getRun/createRun return the
  // whole document { code, speed, floor, trail, trace, console, ink, error } for replay.
  listRuns: (profileId, filters = {}) => {
    const qs = new URLSearchParams();
    if (filters.programId) qs.set('programId', filters.programId);
    if (filters.floorId) qs.set('floorId', filters.floorId);
    const s = qs.toString();
    return request('GET', `/api/profiles/${profileId}/runs${s ? '?' + s : ''}`).then((d) => d.runs);
  },
  createRun: (profileId, body) => request('POST', `/api/profiles/${profileId}/runs`, body).then((d) => d.run),
  getRun: (id) => request('GET', `/api/runs/${id}`).then((d) => d.run),
  deleteRun: (id) => request('DELETE', `/api/runs/${id}`),
  pruneRuns: (profileId, keep = 50) => request('POST', `/api/profiles/${profileId}/runs/prune`, { keep }).then((d) => d.deleted),
  // drawings (Milestone 3): { title, runId?, programName, floorName, width, height, background, strokes }
  listDrawings: (profileId) => request('GET', `/api/profiles/${profileId}/drawings`).then((d) => d.drawings),
  createDrawing: (profileId, body) => request('POST', `/api/profiles/${profileId}/drawings`, body).then((d) => d.drawing),
  getDrawing: (id) => request('GET', `/api/drawings/${id}`).then((d) => d.drawing),
  deleteDrawing: (id) => request('DELETE', `/api/drawings/${id}`),
  // workbook (Milestone 4): entries are { id, profileId, lesson, exercise, done, programId, floorId,
  // updatedAt }; the patch may carry done, programId (null detaches) and floorId (null clears).
  listWorkbook: (profileId) => request('GET', `/api/profiles/${profileId}/workbook`).then((d) => d.entries),
  updateWorkbookEntry: (profileId, lesson, exercise, patch) =>
    request('PUT', `/api/profiles/${profileId}/workbook/${lesson}/${exercise}`, patch).then((d) => d.entry),
};
