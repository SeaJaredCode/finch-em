// Finch Sandbox — page wiring. Everything on the page meets here.
import { api } from './api.js';
import { World } from './sim/world.js';
import { createArena } from './arena.js';
import { createPanel } from './panel.js';
import { createConsole } from './console.js';
import { createEditor } from './editor.js';
import { createRunner, nextMacrotask } from './runner.js';
import { installBirdBrain } from './birdbrain.js';
import { createAudio, midiToFreq } from './audio.js';
import { createPrograms } from './programs.js';
import { createProfiles } from './profiles.js';
import { createAccount } from './account.js';
import { createClasses } from './classes.js';
import { shareActions, renderShareMenu } from './share.js';
import { createFloorLibrary } from './floorlib.js';
import { createFloorEditor } from './flooreditor.js';
import { createRecorder } from './recorder.js';
import { createRuns } from './runs.js';
import { createGoalTracker } from './goals.js';
import { createWorkbook } from './workbook.js';
import { createDebugPanel } from './debugpanel.js';
import { errorHint } from './hints.js';

const $ = (id) => document.getElementById(id);
const SPEEDS = [0.5, 1, 2, 4, 8];

// A banner is either sticky (the page itself is in trouble: a CDN did not load, the workspace could not
// be loaded) or reports one failed operation — a save, a delete, a hand-off. The second kind is stale as
// soon as a later save goes through, so every module's onSaved clears it; sticky banners stay put.
let bannerClearable = false;
function banner(message, kind = 'error', { sticky = false } = {}) {
  const el = $('banner');
  el.textContent = message;
  el.className = 'banner ' + kind;
  el.hidden = !message;
  bannerClearable = !!message && !sticky;
}
/** A save (program, floor, workbook, drawing) went through: a banner from an earlier failed operation is over. */
function savedOk() {
  if (bannerClearable) banner('');
}

