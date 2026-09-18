// The ownership seam (itch-12 phase 1, d-29). scopedStore(raw, userId) is the only store handle
// the /api routes ever hold: every method of the raw interface (src/store/index.js) is wrapped so
// a profile-keyed call answers null unless the profile is the user's, and an id-keyed
// get/update/delete answers null (or false) unless the row's profileId is. A foreign row and a
// missing row are indistinguishable, so routes turn null into 404 and existence never leaks.
// Class membership is the second axis (d-32): classRole(classId) gates every class-keyed read,
// loaded on the first such call only, so a non-member sees "no such class".
// Assignments (d-34) add one invariant rather than widening `owned`: a profile-owned row (program,
// floor, run) is readable by someone other than its owner ONLY through a link-keyed method here,
// keyed by (assignment, membership) and gated by the reader's teacher role plus the student's
// membership state (active or archived; removed ends it at once). No id-keyed getter ever answers
// for a foreign row, and nothing but the owner ever writes one — byRow serves get, update and
// delete alike, which is exactly why teachers never enter `owned`.
// Submissions (d-35) are class-record rows, not profile-owned: an attempt is a server-built snapshot
// keyed by (assignment, membership), so reading one by id does not weaken the rule above. The class
// teacher reads them whatever the student's state (removed included: they are the class's record);
// a student reads only their own, and only while their membership is live. Nothing here writes one.
// Sent copies (d-38) are class-record rows like submissions: the class teacher reads every copy of
// the class whatever the sender's state; a student reads only their own, while their membership is
// live. Neither reader gets the source program id or (for the student) a membership id.
// Peer examples (d-37) are class resources copied from an attempt. Every resource read below resolves
// them in one place: a non-teacher sees an example only while its author is an active or archived
// student (so remove, rejoin and archive need no writes here), and sees only { note, byline }, the
// byline being the author's username when the teacher chose attribution by name, else 'A classmate'.
// The teacher also gets the attribution and the author's username and state. No id of the author
// (membership, submission, user, profile, program) ever leaves this module on an example.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stripUser = ({ userId, ...row }) => row;
const visibleStudent = (m) => m.role === 'student' && (m.state === 'active' || m.state === 'archived');
const ANONYMOUS_BYLINE = 'A classmate';
/** A submission as its reader sees it: the source program id stays on the server. */
const stripSource = ({ sourceProgramId, ...row }) => row;

