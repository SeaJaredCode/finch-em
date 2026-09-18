// The Workbook pane (Milestone 4, d-21): the fixed BirdBrain lesson catalogue (lessons.js) with,
// per profile, a done mark, an attached program and an optional floor for every exercise; progress
// per lesson and overall; the built-in floor a lesson implies; and a jump straight to a program on
// its floor. Lesson text is never shown here — each lesson links to its page on BirdBrain's site.
//
//   const workbook = createWorkbook({ root, programs, library, onOpenExercise, onHint, onError, onSaved, classes, account });
//   workbook.load(profileId); workbook.setActive(true); workbook.setEntry(9, 3, { done: true })
// A class context (itch-15, d-34) shows that class's assignments instead of the personal checklist.
// It stores nothing: "started" means the current profile holds the program Start made for the
// assignment (programs.all, assignmentId), so personal progress is never touched.
import { api } from './api.js';
import { LESSONS, TOTAL_EXERCISES, suggestedFloor, exerciseRef } from './lessons.js';

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const key = (lesson, exercise) => `${lesson}.${exercise}`;

export function createWorkbook({ root, programs, library, onOpenExercise, onHint, onError, onSaved, classes, account }) {
  const els = {
    overall: root.querySelector('#workbook-overall'),
    bar: root.querySelector('#workbook-bar'),
    lessons: root.querySelector('#workbook-lessons'),
    note: root.querySelector('.wb-note'),
    context: root.querySelector('#workbook-context'),
    contextWrap: root.querySelector('.wb-context'),
  };
  let context = null; // null = personal progress; else a class id (d-34)
  let contextClasses = []; // the user's classes, for the select
  let assigned = []; // the context class's assignments
  let profileId = null;
  let entries = new Map(); // "lesson.exercise" -> entry row
  let openLessons = new Set(); // lesson numbers whose <details> is open
  let active = false;

  const report = (m) => onError && onError(m);
  const entry = (lesson, exercise) => entries.get(key(lesson, exercise)) || null;
  const hasProgram = (id) => !!id && programs.all.some((p) => p.id === id);

  /** Load a profile's entries (replaces the previous profile's) and render. */
  async function load(pid) {
    profileId = pid;
    entries = new Map();
    openLessons = new Set();
    if (pid) {
      try {
        for (const e of await api.listWorkbook(pid)) entries.set(key(e.lesson, e.exercise), e);
      } catch (err) {
        report('Could not load your workbook: ' + err.message);
      }
    }
    // Open the lesson she is in the middle of (touched but not finished), else Lesson 1.
    const current = LESSONS.find((l) => {
      const p = lessonProgress(l);
      return p.touched && p.done < p.total;
    });
    openLessons.add((current || LESSONS[0]).n);
    render();
  }

  function lessonProgress(l) {
    let done = 0;
    let touched = false;
    for (let e = 1; e <= l.exercises; e++) {
      const en = entry(l.n, e);
      if (en) {
        touched = true;
        if (en.done) done++;
      }
    }
    return { done, total: l.exercises, touched };
  }

  /** { done, total, lessons: [{ n, done, total, touched }] } across the catalogue. */
  function progress() {
    const lessons = LESSONS.map((l) => ({ n: l.n, ...lessonProgress(l) }));
    return { done: lessons.reduce((n, l) => n + l.done, 0), total: TOTAL_EXERCISES, lessons };
  }

  function render() {
    if (els.note) els.note.hidden = !!context;
    if (context) return renderAssigned();
    const p = progress();
    els.overall.textContent = profileId ? `${p.done} of ${p.total} exercises done` : 'No profile is open.';
    els.bar.style.width = `${p.total ? Math.round((100 * p.done) / p.total) : 0}%`;
    els.lessons.innerHTML = '';
    for (const l of LESSONS) els.lessons.appendChild(renderLesson(l, p.lessons.find((x) => x.n === l.n)));
  }

  function renderLesson(l, lp) {
    const det = document.createElement('details');
    det.className = 'wb-lesson' + (lp.done === lp.total ? ' complete' : '');
    det.open = openLessons.has(l.n);
    det.dataset.lesson = String(l.n);
    det.addEventListener('toggle', () => {
      if (det.open) openLessons.add(l.n);
      else openLessons.delete(l.n);
    });
    const sum = document.createElement('summary');
    sum.innerHTML =
      `<span class="wb-name">${escapeHtml(l.name)}</span>` +
      `<a class="wb-link" href="${l.url}" target="_blank" rel="noopener" title="Open this lesson on BirdBrain's site (new tab)">lesson page ↗</a>` +
      `<span class="wb-count">${lp.done} / ${lp.total}</span>` +
      `<span class="wb-bar"><span style="width:${Math.round((100 * lp.done) / lp.total)}%"></span></span>`;
    sum.querySelector('a').addEventListener('click', (e) => e.stopPropagation()); // the link must not toggle the lesson
    det.appendChild(sum);
    const list = document.createElement('div');
    list.className = 'wb-exercises';
    for (let e = 1; e <= l.exercises; e++) list.appendChild(renderExercise(l, e));
    det.appendChild(list);
    return det;
  }

  function renderExercise(l, e) {
    const en = entry(l.n, e);
    const row = document.createElement('div');
    row.className = 'wb-exercise' + (en && en.done ? ' done' : '');
    row.dataset.exercise = key(l.n, e);
    // done mark
    const lab = document.createElement('label');
    lab.className = 'wb-done';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!(en && en.done);
    cb.disabled = !profileId;
    cb.title = 'Mark this exercise done';
    cb.addEventListener('change', () => setEntry(l.n, e, { done: cb.checked }));
    lab.append(cb, ` Exercise ${e}`);
    // the program she wrote for it
    const prog = document.createElement('select');
    prog.className = 'wb-program';
    prog.title = 'The program you wrote for this exercise';
    prog.disabled = !profileId;
    prog.innerHTML =
      '<option value="">— no program —</option>' +
      programs.all.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('') +
      '<option value="__new__">+ New program…</option>';
    prog.value = en && hasProgram(en.programId) ? en.programId : '';
    prog.addEventListener('change', async () => {
      if (prog.value === '__new__') {
        prog.value = en && hasProgram(en.programId) ? en.programId : '';
        await newProgram(l, e);
        return;
      }
      await setEntry(l.n, e, { programId: prog.value || null });
    });
    // the floor (optional — blank means the program's own floor)
    const fl = document.createElement('select');
    fl.className = 'wb-floor';
    fl.title = "The floor for this exercise (leave blank to use the program's own floor)";
    fl.disabled = !profileId;
    const opt = (f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`;
    fl.innerHTML =
      `<option value="">— program's floor —</option><optgroup label="Built-in">${library.builtin.map(opt).join('')}</optgroup>` +
      (library.custom.length ? `<optgroup label="My floors">${library.custom.map(opt).join('')}</optgroup>` : '');
    fl.value = en && en.floorId && library.has(en.floorId) ? en.floorId : '';
    fl.addEventListener('change', () => setEntry(l.n, e, { floorId: fl.value || null }));
    // the floor the lesson implies, and Open
    const actions = document.createElement('span');
    actions.className = 'wb-actions';
    const sug = suggestedFloor(l, e);
    if (sug && library.has(sug) && (!en || en.floorId !== sug)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wb-suggest';
      b.textContent = `Suggested: ${library.get(sug).name}`;
      b.title = 'The lesson implies this floor — click to use it for this exercise';
      b.disabled = !profileId;
      b.addEventListener('click', () => setEntry(l.n, e, { floorId: sug }));
      actions.appendChild(b);
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'wb-open';
    open.textContent = 'Open ▶';
    open.title = 'Open this program in the editor, on its floor';
    open.disabled = !(en && hasProgram(en.programId));
    open.addEventListener('click', () => onOpenExercise && onOpenExercise({ lesson: l.n, exercise: e, programId: en.programId, floorId: en.floorId || null }));
    actions.appendChild(open);
    row.append(lab, prog, fl, actions);
    return row;
  }

  /** Update one exercise's entry ({ done?, programId?, floorId? }; null clears) and re-render. */
  async function setEntry(lesson, exercise, patch) {
    if (!profileId) return null;
    try {
      const e = await api.updateWorkbookEntry(profileId, lesson, exercise, patch);
      entries.set(key(lesson, exercise), e);
      onSaved && onSaved(); // a banner from an earlier failed save is stale now
      if (patch.programId) {
        const p = programs.all.find((x) => x.id === patch.programId);
        if (p) p.exerciseRef = exerciseRef(lesson, exercise); // the server recorded it on the program too
      }
      render();
      return e;
    } catch (err) {
      report('Could not save the workbook: ' + err.message);
      render();
      return null;
    }
  }

  /** "+ New program…": a program named after the exercise, on its floor, attached and opened. */
  async function newProgram(l, e) {
    const en = entry(l.n, e);
    const floorId = (en && en.floorId) || suggestedFloor(l, e) || 'blank';
    const p = await programs.create({ name: `Lesson ${l.n} exercise ${e}`, floorId, exerciseRef: exerciseRef(l.n, e) });
    if (!p) return;
    await setEntry(l.n, e, { programId: p.id });
    onHint && onHint(`Made "${p.name}" and attached it to Lesson ${l.n} exercise ${e} in the Workbook.`);
    onOpenExercise && onOpenExercise({ lesson: l.n, exercise: e, programId: p.id, floorId: (en && en.floorId) || null });
  }

  // ---- class context (d-34) ------------------------------------------------------------------

  const startedProgram = (a) => programs.all.find((p) => p.assignmentId === a.id) || null;
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '');

  /** Refill the context select with the user's classes; the select stays hidden without any. */
  async function refreshContexts() {
    if (!els.context) return;
    const acct = account ? account() : null;
    contextClasses = [];
    if (acct && acct.username) {
      try {
        contextClasses = await api.listClasses();
      } catch (err) {
        report('Could not load your classes: ' + err.message);
      }
    }
    if (context && !contextClasses.some((c) => c.id === context)) context = null;
    els.context.innerHTML =
      '<option value="">My own progress</option>' +
      contextClasses.map((c) => `<option value="${c.id}">Assigned in ${escapeHtml(c.name)}</option>`).join('');
    els.context.value = context || '';
    if (els.contextWrap) els.contextWrap.hidden = !contextClasses.length;
  }

  /** Show personal progress (null) or one class's assignments. */
  async function setContext(classId) {
    context = classId || null;
    assigned = [];
    if (els.context) els.context.value = context || '';
    if (context) {
      try {
        assigned = await api.listAssignments(context);
      } catch (err) {
        report('Could not load the assignments: ' + err.message);
      }
    }
    render();
  }
  if (els.context) els.context.addEventListener('change', () => setContext(els.context.value));

  function renderAssigned() {
    const cls = contextClasses.find((c) => c.id === context);
    const started = assigned.filter((a) => startedProgram(a)).length;
    els.overall.textContent = assigned.length
      ? `${started} of ${assigned.length} assigned exercises started in ${cls ? cls.name : 'this class'}`
      : `Nothing has been assigned in ${cls ? cls.name : 'this class'} yet.`;
    els.bar.style.width = `${assigned.length ? Math.round((100 * started) / assigned.length) : 0}%`;
    els.lessons.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'wb-assigned';
    const student = cls && cls.membership.role === 'student';
    const open = cls && cls.membership.state === 'active';
    for (const a of [...assigned].sort((x, y) => x.lesson - y.lesson || x.exercise - y.exercise)) {
      const mine = startedProgram(a);
      const card = document.createElement('div');
      card.className = 'assign-card' + (a.closedAt ? ' closed' : '');
      card.innerHTML =
        `<div class="assign-head"><span class="assign-title">${escapeHtml(a.title)}</span>` +
        (a.lessonUrl ? `<a class="wb-link" href="${a.lessonUrl}" target="_blank" rel="noopener">${escapeHtml(a.lessonName || 'lesson page')} ↗</a>` : '') +
        (a.dueAt ? `<span class="muted">due ${fmtDate(a.dueAt)}</span>` : '') +
        (a.closedAt ? '<span class="class-tag">closed</span>' : '') +
        (student ? `<span class="assign-status ${mine ? 'started' : 'not-started'}">${mine ? 'started' : 'not started'}</span>` : '') +
        '</div>' +
        (a.instructions ? `<div class="assign-instructions">${escapeHtml(a.instructions)}</div>` : '');
      if (student) {
        const row = document.createElement('div');
        row.className = 'control-row';
        const b = document.createElement('button');
        b.type = 'button';
        if (mine) {
          b.textContent = 'Open my work ▶';
          b.addEventListener('click', () => onOpenExercise && onOpenExercise({ lesson: a.lesson, exercise: a.exercise, programId: mine.id, floorId: null }));
        } else {
          b.textContent = 'Start';
          b.disabled = !profileId || !open || !!a.closedAt;
          b.title = a.closedAt ? 'This assignment is closed' : !open ? 'This class is archived' : 'Make your own copy of the starter in this profile';
          b.addEventListener('click', async () => {
            const ui = classes && classes();
            if (ui) await ui.startAssignment(a);
          });
        }
        row.appendChild(b);
        card.appendChild(row);
      }
      box.appendChild(card);
    }
    els.lessons.appendChild(box);
  }

  /** The Workbook section was shown (re-render: programs and floors may have changed) or hidden. */
  function setActive(v) {
    active = !!v;
    if (!active) return;
    render();
    refreshContexts()
      .then(() => setContext(context))
      .catch((err) => report(err.message));
  }

  return {
    load,
    render,
    setActive,
    setEntry,
    setContext,
    progress,
    get context() {
      return context;
    },
    get active() {
      return active;
    },
    get entries() {
      return [...entries.values()];
    },
    get openLessons() {
      return openLessons;
    },
  };
}