async function boot() {
  if (!window.Sk || !window.Sk.builtinFiles) {
    banner('The Python runtime (Skulpt) did not load from cdn.jsdelivr.net. Check your connection and reload.', 'error', { sticky: true });
    return;
  }

  // ---- simulation ----
  const world = new World();
  const floorLib = createFloorLibrary({ onChange: () => floorsChanged() });
  world.setFloor(floorLib.get('blank'));
  const audio = createAudio();

  const consoleUi = createConsole($('console'), { getTime: () => world.time });
  const recorder = createRecorder({ world, consoleUi }); // records every run (Milestone 3)
  const editor = createEditor($('code'), {
    onChange: (code) => programs.codeChanged(code),
    onSandboxCalls: (lines) => showSandboxWarning(lines),
    onBreakpointsChange: (lines) => runner.setBreakpoints(lines),
  });
  if (!editor.hasCodeMirror) banner('CodeMirror did not load from cdnjs; using a plain editor.', 'warn', { sticky: true });

  const arena = createArena($('arena'), { world });
  const panel = createPanel($('panel'), {
    world,
    onPlaceAtStart: (robot) => world.placeAtStart(robot || world.robots[0]),
    onSaveDrawing: () => saveInkAsDrawing(),
    onSteadyChange: (steady) => profiles.savePrefs({ steadyReadouts: steady }),
  });

  const bridge = {
    world,
    getRobot: (name) => world.robot(name),
    note: (msg) => consoleUi.note(msg),
  };
  installBirdBrain(bridge);

  const runner = createRunner({
    world,
    out: {
      write: (t) => consoleUi.write(t),
      prompt: (p) => consoleUi.prompt(p),
      cancelPrompt: () => consoleUi.cancelPrompt(),
    },
    onState: (state) => onRunnerState(state),
    onHalt: (halt, mode) => onHalt(halt, mode),
  });

  // The debugger box under the editor (Milestone 5, d-23): variables, call stack, watch.
  const debugPanel = createDebugPanel($('debugger'), { evalWatch: (expr) => runner.evalWatch(expr) });

  world.onBump = (robot) => {
    const who = world.twoRobots ? `Finch ${robot.name} ran into a wall, the edge of the floor or the other Finch` : 'the Finch ran into a wall or the edge of the floor';
    consoleUi.hint(`Bump: ${who} at (${robot.x.toFixed(0)}, ${robot.y.toFixed(0)}) cm.`);
  };

  // ---- profiles & programs ----
  const profiles = createProfiles({
    els: { select: $('profile-select'), btnNew: $('profile-new'), btnDelete: $('profile-delete'), swatch: $('profile-swatch') },
    onSwitch: async (profile) => {
      await runner.stop();
      await floorEditor.saveNow();
      consoleUi.clear();
      applyPrefs(profile.prefs);
      await loadFloorLibrary(profile.id);
      await runsUi.load(profile.id);
      await programs.load(profile.id, profile.prefs.lastProgramId);
      await workbookUi.load(profile.id);
    },
    onError: (m) => banner(m),
  });

  // The account button and dialog (itch-13, d-31): sign in, create an account, split, sign out, claim.
  const account = createAccount({ els: { button: $('account'), dialog: $('account-dialog') }, profiles, onError: (m) => banner(m) });

  const programs = createPrograms({
    els: {
      list: $('program-list'),
      name: $('program-name'),
      status: $('save-status'),
      btnNew: $('btn-new'),
      btnDuplicate: $('btn-duplicate'),
      btnDelete: $('btn-delete'),
      btnDownload: $('btn-download'),
      fileImport: $('file-import'),
      btnTurnIn: $('btn-turnin'),
    },
    editor,
    // "Copy to <profile>" in the Share menu (d-25, d-39): the other profiles a copy can go to.
    otherProfiles: () => profiles.all.filter((p) => !profiles.current || p.id !== profiles.current.id),
    onHint: (m) => consoleUi.hint(m),
    onOpen: (program) => {
      leaveViewer(); // opening one of her own programs ends a read-only view (d-34)
      runner.stop();
      debugPanel.clear();
      loadFloor(program ? program.floorId : 'blank');
      if (program) profiles.savePrefs({ lastProgramId: program.id });
      updateControls(runner.state);
    },
    onError: (m) => banner(m),
    onSaved: () => savedOk(),
    // The program's floor changed (run-bar picker, Workbook Open, "Use for <program>"): the Floors pane's button follows.
    onFloorChanged: () => floorEditor.refreshList(),
    // Turn in (itch-16, d-35) on assignment work: a snapshot for the teacher.
    onTurnIn: (program) => classesUi.turnInProgram(program),
  });

  // ---- floors (Milestone 2) ----
  const floorSelect = $('floor-select');
  const floorEditor = createFloorEditor({
    root: $('floors-pane'),
    world,
    library: floorLib,
    // Browsing the library, New blank floor and Copy only show the floor in the arena (d-10 fix pass):
    // the open program keeps the floor it remembers until she presses "Use for <program>" here, picks
    // a floor in the run bar, or opens an exercise from the Workbook.
    onSelectFloor: (id) => previewFloor(id),
    onUseFloor: (id) => selectFloor(id),
    openProgram: () => programs.current,
    onSaved: () => savedOk(),
    onFloorDeleted: async (id) => {
      programs.forgetFloor(id); // the server already moved the programs that used it to 'blank'
      // The arena showed the deleted floor: back to the open program's own (a preview, not an assignment).
      if (world.floor && world.floor.id === id) await previewFloor(programs.current ? programs.current.floorId : 'blank');
      else floorsChanged();
    },
    onFloorResized: () => {
      arena.floorChanged();
      for (const r of world.robots) {
        const c = world.clampInside(r.x, r.y);
        r.x = c.x;
        r.y = c.y;
      }
    },
    onFloorMetaChanged: () => floorsChanged(),
    // A second start mark placed or removed in the editor adds or drops Finch B at once (d-24).
    onFloorEdited: () => world.syncRobots(),
    onHint: (text) => {
      $('arena-help').textContent = text
        ? 'Edit mode — ' + text
        : 'Drag the robot to move it · Shift-drag to rotate · Wheel to zoom · Drag the floor to pan';
    },
    onError: (m) => banner(m),
  });
  arena.setEditor(floorEditor);

  // ---- runs, replays and the gallery (Milestone 3) ----
  const runsUi = createRuns({
    root: $('runs-pane'),
    arena,
    panel,
    consoleUi,
    onOpen: () => runner.stop(), // a replay takes over the arena, so the live program stops
    onHint: (text) => {
      $('arena-help').textContent = text || 'Drag the robot to move it · Shift-drag to rotate · Wheel to zoom · Drag the floor to pan';
    },
    onError: (m) => banner(m),
    onSaved: () => savedOk(),
  });

  // ---- the Workbook (Milestone 4, d-21) ----
  const workbookUi = createWorkbook({
    root: $('workbook-pane'),
    programs,
    library: floorLib,
    // "Open" on an exercise: its program in the editor, on the exercise's floor (if it names one).
    onOpenExercise: async ({ programId, floorId }) => {
      showSection('programs');
      await programs.open(programId);
      if (floorId && floorLib.has(floorId)) await selectFloor(floorId);
    },
    onHint: (text) => consoleUi.hint(text),
    onError: (m) => banner(m),
    onSaved: () => savedOk(),
    // The class context (d-34): the user's classes and their assignments, and Start / Open from there.
    classes: () => classesUi,
    account: () => profiles.account,
  });

  // ---- Classes (itch-14, d-32) ----
  const classesUi = createClasses({
    els: {
      root: $('classes-pane'),
      anon: $('classes-anon'),
      body: $('classes-body'),
      btnNew: $('class-new'),
      btnAccount: $('classes-account'),
      joinForm: $('class-join'),
      codeInput: $('class-code'),
      list: $('class-list'),
      detail: $('class-detail'),
      resetDialog: $('reset-dialog'),
      resetForm: document.querySelector('#reset-dialog form'),
      resetName: $('reset-name'),
      resetCancel: document.querySelector('#reset-dialog .reset-cancel'),
    },
    profiles,
    programs,
    floorLib,
    account,
    // "Get a copy" and an assignment's Start (d-34): the program landed in the current profile; show it
    // in the editor on its floor.
    onCopied: (result) => showNewWork(result),
    onStarted: (result) => showNewWork(result),
    // "Run" on a resource or starter, "Open read-only" on a student's draft (d-34).
    onView: (view) => openViewer(view),
    onHint: (m) => consoleUi.hint(m),
    onError: (m) => banner(m),
  });

  // ---- the Share menu (itch-18, d-39) ----
  // Built each time it opens, from shareActions() over a fresh class list, so it never offers what a
  // join, removal or archive has since changed; the server stays the authority and its refusals show
  // in the banner.
  const shareMenu = $('share-menu');
  const shareBox = shareMenu.querySelector('.share-items');
  shareMenu.addEventListener('toggle', () => {
    if (shareMenu.open) buildShareMenu().catch((err) => banner(err.message));
  });
  document.addEventListener('click', (e) => {
    if (shareMenu.open && !shareMenu.contains(e.target)) shareMenu.open = false;
  });

  async function buildShareMenu() {
    const program = programs.current;
    shareBox.textContent = program ? 'Loading…' : '';
    if (!program) return renderShareMenu(shareBox, [], () => {});
    const registered = !!(profiles.account && profiles.account.username);
    const classes = registered ? await api.listClasses() : [];
    const assignment = program.assignmentId ? await api.getAssignment(program.assignmentId).catch(() => null) : null;
    const others = profiles.all.filter((p) => !profiles.current || p.id !== profiles.current.id);
    const items = shareActions({ program, otherProfiles: others, classes, assignment });
    renderShareMenu(shareBox, items, (item) => {
      shareMenu.open = false;
      runShareAction(item, program, classes).catch((err) => banner(err.message));
    });
  }

  async function runShareAction(item, program, classes) {
    const cls = classes.find((c) => c.id === item.target);
    if (item.id === 'duplicate') return programs.duplicate();
    if (item.id === 'copy') return programs.copyToProfile(item.target);
    if (item.id === 'turnin') return classesUi.turnInProgram(program);
    if (item.id === 'send' && cls) {
      const teacher = (cls.teacher && cls.teacher.username) || 'your teacher';
      const message = window.prompt(`Send ${teacher} a copy of “${program.name}” (${cls.name}). Only ${teacher} will see it.\nAdd a message, for example what you need help with (optional):`, '');
      if (message === null) return;
      return classesUi.sendCopy(program, cls, message);
    }
    if (item.id === 'publish' && cls) {
      if (!window.confirm(`Publish “${program.name}” to ${cls.name}? Every student in the class will be able to run and copy it. Your later edits do not change what they see.`)) return;
      return classesUi.publishProgram(program, cls);
    }
  }

  async function showNewWork({ program }) {
    const profile = profiles.current;
    if (!profile) return;
    await loadFloorLibrary(profile.id);
    if (program) {
      showSection('programs');
      await programs.load(profile.id, program.id);
    } else floorsChanged();
    if (workbookUi.active) workbookUi.render();
  }

  // ---- the read-only viewer (itch-15, d-34) ----
  // An assignment starter, a published class resource or a student's draft, shown in the editor
  // read-only on its own floor and runnable in place. The open program is let go first
  // (programs.detach), so nothing shown here can be saved into it; runs are not recorded.
  let viewing = null; // { label, program, floor, backTo }
  const viewerBar = $('viewer-bar');

  async function openViewer({ label, program, floor }) {
    if (!program) return;
    await runner.stop();
    await floorEditor.saveNow();
    const backTo = viewing ? viewing.backTo : await programs.detach();
    const floorObj = floor
      ? { ...floor, id: 'view:' + (program.id || label), builtin: true, description: floor.description || '' }
      : floorLib.get(program.floorId || 'blank');
    viewing = { label, program, floor: floorObj, backTo };
    showSection('programs');
    editor.setValue(program.code || '');
    editor.setReadOnly(true);
    debugPanel.clear();
    consoleUi.clear();
    $('program-name').value = program.name;
    loadFloorObject(floorObj);
    floorSelect.disabled = true;
    $('viewer-label').textContent = `Viewing ${label} — read-only. Run it as often as you like; nothing here is saved.`;
    viewerBar.hidden = false;
    updateControls(runner.state);
  }

  /** Drop the viewer state (no reopening); returns the program id it was covering. */
  function leaveViewer() {
    if (!viewing) return null;
    const back = viewing.backTo;
    viewing = null;
    editor.setReadOnly(false);
    floorSelect.disabled = false;
    viewerBar.hidden = true;
    return back;
  }

  async function exitViewer() {
    if (!viewing) return;
    await runner.stop();
    const back = leaveViewer();
    if (back && programs.all.some((p) => p.id === back)) await programs.open(back);
    else if (programs.all.length) await programs.open(programs.all[0].id);
    else {
      editor.setValue('');
      $('program-name').value = '';
      loadFloor('blank');
      updateControls(runner.state);
    }
  }
  $('viewer-exit').addEventListener('click', () => exitViewer());

  // Goals (Milestone 4, d-20): one tracker per run, ticked beside the recorder, judged at the end.
  let goalTracker = null;
  // The header clock freezes at the end of a run (so it reads the run's length, not the clock that keeps
  // going afterwards) and shows the live clock again when the next run starts or a floor is loaded.
  let timeShown = null;

  /** The panel's "Save drawing…": keep the ink currently on the floor. */
  function saveInkAsDrawing() {
    runsUi.saveDrawing({
      strokes: world.ink,
      floor: world.floor,
      runId: runsUi.lastRunId,
      programName: programs.current ? programs.current.name : '',
      floorName: world.floor.name,
    });
  }

  /** Lines that call the sandbox-only pen (editor.js) get a gentle warning above the editor. */
  function showSandboxWarning(lines) {
    const el = $('sandbox-warning');
    el.hidden = !lines.length;
    if (lines.length) {
      const many = lines.length > 1;
      el.textContent =
        `Line${many ? 's' : ''} ${lines.join(', ')} use${many ? '' : 's'} the sandbox-only pen (penDown / penUp / setPenColor). ` +
        'The real Finch has no pen — take these lines out before downloading the program for it.';
    }
  }

  async function loadFloorLibrary(profileId) {
    try {
      await floorLib.load(profileId);
    } catch (err) {
      banner('Could not load your floors: ' + err.message + '. Built-in floors are still available.', 'warn', { sticky: true });
    }
  }

  /** Rebuild the floor picker (built-in + custom groups) and the library list. */
  function floorsChanged() {
    const current = world.floor ? world.floor.id : floorSelect.value;
    const opt = (f) => `<option value="${f.id}" title="${(f.description || '').replace(/"/g, '&quot;')}">${escapeHtml(f.name)}</option>`;
    let html = `<optgroup label="Built-in">${floorLib.builtin.map(opt).join('')}</optgroup>`;
    if (floorLib.custom.length) html += `<optgroup label="My floors">${floorLib.custom.map(opt).join('')}</optgroup>`;
    floorSelect.innerHTML = html;
    if (floorLib.has(current)) floorSelect.value = current;
    if (world.floor) $('floor-description').textContent = world.floor.description || '';
    floorEditor.refreshList();
  }
  floorSelect.addEventListener('change', () => selectFloor(floorSelect.value));

  /**
   * She chose a floor for the open program — the run-bar picker, the Workbook's Open, the Floors pane's
   * "Use for <program>" button: show it and remember it on the program.
   */
  async function selectFloor(id) {
    await runner.stop();
    loadFloor(id);
    await programs.setFloor(world.floor.id);
  }

  /** The Floors pane is browsing or editing a floor: show it in the arena; the open program keeps its own. */
  async function previewFloor(id) {
    await runner.stop();
    loadFloor(id);
  }

  /** True while the arena shows a floor other than the open program's own (a Floors-pane preview). */
  function arenaOffProgramFloor() {
    const p = programs.current;
    return !!p && !!world.floor && world.floor.id !== floorLib.get(p.floorId).id;
  }

  function loadFloor(id) {
    loadFloorObject(floorLib.get(id));
  }

  /** Show a floor object: a library floor, or a snapshot the viewer brought (d-34). */
  function loadFloorObject(floor) {
    world.setFloor(floor);
    world.resetRun();
    timeShown = null;
    arena.floorChanged();
    if (floorLib.has(floor.id)) floorSelect.value = floor.id;
    $('floor-description').textContent = floor.description || '';
    floorEditor.setFloor(floor);
  }

  // ---- header sections ----
  const sections = { programs: $('code-pane'), floors: $('floors-pane'), runs: $('runs-pane'), workbook: $('workbook-pane'), classes: $('classes-pane') };
  let currentSection = 'programs';
  function showSection(name) {
    if (!sections[name]) return;
    const leavingFloors = currentSection === 'floors' && name !== 'floors';
    currentSection = name;
    for (const [key, el] of Object.entries(sections)) el.hidden = key !== name;
    for (const b of document.querySelectorAll('.sections .section')) b.classList.toggle('active', b.dataset.section === name);
    floorEditor.setActive(name === 'floors');
    runsUi.setActive(name === 'runs');
    workbookUi.setActive(name === 'workbook');
    classesUi.setActive(name === 'classes');
    if (name === 'programs') editor.refresh();
    // Leaving the Floors pane: the open program's own floor returns to the arena — a floor she was only
    // browsing or editing there was never the program's (d-10). A run still in progress on it is left
    // alone; the next Run from the Programs section puts the program's floor back first.
    if (leavingFloors && !runner.busy && arenaOffProgramFloor()) previewFloor(programs.current.floorId);
    arena.fit();
  }
  for (const b of document.querySelectorAll('.sections .section[data-section]')) {
    b.addEventListener('click', () => showSection(b.dataset.section));
  }

  // ---- run controls ----
  const speedSelect = $('speed-select');
  speedSelect.innerHTML = SPEEDS.map((s) => `<option value="${s}">${s === 0.5 ? '½×' : s + '×'}</option>`).join('');
  speedSelect.value = '1';
  speedSelect.addEventListener('change', () => profiles.savePrefs({ speed: Number(speedSelect.value) }));
  const muteBox = $('mute');
  muteBox.addEventListener('change', () => {
    audio.setMuted(muteBox.checked);
    profiles.savePrefs({ muted: muteBox.checked });
  });
  const fontSelect = $('font-size');
  fontSelect.addEventListener('change', () => {
    editor.setFontSize(Number(fontSelect.value));
    profiles.savePrefs({ fontSize: Number(fontSelect.value) });
  });

  function applyPrefs(prefs) {
    const speed = SPEEDS.includes(Number(prefs.speed)) ? Number(prefs.speed) : 1;
    speedSelect.value = String(speed);
    muteBox.checked = !!prefs.muted;
    audio.setMuted(muteBox.checked);
    const fs = Number(prefs.fontSize) || 14;
    fontSelect.value = String(fs);
    editor.setFontSize(fs);
    panel.setSteady(!!prefs.steadyReadouts);
  }

  // Run requests are numbered: one that is still saving or waiting for the old program to unwind
  // when a newer request arrives gives way, so two programs never share the robot (d-23). The token
  // is checked after every await and before every side effect — in particular a superseded request
  // must not call runner.stop(), which would kill the run that replaced it.
  let runToken = 0;
  let runInFlight = null; // the current run, settled once finishRun has dealt with it

  /** Run (or, with { step: true }, start stepping) the open program from line 1. */
  async function startRun(opts = {}) {
    const view = viewing; // a read-only view runs its own program and floor and is never recorded (d-34)
    const program = view ? view.program : programs.current;
    if (!program) return;
    const token = ++runToken;
    audio.unlock();
    if (!view) await programs.saveNow();
    if (token !== runToken) return;
    await runner.stop();
    if (token !== runToken) return;
    // The run just stopped finishes up first (its 'Stopped.' line, recording and debugger box
    // belong to its own console) before this one clears the console and starts recording.
    try {
      await runInFlight;
    } catch {
      /* reported by that run */
    }
    if (token !== runToken) return;
    runsUi.close(); // a replay on the arena gives way to the live robot
    // From the Programs section a program runs on its own floor; only while the Floors pane is open does
    // a run use the floor being edited there (so she can test a floor as she builds it, d-10).
    if (view) {
      if (world.floor !== view.floor) loadFloorObject(view.floor);
    } else if (!floorEditor.active && arenaOffProgramFloor()) loadFloor(program.floorId);
    world.resetRun();
    timeShown = null;
    const tracker = createGoalTracker(world);
    goalTracker = tracker;
    consoleUi.clear();
    editor.setErrorLine(null);
    editor.setCurrentLine(null);
    debugPanel.showRunning(null, true); // fresh: the previous run's variables are gone
    consoleUi.info(
      opts.step
        ? `Stepping "${program.name}" on ${world.floor.name} — press Step for each line, Continue to run on.`
        : `Running "${program.name}" on ${world.floor.name}…`,
    );
    const code = editor.getValue();
    recorder.start({ profileId: !view && profiles.current ? profiles.current.id : null, program, code, speed: Number(speedSelect.value) });
    runInFlight = runner.run(code, { step: !!opts.step }).then((result) => finishRun(result, tracker, code));
    await runInFlight;
  }

  /** A program that ended early leaves the robot still: motors off and no move in progress. */
  function parkRobot() {
    if (runner.busy) return; // a newer program already owns the robot
    for (const robot of world.robots) {
      robot.motors = { left: 0, right: 0 };
      robot.pending = null;
    }
  }

  function finishRun(result, tracker, code) {
    if (!result) return;
    timeShown = world.time; // the header clock stops here: the run's length, not the clock that keeps going
    consoleUi.flush();
    editor.setCurrentLine(null);
    if (result.status === 'finished') {
      consoleUi.info(`Program finished in ${world.time.toFixed(2)} s.`);
      const rolling = world.robots.filter((r) => r.motorsOn());
      if (rolling.length) {
        const who = world.twoRobots ? rolling.map((r) => `Finch ${r.name}`).join(' and ') + ' keeps rolling until it meets a wall, the edge of the floor or the other Finch' : 'the Finch keeps rolling until it meets a wall or the edge of the floor';
        consoleUi.hint(`The program ended with the motors still on, so ${who}. Call bird.stop() or bird.stopAll() at the end of your program.`);
      }
    } else if (result.status === 'error') {
      const e = result.error;
      const where = e.line ? ` (line ${e.line})` : '';
      consoleUi.error(`${e.type}: ${e.message}${where}`);
      if (e.line) editor.setErrorLine(e.line);
      // "What this usually means" (Milestone 5, d-23) for the mistakes the lessons provoke.
      const hint = errorHint(e, code);
      if (hint) consoleUi.hint('What this usually means: ' + hint);
      parkRobot();
    } else if (result.status === 'stopped') {
      consoleUi.info('Stopped.');
      parkRobot();
    }
    debugPanel.showFinal(runner.globalsFrame(), result.status);
    // The goal verdict (Milestone 4): judged now, shown in the console, stored on the run. A run she
    // stopped herself only gets a verdict when a goal had already failed (e.g. the wall was touched).
    if (goalTracker === tracker) goalTracker = null;
    const verdict = tracker && !(result.status === 'stopped' && !tracker.failed) ? tracker.finish(result.status) : null;
    if (verdict) consoleUi.verdict(verdict);
    saveRun(result, verdict);
  }

  /** Every run is recorded (Milestone 3): the recorder's document goes to /api/profiles/:id/runs. */
  async function saveRun(result, verdict) {
    const rec = recorder.finish(result.status, result.error, verdict);
    if (!rec || !rec.profileId) return;
    try {
      const run = await api.createRun(rec.profileId, rec.body);
      runsUi.add(run);
    } catch (err) {
      consoleUi.hint('This run could not be saved to Runs: ' + err.message);
    }
  }

  $('btn-run').addEventListener('click', () => startRun());
  $('btn-pause').addEventListener('click', () => {
    if (runner.state === 'running') runner.pause();
    else if (runner.state === 'paused') runner.resume();
  });
  $('btn-step').addEventListener('click', () => {
    if (!runner.step()) startRun({ step: true }); // nothing running: start the program parked before line 1
  });
  $('btn-restart').addEventListener('click', () => startRun());
  $('btn-stop').addEventListener('click', async () => {
    await runner.stop();
    for (const r of world.robots) r.turnOffAll();
    consoleUi.info('Stopped; motors, lights and display are off.');
  });
  $('btn-fit').addEventListener('click', () => arena.fit());
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      startRun();
    }
  });

  /**
   * The runner changed state. A user Pause (not a debugger halt) lights the line in progress and
   * shows its variables in the debugger box; Resume goes back to the running status.
   */
  function onRunnerState(state) {
    if (state === 'paused' && !runner.halt) {
      const frames = runner.currentFrames();
      const top = frames[frames.length - 1];
      editor.setCurrentLine(top && top.line ? top.line : null);
      debugPanel.showPaused(frames);
    } else if (state === 'running' && !runner.halt && !runner.stepping) {
      editor.setCurrentLine(null);
      debugPanel.showRunning();
    }
    updateControls(state);
  }

  /** The debugger parked the program before a line, or (null) moved on by Step, Continue or Stop. */
  function onHalt(halt, mode) {
    // After Step the line stays lit while it runs (a setMove takes a while); the next halt moves it.
    if (halt) editor.setCurrentLine(halt.line);
    else if (mode !== 'step') editor.setCurrentLine(null);
    if (halt) debugPanel.showHalt(halt);
    else if (mode !== 'stop') debugPanel.showRunning(mode === 'step' ? editor.currentLine : null);
    if (halt && halt.reason === 'breakpoint') consoleUi.info(`Breakpoint: paused before line ${halt.line}.`);
    updateControls(runner.state);
  }

  function updateControls(state) {
    const running = state === 'running';
    const paused = state === 'paused';
    const halt = runner.halt;
    const has = !!programs.current || !!viewing;
    $('btn-run').disabled = running || paused || !has;
    $('btn-pause').disabled = !(running || paused);
    $('btn-pause').textContent = halt ? '▶ Continue' : paused ? 'Resume' : 'Pause';
    $('btn-step').disabled = !has;
    $('btn-restart').disabled = !has;
    $('btn-stop').disabled = !has; // always available: it also halts a robot left rolling
    const label =
      paused && halt
        ? `Paused at line ${halt.line}`
        : { idle: 'Ready', running: 'Running', paused: 'Paused', finished: 'Finished', error: 'Error' }[state] || state;
    $('run-state').textContent = label;
    $('run-state').dataset.state = state;
  }

  // ---- the clock ----
  // The simulation ticks on a timer (so it keeps going like the real robot even when the tab is
  // hidden and requestAnimationFrame is throttled); drawing happens on animation frames.
  let lastTick = performance.now();
  function tick() {
    const now = performance.now();
    const realDt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    if (!runner.paused) {
      const simDt = realDt * Number(speedSelect.value);
      const steps = Math.min(60, Math.max(1, Math.ceil(simDt / 0.01)));
      const h = simDt / steps;
      for (let i = 0; i < steps; i++) {
        world.tick(h);
        recorder.sample();
        if (goalTracker) goalTracker.tick();
      }
    }
    // one buzzer through the speaker: whichever Finch is playing (d-24)
    const playing = runner.paused ? null : world.robots.find((r) => r.buzzer && world.time < r.buzzer.until);
    audio.setTone(playing ? midiToFreq(playing.buzzer.note) : null);
  }
  function frame() {
    $('sim-time').textContent = (timeShown === null ? world.time : timeShown).toFixed(2) + ' s';
    arena.draw();
    panel.update();
    debugPanel.refreshWatch(false); // the watch expression follows the simulation while it runs
    requestAnimationFrame(frame);
  }

  // Automation / debugging hook (also used by later milestones' browser checks):
  // finchSandbox.advance(seconds) steps the simulation synchronously, independent of the timers.
  window.finchSandbox = {
    world,
    runner,
    editor,
    programs,
    profiles,
    floors: floorLib,
    floorEditor,
    arena,
    panel,
    runs: runsUi,
    recorder,
    workbook: workbookUi,
    classes: classesUi,
    viewer: {
      open: openViewer,
      exit: exitViewer,
      get current() {
        return viewing;
      },
    },
    console: consoleUi,
    run: startRun,
    step: () => (runner.step() ? Promise.resolve() : startRun({ step: true })),
    debugPanel,
    selectFloor,
    previewFloor,
    showSection,
    get goalTracker() {
      return goalTracker;
    },
    async advance(seconds, step = 0.01) {
      const Sk = window.Sk;
      const savedYield = Sk.yieldLimit;
      Sk.yieldLimit = 2; // short Python slices so busy loops interleave with the ticks
      try {
        const n = Math.round(seconds / step);
        for (let i = 0; i < n; i++) {
          if (!runner.paused) {
            world.tick(step);
            recorder.sample();
            if (goalTracker) goalTracker.tick();
          }
          await nextMacrotask();
        }
      } finally {
        Sk.yieldLimit = savedYield;
      }
    },
  };

  // ---- go ----
  updateControls('idle');
  floorsChanged();
  try {
    const profile = await profiles.load();
    account.render();
    if (!profile) throw new Error('no profile');
    applyPrefs(profile.prefs);
    await loadFloorLibrary(profile.id);
    await runsUi.load(profile.id);
    await programs.load(profile.id, profile.prefs.lastProgramId);
    await workbookUi.load(profile.id);
    banner('');
    setInterval(tick, 1000 / 60);
    requestAnimationFrame(frame);
    // A join link (/?join=CODE, d-32): open the Classes pane with the code filled in; the user still
    // presses Join. The query string survives the reload after creating an account, so it works then too.
    if (classesUi.prefillJoin(new URLSearchParams(location.search).get('join'))) showSection('classes');
    else if (!profile.prefs.visited && programs.current) {
      profiles.savePrefs({ visited: true });
      setTimeout(() => startRun(), 400);
    }
  } catch (err) {
    banner('Could not load your workspace: ' + err.message + '. Reload to try again.', 'error', { sticky: true });
    setInterval(tick, 1000 / 60);
    requestAnimationFrame(frame);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

boot().catch((err) => banner('Finch Sandbox failed to start: ' + err.message, 'error', { sticky: true }));