export async function scopedStore(raw, userId) {
  const profiles = await raw.listProfiles(userId);
  const owned = new Set(profiles.map((p) => p.id));
  const mine = (profileId) => owned.has(String(profileId));

  let membershipsPromise = null;
  const memberships = () => (membershipsPromise ??= raw.listClassesForUser(userId));
  const invalidateMemberships = () => {
    membershipsPromise = null;
  };
  const live = (m) => m.state !== 'removed' && m.state !== 'invited';
  /** { role, state, membership } of the caller's live membership in the class, else null. */
  async function classRole(classId) {
    const row = (await memberships()).find((x) => x.class.id === String(classId));
    if (!row || !live(row.membership)) return null;
    return { role: row.membership.role, state: row.membership.state, membership: row.membership };
  }
  /** The join code is the teacher's to see. */
  const withCode = (cls, role) => {
    if (role && role.role === 'teacher') return cls;
    const { joinCode, ...rest } = cls;
    return rest;
  };

  /** A method keyed by profileId: passes through for an owned profile, null otherwise. */
  const byProfile =
    (method) =>
    async (profileId, ...rest) =>
      mine(profileId) ? raw[method](profileId, ...rest) : null;

  /** A method keyed by row id: fetches the row first and passes through only when it is owned. */
  const byRow =
    (getter, method, miss = null) =>
    async (id, ...rest) => {
      const row = await raw[getter](id);
      if (!row || !mine(row.profileId)) return miss;
      return method === getter ? row : raw[method](id, ...rest);
    };

  return {
    kind: raw.kind,
    userId,
    ping: () => raw.ping(),

    listProfiles: () => raw.listProfiles(userId),
    getProfile: async (id) => (mine(id) ? raw.getProfile(id) : null),
    createProfile: async (fields) => {
      const profile = await raw.createProfile({ ...fields, userId });
      owned.add(profile.id);
      return profile;
    },
    updateProfile: async (id, patch) => (mine(id) ? raw.updateProfile(id, patch) : null),
    // false for a foreign or missing profile alike, as the other deletes answer (d-40). `owned`
    // drops the id so a later call in the same request sees it gone.
    deleteProfile: async (id) => {
      if (!mine(id)) return false;
      const ok = await raw.deleteProfile(id);
      if (ok) owned.delete(String(id));
      return ok;
    },

    listPrograms: byProfile('listPrograms'),
    createProgram: byProfile('createProgram'),
    getProgram: byRow('getProgram', 'getProgram'),
    updateProgram: byRow('getProgram', 'updateProgram'),
    deleteProgram: byRow('getProgram', 'deleteProgram', false),

    listFloors: byProfile('listFloors'),
    createFloor: byProfile('createFloor'),
    getFloor: byRow('getFloor', 'getFloor'),
    updateFloor: byRow('getFloor', 'updateFloor'),
    deleteFloor: byRow('getFloor', 'deleteFloor', false),

    listRuns: byProfile('listRuns'),
    createRun: byProfile('createRun'),
    pruneRuns: byProfile('pruneRuns'),
    getRun: byRow('getRun', 'getRun'),
    deleteRun: byRow('getRun', 'deleteRun', false),

    listDrawings: byProfile('listDrawings'),
    createDrawing: byProfile('createDrawing'),
    getDrawing: byRow('getDrawing', 'getDrawing'),
    deleteDrawing: byRow('getDrawing', 'deleteDrawing', false),

    listWorkbook: byProfile('listWorkbook'),
    upsertWorkbookEntry: byProfile('upsertWorkbookEntry'),

    // ---- classes (d-32): every read gated by classRole; writes live in src/classes.js ----
    classRole,
    invalidateMemberships,
    listClasses: async () =>
      (await memberships())
        .filter((x) => live(x.membership))
        .map((x) => ({ ...withCode(x.class, x.membership), membership: x.membership, teacherUsername: x.teacherUsername })),
    getClass: async (id) => {
      const role = await classRole(id);
      if (!role) return null;
      const cls = await raw.getClass(String(id));
      return cls ? withCode(cls, role) : null;
    },
    listRoster: async (classId) => {
      const role = await classRole(classId);
      if (!role || role.role !== 'teacher') return null;
      return raw.listClassMembers(String(classId));
    },
    listResources: async (classId) => {
      const role = await classRole(classId);
      if (!role) return null;
      const rows = await raw.listResources(String(classId), { includeUnpublished: role.role === 'teacher' });
      return resolveExamples(String(classId), rows, role);
    },
    getResource: async (id) => {
      const resource = await raw.getResource(String(id));
      if (!resource) return null;
      const role = await classRole(resource.classId);
      if (!role) return null;
      if (resource.unpublishedAt && role.role !== 'teacher') return null;
      const [shown] = await resolveExamples(resource.classId, [resource], role);
      return shown || null;
    },

    // ---- assignments (d-34): members read them; drafts only through the link-keyed reads below ----
    listAssignments: async (classId) => ((await classRole(classId)) ? raw.listAssignments(String(classId)) : null),
    getAssignment: async (id) => {
      const a = await raw.getAssignment(String(id));
      return a && (await classRole(a.classId)) ? a : null;
    },
    /** The caller's own programs linked to the assignment (any of their profiles). */
    myLinkedPrograms: async (assignmentId) =>
      (await raw.listAssignmentPrograms(String(assignmentId))).filter((p) => mine(p.profileId)).map(stripUser),
    /** Teacher only: every live student of the class with the ids and times of their linked programs. */
    /**
     * Teacher only: every live student of the class with the ids and times of their linked programs
     * and their submission attempts (d-35). A removed student appears only when they turned something
     * in, and then with no programs: their drafts are closed to the teacher, their submissions are not.
     */
    assignmentProgress: async (assignmentId) => {
      const a = await teacherAssignment(assignmentId);
      if (!a) return null;
      const linked = await raw.listAssignmentPrograms(a.id);
      const subs = await raw.listSubmissions(a.id);
      return (await raw.listClassMembers(a.classId))
        .filter((m) => visibleStudent(m) || (m.role === 'student' && subs.some((s) => s.membershipId === m.id)))
        .map((m) => ({
          membershipId: m.id,
          username: m.username,
          state: m.state,
          programs: visibleStudent(m)
            ? linked.filter((p) => p.userId === m.userId).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt }))
            : [],
          submissions: subs
            .filter((s) => s.membershipId === m.id)
            .map((s) => ({ id: s.id, attempt: s.attempt, createdAt: s.createdAt, reviewStatus: s.review ? s.review.status : null })),
        }));
    },
    /**
     * Teacher only: one student's linked programs, each with the floor it runs on when that floor is
     * the assignment's own copy in the same profile (a personal floor stays private: null), and the
     * newest run's summary (no data, so console, trace and ink never leave the profile).
     */
    linkedDrafts: async (assignmentId, membershipId) => {
      const a = await teacherAssignment(assignmentId);
      if (!a) return null;
      const m = await raw.getMembership(String(membershipId));
      if (!m || m.classId !== a.classId || !visibleStudent(m)) return null;
      const out = [];
      for (const p of (await raw.listAssignmentPrograms(a.id)).filter((x) => x.userId === m.userId)) {
        const f = UUID_RE.test(String(p.floorId)) ? await raw.getFloor(p.floorId) : null;
        const floor = f && f.assignmentId === a.id && f.profileId === p.profileId ? f : null;
        const runs = await raw.listRuns(p.profileId, { programId: p.id });
        out.push({ program: stripUser(p), floor, latestRun: runs[0] || null });
      }
      return out;
    },

    // ---- sent copies (d-38): read-only here; src/sentcopies.js writes them ----
    /** Teacher only: every copy sent in the class, newest first, each with its sender's username and state. */
    classSentCopies: async (classId) => {
      const role = await classRole(classId);
      if (!role || role.role !== 'teacher') return null;
      const members = new Map((await raw.listClassMembers(String(classId))).map((m) => [m.id, m]));
      return (await raw.listSentCopies({ classId: String(classId) })).map(({ sourceProgramId, membershipId, ...c }) => {
        const m = members.get(membershipId);
        return { ...c, author: m ? { username: m.username, state: m.state } : null };
      });
    },
    /** Student only: the caller's own copies sent in this class, while their membership is live. */
    mySentCopies: async (classId) => {
      const role = await classRole(classId);
      if (!role || role.role !== 'student') return null;
      return (await raw.listSentCopies({ membershipId: role.membership.id })).map(({ sourceProgramId, membershipId, ...c }) => c);
    },
    /** One copy for its class teacher (asTeacher) or its live sender; null otherwise. membershipId stays for the rules module. */
    sentCopyFor: async (id) => {
      const c = await raw.getSentCopy(String(id));
      if (!c) return null;
      const role = await classRole(c.classId);
      if (!role) return null;
      if (role.role === 'teacher') return { copy: stripSource(c), asTeacher: true };
      if (role.membership.id === c.membershipId) return { copy: stripSource(c), asTeacher: false };
      return null;
    },

    // ---- submissions (d-35): read-only here; src/submissions.js writes them ----
    /** Student only: the caller's own attempts at the assignment (every profile), while their membership is live. */
    mySubmissions: async (assignmentId) => {
      const a = await raw.getAssignment(String(assignmentId));
      if (!a) return null;
      const role = await classRole(a.classId);
      if (!role || role.role !== 'student') return null;
      return (await raw.listSubmissions(a.id, { membershipId: role.membership.id })).map(stripSource);
    },
    /** Teacher only: one student's attempts, in any membership state of that student. */
    studentSubmissions: async (assignmentId, membershipId) => {
      const a = await teacherAssignment(assignmentId);
      if (!a) return null;
      const m = await raw.getMembership(String(membershipId));
      if (!m || m.classId !== a.classId || m.role !== 'student') return null;
      return (await raw.listSubmissions(a.id, { membershipId: m.id })).map(stripSource);
    },
    /**
     * One attempt with its assignment, for the class teacher (asTeacher) or the student who turned it
     * in while their membership is live; null for anyone else. Neither reader gets the source program id.
     */
    submissionFor: async (id) => {
      const s = await raw.getSubmission(String(id));
      if (!s) return null;
      const a = await raw.getAssignment(s.assignmentId);
      if (!a) return null;
      const role = await classRole(a.classId);
      if (!role) return null;
      if (role.role === 'teacher') return { submission: stripSource(s), assignment: a, asTeacher: true };
      if (role.membership.id === s.membershipId) return { submission: stripSource(s), assignment: a, asTeacher: false };
      return null;
    },
  };

  /**
   * Peer examples as the caller may see them (d-37): hidden from non-teachers unless the author is a
   * visible student; the store-internal provenance replaced by the byline (and, for the teacher, the author).
   */
  async function resolveExamples(classId, rows, role) {
    if (!rows.some((r) => r.example)) return rows;
    const members = new Map((await raw.listClassMembers(classId)).map((m) => [m.id, m]));
    const teacher = role.role === 'teacher';
    const out = [];
    for (const r of rows) {
      if (!r.example) {
        out.push(r);
        continue;
      }
      const author = members.get(r.example.authorMembershipId);
      const visible = !!author && visibleStudent(author);
      if (!teacher && !visible) continue;
      const example = { note: r.example.note, byline: r.example.attribution === 'name' && author ? author.username : ANONYMOUS_BYLINE };
      if (teacher) {
        example.attribution = r.example.attribution;
        example.author = author ? { username: author.username, state: author.state } : null;
        example.hidden = !visible;
      }
      out.push({ ...r, example });
    }
    return out;
  }

  /** The assignment, when the caller teaches its class (archived included); else null. */
  async function teacherAssignment(assignmentId) {
    const a = await raw.getAssignment(String(assignmentId));
    if (!a) return null;
    const role = await classRole(a.classId);
    return role && role.role === 'teacher' ? a : null;
  }
}
