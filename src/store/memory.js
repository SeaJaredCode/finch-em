import { randomUUID } from 'node:crypto';

// In-memory store with the same interface as the pg store. Only used when DATABASE_URL is unset
// (Vitest in the sandbox, local development). Never intended for the deployed app.
export function createMemoryStore() {
  const users = new Map(); // id -> { id, username, usernameKey, passwordHash, registeredAt, createdAt } (d-29, d-31)
  const sessions = new Map(); // tokenHash -> { tokenHash, userId, homeUserId, createdAt, lastSeenAt, expiresAt } (d-29, d-31)
  const profiles = new Map(); // id -> { id, userId (null = unclaimed pre-session row), name, color, prefs, createdAt }
  const classes = new Map(); // id -> { id, name, createdBy, joinCode, archivedAt, createdAt, updatedAt } (d-32)
  const memberships = new Map(); // id -> { id, classId, userId, role, state, rejoinAllowed, joinedAt, updatedAt } (d-32)
  const resources = new Map(); // id -> { id, classId, publishedBy, kind, name, snapshot, sourceId, publishedAt, unpublishedAt } (d-32)
  const assignments = new Map(); // id -> { id, classId, createdBy, lesson, exercise, instructions, dueAt, allowFloorEdit, floorId, starter, closedAt, createdAt, updatedAt } (d-34)
  const submissions = new Map(); // id -> { id, assignmentId, membershipId, attempt, sourceProgramId, snapshot, run, createdAt } (d-35, append-only)
  const reviews = new Map(); // submissionId -> { comment, status, reviewedBy, updatedAt } (d-35)
  const sentCopies = new Map(); // id -> { id, membershipId, sourceProgramId, snapshot, message, createdAt } (d-38, insert-only)
  const sentCopyReplies = new Map(); // sentCopyId -> { comment, repliedBy, updatedAt } (d-38)
  const programs = new Map(); // id -> { ..., classId, assignmentId } (assignment link, d-34)
  const floors = new Map(); // id -> { id, profileId, name, data, createdAt, updatedAt }
  const runs = new Map(); // id -> { id, profileId, programId, programName, floorId, ..., data, createdAt } (d-13)
  const drawings = new Map(); // id -> { id, profileId, runId, title, programName, floorName, data, createdAt }
  const workbook = new Map(); // `${profileId}:${lesson}:${exercise}` -> { id, profileId, lesson, exercise, done, programId, floorId, updatedAt } (d-21)
  const now = () => new Date().toISOString();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  // One program's removal, with the SET NULL and cascade the schema declares. It lives here in one
  // place so deleting a single program and deleting a whole profile (d-40) cannot drift apart.
  const removeProgram = (id) => {
    const ok = programs.delete(id);
    if (ok) {
      for (const s of submissions.values()) if (s.sourceProgramId === id) s.sourceProgramId = null; // SET NULL (d-35)
      for (const c of sentCopies.values()) if (c.sourceProgramId === id) c.sourceProgramId = null; // SET NULL (d-38)
      for (const r of [...runs.values()]) if (r.programId === id) runs.delete(r.id); // cascade (d-13)
      for (const w of workbook.values()) if (w.programId === id) w.programId = null; // SET NULL (d-21)
    }
    return ok;
  };
  // A user row never carries the password hash (d-31).
  const userRow = (u) => ({ id: u.id, username: u.username ?? null, registeredAt: u.registeredAt ?? null, createdAt: u.createdAt });
  const usernameTaken = (usernameKey) => {
    if (usernameKey && [...users.values()].some((u) => u.usernameKey === usernameKey)) {
      const err = new Error('username taken');
      err.code = 'USERNAME_TAKEN';
      throw err;
    }
  };
  const joinCodeTaken = (joinCode) => {
    if ([...classes.values()].some((c) => c.joinCode === joinCode)) {
      const err = new Error('join code taken');
      err.code = 'JOIN_CODE_TAKEN';
      throw err;
    }
  };
  // The earliest teacher membership of a class names the teacher students see (d-32).
  const teacherUsername = (classId) => {
    const t = [...memberships.values()]
      .filter((m) => m.classId === classId && m.role === 'teacher')
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
    return t ? (users.get(t.userId) || {}).username ?? null : null;
  };
  const floorRow = (f) => ({
    id: f.id,
    profileId: f.profileId,
    name: f.name,
    ...clone(f.data),
    builtin: false,
    classId: f.classId ?? null,
    assignmentId: f.assignmentId ?? null,
    locked: !!f.locked,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  });
  const runSummary = ({ data, ...rest }) => clone(rest); // the list omits the heavy document
  const drawingRow = (d) => ({
    id: d.id,
    profileId: d.profileId,
    runId: d.runId,
    title: d.title,
    programName: d.programName,
    floorName: d.floorName,
    ...clone(d.data),
    createdAt: d.createdAt,
  });
  const sentCopyRow = (c) => ({
    ...clone(c),
    classId: (memberships.get(c.membershipId) || {}).classId ?? null,
    reply: sentCopyReplies.has(c.id) ? clone(sentCopyReplies.get(c.id)) : null,
  });
  const liveExampleOf = (submissionId) => [...resources.values()].find((r) => r.liveSubmissionId === submissionId) || null;
  const submissionRow = (s) => {
    const live = liveExampleOf(s.id);
    return { ...clone(s), shared: live ? live.attribution : null, review: reviews.has(s.id) ? clone(reviews.get(s.id)) : null };
  };
  // A resource; a peer example (d-37) carries its provenance, the author read through the attempt.
  const resourceRow = ({ submissionId, liveSubmissionId, attribution, note, ...r }) => ({
    ...clone(r),
    example: submissionId
      ? { submissionId, authorMembershipId: (submissions.get(submissionId) || {}).membershipId ?? null, attribution, note: note || '' }
      : null,
  });
  // Newest first; rows created in the same millisecond keep reverse insertion order.
  const newestFirst = (rows) => rows.reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    kind: 'memory',
    async ping() {
      return true;
    },
    // ---- users and sessions (d-29, credentials d-31) ----
    async createUser({ username, usernameKey, passwordHash } = {}) {
      usernameTaken(usernameKey);
      const t = now();
      const row = {
        id: randomUUID(),
        username: username || null,
        usernameKey: usernameKey || null,
        passwordHash: passwordHash || null,
        registeredAt: usernameKey ? t : null,
        createdAt: t,
      };
      users.set(row.id, row);
      return userRow(row);
    },
    async getUser(id) {
      const u = users.get(id);
      return u ? userRow(u) : null;
    },
    async findCredential(usernameKey) {
      const u = [...users.values()].find((x) => x.usernameKey === usernameKey);
      return u ? { userId: u.id, passwordHash: u.passwordHash } : null;
    },
    async setCredential(id, { username, usernameKey, passwordHash }) {
      const u = users.get(id);
      if (!u || u.usernameKey) return null;
      usernameTaken(usernameKey);
      Object.assign(u, { username, usernameKey, passwordHash, registeredAt: now() });
      return userRow(u);
    },
    async createSession({ tokenHash, userId, homeUserId, expiresAt }) {
      const t = now();
      const s = { tokenHash, userId, homeUserId: homeUserId || null, createdAt: t, lastSeenAt: t, expiresAt };
      sessions.set(tokenHash, s);
      return clone(s);
    },
    async deleteSession(tokenHash) {
      return sessions.delete(tokenHash);
    },
    async getSession(tokenHash) {
      const s = sessions.get(tokenHash);
      return s ? clone(s) : null;
    },
    async touchSession(tokenHash, expiresAt) {
      const s = sessions.get(tokenHash);
      if (!s) return null;
      s.lastSeenAt = now();
      s.expiresAt = expiresAt;
      return clone(s);
    },

    async setPassword(userId, passwordHash) {
      const u = users.get(userId);
      if (!u || !u.usernameKey) return null;
      u.passwordHash = passwordHash;
      return userRow(u);
    },
    async revokeUserSessions(userId) {
      let n = 0;
      for (const s of [...sessions.values()]) {
        if (s.userId !== userId) continue;
        if (s.homeUserId) {
          s.userId = s.homeUserId;
          s.homeUserId = null;
        } else sessions.delete(s.tokenHash);
        n++;
      }
      return n;
    },

    // ---- classes, memberships and resources (d-32) ----
    async createClass({ name, createdBy, joinCode }) {
      joinCodeTaken(joinCode);
      const t = now();
      const c = { id: randomUUID(), name, createdBy, joinCode, archivedAt: null, createdAt: t, updatedAt: t };
      classes.set(c.id, c);
      return clone(c);
    },
    async getClass(id) {
      const c = classes.get(id);
      return c ? clone(c) : null;
    },
    async findClassByJoinCode(code) {
      const c = [...classes.values()].find((x) => x.joinCode === code);
      return c ? clone(c) : null;
    },
    async updateClass(id, patch) {
      const c = classes.get(id);
      if (!c) return null;
      if (patch.joinCode !== undefined && patch.joinCode !== null) {
        if (patch.joinCode !== c.joinCode) joinCodeTaken(patch.joinCode);
        c.joinCode = patch.joinCode;
      }
      if (patch.archivedAt !== undefined) c.archivedAt = patch.archivedAt;
      c.updatedAt = now();
      return clone(c);
    },
    async listClassesForUser(userId) {
      return [...memberships.values()]
        .filter((m) => m.userId === userId)
        .map((m) => ({ m, c: classes.get(m.classId) }))
        .filter(({ c }) => c)
        .sort((a, b) => a.c.createdAt.localeCompare(b.c.createdAt))
        .map(({ m, c }) => ({ class: clone(c), membership: clone(m), teacherUsername: teacherUsername(c.id) }));
    },
    async findMembership(classId, userId) {
      const m = [...memberships.values()].find((x) => x.classId === classId && x.userId === userId);
      return m ? clone(m) : null;
    },
    async getMembership(id) {
      const m = memberships.get(id);
      return m ? clone(m) : null;
    },
    async createMembership({ classId, userId, role, state }) {
      const t = now();
      const m = { id: randomUUID(), classId, userId, role, state, rejoinAllowed: false, joinedAt: t, updatedAt: t };
      memberships.set(m.id, m);
      return clone(m);
    },
    async updateMembership(id, patch) {
      const m = memberships.get(id);
      if (!m) return null;
      if (patch.state != null) m.state = patch.state;
      if (patch.rejoinAllowed != null) m.rejoinAllowed = !!patch.rejoinAllowed;
      if (patch.joinedAt != null) m.joinedAt = patch.joinedAt;
      m.updatedAt = now();
      return clone(m);
    },
    async archiveClassMemberships(classId) {
      let n = 0;
      for (const m of memberships.values()) {
        if (m.classId === classId && m.state === 'active') {
          m.state = 'archived';
          m.updatedAt = now();
          n++;
        }
      }
      return n;
    },
    async listClassMembers(classId) {
      return [...memberships.values()]
        .filter((m) => m.classId === classId)
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
        .map((m) => ({ ...clone(m), username: (users.get(m.userId) || {}).username ?? null }));
    },
    async createResource(fields) {
      if (['submissionId', 'liveSubmissionId', 'attribution', 'note'].some((k) => fields[k] !== undefined)) {
        throw new Error('peer examples are created by createExample only');
      }
      const { classId, publishedBy, kind, name, snapshot, sourceId } = fields;
      const r = { id: randomUUID(), classId, publishedBy, kind, name, snapshot: clone(snapshot || {}), sourceId: sourceId || null, publishedAt: now(), unpublishedAt: null };
      resources.set(r.id, r);
      return resourceRow(r);
    },
    async listResources(classId, { includeUnpublished = false } = {}) {
      return [...resources.values()]
        .filter((r) => r.classId === classId && (includeUnpublished || !r.unpublishedAt))
        .reverse()
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .map(resourceRow);
    },
    async getResource(id) {
      const r = resources.get(id);
      return r ? resourceRow(r) : null;
    },
    async unpublishResource(id) {
      const r = resources.get(id);
      if (!r || r.unpublishedAt) return null;
      r.unpublishedAt = now();
      r.liveSubmissionId = null; // d-37: the attempt may be published again
      return resourceRow(r);
    },
    async createExample({ classId, publishedBy, submissionId, attribution, note, name, floorName }) {
      const s = submissions.get(submissionId);
      if (!s) return null;
      if (liveExampleOf(submissionId)) {
        const err = new Error('example live');
        err.code = 'EXAMPLE_LIVE'; // UNIQUE (live_submission_id)
        throw err;
      }
      const snapshot = clone(s.snapshot || {});
      if (snapshot.program) snapshot.program.name = name;
      if (snapshot.floor && typeof snapshot.floor === 'object') snapshot.floor.name = floorName || name;
      const r = {
        id: randomUUID(),
        classId,
        publishedBy,
        kind: 'program',
        name,
        snapshot,
        sourceId: null,
        publishedAt: now(),
        unpublishedAt: null,
        submissionId,
        liveSubmissionId: submissionId,
        attribution,
        note: note || '',
      };
      resources.set(r.id, r);
      return resourceRow(r);
    },

    // ---- assignments (d-34) ----
    async createAssignment({ classId, createdBy, lesson, exercise, instructions, dueAt, allowFloorEdit, requireRun, floorId, starter }) {
      const t = now();
      const a = {
        id: randomUUID(),
        classId,
        createdBy,
        lesson,
        exercise,
        instructions: instructions || '',
        dueAt: dueAt || null,
        allowFloorEdit: !!allowFloorEdit,
        requireRun: !!requireRun,
        floorId: floorId || 'blank',
        starter: clone(starter || {}),
        closedAt: null,
        createdAt: t,
        updatedAt: t,
      };
      assignments.set(a.id, a);
      return clone(a);
    },
    async getAssignment(id) {
      const a = assignments.get(id);
      return a ? clone(a) : null;
    },
    async listAssignments(classId) {
      return newestFirst([...assignments.values()].filter((a) => a.classId === classId)).map(clone);
    },
    async updateAssignment(id, patch) {
      const a = assignments.get(id);
      if (!a) return null;
      if (patch.instructions !== undefined && patch.instructions !== null) a.instructions = patch.instructions;
      if (patch.dueAt !== undefined) a.dueAt = patch.dueAt;
      if (patch.closedAt !== undefined) a.closedAt = patch.closedAt;
      a.updatedAt = now();
      return clone(a);
    },
    async listAssignmentPrograms(assignmentId) {
      return [...programs.values()]
        .filter((p) => p.assignmentId === assignmentId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((p) => ({ ...clone(p), userId: (profiles.get(p.profileId) || {}).userId ?? null }));
    },

    // ---- sent copies (d-38): insert-only; only the reply is ever written again ----
    async createSentCopy({ membershipId, sourceProgramId, snapshot, message }) {
      const c = { id: randomUUID(), membershipId, sourceProgramId: sourceProgramId || null, snapshot: clone(snapshot || {}), message: message || '', createdAt: now() };
      sentCopies.set(c.id, c);
      return sentCopyRow(c);
    },
    async listSentCopies({ classId, membershipId } = {}) {
      return newestFirst(
        [...sentCopies.values()].filter((c) =>
          membershipId ? c.membershipId === membershipId : (memberships.get(c.membershipId) || {}).classId === classId,
        ),
      ).map(sentCopyRow);
    },
    async getSentCopy(id) {
      const c = sentCopies.get(id);
      return c ? sentCopyRow(c) : null;
    },
    async upsertSentCopyReply(sentCopyId, { comment, repliedBy }) {
      const c = sentCopies.get(sentCopyId);
      if (!c) return null;
      sentCopyReplies.set(sentCopyId, { comment: comment || '', repliedBy: repliedBy || null, updatedAt: now() });
      return sentCopyRow(c);
    },

    // ---- submissions (d-35): insert-only attempts; only the review is ever written again ----
    async createSubmission({ assignmentId, membershipId, sourceProgramId, snapshot, run }) {
      const mine = [...submissions.values()].filter((s) => s.assignmentId === assignmentId && s.membershipId === membershipId);
      const s = {
        id: randomUUID(),
        assignmentId,
        membershipId,
        attempt: mine.reduce((max, x) => Math.max(max, x.attempt), 0) + 1, // UNIQUE (assignment_id, membership_id, attempt)
        sourceProgramId: sourceProgramId || null,
        snapshot: clone(snapshot || {}),
        run: run ? clone(run) : null,
        createdAt: now(),
      };
      submissions.set(s.id, s);
      return submissionRow(s);
    },
    async listSubmissions(assignmentId, { membershipId } = {}) {
      return [...submissions.values()]
        .filter((s) => s.assignmentId === assignmentId && (!membershipId || s.membershipId === membershipId))
        .sort((a, b) => a.attempt - b.attempt || a.createdAt.localeCompare(b.createdAt))
        .map(submissionRow);
    },
    async getSubmission(id) {
      const s = submissions.get(id);
      return s ? submissionRow(s) : null;
    },
    async upsertSubmissionReview(submissionId, { comment, status, reviewedBy }) {
      const s = submissions.get(submissionId);
      if (!s) return null;
      const r = reviews.get(submissionId) || { comment: '', status: null, reviewedBy: null, updatedAt: null };
      if (comment !== undefined && comment !== null) r.comment = comment;
      if (status !== undefined) r.status = status;
      r.reviewedBy = reviewedBy || null;
      r.updatedAt = now();
      reviews.set(submissionId, r);
      return submissionRow(s);
    },

    // ---- profiles (d-6, owned per user since d-29) ----
    async listProfiles(userId) {
      return [...profiles.values()].filter((p) => p.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async getProfile(id) {
      return profiles.get(id) || null;
    },
    async createProfile({ userId, name, color, prefs }) {
      const row = { id: randomUUID(), userId: userId || null, name, color: color || '#2f80ed', prefs: prefs || {}, createdAt: now() };
      profiles.set(row.id, row);
      return row;
    },
    async claimProfile(id, userId) {
      const row = profiles.get(id);
      if (!row || row.userId) return null;
      row.userId = userId;
      return row;
    },
    async moveProfile(id, fromUserId, toUserId) {
      const row = profiles.get(id);
      if (!row || row.userId !== fromUserId) return null;
      row.userId = toUserId;
      return row;
    },
    async listUnclaimedProfiles() {
      return [...profiles.values()]
        .filter((p) => p.userId === null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((p) => ({ id: p.id, name: p.name, color: p.color, createdAt: p.createdAt }));
    },
    async updateProfile(id, patch) {
      const row = profiles.get(id);
      if (!row) return null;
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.color !== undefined) row.color = patch.color;
      if (patch.prefs !== undefined) row.prefs = { ...row.prefs, ...patch.prefs };
      return row;
    },
    /**
     * Remove a profile with everything profile-owned, the way the pg cascade does (d-40). Programs
     * go through removeProgram, so an attempt (d-35) or a sent copy (d-38) built from one keeps its
     * snapshot and only loses source_program_id. Floors are dropped directly rather than through
     * deleteFloor, which also resets programs.floor_id to 'blank': pg does not do that (there is no
     * foreign key on that column), and it would be pointless here anyway, since every program
     * pointing at these floors belongs to the profile that is going away.
     */
    async deleteProfile(id) {
      if (!profiles.has(id)) return false;
      for (const p of [...programs.values()]) if (p.profileId === id) removeProgram(p.id);
      for (const f of [...floors.values()]) if (f.profileId === id) floors.delete(f.id);
      for (const r of [...runs.values()]) if (r.profileId === id) runs.delete(r.id);
      for (const d of [...drawings.values()]) if (d.profileId === id) drawings.delete(d.id);
      for (const [key, w] of [...workbook.entries()]) if (w.profileId === id) workbook.delete(key);
      return profiles.delete(id);
    },
    async listPrograms(profileId) {
      return [...programs.values()]
        .filter((p) => p.profileId === profileId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async getProgram(id) {
      return programs.get(id) || null;
    },
    async createProgram(profileId, { name, code, floorId, exerciseRef, classId, assignmentId }) {
      if (!profiles.has(profileId)) return null;
      if (assignmentId && [...programs.values()].some((p) => p.profileId === profileId && p.assignmentId === assignmentId)) {
        const err = new Error('assignment started');
        err.code = 'ASSIGNMENT_STARTED'; // UNIQUE (profile_id, assignment_id)
        throw err;
      }
      const t = now();
      const row = {
        id: randomUUID(),
        profileId,
        name,
        code: code || '',
        floorId: floorId || 'blank',
        exerciseRef: exerciseRef || null,
        classId: classId || null,
        assignmentId: assignmentId || null,
        createdAt: t,
        updatedAt: t,
      };
      programs.set(row.id, row);
      return row;
    },
    async updateProgram(id, patch) {
      const row = programs.get(id);
      if (!row) return null;
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.code !== undefined) row.code = patch.code;
      if (patch.floorId !== undefined) row.floorId = patch.floorId;
      if (patch.exerciseRef !== undefined) row.exerciseRef = patch.exerciseRef;
      row.updatedAt = now();
      return row;
    },
    async deleteProgram(id) {
      return removeProgram(id);
    },

    // ---- floors (d-8) ----
    async listFloors(profileId) {
      return [...floors.values()]
        .filter((f) => f.profileId === profileId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(floorRow);
    },
    async getFloor(id) {
      const f = floors.get(id);
      return f ? floorRow(f) : null;
    },
    async createFloor(profileId, { name, data, classId, assignmentId, locked }) {
      if (!profiles.has(profileId)) return null;
      const t = now();
      const f = {
        id: randomUUID(),
        profileId,
        name,
        data: clone(data || {}),
        classId: classId || null,
        assignmentId: assignmentId || null,
        locked: !!locked,
        createdAt: t,
        updatedAt: t,
      };
      floors.set(f.id, f);
      return floorRow(f);
    },
    async updateFloor(id, patch) {
      const f = floors.get(id);
      if (!f) return null;
      if (patch.name !== undefined) f.name = patch.name;
      if (patch.data !== undefined) f.data = clone(patch.data);
      f.updatedAt = now();
      return floorRow(f);
    },
    async deleteFloor(id) {
      const ok = floors.delete(id);
      if (ok) {
        for (const p of programs.values()) if (p.floorId === id) p.floorId = 'blank';
        for (const w of workbook.values()) if (w.floorId === id) w.floorId = null; // d-21
      }
      return ok;
    },

    // ---- runs (d-13) ----
    async listRuns(profileId, { programId, floorId } = {}) {
      const rows = [...runs.values()].filter(
        (r) => r.profileId === profileId && (!programId || r.programId === programId) && (!floorId || r.floorId === floorId),
      );
      return newestFirst(rows).map(runSummary);
    },
    async getRun(id) {
      const r = runs.get(id);
      return r ? clone(r) : null;
    },
    async createRun(profileId, row) {
      if (!profiles.has(profileId)) return null;
      const program = programs.get(row.programId);
      if (!program || program.profileId !== profileId) return null;
      const r = { id: randomUUID(), profileId, ...clone(row), createdAt: now() };
      runs.set(r.id, r);
      return clone(r);
    },
    async deleteRun(id) {
      return runs.delete(id);
    },
    /** Keep the newest `keep` runs of every program of the profile; returns how many were deleted. */
    async pruneRuns(profileId, keep) {
      const byProgram = new Map();
      for (const r of newestFirst([...runs.values()].filter((r) => r.profileId === profileId))) {
        const group = byProgram.get(r.programId) || [];
        group.push(r);
        byProgram.set(r.programId, group);
      }
      let deleted = 0;
      for (const group of byProgram.values()) for (const r of group.slice(keep)) if (runs.delete(r.id)) deleted++;
      return deleted;
    },

    // ---- drawings (d-13) ----
    async listDrawings(profileId) {
      return newestFirst([...drawings.values()].filter((d) => d.profileId === profileId)).map(drawingRow);
    },
    async getDrawing(id) {
      const d = drawings.get(id);
      return d ? drawingRow(d) : null;
    },
    async createDrawing(profileId, { title, runId, programName, floorName, data }) {
      if (!profiles.has(profileId)) return null;
      const d = {
        id: randomUUID(),
        profileId,
        runId: runId || null,
        title,
        programName: programName || '',
        floorName: floorName || '',
        data: clone(data || {}),
        createdAt: now(),
      };
      drawings.set(d.id, d);
      return drawingRow(d);
    },
    async deleteDrawing(id) {
      return drawings.delete(id);
    },

    // ---- workbook (d-21) ----
    async listWorkbook(profileId) {
      return [...workbook.values()]
        .filter((w) => w.profileId === profileId)
        .sort((a, b) => a.lesson - b.lesson || a.exercise - b.exercise)
        .map(clone);
    },
    async upsertWorkbookEntry(profileId, lesson, exercise, patch) {
      if (!profiles.has(profileId)) return null;
      const key = `${profileId}:${lesson}:${exercise}`;
      let w = workbook.get(key);
      if (!w) {
        w = { id: randomUUID(), profileId, lesson, exercise, done: false, programId: null, floorId: null, updatedAt: now() };
        workbook.set(key, w);
      }
      if (patch.done !== undefined && patch.done !== null) w.done = !!patch.done;
      if (patch.programId !== undefined) w.programId = patch.programId;
      if (patch.floorId !== undefined) w.floorId = patch.floorId;
      w.updatedAt = now();
      return clone(w);
    },
  };
}
