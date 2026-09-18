import { getPool } from '../db.js';

const iso = (d) => (d instanceof Date ? d.toISOString() : d);

function profileRow(r) {
  return { id: r.id, userId: r.user_id ?? null, name: r.name, color: r.color, prefs: r.prefs || {}, createdAt: iso(r.created_at) };
}

// A user row never carries the password hash; findCredential is the one way to read it (d-31).
function userRow(r) {
  return { id: r.id, username: r.username ?? null, registeredAt: iso(r.registered_at) ?? null, createdAt: iso(r.created_at) };
}

// A duplicate under a unique constraint (SQLSTATE 23505) surfaces as err.code = code.
async function uniqueGuard(code, run) {
  try {
    return await run();
  } catch (err) {
    if (err && err.code === '23505') {
      const taken = new Error(code.toLowerCase().replace(/_/g, ' '));
      taken.code = code;
      throw taken;
    }
    throw err;
  }
}
const usernameGuard = (run) => uniqueGuard('USERNAME_TAKEN', run);

// Classes (d-32). A class row carries its join code; src/classes.js decides who may see it.
function classRow(r) {
  return {
    id: r.id,
    name: r.name,
    createdBy: r.created_by,
    joinCode: r.join_code,
    archivedAt: iso(r.archived_at) ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function membershipRow(r) {
  return {
    id: r.id,
    classId: r.class_id,
    userId: r.user_id,
    role: r.role,
    state: r.state,
    rejoinAllowed: !!r.rejoin_allowed,
    joinedAt: iso(r.joined_at),
    updatedAt: iso(r.updated_at),
  };
}

// A resource (d-32). A peer example (d-37) also carries its provenance, store-internal: src/store/scoped.js
// turns it into what a reader may see. The author is read through the attempt, never stored here.
const RESOURCE_SELECT = `SELECT r.*, xs.membership_id AS example_membership_id
   FROM class_resources r LEFT JOIN submissions xs ON xs.id = r.submission_id`;
function resourceRow(r) {
  return {
    id: r.id,
    classId: r.class_id,
    publishedBy: r.published_by,
    kind: r.kind,
    name: r.name,
    snapshot: r.snapshot || {},
    sourceId: r.source_id ?? null,
    publishedAt: iso(r.published_at),
    unpublishedAt: iso(r.unpublished_at) ?? null,
    example: r.submission_id
      ? { submissionId: r.submission_id, authorMembershipId: r.example_membership_id ?? null, attribution: r.attribution, note: r.note || '' }
      : null,
  };
}
const EXAMPLE_FIELDS = ['submissionId', 'liveSubmissionId', 'attribution', 'note'];

// An assignment (d-34): starter is the immutable { program, floor } snapshot taken at creation.
function assignmentRow(r) {
  return {
    id: r.id,
    classId: r.class_id,
    createdBy: r.created_by,
    lesson: r.lesson,
    exercise: r.exercise,
    instructions: r.instructions || '',
    dueAt: iso(r.due_at) ?? null,
    allowFloorEdit: !!r.allow_floor_edit,
    requireRun: !!r.require_run,
    floorId: r.floor_id,
    starter: r.starter || {},
    closedAt: iso(r.closed_at) ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

// A submission (d-35): an append-only attempt, with its review (a LEFT JOIN) when there is one.
const SUBMISSION_SELECT = `SELECT s.*, r.comment AS review_comment, r.status AS review_status, r.reviewed_by, r.updated_at AS reviewed_at,
        e.attribution AS shared_attribution
   FROM submissions s LEFT JOIN submission_reviews r ON r.submission_id = s.id
   LEFT JOIN class_resources e ON e.live_submission_id = s.id`;
function submissionRow(r) {
  return {
    id: r.id,
    assignmentId: r.assignment_id,
    membershipId: r.membership_id,
    attempt: Number(r.attempt),
    sourceProgramId: r.source_program_id ?? null,
    snapshot: r.snapshot || {},
    run: r.run ?? null,
    createdAt: iso(r.created_at),
    shared: r.shared_attribution ?? null, // d-37: the attribution of its published example, if any
    review:
      r.reviewed_at === null || r.reviewed_at === undefined
        ? null
        : { comment: r.review_comment || '', status: r.review_status ?? null, reviewedBy: r.reviewed_by ?? null, updatedAt: iso(r.reviewed_at) },
  };
}

// A sent copy (d-38): insert-only; its class is its membership's; the reply joins in when there is one.
const SENT_COPY_SELECT = `SELECT c.*, sm.class_id AS copy_class_id, sr.comment AS reply_comment, sr.replied_by, sr.updated_at AS replied_at
   FROM sent_copies c JOIN class_memberships sm ON sm.id = c.membership_id
   LEFT JOIN sent_copy_replies sr ON sr.sent_copy_id = c.id`;
function sentCopyRow(r) {
  return {
    id: r.id,
    membershipId: r.membership_id,
    classId: r.copy_class_id,
    sourceProgramId: r.source_program_id ?? null,
    snapshot: r.snapshot || {},
    message: r.message || '',
    createdAt: iso(r.created_at),
    reply:
      r.replied_at === null || r.replied_at === undefined
        ? null
        : { comment: r.reply_comment || '', repliedBy: r.replied_by ?? null, updatedAt: iso(r.replied_at) },
  };
}

// A session row (d-29): only the sha256 of the cookie token is stored.
function sessionRow(r) {
  return {
    tokenHash: r.token_hash,
    userId: r.user_id,
    homeUserId: r.home_user_id ?? null,
    createdAt: iso(r.created_at),
    lastSeenAt: iso(r.last_seen_at),
    expiresAt: iso(r.expires_at),
  };
}

function programRow(r) {
  return {
    id: r.id,
    profileId: r.profile_id,
    name: r.name,
    code: r.code,
    floorId: r.floor_id,
    exerciseRef: r.exercise_ref,
    classId: r.class_id ?? null, // assignment link (d-34), written only by Start
    assignmentId: r.assignment_id ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

// A floor row is its geometry document (d-7 shape) flattened with the row fields (d-8).
function floorRow(r) {
  return {
    id: r.id,
    profileId: r.profile_id,
    name: r.name,
    ...(r.data || {}),
    builtin: false,
    classId: r.class_id ?? null, // assignment origin and lock (d-34)
    assignmentId: r.assignment_id ?? null,
    locked: !!r.locked,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

// A run row (d-13): the summary columns, plus the jsonb document when `withData` (GET /runs/:id).
const RUN_SUMMARY_COLS =
  'id, profile_id, program_id, program_name, floor_id, floor_name, status, elapsed, wheel_left, wheel_right, has_pen, verdict, passed, created_at';
function runRow(r, withData) {
  const row = {
    id: r.id,
    profileId: r.profile_id,
    programId: r.program_id,
    programName: r.program_name,
    floorId: r.floor_id,
    floorName: r.floor_name,
    status: r.status,
    elapsed: Number(r.elapsed),
    wheelLeft: Number(r.wheel_left),
    wheelRight: Number(r.wheel_right),
    hasPen: !!r.has_pen,
    verdict: r.verdict ?? null, // the goal verdict text (Milestone 4, d-20), null without a goal
    passed: r.passed ?? null,
    createdAt: iso(r.created_at),
  };
  if (withData) row.data = r.data || {};
  return row;
}

// A workbook entry (d-21): one profile's state for one numbered exercise of the fixed catalogue.
function workbookRow(r) {
  return {
    id: r.id,
    profileId: r.profile_id,
    lesson: r.lesson,
    exercise: r.exercise,
    done: !!r.done,
    programId: r.program_id,
    floorId: r.floor_id,
    updatedAt: iso(r.updated_at),
  };
}

// A drawing row (d-13): its document { width, height, background, strokes } flattened with the row fields.
function drawingRow(r) {
  return {
    id: r.id,
    profileId: r.profile_id,
    runId: r.run_id,
    title: r.title,
    programName: r.program_name,
    floorName: r.floor_name,
    ...(r.data || {}),
    createdAt: iso(r.created_at),
  };
}

export function createPgStore() {
  const q = (text, params) => getPool().query(text, params);
  const getResource = async (id) => {
    const { rows } = await q(`${RESOURCE_SELECT} WHERE r.id = $1`, [id]);
    return rows[0] ? resourceRow(rows[0]) : null;
  };
  const getSentCopy = async (id) => {
    const { rows } = await q(`${SENT_COPY_SELECT} WHERE c.id = $1`, [id]);
    return rows[0] ? sentCopyRow(rows[0]) : null;
  };
  const getSubmission = async (id) => {
    const { rows } = await q(`${SUBMISSION_SELECT} WHERE s.id = $1`, [id]);
    return rows[0] ? submissionRow(rows[0]) : null;
  };

  return {
    kind: 'pg',
    async ping() {
      await q('SELECT 1');
      return true;
    },
    // ---- users and sessions (d-29, credentials d-31) ----
    async createUser({ username, usernameKey, passwordHash } = {}) {
      const { rows } = await usernameGuard(() =>
        q(
          `INSERT INTO users (username, username_key, password_hash, registered_at)
           VALUES ($1, $2, $3, CASE WHEN $2::text IS NULL THEN NULL ELSE now() END) RETURNING *`,
          [username || null, usernameKey || null, passwordHash || null],
        ),
      );
      return userRow(rows[0]);
    },
    async getUser(id) {
      const { rows } = await q('SELECT * FROM users WHERE id = $1', [id]);
      return rows[0] ? userRow(rows[0]) : null;
    },
    async findCredential(usernameKey) {
      const { rows } = await q('SELECT id, password_hash FROM users WHERE username_key = $1', [usernameKey]);
      return rows[0] ? { userId: rows[0].id, passwordHash: rows[0].password_hash } : null;
    },
    /** Attach a credential to a user that has none; null when the user is missing or already registered. */
    async setCredential(id, { username, usernameKey, passwordHash }) {
      const { rows } = await usernameGuard(() =>
        q(
          `UPDATE users SET username = $2, username_key = $3, password_hash = $4, registered_at = now()
            WHERE id = $1 AND username_key IS NULL RETURNING *`,
          [id, username, usernameKey, passwordHash],
        ),
      );
      return rows[0] ? userRow(rows[0]) : null;
    },
    async createSession({ tokenHash, userId, homeUserId, expiresAt }) {
      const { rows } = await q(
        'INSERT INTO sessions (token_hash, user_id, home_user_id, expires_at) VALUES ($1, $2, $3, $4::timestamptz) RETURNING *',
        [tokenHash, userId, homeUserId || null, expiresAt],
      );
      return sessionRow(rows[0]);
    },
    async deleteSession(tokenHash) {
      const { rowCount } = await q('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
      return rowCount > 0;
    },
    async getSession(tokenHash) {
      const { rows } = await q('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash]);
      return rows[0] ? sessionRow(rows[0]) : null;
    },
    async touchSession(tokenHash, expiresAt) {
      const { rows } = await q(
        'UPDATE sessions SET last_seen_at = now(), expires_at = $2::timestamptz WHERE token_hash = $1 RETURNING *',
        [tokenHash, expiresAt],
      );
      return rows[0] ? sessionRow(rows[0]) : null;
    },

    /** A new password for a registered user (d-32); null for an unknown or anonymous user. */
    async setPassword(userId, passwordHash) {
      const { rows } = await q('UPDATE users SET password_hash = $2 WHERE id = $1 AND username_key IS NOT NULL RETURNING *', [userId, passwordHash]);
      return rows[0] ? userRow(rows[0]) : null;
    },
    /** Sign a user out everywhere (d-32): browsers that remember a home user go back to it, the rest lose their cookie. */
    async revokeUserSessions(userId) {
      const homed = await q('UPDATE sessions SET user_id = home_user_id, home_user_id = NULL WHERE user_id = $1 AND home_user_id IS NOT NULL', [userId]);
      const gone = await q('DELETE FROM sessions WHERE user_id = $1', [userId]);
      return homed.rowCount + gone.rowCount;
    },

    // ---- classes, memberships and resources (d-32) ----
    async createClass({ name, createdBy, joinCode }) {
      const { rows } = await uniqueGuard('JOIN_CODE_TAKEN', () =>
        q('INSERT INTO classes (name, created_by, join_code) VALUES ($1, $2, $3) RETURNING *', [name, createdBy, joinCode]),
      );
      return classRow(rows[0]);
    },
    async getClass(id) {
      const { rows } = await q('SELECT * FROM classes WHERE id = $1', [id]);
      return rows[0] ? classRow(rows[0]) : null;
    },
    async findClassByJoinCode(code) {
      const { rows } = await q('SELECT * FROM classes WHERE join_code = $1', [code]);
      return rows[0] ? classRow(rows[0]) : null;
    },
    async updateClass(id, patch) {
      const { rows } = await uniqueGuard('JOIN_CODE_TAKEN', () =>
        q(
          `UPDATE classes
              SET join_code = COALESCE($2, join_code),
                  archived_at = CASE WHEN $4::boolean THEN $3::timestamptz ELSE archived_at END,
                  updated_at = now()
            WHERE id = $1
            RETURNING *`,
          [id, patch.joinCode ?? null, patch.archivedAt ?? null, patch.archivedAt !== undefined],
        ),
      );
      return rows[0] ? classRow(rows[0]) : null;
    },
    async listClassesForUser(userId) {
      const { rows } = await q(
        `SELECT m.*, c.name AS class_name, c.created_by, c.join_code, c.archived_at,
                c.created_at AS class_created_at, c.updated_at AS class_updated_at,
                (SELECT u.username FROM class_memberships t JOIN users u ON u.id = t.user_id
                  WHERE t.class_id = m.class_id AND t.role = 'teacher' ORDER BY t.joined_at ASC LIMIT 1) AS teacher_username
           FROM class_memberships m JOIN classes c ON c.id = m.class_id
          WHERE m.user_id = $1
          ORDER BY c.created_at ASC, c.id ASC`,
        [userId],
      );
      return rows.map((r) => ({
        class: classRow({
          id: r.class_id,
          name: r.class_name,
          created_by: r.created_by,
          join_code: r.join_code,
          archived_at: r.archived_at,
          created_at: r.class_created_at,
          updated_at: r.class_updated_at,
        }),
        membership: membershipRow(r),
        teacherUsername: r.teacher_username ?? null,
      }));
    },
    async findMembership(classId, userId) {
      const { rows } = await q('SELECT * FROM class_memberships WHERE class_id = $1 AND user_id = $2', [classId, userId]);
      return rows[0] ? membershipRow(rows[0]) : null;
    },
    async getMembership(id) {
      const { rows } = await q('SELECT * FROM class_memberships WHERE id = $1', [id]);
      return rows[0] ? membershipRow(rows[0]) : null;
    },
    async createMembership({ classId, userId, role, state }) {
      const { rows } = await q(
        'INSERT INTO class_memberships (class_id, user_id, role, state) VALUES ($1, $2, $3, $4) RETURNING *',
        [classId, userId, role, state],
      );
      return membershipRow(rows[0]);
    },
    async updateMembership(id, patch) {
      const { rows } = await q(
        `UPDATE class_memberships
            SET state = COALESCE($2, state),
                rejoin_allowed = COALESCE($3::boolean, rejoin_allowed),
                joined_at = COALESCE($4::timestamptz, joined_at),
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [id, patch.state ?? null, patch.rejoinAllowed ?? null, patch.joinedAt ?? null],
      );
      return rows[0] ? membershipRow(rows[0]) : null;
    },
    async archiveClassMemberships(classId) {
      const { rowCount } = await q(`UPDATE class_memberships SET state = 'archived', updated_at = now() WHERE class_id = $1 AND state = 'active'`, [classId]);
      return rowCount;
    },
    async listClassMembers(classId) {
      const { rows } = await q(
        'SELECT m.*, u.username FROM class_memberships m JOIN users u ON u.id = m.user_id WHERE m.class_id = $1 ORDER BY m.joined_at ASC, m.id ASC',
        [classId],
      );
      return rows.map((r) => ({ ...membershipRow(r), username: r.username ?? null }));
    },
    async createResource(fields) {
      if (EXAMPLE_FIELDS.some((k) => fields[k] !== undefined)) throw new Error('peer examples are created by createExample only');
      const { classId, publishedBy, kind, name, snapshot, sourceId } = fields;
      const { rows } = await q(
        'INSERT INTO class_resources (class_id, published_by, kind, name, snapshot, source_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *',
        [classId, publishedBy, kind, name, JSON.stringify(snapshot || {}), sourceId || null],
      );
      return resourceRow(rows[0]);
    },
    async listResources(classId, { includeUnpublished = false } = {}) {
      const { rows } = await q(
        `${RESOURCE_SELECT} WHERE r.class_id = $1 ${includeUnpublished ? '' : 'AND r.unpublished_at IS NULL'} ORDER BY r.published_at DESC, r.id DESC`,
        [classId],
      );
      return rows.map(resourceRow);
    },
    getResource,
    /** Unpublishing also frees the attempt to be published again (d-37). */
    async unpublishResource(id) {
      const { rows } = await q('UPDATE class_resources SET unpublished_at = now(), live_submission_id = NULL WHERE id = $1 AND unpublished_at IS NULL RETURNING id', [id]);
      return rows[0] ? getResource(rows[0].id) : null;
    },
    /**
     * A peer example (d-37): the attempt's own snapshot, copied here with neutral program and floor
     * names. Takes only a submission id, so nothing else can be published this way. Null when the
     * attempt is missing; EXAMPLE_LIVE while that attempt already has a published example.
     */
    async createExample({ classId, publishedBy, submissionId, attribution, note, name, floorName }) {
      const { rows } = await uniqueGuard('EXAMPLE_LIVE', () =>
        q(
          `INSERT INTO class_resources (class_id, published_by, kind, name, snapshot, submission_id, live_submission_id, attribution, note)
           SELECT $1::uuid, $2::uuid, 'program', $3::text,
                  CASE WHEN jsonb_typeof(s.snapshot->'floor') = 'object'
                       THEN jsonb_set(jsonb_set(s.snapshot, '{program,name}', to_jsonb($3::text)), '{floor,name}', to_jsonb($7::text))
                       ELSE jsonb_set(s.snapshot, '{program,name}', to_jsonb($3::text)) END,
                  s.id, s.id, $5::text, $6::text
             FROM submissions s WHERE s.id = $4::uuid
           RETURNING id`,
          [classId, publishedBy, name, submissionId, attribution, note || '', floorName || name],
        ),
      );
      return rows[0] ? getResource(rows[0].id) : null;
    },

    // ---- assignments (d-34) ----
    async createAssignment({ classId, createdBy, lesson, exercise, instructions, dueAt, allowFloorEdit, requireRun, floorId, starter }) {
      const { rows } = await q(
        `INSERT INTO assignments (class_id, created_by, lesson, exercise, instructions, due_at, allow_floor_edit, floor_id, starter, require_run)
         VALUES ($1, $2, $3::int, $4::int, $5, $6::timestamptz, $7::boolean, $8, $9::jsonb, $10::boolean) RETURNING *`,
        [classId, createdBy, lesson, exercise, instructions || '', dueAt || null, !!allowFloorEdit, floorId || 'blank', JSON.stringify(starter || {}), !!requireRun],
      );
      return assignmentRow(rows[0]);
    },
    async getAssignment(id) {
      const { rows } = await q('SELECT * FROM assignments WHERE id = $1', [id]);
      return rows[0] ? assignmentRow(rows[0]) : null;
    },
    async listAssignments(classId) {
      const { rows } = await q('SELECT * FROM assignments WHERE class_id = $1 ORDER BY created_at DESC, id DESC', [classId]);
      return rows.map(assignmentRow);
    },
    /** instructions, dueAt, closedAt; a key that is present replaces the value (null clears the dates). */
    async updateAssignment(id, patch) {
      const { rows } = await q(
        `UPDATE assignments
            SET instructions = COALESCE($2, instructions),
                due_at = CASE WHEN $4::boolean THEN $3::timestamptz ELSE due_at END,
                closed_at = CASE WHEN $6::boolean THEN $5::timestamptz ELSE closed_at END,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [id, patch.instructions ?? null, patch.dueAt ?? null, patch.dueAt !== undefined, patch.closedAt ?? null, patch.closedAt !== undefined],
      );
      return rows[0] ? assignmentRow(rows[0]) : null;
    },
    /** Every program linked to the assignment, with its owner's user id (for src/store/scoped.js only). */
    async listAssignmentPrograms(assignmentId) {
      const { rows } = await q(
        `SELECT p.*, pr.user_id AS owner_user_id FROM programs p JOIN profiles pr ON pr.id = p.profile_id
          WHERE p.assignment_id = $1 ORDER BY p.updated_at DESC, p.id ASC`,
        [assignmentId],
      );
      return rows.map((r) => ({ ...programRow(r), userId: r.owner_user_id ?? null }));
    },

    // ---- sent copies (d-38): insert-only; only the reply row is ever written again ----
    async createSentCopy({ membershipId, sourceProgramId, snapshot, message }) {
      const { rows } = await q(
        'INSERT INTO sent_copies (membership_id, source_program_id, snapshot, message) VALUES ($1::uuid, $2::uuid, $3::jsonb, $4::text) RETURNING id',
        [membershipId, sourceProgramId || null, JSON.stringify(snapshot || {}), message || ''],
      );
      return getSentCopy(rows[0].id);
    },
    /** { classId } or { membershipId }; newest first. */
    async listSentCopies({ classId, membershipId } = {}) {
      const [where, param] = membershipId ? ['c.membership_id = $1', membershipId] : ['sm.class_id = $1', classId];
      const { rows } = await q(`${SENT_COPY_SELECT} WHERE ${where} ORDER BY c.created_at DESC, c.id DESC`, [param]);
      return rows.map(sentCopyRow);
    },
    getSentCopy,
    async upsertSentCopyReply(sentCopyId, { comment, repliedBy }) {
      await q(
        `INSERT INTO sent_copy_replies (sent_copy_id, comment, replied_by) VALUES ($1::uuid, $2::text, $3::uuid)
         ON CONFLICT (sent_copy_id) DO UPDATE SET comment = $2::text, replied_by = $3::uuid, updated_at = now()`,
        [sentCopyId, comment || '', repliedBy || null],
      );
      return getSentCopy(sentCopyId);
    },

    // ---- submissions (d-35): insert-only attempts; only the review row is ever written again ----
    async createSubmission({ assignmentId, membershipId, sourceProgramId, snapshot, run }) {
      const { rows } = await uniqueGuard('SUBMISSION_RACE', () =>
        q(
          `INSERT INTO submissions (assignment_id, membership_id, attempt, source_program_id, snapshot, run)
           SELECT $1::uuid, $2::uuid, COALESCE(MAX(attempt), 0) + 1, $3::uuid, $4::jsonb, $5::jsonb
             FROM submissions WHERE assignment_id = $1::uuid AND membership_id = $2::uuid
           RETURNING *`,
          [assignmentId, membershipId, sourceProgramId || null, JSON.stringify(snapshot || {}), run ? JSON.stringify(run) : null],
        ),
      );
      return submissionRow(rows[0]);
    },
    async listSubmissions(assignmentId, { membershipId } = {}) {
      const params = [assignmentId];
      let where = 's.assignment_id = $1';
      if (membershipId) {
        params.push(membershipId);
        where += ' AND s.membership_id = $2';
      }
      const { rows } = await q(`${SUBMISSION_SELECT} WHERE ${where} ORDER BY s.attempt ASC, s.created_at ASC, s.id ASC`, params);
      return rows.map(submissionRow);
    },
    getSubmission,
    async upsertSubmissionReview(submissionId, { comment, status, reviewedBy }) {
      await q(
        `INSERT INTO submission_reviews (submission_id, comment, status, reviewed_by)
         VALUES ($1::uuid, COALESCE($2::text, ''), CASE WHEN $4::boolean THEN $3::text ELSE NULL END, $5::uuid)
         ON CONFLICT (submission_id) DO UPDATE
           SET comment = COALESCE($2::text, submission_reviews.comment),
               status = CASE WHEN $4::boolean THEN $3::text ELSE submission_reviews.status END,
               reviewed_by = $5::uuid,
               updated_at = now()`,
        [submissionId, comment ?? null, status ?? null, status !== undefined, reviewedBy || null],
      );
      return getSubmission(submissionId);
    },

    // ---- profiles (d-6, owned per user since d-29) ----
    async listProfiles(userId) {
      const { rows } = await q('SELECT * FROM profiles WHERE user_id = $1 ORDER BY created_at ASC, id ASC', [userId]);
      return rows.map(profileRow);
    },
    async getProfile(id) {
      const { rows } = await q('SELECT * FROM profiles WHERE id = $1', [id]);
      return rows[0] ? profileRow(rows[0]) : null;
    },
    async createProfile({ userId, name, color, prefs }) {
      const { rows } = await q(
        'INSERT INTO profiles (user_id, name, color, prefs) VALUES ($1, $2, $3, $4::jsonb) RETURNING *',
        [userId || null, name, color || '#2f80ed', JSON.stringify(prefs || {})],
      );
      return profileRow(rows[0]);
    },
    /** Give an unclaimed pre-session profile to a user; null when it is missing or already claimed. */
    async claimProfile(id, userId) {
      const { rows } = await q('UPDATE profiles SET user_id = $2 WHERE id = $1 AND user_id IS NULL RETURNING *', [id, userId]);
      return rows[0] ? profileRow(rows[0]) : null;
    },
    /** Re-home a profile the giver owns (d-31); null when it is missing or not the giver's. */
    async moveProfile(id, fromUserId, toUserId) {
      const { rows } = await q('UPDATE profiles SET user_id = $3 WHERE id = $1 AND user_id = $2 RETURNING *', [id, fromUserId, toUserId]);
      return rows[0] ? profileRow(rows[0]) : null;
    },
    /** The pre-session profiles nobody has claimed (d-31): what a registered user may still take. */
    async listUnclaimedProfiles() {
      const { rows } = await q('SELECT id, name, color, created_at FROM profiles WHERE user_id IS NULL ORDER BY created_at ASC, id ASC');
      return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, createdAt: iso(r.created_at) }));
    },
    /**
     * Remove a profile. One statement is the whole operation: profile_id is ON DELETE CASCADE from
     * programs, floors, runs, drawings and workbook_entries, and deleting those programs fires the
     * ON DELETE SET NULL on submissions.source_program_id and sent_copies.source_program_id, so the
     * class keeps its records and only loses the back-pointer (d-40).
     */
    async deleteProfile(id) {
      const { rowCount } = await q('DELETE FROM profiles WHERE id = $1', [id]);
      return rowCount > 0;
    },
    async updateProfile(id, patch) {
      const { rows } = await q(
        `UPDATE profiles
            SET name = COALESCE($2, name),
                color = COALESCE($3, color),
                prefs = prefs || COALESCE($4::jsonb, '{}'::jsonb)
          WHERE id = $1
          RETURNING *`,
        [id, patch.name ?? null, patch.color ?? null, patch.prefs !== undefined ? JSON.stringify(patch.prefs) : null],
      );
      return rows[0] ? profileRow(rows[0]) : null;
    },
    async listPrograms(profileId) {
      const { rows } = await q(
        'SELECT * FROM programs WHERE profile_id = $1 ORDER BY updated_at DESC, id ASC',
        [profileId],
      );
      return rows.map(programRow);
    },
    async getProgram(id) {
      const { rows } = await q('SELECT * FROM programs WHERE id = $1', [id]);
      return rows[0] ? programRow(rows[0]) : null;
    },
    /** classId/assignmentId only from Start (d-34); a second linked program in a profile is ASSIGNMENT_STARTED. */
    async createProgram(profileId, { name, code, floorId, exerciseRef, classId, assignmentId }) {
      const { rows } = await uniqueGuard('ASSIGNMENT_STARTED', () =>
        q(
          `INSERT INTO programs (profile_id, name, code, floor_id, exercise_ref, class_id, assignment_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [profileId, name, code || '', floorId || 'blank', exerciseRef || null, classId || null, assignmentId || null],
        ),
      );
      return programRow(rows[0]);
    },
    async updateProgram(id, patch) {
      const { rows } = await q(
        `UPDATE programs
            SET name = COALESCE($2, name),
                code = COALESCE($3, code),
                floor_id = COALESCE($4, floor_id),
                exercise_ref = CASE WHEN $6::boolean THEN $5 ELSE exercise_ref END,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          id,
          patch.name ?? null,
          patch.code ?? null,
          patch.floorId ?? null,
          patch.exerciseRef ?? null,
          patch.exerciseRef !== undefined,
        ],
      );
      return rows[0] ? programRow(rows[0]) : null;
    },
    async deleteProgram(id) {
      const { rowCount } = await q('DELETE FROM programs WHERE id = $1', [id]);
      return rowCount > 0;
    },

    // ---- floors (d-8) ----
    async listFloors(profileId) {
      const { rows } = await q('SELECT * FROM floors WHERE profile_id = $1 ORDER BY created_at ASC, id ASC', [profileId]);
      return rows.map(floorRow);
    },
    async getFloor(id) {
      const { rows } = await q('SELECT * FROM floors WHERE id = $1', [id]);
      return rows[0] ? floorRow(rows[0]) : null;
    },
    async createFloor(profileId, { name, data, classId, assignmentId, locked }) {
      const { rows } = await q(
        'INSERT INTO floors (profile_id, name, data, class_id, assignment_id, locked) VALUES ($1, $2, $3::jsonb, $4, $5, $6::boolean) RETURNING *',
        [profileId, name, JSON.stringify(data || {}), classId || null, assignmentId || null, !!locked],
      );
      return floorRow(rows[0]);
    },
    async updateFloor(id, patch) {
      const { rows } = await q(
        `UPDATE floors
            SET name = COALESCE($2, name),
                data = COALESCE($3::jsonb, data),
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [id, patch.name ?? null, patch.data !== undefined ? JSON.stringify(patch.data) : null],
      );
      return rows[0] ? floorRow(rows[0]) : null;
    },
    async deleteFloor(id) {
      const { rowCount } = await q('DELETE FROM floors WHERE id = $1', [id]);
      if (rowCount > 0) {
        // Programs that ran on this floor fall back to the blank floor (floor_id is text).
        await q(`UPDATE programs SET floor_id = 'blank' WHERE floor_id = $1::text`, [id]);
        // Workbook exercises that used it no longer name a floor (d-21).
        await q(`UPDATE workbook_entries SET floor_id = NULL WHERE floor_id = $1::text`, [id]);
      }
      return rowCount > 0;
    },

    // ---- runs (d-13) ----
    async listRuns(profileId, { programId, floorId } = {}) {
      const params = [profileId];
      let where = 'profile_id = $1';
      if (programId) {
        params.push(programId);
        where += ` AND program_id = $${params.length}`;
      }
      if (floorId) {
        params.push(floorId);
        where += ` AND floor_id = $${params.length}::text`;
      }
      const { rows } = await q(`SELECT ${RUN_SUMMARY_COLS} FROM runs WHERE ${where} ORDER BY created_at DESC, id DESC`, params);
      return rows.map((r) => runRow(r, false));
    },
    async getRun(id) {
      const { rows } = await q('SELECT * FROM runs WHERE id = $1', [id]);
      return rows[0] ? runRow(rows[0], true) : null;
    },
    async createRun(profileId, row) {
      const { rows } = await q(
        `INSERT INTO runs (profile_id, program_id, program_name, floor_id, floor_name, status, elapsed, wheel_left, wheel_right, has_pen, verdict, passed, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb) RETURNING *`,
        [
          profileId,
          row.programId,
          row.programName || '',
          row.floorId || 'blank',
          row.floorName || '',
          row.status || 'finished',
          row.elapsed || 0,
          row.wheelLeft || 0,
          row.wheelRight || 0,
          !!row.hasPen,
          row.verdict ?? null,
          row.passed ?? null,
          JSON.stringify(row.data || {}),
        ],
      );
      return runRow(rows[0], true);
    },
    async deleteRun(id) {
      const { rowCount } = await q('DELETE FROM runs WHERE id = $1', [id]);
      return rowCount > 0;
    },
    /** Keep the newest `keep` runs of every program of the profile; returns how many were deleted. */
    async pruneRuns(profileId, keep) {
      const { rowCount } = await q(
        `DELETE FROM runs
          WHERE id IN (
            SELECT id FROM (
              SELECT id, row_number() OVER (PARTITION BY program_id ORDER BY created_at DESC, id DESC) AS rn
                FROM runs WHERE profile_id = $1
            ) ranked
            WHERE rn > $2::int
          )`,
        [profileId, keep],
      );
      return rowCount;
    },

    // ---- drawings (d-13) ----
    async listDrawings(profileId) {
      const { rows } = await q('SELECT * FROM drawings WHERE profile_id = $1 ORDER BY created_at DESC, id DESC', [profileId]);
      return rows.map(drawingRow);
    },
    async getDrawing(id) {
      const { rows } = await q('SELECT * FROM drawings WHERE id = $1', [id]);
      return rows[0] ? drawingRow(rows[0]) : null;
    },
    async createDrawing(profileId, { title, runId, programName, floorName, data }) {
      const { rows } = await q(
        `INSERT INTO drawings (profile_id, run_id, title, program_name, floor_name, data)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *`,
        [profileId, runId || null, title, programName || '', floorName || '', JSON.stringify(data || {})],
      );
      return drawingRow(rows[0]);
    },
    async deleteDrawing(id) {
      const { rowCount } = await q('DELETE FROM drawings WHERE id = $1', [id]);
      return rowCount > 0;
    },

    // ---- workbook (d-21) ----
    async listWorkbook(profileId) {
      const { rows } = await q('SELECT * FROM workbook_entries WHERE profile_id = $1 ORDER BY lesson ASC, exercise ASC', [profileId]);
      return rows.map(workbookRow);
    },
    /** Create or update the entry for one exercise; keys absent from the patch keep their value. */
    async upsertWorkbookEntry(profileId, lesson, exercise, patch) {
      const { rows } = await q(
        `INSERT INTO workbook_entries (profile_id, lesson, exercise, done, program_id, floor_id)
         VALUES ($1, $2::int, $3::int, COALESCE($4::boolean, false), $5::uuid, $6::text)
         ON CONFLICT (profile_id, lesson, exercise) DO UPDATE
           SET done = COALESCE($4::boolean, workbook_entries.done),
               program_id = CASE WHEN $7::boolean THEN $5::uuid ELSE workbook_entries.program_id END,
               floor_id = CASE WHEN $8::boolean THEN $6::text ELSE workbook_entries.floor_id END,
               updated_at = now()
         RETURNING *`,
        [
          profileId,
          lesson,
          exercise,
          patch.done ?? null,
          patch.programId ?? null,
          patch.floorId ?? null,
          patch.programId !== undefined,
          patch.floorId !== undefined,
        ],
      );
      return workbookRow(rows[0]);
    },
  };
}
