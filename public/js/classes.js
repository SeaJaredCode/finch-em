// The Classes pane (itch-14, d-32). A registered user creates a class (becoming its teacher) or
// joins one with a code; a teacher sees the code and link, the roster, and what they published;
// a student sees the class, its teacher and the published resources they can copy into their
// current profile. Anonymous users see one button: create an account first.
// Assignments (itch-15, d-34): a teacher sets workbook exercises with a starter, follows progress and
// opens each student's linked draft read-only; a student starts their own copy. Starters, published
// resources and drafts all open in the read-only viewer (onView) without copying.
// Submissions (itch-16, d-35): a student turns in their linked work as numbered attempts and reads the
// teacher's feedback; the teacher opens each attempt read-only, comments, returns or marks it
// reviewed, and can duplicate it into their own profile. Attempts never change once turned in.
// Peer examples (itch-17, d-37): the teacher publishes an attempt to the class, anonymously or by name,
// with a note; classmates see it among the published items; the author sees that it is shared.
// Sent copies (itch-18, d-38): a student sends the teacher a copy of any program (from the Share menu,
// d-39); the teacher sees "Sent to you" (open, duplicate, reply), the student "Sent to your teacher".
import { api } from './api.js';
import { LESSONS } from './lessons.js';

export function createClasses({ els, profiles, programs, floorLib, account, onCopied, onStarted, onView, onHint, onError }) {
  let classes = [];
  let openId = null;
  let resetTarget = null;

  const registered = () => !!(profiles.account && profiles.account.username);
  const fail = (err) => onError && onError(err.message);
  const hint = (text) => onHint && onHint(text);
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : '');
  const statusClass = (s) => String(s).replace(/ /g, '-');
  const runText = (r) => (r ? `run: ${r.verdict || r.status}` : 'no run');
  const sharedTag = (shared, whose) =>
    shared ? `<span class="class-tag">shared with ${whose} class ${shared === 'name' ? 'by name' : 'anonymously'}</span>` : '';

  async function refresh() {
    const ok = registered();
    els.anon.hidden = ok;
    els.body.hidden = !ok;
    els.btnNew.hidden = !ok;
    if (!ok) return;
    classes = await api.listClasses();
    renderList();
    if (openId && classes.some((c) => c.id === openId)) await openClass(openId);
    else {
      openId = null;
      els.detail.hidden = true;
      els.detail.innerHTML = '';
    }
  }

  function renderList() {
    els.list.innerHTML = '';
    if (!classes.length) {
      const empty = document.createElement('div');
      empty.className = 'floor-empty';
      empty.textContent = 'No classes yet. Create one, or join one with the code your teacher gave you.';
      els.list.appendChild(empty);
      return;
    }
    for (const c of classes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'floor-item class-item' + (c.id === openId ? ' active' : '');
      b.innerHTML = `<span class="class-name">${esc(c.name)}</span><span class="class-role">${esc(c.membership.role)}</span>${c.archivedAt ? '<span class="class-tag">archived</span>' : ''}`;
      b.addEventListener('click', () => openClass(c.id).catch(fail));
      els.list.appendChild(b);
    }
  }

  async function openClass(id) {
    openId = id;
    renderList();
    const cls = await api.getClass(id);
    const resources = await api.listClassResources(id);
    const assignments = await api.listAssignments(id);
    const teacher = cls.membership.role === 'teacher';
    const roster = teacher ? await api.classRoster(id) : [];
    const mySubs = {};
    if (!teacher) for (const a of assignments) mySubs[a.id] = await api.mySubmissions(a.id);
    const sent = teacher ? await api.classSentCopies(id) : await api.mySentCopies(id);
    els.detail.hidden = false;
    els.detail.innerHTML = teacher ? teacherHtml(cls, roster, resources, assignments, sent) : studentHtml(cls, resources, assignments, mySubs, sent);
    wire(cls, assignments, mySubs);
    wireSent(cls, sent, teacher);
  }

  // ---- sent copies (d-38) ----

  function sentCopiesHtml(list, { teacher, frozen }) {
    if (!list.length) {
      return `<div class="floor-empty">${teacher ? 'Nothing sent to you yet.' : 'Nothing sent yet. Use Share… on one of your programs to send your teacher a copy.'}</div>`;
    }
    return list
      .map((c) => {
        const who = teacher && c.author ? `<span>from ${esc(c.author.username)}${c.author.state !== 'active' ? ` <span class="class-tag">${esc(c.author.state)}</span>` : ''}</span>` : '';
        const reply = c.reply ? c.reply.comment : '';
        const answer =
          teacher && !frozen
            ? `<textarea data-reply maxlength="4000" placeholder="Reply (only ${esc(c.author ? c.author.username : 'the student')} sees it)">${esc(reply)}</textarea>
              <div class="control-row"><button type="button" data-copy-act="reply">Save reply</button></div>`
            : reply
              ? `<div class="attempt-comment"><span class="muted">${teacher ? 'Your reply' : 'Teacher'}:</span> ${esc(reply)}</div>`
              : '';
        return `<div class="attempt sent-copy" data-copy="${c.id}"><div class="attempt-head"><span class="assign-title">${esc(c.program ? c.program.name : 'Program')}</span>${who}
          <span class="muted">${fmtTime(c.sentAt)}</span>${c.floor ? `<span class="muted">floor “${esc(c.floor.name)}”</span>` : ''}
          <button type="button" data-copy-act="view">Open read-only</button>
          ${teacher ? '<button type="button" data-copy-act="duplicate" title="An editable copy in your current profile; the student\'s copy does not change">Duplicate</button>' : ''}</div>
          ${c.message ? `<div class="attempt-comment"><span class="muted">${teacher ? 'Message' : 'You wrote'}:</span> ${esc(c.message)}</div>` : ''}
          ${answer}</div>`;
      })
      .join('');
  }

  function wireSent(cls, list, teacher) {
    for (const el of els.detail.querySelectorAll('[data-copy]')) {
      const c = list.find((x) => x.id === el.dataset.copy);
      const who = teacher ? (c.author ? c.author.username : 'a student') : 'you';
      for (const b of el.querySelectorAll('[data-copy-act]')) {
        b.addEventListener('click', async () => {
          try {
            if (b.dataset.copyAct === 'view') {
              await onView({ label: `the copy of “${c.program.name}” sent by ${who}`, program: c.program, floor: c.floor });
            } else if (b.dataset.copyAct === 'duplicate') {
              const profile = profiles.current;
              if (!profile) return;
              const result = await api.duplicateSentCopy(c.id, profile.id);
              hint(`Copied it into ${profile.name} as “${result.program.name}”.`);
              if (onCopied) await onCopied(result);
            } else if (b.dataset.copyAct === 'reply') {
              await api.replySentCopy(c.id, el.querySelector('[data-reply]').value);
              hint(`Reply saved; ${who} will see it in ${cls.name}.`);
            }
          } catch (err) {
            fail(err);
          }
        });
      }
    }
  }

  /** Share menu (d-39): send the teacher of `cls` a copy of `program` with `message`. Throws on refusal. */
  async function sendCopy(program, cls, message) {
    await programs.saveNow();
    const copy = await api.sendCopy(cls.id, program.id, message || '');
    hint(`Sent a copy of “${program.name}” to ${(cls.teacher && cls.teacher.username) || 'your teacher'} in ${cls.name}. Your later edits do not change it.`);
    if (openId === cls.id) await openClass(openId);
    return copy;
  }

  /** Share menu (d-39): publish the teacher's open program to `cls` (d-32). Throws on refusal. */
  async function publishProgram(program, cls) {
    await programs.saveNow();
    const r = await api.publishResource(cls.id, { programId: program.id });
    hint(`Published “${r.name}” to ${cls.name}. Every student there can run and copy it.`);
    if (openId === cls.id) await openClass(openId);
    return r;
  }

  // ---- assignments (d-34) ----

  const startedHere = (a) => programs.all.find((p) => p.assignmentId === a.id) || null;

  function exerciseOptions() {
    return LESSONS.map(
      (l) =>
        `<optgroup label="${esc(l.name)}">${Array.from({ length: l.exercises }, (_, i) => `<option value="${l.n}.${i + 1}">Lesson ${l.n} exercise ${i + 1}</option>`).join('')}</optgroup>`,
    ).join('');
  }

  function assignFormHtml() {
    const ps = programs.all.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    const opt = (f) => `<option value="${f.id}">${esc(f.name)}</option>`;
    const custom = floorLib.custom.filter((f) => !f.locked);
    return `<details class="assign-new"><summary>New assignment</summary>
      <form class="assign-form" data-assign-form>
        <label>Exercise</label><select name="exercise" required>${exerciseOptions()}</select>
        <label>Starter</label><select name="starter"><option value="">None (the lesson template)</option>${ps}</select>
        <label>Floor</label><select name="floor"><option value="">The starter's floor, else the lesson's</option><optgroup label="Built-in">${floorLib.builtin.map(opt).join('')}</optgroup>${custom.length ? `<optgroup label="My floors">${custom.map(opt).join('')}</optgroup>` : ''}</select>
        <label>Instructions</label><textarea name="instructions" maxlength="4000" placeholder="What should they do?"></textarea>
        <label>Due</label><input type="date" name="due">
        <span></span><label><input type="checkbox" name="allowFloorEdit"> Students may edit their copy of the floor</label>
        <span></span><label><input type="checkbox" name="requireRun"> Students must run their program before turning it in</label>
        <div class="assign-actions"><span class="muted">Students get a copy of the starter and floor as they are now.</span><button type="submit" class="primary">Assign</button></div>
      </form></details>`;
  }

  function assignHead(a) {
    const what = [a.starterName ? `starter “${esc(a.starterName)}”` : 'lesson template', a.floorName ? `floor “${esc(a.floorName)}”` : `floor ${esc(a.floorId)}`];
    return `<div class="assign-head"><span class="assign-title">${esc(a.title)}</span>
        ${a.lessonUrl ? `<a class="wb-link" href="${a.lessonUrl}" target="_blank" rel="noopener">${esc(a.lessonName || 'lesson page')} ↗</a>` : ''}
        ${a.dueAt ? `<span class="muted">due ${fmtDate(a.dueAt)}</span>` : ''}
        ${a.closedAt ? '<span class="class-tag">closed</span>' : ''}</div>
      <div class="muted">${what.join(' · ')}${a.allowFloorEdit ? ' · floor editable' : ''}${a.requireRun ? ' · needs a run to turn in' : ''}</div>
      ${a.instructions ? `<div class="assign-instructions">${esc(a.instructions)}</div>` : ''}`;
  }

  function teacherAssignmentsHtml(cls, assignments) {
    const closed = !!cls.archivedAt;
    const cards = assignments
      .map(
        (a) => `<div class="assign-card${a.closedAt ? ' closed' : ''}">${assignHead(a)}
        <div class="control-row">
          <button type="button" data-act="assign-progress" data-id="${a.id}">Progress</button>
          ${a.starterName ? `<button type="button" data-act="assign-run" data-id="${a.id}" title="Run the starter read-only">Run starter</button>` : ''}
          ${closed ? '' : `<button type="button" data-act="assign-edit" data-id="${a.id}">Edit</button>`}
          ${closed ? '' : `<button type="button" data-act="${a.closedAt ? 'assign-reopen' : 'assign-close'}" data-id="${a.id}">${a.closedAt ? 'Reopen' : 'Close'}</button>`}
        </div>
        <div data-progress="${a.id}" hidden data-frozen="${closed ? '1' : ''}"></div></div>`,
      )
      .join('');
    return `<div class="class-subtitle">Assignments <span class="muted">(${assignments.length})</span></div>
      ${cards || '<div class="floor-empty">No assignments yet.</div>'}
      ${closed ? '' : assignFormHtml()}`;
  }

  /** A student's own attempts, newest first, with the teacher's feedback. */
  function myAttemptsHtml(a, subs) {
    if (!subs.length) return '';
    const items = subs
      .slice()
      .reverse()
      .map(
        (t) => `<div class="attempt"><div class="attempt-head"><span class="assign-title">Attempt ${t.attempt}</span>
          <span class="muted">${fmtTime(t.submittedAt)}</span><span class="assign-status ${statusClass(t.status)}">${esc(t.status)}</span><span class="muted">${runText(t.run)}</span>${sharedTag(t.shared, 'your')}
          <button type="button" data-act="attempt-view" data-id="${a.id}" data-attempt="${t.id}" title="What your teacher sees">Open read-only</button></div>
          ${t.review && t.review.comment ? `<div class="attempt-comment"><span class="muted">Teacher:</span> ${esc(t.review.comment)}</div>` : ''}</div>`,
      )
      .join('');
    return `<details class="attempts" ${subs.some((t) => t.review) ? 'open' : ''}><summary>Turned in (${subs.length})</summary>${items}</details>`;
  }

  function studentAssignmentsHtml(cls, assignments, mySubs) {
    const open = cls.membership.state === 'active';
    const cards = assignments
      .map((a) => {
        const mine = startedHere(a);
        const subs = mySubs[a.id] || [];
        const latest = subs[subs.length - 1];
        const status = latest ? latest.status : mine ? 'started' : 'not started';
        const start = mine
          ? `<button type="button" data-act="assign-start" data-id="${a.id}" title="Your work in this profile">Open my work ▶</button>`
          : `<button type="button" data-act="assign-start" data-id="${a.id}" ${!open || a.closedAt ? 'disabled' : ''} title="${a.closedAt ? 'This assignment is closed' : !open ? 'This class is archived' : 'Make your own copy of the starter in this profile'}">Start</button>`;
        const turnIn =
          mine && open && !a.closedAt
            ? `<button type="button" data-act="assign-turnin" data-id="${a.id}" title="Send your teacher a snapshot of this work as it is now${a.requireRun ? ' (run it first)' : ''}; you can keep working and turn in again">Turn in</button>`
            : '';
        return `<div class="assign-card${a.closedAt ? ' closed' : ''}">${assignHead(a)}
          <div class="control-row"><span class="assign-status ${statusClass(status)}">${esc(status)}</span>
          ${start}${turnIn}
          ${a.starterName ? `<button type="button" data-act="assign-run" data-id="${a.id}" title="Run the starter without copying it">Run starter</button>` : ''}</div>
          ${myAttemptsHtml(a, subs)}</div>`;
      })
      .join('');
    return `<div class="class-subtitle">Assignments</div>${cards || '<div class="floor-empty">Nothing assigned yet.</div>'}
      <div class="muted">Your teacher can read the work you start here and what you turn in, and nothing else in your profile.</div>`;
  }

  /** Turn in the student's linked program: save it, then send the snapshot. */
  async function turnInProgram(program) {
    if (!program || !program.assignmentId) return null;
    await programs.saveNow();
    try {
      const s = await api.turnIn(program.assignmentId, program.id);
      hint(`Turned in “${program.name}” — attempt ${s.attempt}. Your teacher sees this version; keep working and turn in again any time.`);
      if (openId) await openClass(openId);
      return s;
    } catch (err) {
      fail(err);
      return null;
    }
  }

  /** A teacher's view of one student's attempts, newest first, with the review controls unless the class is archived. */
  function teacherAttemptsHtml(list, frozen, name) {
    if (!list.length) return '<div class="floor-empty">Nothing turned in.</div>';
    return list
      .slice()
      .reverse()
      .map((t) => {
        const comment = t.review ? t.review.comment : '';
        const controls = frozen
          ? comment
            ? `<div class="attempt-comment">${esc(comment)}</div>`
            : ''
          : `<textarea data-comment maxlength="4000" placeholder="Feedback for the student">${esc(comment)}</textarea>
            <div class="control-row"><button type="button" data-sub-act="save">Save comment</button>
            <button type="button" data-sub-act="returned" title="Save the comment and ask for more work">Return</button>
            <button type="button" data-sub-act="reviewed" title="Save the comment and mark it done">Mark reviewed</button></div>
            ${
              t.shared
                ? ''
                : `<div class="control-row attempt-publish"><select data-attribution title="How classmates see who wrote it"><option value="anonymous">anonymously</option><option value="name">as ${esc(name)}</option></select>
              <input data-note maxlength="500" placeholder="Note for the class (optional)">
              <button type="button" data-sub-act="publish" title="Every student in the class will be able to run and copy this attempt">Publish to class</button></div>`
            }`;
        return `<div class="attempt" data-sub="${t.id}"><div class="attempt-head"><span class="assign-title">Attempt ${t.attempt}</span>
          <span class="muted">${fmtTime(t.submittedAt)}</span><span class="assign-status ${statusClass(t.status)}">${esc(t.status)}</span><span class="muted">${runText(t.run)}</span>${sharedTag(t.shared, 'the')}
          <button type="button" data-sub-act="view">Open read-only</button>
          <button type="button" data-sub-act="duplicate" title="An editable copy in your current profile; the student's work does not change">Duplicate</button></div>
          ${controls}</div>`;
      })
      .join('');
  }

  async function showAttempts(a, cell, name, frozen, box) {
    const list = await api.studentSubmissions(a.id, cell.dataset.attemptsFor);
    cell.innerHTML = teacherAttemptsHtml(list, frozen, name);
    for (const el of cell.querySelectorAll('[data-sub]')) {
      const t = list.find((x) => x.id === el.dataset.sub);
      for (const b of el.querySelectorAll('[data-sub-act]')) {
        b.addEventListener('click', async () => {
          const what = b.dataset.subAct;
          try {
            if (what === 'view') {
              await onView({ label: `${name}'s attempt ${t.attempt}${t.run ? ` (${runText(t.run)})` : ''}`, program: t.program, floor: t.floor });
            } else if (what === 'duplicate') {
              const profile = profiles.current;
              if (!profile) return;
              const result = await api.duplicateSubmission(t.id, profile.id);
              hint(`Copied ${name}'s attempt ${t.attempt} into ${profile.name} as “${result.program.name}”.`);
              if (onCopied) await onCopied(result);
            } else if (what === 'publish') {
              const attribution = el.querySelector('[data-attribution]').value;
              const how = attribution === 'name' ? `under ${name}'s name` : 'anonymously';
              if (!window.confirm(`Publish ${name}'s attempt ${t.attempt} to the whole class ${how}? Every student in the class will be able to run and copy it.`)) return;
              const r = await api.publishSubmission(t.id, { attribution, note: el.querySelector('[data-note]').value });
              hint(`Published “${r.name}” to the class ${how}.`);
              if (openId) await openClass(openId);
            } else {
              const patch = { comment: el.querySelector('[data-comment]').value };
              if (what !== 'save') patch.status = what;
              await api.reviewSubmission(t.id, patch);
              hint(what === 'save' ? `Comment saved for ${name}.` : `${name}'s attempt ${t.attempt} marked ${what}.`);
              await showProgress(a, box, cell.dataset.attemptsFor);
            }
          } catch (err) {
            fail(err);
          }
        });
      }
    }
  }

  async function showProgress(a, box, openFor = null) {
    const { students } = await api.assignmentProgress(a.id);
    const frozen = box.dataset.frozen === '1';
    const rows = students
      .map(
        (s) => `<tr><td>${esc(s.username)}${s.state !== 'active' ? ` <span class="class-tag">${esc(s.state)}</span>` : ''}</td>
          <td class="assign-status ${statusClass(s.status)}">${esc(s.status)}${s.latestAttempt ? ` <span class="muted">(attempt ${s.latestAttempt.attempt}, ${fmtTime(s.latestAttempt.submittedAt)})</span>` : ''}</td>
          <td class="muted">${s.lastEditAt ? 'last edit ' + fmtTime(s.lastEditAt) : ''}${s.editedSinceSubmit ? ' · edited since turned in' : ''}</td>
          <td>${s.programs.length ? `<button type="button" data-draft="${s.membershipId}" data-name="${esc(s.username)}" title="The live draft">Open read-only</button>` : ''}
            ${s.attempts ? `<button type="button" data-attempts="${s.membershipId}" data-name="${esc(s.username)}">Turned in (${s.attempts})</button>` : ''}</td></tr>
          <tr hidden><td colspan="4" class="attempts-cell" data-attempts-for="${s.membershipId}"></td></tr>`,
      )
      .join('');
    box.innerHTML = students.length
      ? `<table class="class-table"><tr><th>Student</th><th>Progress</th><th></th><th></th></tr>${rows}</table>`
      : '<div class="floor-empty">No students yet.</div>';
    box.hidden = false;
    for (const b of box.querySelectorAll('[data-attempts]')) {
      const cell = box.querySelector(`[data-attempts-for="${b.dataset.attempts}"]`);
      const toggle = async () => {
        const row = cell.parentElement;
        if (!row.hidden) return (row.hidden = true);
        await showAttempts(a, cell, b.dataset.name, frozen, box);
        row.hidden = false;
      };
      b.addEventListener('click', () => toggle().catch(fail));
      if (b.dataset.attempts === openFor) await toggle();
    }
    for (const b of box.querySelectorAll('[data-draft]')) {
      b.addEventListener('click', async () => {
        try {
          const drafts = await api.assignmentDrafts(a.id, b.dataset.draft);
          const d = drafts[0];
          if (!d) return hint('No work to show yet.');
          const run = d.latestRun ? ` (last run: ${d.latestRun.verdict || d.latestRun.status})` : ' (not run yet)';
          await onView({ label: `${b.dataset.name}'s “${d.program.name}”${run}`, program: d.program, floor: d.floor });
          if (drafts.length > 1) hint(`${b.dataset.name} has ${drafts.length} copies in different profiles; showing the most recently edited.`);
        } catch (err) {
          fail(err);
        }
      });
    }
  }

  /** Start (or reopen) the student's own copy of an assignment in the current profile. */
  async function startAssignment(a) {
    const profile = profiles.current;
    if (!profile) return null;
    try {
      const result = await api.startAssignment(a.id, profile.id);
      hint(
        result.created
          ? `Started “${result.program.name}” in ${profile.name}${result.floor ? ` on the floor “${result.floor.name}”${result.floor.locked ? ' (read-only)' : ''}` : ''}. Your teacher can read this program.`
          : `Opened your work on ${a.title}.`,
      );
      if (onStarted) await onStarted(result);
      return result;
    } catch (err) {
      fail(err);
      return null;
    }
  }

  function publishOptions() {
    const ps = programs.all.map((p) => `<option value="program:${p.id}">${esc(p.name)}</option>`).join('');
    const fs = floorLib.custom.map((f) => `<option value="floor:${f.id}">${esc(f.name)}</option>`).join('');
    return `<option value="">Choose…</option>${ps ? `<optgroup label="Programs">${ps}</optgroup>` : ''}${fs ? `<optgroup label="My floors">${fs}</optgroup>` : ''}`;
  }

  /** A peer example's byline and note (d-37); the teacher also sees whose it is and whether it is hidden. */
  function exampleHtml(e) {
    if (!e) return '';
    const from = e.author ? ` <span class="muted">from ${esc(e.author.username)}${e.attribution === 'anonymous' ? ' (shown anonymously)' : ''}</span>` : '';
    const hidden = e.hidden ? ' <span class="class-tag">hidden: author not in the class</span>' : '';
    return `<div class="example-byline">Example by ${esc(e.byline)}${from}${hidden}</div>${e.note ? `<div class="example-note">${esc(e.note)}</div>` : ''}`;
  }

  function resourcesHtml(resources, { teacher, canCopy }) {
    if (!resources.length) return '<div class="floor-empty">Nothing published yet.</div>';
    const what = (r) =>
      (r.kind === 'program' ? 'program' + (r.floorName ? ' + floor “' + esc(r.floorName) + '”' : '') : 'floor') + (r.exerciseRef ? ', exercise ' + esc(r.exerciseRef) : '');
    return `<table class="class-table">${resources
      .map(
        (r) => `<tr><td>${esc(r.name)}${r.unpublishedAt ? ' <span class="class-tag">unpublished</span>' : ''}${exampleHtml(r.example)}</td><td class="muted">${what(r)}</td><td class="muted">${fmtDate(r.publishedAt)}</td>
      <td>${r.kind === 'program' ? `<button type="button" data-act="resource-run" data-id="${r.id}" data-name="${esc(r.name)}" title="Run it read-only without copying">Run</button> ` : ''}${
        teacher
          ? r.unpublishedAt
            ? ''
            : `<button type="button" data-act="unpublish" data-id="${r.id}">Unpublish</button>`
          : canCopy
            ? `<button type="button" data-act="copy" data-id="${r.id}" title="An editable copy in your current profile">Get a copy</button>`
            : ''
      }</td></tr>`,
      )
      .join('')}</table>`;
  }

  function teacherHtml(cls, roster, resources, assignments, sent = []) {
    const closed = !!cls.archivedAt;
    const rows = roster
      .map(
        (m) => `<tr><td>${esc(m.username)}</td><td>${esc(m.state)}${m.state === 'removed' && m.rejoinAllowed ? ' (may rejoin)' : ''}</td><td>${fmtDate(m.joinedAt)}</td>
          <td>${
            m.state === 'active' && !closed
              ? `<button type="button" data-act="reset" data-id="${m.id}" data-name="${esc(m.username)}">Reset password</button> <button type="button" data-act="remove" data-id="${m.id}">Remove</button> <label title="They may rejoin with the code"><input type="checkbox" data-rejoin="${m.id}"> may rejoin</label>`
              : ''
          }</td></tr>`,
      )
      .join('');
    return `
      <div class="pane-title"><span>${esc(cls.name)} ${closed ? '<span class="class-tag">archived</span>' : ''}</span></div>
      <div class="class-subtitle">Join code</div>
      <div class="control-row"><span class="class-code">${esc(cls.joinCode)}</span>
        <button type="button" data-act="copy-code">Copy code</button>
        <button type="button" data-act="copy-link" title="A link that opens the sandbox with the code filled in">Copy link</button>
        <button type="button" data-act="rotate" ${closed ? 'disabled' : ''} title="A new code; the old one stops working">Regenerate</button>
        <button type="button" data-act="archive" ${closed ? 'disabled' : ''} title="Close the class: no more joins; everyone keeps it as archived">Archive</button></div>
      <div class="class-subtitle">Students <span class="muted">(${roster.length})</span></div>
      ${roster.length ? `<table class="class-table"><tr><th>Username</th><th>State</th><th>Joined</th><th></th></tr>${rows}</table>` : '<div class="floor-empty">Nobody has joined yet. Share the code or the link.</div>'}
      ${teacherAssignmentsHtml(cls, assignments)}
      <div class="class-subtitle">Sent to you <span class="muted">(${sent.length})</span></div>
      ${sentCopiesHtml(sent, { teacher: true, frozen: closed })}
      <div class="class-subtitle">Published to this class</div>
      ${resourcesHtml(resources, { teacher: true, canCopy: false })}
      ${closed ? '' : `<div class="control-row"><label>Publish <select data-publish>${publishOptions()}</select></label><button type="button" data-act="publish" title="A snapshot for the class; your later edits do not change it">Publish to class</button></div>`}
    `;
  }

  function studentHtml(cls, resources, assignments, mySubs, sent = []) {
    return `<div class="pane-title"><span>${esc(cls.name)} ${cls.archivedAt ? '<span class="class-tag">archived</span>' : ''}</span></div>
      <div class="muted">Teacher: ${esc(cls.teacher.username || '')} · you are ${esc(cls.membership.state)}</div>
      ${studentAssignmentsHtml(cls, assignments, mySubs)}
      <div class="class-subtitle">Sent to your teacher <span class="muted">(${sent.length})</span></div>
      ${sentCopiesHtml(sent, { teacher: false, frozen: true })}
      <div class="muted">Only your teacher sees what you send; classmates never do.</div>
      <div class="class-subtitle">Published to your class</div>
      ${resourcesHtml(resources, { teacher: false, canCopy: cls.membership.state === 'active' })}`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('Copy this:', text);
    }
  }

  function wire(cls, assignments = [], mySubs = {}) {
    const byId = (id) => assignments.find((a) => a.id === id);
    const act = async (name, el) => {
      const id = el.dataset.id;
      try {
        if (name === 'assign-start') {
          await startAssignment(byId(id));
          await openClass(cls.id);
        } else if (name === 'assign-turnin') {
          await turnInProgram(startedHere(byId(id)));
        } else if (name === 'attempt-view') {
          const t = (mySubs[id] || []).find((x) => x.id === el.dataset.attempt);
          if (t) await onView({ label: `your attempt ${t.attempt} at ${byId(id).title}`, program: t.program, floor: t.floor });
        } else if (name === 'assign-run') {
          const a = await api.getAssignment(id);
          await onView({ label: `the starter for ${a.title}`, program: a.starter.program, floor: a.starter.floor });
        } else if (name === 'resource-run') {
          const snap = await api.resourceSnapshot(id);
          await onView({ label: `“${snap.resource.name}” from ${cls.name}`, program: snap.program, floor: snap.floor });
        } else if (name === 'assign-progress') {
          const box = els.detail.querySelector(`[data-progress="${id}"]`);
          if (box && !box.hidden) box.hidden = true;
          else if (box) await showProgress(byId(id), box);
        } else if (name === 'assign-edit') {
          const a = byId(id);
          const instructions = window.prompt('Instructions for students:', a.instructions || '');
          if (instructions === null) return;
          const due = window.prompt('Due date (YYYY-MM-DD), or leave empty for none:', a.dueAt ? a.dueAt.slice(0, 10) : '');
          if (due === null) return;
          await api.editAssignment(id, { instructions, dueAt: due.trim() ? new Date(due.trim() + 'T23:59').toISOString() : null });
          await openClass(cls.id);
        } else if (name === 'assign-close' || name === 'assign-reopen') {
          if (name === 'assign-close' && !window.confirm('Close this assignment? Students who have not started can no longer start it; work already started stays theirs.')) return;
          await (name === 'assign-close' ? api.closeAssignment(id) : api.reopenAssignment(id));
          await openClass(cls.id);
        } else if (name === 'copy-code') {
          await copyText(cls.joinCode);
          hint('Join code copied: ' + cls.joinCode);
        } else if (name === 'copy-link') {
          const link = location.origin + cls.joinUrl;
          await copyText(link);
          hint('Join link copied: ' + link);
        } else if (name === 'rotate') {
          if (!window.confirm('Make a new join code? The old one will stop working.')) return;
          await api.rotateClassCode(cls.id);
          await openClass(cls.id);
        } else if (name === 'archive') {
          if (!window.confirm(`Archive "${cls.name}"? Nobody can join any more, and everyone keeps it as archived.`)) return;
          await api.archiveClass(cls.id);
          await refresh();
        } else if (name === 'remove') {
          const rejoin = els.detail.querySelector(`[data-rejoin="${id}"]`);
          if (!window.confirm('Remove this student from the class?')) return;
          await api.removeMember(cls.id, id, !!(rejoin && rejoin.checked));
          await openClass(cls.id);
        } else if (name === 'reset') {
          resetTarget = { classId: cls.id, membershipId: id };
          els.resetName.textContent = el.dataset.name;
          els.resetForm.reset();
          els.resetDialog.showModal();
        } else if (name === 'unpublish') {
          await api.unpublishResource(id);
          await openClass(cls.id);
        } else if (name === 'publish') {
          const select = els.detail.querySelector('[data-publish]');
          const [kind, sourceId] = String(select ? select.value : '').split(':');
          if (!sourceId) return;
          await programs.saveNow();
          const r = await api.publishResource(cls.id, kind === 'program' ? { programId: sourceId } : { floorId: sourceId });
          hint(`Published "${r.name}" to ${cls.name}.`);
          await openClass(cls.id);
        } else if (name === 'copy') {
          const profile = profiles.current;
          if (!profile) return;
          const result = await api.copyResource(id, profile.id);
          hint(`Copied "${result.program ? result.program.name : result.floor.name}" into ${profile.name}.`);
          if (onCopied) await onCopied(result);
        }
      } catch (err) {
        fail(err);
      }
    };
    for (const el of els.detail.querySelectorAll('[data-act]')) el.addEventListener('click', () => act(el.dataset.act, el));

    const form = els.detail.querySelector('[data-assign-form]');
    form &&
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = form.elements;
        const [lesson, exercise] = f.exercise.value.split('.').map(Number);
        const body = { lesson, exercise, instructions: f.instructions.value, allowFloorEdit: f.allowFloorEdit.checked, requireRun: f.requireRun.checked };
        if (f.starter.value) body.starterProgramId = f.starter.value;
        if (f.floor.value) body.floorId = f.floor.value;
        if (f.due.value) body.dueAt = new Date(f.due.value + 'T23:59').toISOString();
        try {
          await programs.saveNow();
          const a = await api.createAssignment(cls.id, body);
          hint(`Assigned ${a.title} to ${cls.name}.`);
          await openClass(cls.id);
        } catch (err) {
          fail(err);
        }
      });
  }

  els.resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!resetTarget) return;
    try {
      const r = await api.resetMemberPassword(resetTarget.classId, resetTarget.membershipId, els.resetForm.elements.password.value);
      els.resetDialog.close();
      hint(`Password set. ${r.revokedSessions} signed-in browser${r.revokedSessions === 1 ? ' was' : 's were'} signed out.`);
    } catch (err) {
      fail(err);
    }
  });
  els.resetCancel.addEventListener('click', () => els.resetDialog.close());

  els.btnNew.addEventListener('click', async () => {
    const name = window.prompt('Name for the class (for example, "Robotics 101"):');
    if (!name || !name.trim()) return;
    try {
      const r = await api.createClass({ name: name.trim() });
      openId = r.class.id;
      await refresh();
      hint(`Class "${r.class.name}" created. Join code: ${r.class.joinCode}`);
    } catch (err) {
      fail(err);
    }
  });

  els.joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = els.codeInput.value.trim();
    if (!code) return;
    try {
      const r = await api.joinClass(code);
      els.codeInput.value = '';
      if (/[?&]join=/.test(location.search)) history.replaceState(null, '', location.pathname);
      openId = r.class.id;
      await refresh();
      hint(`You joined "${r.class.name}".`);
    } catch (err) {
      fail(err);
    }
  });

  els.btnAccount.addEventListener('click', () => account.open().catch(fail));

  /** A join link opened the page: put the code in the box (the user still presses Join). */
  function prefillJoin(code) {
    if (code) els.codeInput.value = code;
    return !!code;
  }

  function setActive(active) {
    if (active) refresh().catch(fail);
  }

  return {
    refresh,
    setActive,
    prefillJoin,
    openClass,
    startAssignment,
    turnInProgram,
    sendCopy,
    publishProgram,
    get classes() {
      return classes;
    },
  };
}
