// The floor editor (Milestone 2, d-10): an edit mode of the arena plus the "Floors" pane (library
// list, settings, tool palette, properties). It edits the very floor object world.floor points at,
// so anything placed is seen by the sensors at once — even while a program is running. Built-in
// floors are read-only; Copy makes an editable one. Undo/redo keeps JSON snapshots of the floor.
//
//   const editor = createFloorEditor({ root, world, library, onSelectFloor, onUseFloor, openProgram, ... });
//   onSelectFloor(id): show a floor in the arena (library click, New blank floor, Copy) — a preview that
//   leaves the open program's floor alone; onUseFloor(id): the "Use for <program>" button, this pane's one
//   explicit way to make the open program (openProgram() -> program | null) run on the floor shown.
//   arena.setEditor(editor)   // the arena forwards pointer events and asks for the overlay
import { dist, pointInRect, polylineDist, clamp, DEG, headingVec } from './sim/geometry.js';
import { floorData, FLOOR_DATA_KEYS } from './floorlib.js';
import { newGoal } from './goals.js';
import { renderGoalList } from './goalprops.js';

export const TOOLS = [
  { id: 'select', label: 'Select', hint: 'Click an object to select it, drag to move it, drag a corner to resize. Drag the arrow of the start mark or the edge of a lamp to turn / reach.' },
  { id: 'tape', label: 'Tape', hint: 'Click to add points; double-click (or press Enter) to finish the tape. Esc cancels.' },
  { id: 'curve', label: 'Curve', hint: 'Press and drag to draw a curved piece of tape freehand.' },
  { id: 'wall', label: 'Wall', hint: 'Drag a rectangle to place a wall.' },
  { id: 'box', label: 'Box', hint: 'Drag a rectangle to place a box (a solid obstacle the robot cannot pass).' },
  { id: 'light', label: 'Light', hint: 'Click to place a lamp; set its brightness and reach below.' },
  { id: 'dark', label: 'Dark area', hint: 'Drag a rectangle to shade a dark area: light readings drop inside it.' },
  { id: 'slope', label: 'Slope', hint: 'Drag a rectangle to mark a slope, then set which way is uphill below.' },
  { id: 'start', label: 'Start mark', hint: 'Click to put the start mark there; keep dragging to point it.' },
  { id: 'startB', label: 'Start B', hint: "Click to put the second Finch's start mark there (this makes it a two-robot floor); keep dragging to point it. Select it and press Remove selected to take Finch B off the floor." },
  { id: 'checkpoint', label: 'Checkpoint', hint: 'Click to place a checkpoint; the robot must visit them in order (reorder with the ▲▼ buttons below).' },
  { id: 'finish', label: 'Finish zone', hint: 'Drag a rectangle to place a finish zone the robot must reach.' },
];

export const TAPE_COLORS = [
  ['#111111', 'Black'],
  ['#d62828', 'Red'],
  ['#1d4ed8', 'Blue'],
  ['#15803d', 'Green'],
  ['#facc15', 'Yellow'],
  ['#f5f5f5', 'White'],
];

const GRID = 5; // cm
const UNDO_MAX = 100;
const MIN_SIZE = 30;
const MAX_SIZE = 400;
const RECT_TOOLS = { wall: 'wall', box: 'wall', dark: 'dark', slope: 'slope', finish: 'finish' };
const KIND_ARRAY = { wall: 'walls', dark: 'darkAreas', slope: 'slopes', light: 'lights', tape: 'tape', checkpoint: 'checkpoints', finish: 'finishZones' };
const TITLES = { start: 'Start mark', startB: 'Start mark B', light: 'Light', wall: 'Wall', dark: 'Dark area', slope: 'Slope', tape: 'Tape', checkpoint: 'Checkpoint', finish: 'Finish zone' };

const clone = (v) => JSON.parse(JSON.stringify(v));
const r1 = (v) => Math.round(v * 10) / 10;

export function createFloorEditor({ root, world, library, onSelectFloor, onUseFloor, openProgram, onSaved, onFloorDeleted, onFloorResized, onFloorMetaChanged, onFloorEdited, onHint, onError }) {
  const q = (sel) => root.querySelector(sel);
  const els = {
    list: q('#floor-list'),
    btnNew: q('#floor-new'),
    btnCopy: q('#floor-copy'),
    btnDelete: q('#floor-delete'),
    btnUse: q('#floor-use'),
    editor: q('#floor-editor'),
    locked: q('#floor-locked'),
    name: q('#floor-name'),
    width: q('#floor-width'),
    height: q('#floor-height'),
    background: q('#floor-background'),
    desc: q('#floor-desc'),
    palette: q('#tool-palette'),
    tapeColor: q('#tape-color'),
    tapeCustom: q('#tape-color-custom'),
    tapeWidth: q('#tape-width'),
    undo: q('#floor-undo'),
    redo: q('#floor-redo'),
    snap: q('#floor-snap'),
    deleteSel: q('#floor-delete-sel'),
    props: q('#floor-props'),
    goals: q('#floor-goals'),
    status: q('#floor-save-status'),
    hint: q('#floor-hint'),
  };

  let floor = null;
  let active = false;
  let tool = 'select';
  let selection = null; // { kind, index? }
  let drag = null;
  let pending = null; // tape being clicked out: { points, cursor }
  let undoStack = [];
  let redoStack = [];
  let snap = true;
  let dirty = false;
  let saveTimer = null;
  let tapeColor = '#111111';
  let tapeWidth = 2.5;
  let propsKey = null;

  // Built-in floors, snapshots shown by the viewer (builtin too) and an assignment's locked copy (d-34) are read-only.
  const editable = () => !!floor && !floor.builtin && !floor.locked;
  const snapV = (v) => (snap ? Math.round(v / GRID) * GRID : r1(v));
  const snapPt = (p) => ({ x: snapV(p.x), y: snapV(p.y) });
  const arrOf = (kind) => floor[KIND_ARRAY[kind]];
  const objOf = (sel) => (sel ? (sel.kind === 'start' ? floor.start : sel.kind === 'startB' ? floor.startB : arrOf(sel.kind)[sel.index]) : null);
  const isRect = (kind) => kind === 'wall' || kind === 'dark' || kind === 'slope' || kind === 'finish';
  const report = (m) => onError && onError(m);
  /** One undoable, autosaved mutation of the floor (also used by the goal list, goalprops.js). */
  function mutate(fn) {
    begin();
    fn();
    commit();
  }
  /** Placing the first finish zone / checkpoint adds the goal that uses it. */
  function ensureGoal(type) {
    if (!floor.goals.some((g) => g.type === type)) floor.goals.push(newGoal(type));
  }

  // ---- palette, tape options, settings ------------------------------------------------------

  els.palette.innerHTML = TOOLS.map((t) => `<button type="button" data-tool="${t.id}" title="${t.hint}">${t.label}</button>`).join('');
  els.tools = [...els.palette.querySelectorAll('[data-tool]')];
  for (const b of els.tools) b.addEventListener('click', () => setTool(b.dataset.tool));

  els.tapeColor.innerHTML = TAPE_COLORS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('') + '<option value="custom">Custom…</option>';
  els.tapeCustom.hidden = true;
  els.tapeColor.addEventListener('change', () => {
    if (els.tapeColor.value === 'custom') {
      els.tapeCustom.hidden = false;
      tapeColor = els.tapeCustom.value;
    } else {
      els.tapeCustom.hidden = true;
      tapeColor = els.tapeColor.value;
    }
    applyTapeStyle();
  });
  els.tapeCustom.addEventListener('input', () => {
    tapeColor = els.tapeCustom.value;
    applyTapeStyle();
  });
  els.tapeWidth.addEventListener('change', () => {
    tapeWidth = clamp(Number(els.tapeWidth.value) || 2.5, 0.5, 20);
    els.tapeWidth.value = String(tapeWidth);
    applyTapeStyle();
  });
  /** The tape options also restyle the selected piece of tape. */
  function applyTapeStyle() {
    if (!editable() || !selection || selection.kind !== 'tape') return;
    const t = objOf(selection);
    if (!t || (t.color === tapeColor && t.width === tapeWidth)) return;
    begin();
    t.color = tapeColor;
    t.width = tapeWidth;
    commit();
  }

  els.name.addEventListener('change', async () => {
    if (!editable()) return;
    const name = els.name.value.trim();
    if (!name) {
      els.name.value = floor.name;
      return;
    }
    try {
      await library.rename(floor, name);
      renderList();
      onSaved && onSaved();
      onFloorMetaChanged && onFloorMetaChanged(floor);
    } catch (err) {
      report('Could not rename the floor: ' + err.message);
    }
  });
  const sizeChanged = () => {
    if (!editable()) return;
    const w = clamp(Math.round(Number(els.width.value)) || floor.width, MIN_SIZE, MAX_SIZE);
    const h = clamp(Math.round(Number(els.height.value)) || floor.height, MIN_SIZE, MAX_SIZE);
    if (w === floor.width && h === floor.height) return refreshSettings();
    begin();
    floor.width = w;
    floor.height = h;
    clampStart();
    commit({ size: true });
  };
  els.width.addEventListener('change', sizeChanged);
  els.height.addEventListener('change', sizeChanged);
  els.background.addEventListener('change', () => {
    if (!editable()) return;
    begin();
    floor.background = els.background.value;
    commit();
  });
  els.desc.addEventListener('change', () => {
    if (!editable()) return;
    begin();
    floor.description = els.desc.value.slice(0, 300);
    commit({ meta: true });
  });
  els.snap.addEventListener('change', () => (snap = els.snap.checked));
  els.undo.addEventListener('click', undo);
  els.redo.addEventListener('click', redo);
  els.deleteSel.addEventListener('click', deleteSelection);

  // ---- library buttons ----------------------------------------------------------------------

  els.btnNew.addEventListener('click', async () => {
    await saveNow();
    try {
      const f = await library.createBlank();
      onSelectFloor && (await onSelectFloor(f.id));
      setTool('select');
    } catch (err) {
      report('Could not create the floor: ' + err.message);
    }
  });
  els.btnCopy.addEventListener('click', async () => {
    if (!floor) return;
    await saveNow();
    try {
      const f = await library.copy(floor);
      onSelectFloor && (await onSelectFloor(f.id));
      setTool('select');
    } catch (err) {
      report('Could not copy the floor: ' + err.message);
    }
  });
  els.btnDelete.addEventListener('click', async () => {
    if (!editable()) return;
    if (!window.confirm(`Delete the floor "${floor.name}"? Programs that used it go back to the blank floor.`)) return;
    const id = floor.id;
    clearTimeout(saveTimer);
    dirty = false;
    try {
      await library.remove(id);
    } catch (err) {
      report('Could not delete the floor: ' + err.message);
      return;
    }
    onFloorDeleted && (await onFloorDeleted(id));
  });
  // "Use for <program>": the one place in this pane that changes which floor the open program runs on.
  // Everything else here (clicking a floor, New blank floor, Copy, editing) only shows a floor in the arena.
  els.btnUse &&
    els.btnUse.addEventListener('click', async () => {
      if (!floor || !onUseFloor) return;
      await saveNow();
      await onUseFloor(floor.id);
      refreshUse();
    });

  // ---- rendering the pane ---------------------------------------------------------------------

  function renderList() {
    els.list.innerHTML = '';
    const group = (title) => {
      const d = document.createElement('div');
      d.className = 'floor-group';
      d.textContent = title;
      els.list.appendChild(d);
    };
    const item = (f) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'floor-item' + (floor && f.id === floor.id ? ' active' : '');
      b.textContent = f.name + (f.locked ? ' 🔒' : '');
      b.title = (f.description || f.name) + (f.locked ? ' — from a class assignment, read-only' : '');
      b.addEventListener('click', () => onSelectFloor && onSelectFloor(f.id));
      els.list.appendChild(b);
    };
    group('Built-in');
    library.builtin.forEach(item);
    group('My floors');
    if (!library.custom.length) {
      const empty = document.createElement('div');
      empty.className = 'floor-empty';
      empty.textContent = 'No custom floors yet. Pick a built-in and press Copy, or press New blank floor.';
      els.list.appendChild(empty);
    } else library.custom.forEach(item);
    refreshUse();
  }

  /** The "Use for <program>" button follows the open program and the floor shown. */
  function refreshUse() {
    const b = els.btnUse;
    if (!b) return;
    const p = openProgram ? openProgram() : null;
    if (!p || !floor) {
      b.disabled = true;
      b.textContent = 'Use for program';
      b.title = 'Open a program first';
      return;
    }
    const same = p.floorId === floor.id;
    b.disabled = same;
    b.textContent = same ? `"${p.name}" runs here` : `Use for "${p.name}"`;
    b.title = same
      ? `"${p.name}" already runs on this floor`
      : `From now on "${p.name}" runs on ${floor.name} (the same as picking it in the run bar's Floor menu)`;
  }

  function refreshSettings() {
    const has = !!floor;
    const ok = editable();
    els.editor.classList.toggle('locked', !ok);
    els.locked.hidden = ok || !has;
    if (has && !ok) {
      els.locked.innerHTML = floor.locked
        ? 'This floor came with a class assignment, so it cannot be edited. Press <b>Copy</b> to make an editable copy in your library.'
        : 'This is a built-in floor, so it cannot be edited. Press <b>Copy</b> to make an editable copy in your library.';
    }
    els.btnCopy.disabled = !has || !library.profileId;
    els.btnDelete.disabled = !ok;
    for (const el of [els.name, els.width, els.height, els.background, els.desc]) el.disabled = !ok;
    renderGoalList(els.goals, floor, { editable: ok, mutate });
    if (!has) return;
    const set = (el, v) => {
      if (document.activeElement !== el) el.value = v;
    };
    set(els.name, floor.name);
    set(els.width, floor.width);
    set(els.height, floor.height);
    set(els.background, floor.background || 'white');
    set(els.desc, floor.description || '');
    els.undo.disabled = !ok || !undoStack.length;
    els.redo.disabled = !ok || !redoStack.length;
  }

  function setStatus(text, cls = '') {
    els.status.textContent = text;
    els.status.className = 'save-status ' + cls;
  }

  function hint(text) {
    els.hint.textContent = text;
    onHint && onHint(active ? text : '');
  }

  function setTool(t) {
    tool = TOOLS.some((x) => x.id === t) ? t : 'select';
    cancelPending();
    for (const b of els.tools) b.classList.toggle('active', b.dataset.tool === tool);
    hint(TOOLS.find((x) => x.id === tool).hint);
  }

  // ---- properties of the selection ------------------------------------------------------------

  function refreshProps() {
    const key = selection ? `${selection.kind}:${selection.index ?? ''}` : 'none';
    if (key !== propsKey) {
      propsKey = key;
      buildProps();
    } else updatePropValues();
    els.deleteSel.disabled = !editable() || !selection || selection.kind === 'start';
  }

  function numberField(label, o, key, min, max, step, after) {
    const lab = document.createElement('label');
    lab.append(label + ' ');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.dataset.key = key;
    inp.value = String(o[key]);
    inp.addEventListener('change', () => {
      if (!editable()) return;
      const v = Number(inp.value);
      if (!Number.isFinite(v)) return;
      begin();
      o[key] = r1(clamp(v, min, max));
      after && after();
      commit();
    });
    lab.appendChild(inp);
    return lab;
  }

  function buildProps() {
    els.props.innerHTML = '';
    const o = objOf(selection);
    if (!selection || !o) {
      selection = null;
      els.props.innerHTML = '<div class="props-title muted">Nothing selected</div>';
      return;
    }
    const kind = selection.kind;
    const title = document.createElement('div');
    title.className = 'props-title';
    title.textContent = kind === 'wall' && o.kind === 'box' ? 'Box' : kind === 'start' && floor.startB ? 'Start mark A' : TITLES[kind];
    els.props.appendChild(title);
    const row = (...fields) => {
      const div = document.createElement('div');
      div.className = 'control-row';
      div.append(...fields);
      els.props.appendChild(div);
      return div;
    };
    const P = 1000;
    if (kind === 'start' || kind === 'startB') {
      row(numberField('x', o, 'x', 0, floor.width, 1, clampStart), numberField('y', o, 'y', 0, floor.height, 1, clampStart));
      row(numberField('heading', o, 'heading', 0, 359, 1, () => (o.heading = ((o.heading % 360) + 360) % 360)));
      const info = document.createElement('div');
      info.className = 'muted';
      info.textContent =
        kind === 'startB'
          ? "Finch B starts here — Finch('B') in a program drives it. Remove selected takes the second Finch off this floor."
          : floor.startB
            ? "Finch A starts here — Finch() or Finch('A') in a program."
            : 'One Finch. Use the Start B tool to add a second one to this floor (Lesson 14).';
      els.props.appendChild(info);
    } else if (kind === 'light') {
      row(numberField('x', o, 'x', -P, P, 1), numberField('y', o, 'y', -P, P, 1));
      row(numberField('brightness', o, 'brightness', 0, 100, 5), numberField('reach', o, 'reach', 5, P, 5));
    } else if (isRect(kind)) {
      row(numberField('x', o, 'x', -P, P, 1), numberField('y', o, 'y', -P, P, 1));
      row(numberField('width', o, 'w', 0.5, P, 1), numberField('height', o, 'h', 0.5, P, 1));
      if (kind === 'wall') {
        const lab = document.createElement('label');
        lab.append('kind ');
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="wall">Wall</option><option value="box">Box</option>';
        sel.value = o.kind === 'box' ? 'box' : 'wall';
        sel.dataset.key = 'kind';
        sel.addEventListener('change', () => {
          begin();
          if (sel.value === 'box') o.kind = 'box';
          else delete o.kind;
          commit();
          title.textContent = o.kind === 'box' ? 'Box' : 'Wall';
        });
        lab.appendChild(sel);
        row(lab);
      }
      if (kind === 'slope') {
        const r = row(numberField('uphill (°)', o, 'uphill', 0, 359, 5));
        r.classList.add('quick');
        for (const [name, deg] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = name;
          b.title = `Uphill towards ${name.toLowerCase() === 'n' ? 'north' : name === 'E' ? 'east' : name === 'S' ? 'south' : 'west'}`;
          b.addEventListener('click', () => {
            begin();
            o.uphill = deg;
            commit();
          });
          r.appendChild(b);
        }
      }
    } else if (kind === 'checkpoint') {
      row(numberField('x', o, 'x', -P, P, 1), numberField('y', o, 'y', -P, P, 1), numberField('radius', o, 'r', 2, 100, 1));
      const r = row();
      r.classList.add('quick');
      r.append(`#${selection.index + 1} of ${floor.checkpoints.length} · visit order:`);
      for (const [name, d] of [['▲ earlier', -1], ['▼ later', 1]]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.disabled = selection.index + d < 0 || selection.index + d >= floor.checkpoints.length;
        b.addEventListener('click', () => mutate(() => {
          const a = floor.checkpoints;
          const i = selection.index;
          [a[i], a[i + d]] = [a[i + d], a[i]];
          selection = { kind: 'checkpoint', index: i + d };
        }));
        r.appendChild(b);
      }
    } else if (kind === 'tape') {
      const info = document.createElement('div');
      info.className = 'muted';
      info.dataset.key = 'tapeinfo';
      info.textContent = `${o.points.length} points · ${o.width} cm wide · ${o.color}. Change colour and width with the tape options above.`;
      els.props.appendChild(info);
      els.tapeColor.value = TAPE_COLORS.some(([c]) => c === o.color) ? o.color : 'custom';
      els.tapeCustom.hidden = els.tapeColor.value !== 'custom';
      els.tapeCustom.value = o.color;
      els.tapeWidth.value = String(o.width);
      tapeColor = o.color;
      tapeWidth = o.width;
    }
  }

  function updatePropValues() {
    const o = objOf(selection);
    if (!o) return;
    for (const el of els.props.querySelectorAll('[data-key]')) {
      if (el === document.activeElement) continue;
      const k = el.dataset.key;
      if (k === 'kind') el.value = o.kind === 'box' ? 'box' : 'wall';
      else if (k === 'tapeinfo') el.textContent = `${o.points.length} points · ${o.width} cm wide · ${o.color}. Change colour and width with the tape options above.`;
      else if (o[k] !== undefined) el.value = String(o[k]);
    }
  }

  // ---- undo / redo / save -------------------------------------------------------------------

  const snapshot = () => JSON.stringify(floorData(floor));

  function begin() {
    undoStack.push(snapshot());
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
  }

  function restore(json) {
    const d = JSON.parse(json);
    const sizeChanged = d.width !== floor.width || d.height !== floor.height;
    for (const k of FLOOR_DATA_KEYS) floor[k] = d[k];
    if (selection && !objOf(selection)) selection = null;
    afterChange({ size: sizeChanged, meta: true });
  }

  function undo() {
    if (!editable() || !undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }

  function redo() {
    if (!editable() || !redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
  }

  /** Called after a mutation that began with begin(). Drops the undo entry if nothing changed. */
  function commit(opts = {}) {
    if (undoStack.length && undoStack[undoStack.length - 1] === snapshot()) {
      undoStack.pop();
      refreshProps();
      refreshSettings();
      return;
    }
    afterChange(opts);
  }

  function afterChange(opts = {}) {
    dirty = true;
    setStatus('Unsaved…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 600);
    refreshProps();
    refreshSettings();
    if (opts.size) onFloorResized && onFloorResized(floor);
    if (opts.meta) onFloorMetaChanged && onFloorMetaChanged(floor);
    onFloorEdited && onFloorEdited(floor); // the world re-checks its robots: startB may have come or gone (d-24)
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    if (!floor || !editable() || !dirty) return;
    const f = floor;
    dirty = false;
    setStatus('Saving…');
    try {
      await library.save(f);
      if (floor === f && !dirty) setStatus('Saved', 'ok');
      onSaved && onSaved(); // a banner from an earlier failed save is stale now
    } catch (err) {
      dirty = true;
      setStatus('Not saved', 'bad');
      report('Could not save the floor: ' + err.message);
    }
  }

  function clampStart() {
    for (const s of [floor.start, floor.startB]) {
      if (!s) continue;
      s.x = r1(clamp(s.x, 0, floor.width));
      s.y = r1(clamp(s.y, 0, floor.height));
    }
  }

  function deleteSelection() {
    if (!editable() || !selection || selection.kind === 'start') return;
    begin();
    if (selection.kind === 'startB') floor.startB = null; // the second Finch leaves the floor (d-24)
    else arrOf(selection.kind).splice(selection.index, 1);
    selection = null;
    commit();
  }

  // ---- geometry helpers ----------------------------------------------------------------------

  function hitTest(w, scale) {
    const f = floor;
    const tol = 6 / scale;
    if (f.startB && dist(w.x, w.y, f.startB.x, f.startB.y) <= 7) return { kind: 'startB' };
    if (dist(w.x, w.y, f.start.x, f.start.y) <= 7) return { kind: 'start' };
    for (let i = f.lights.length - 1; i >= 0; i--) {
      if (dist(w.x, w.y, f.lights[i].x, f.lights[i].y) <= Math.max(4, tol * 1.5)) return { kind: 'light', index: i };
    }
    for (let i = f.checkpoints.length - 1; i >= 0; i--) if (dist(w.x, w.y, f.checkpoints[i].x, f.checkpoints[i].y) <= (f.checkpoints[i].r || 8)) return { kind: 'checkpoint', index: i };
    for (let i = f.tape.length - 1; i >= 0; i--) {
      if (polylineDist(w.x, w.y, f.tape[i].points) <= (f.tape[i].width || 2.5) / 2 + tol) return { kind: 'tape', index: i };
    }
    for (let i = f.walls.length - 1; i >= 0; i--) if (pointInRect(w.x, w.y, f.walls[i])) return { kind: 'wall', index: i };
    for (let i = f.finishZones.length - 1; i >= 0; i--) if (pointInRect(w.x, w.y, f.finishZones[i])) return { kind: 'finish', index: i };
    for (let i = f.slopes.length - 1; i >= 0; i--) if (pointInRect(w.x, w.y, f.slopes[i])) return { kind: 'slope', index: i };
    for (let i = f.darkAreas.length - 1; i >= 0; i--) if (pointInRect(w.x, w.y, f.darkAreas[i])) return { kind: 'dark', index: i };
    return null;
  }

  function handlesOf(sel, o) {
    if (isRect(sel.kind)) {
      return [
        { id: 'nw', x: o.x, y: o.y + o.h },
        { id: 'ne', x: o.x + o.w, y: o.y + o.h },
        { id: 'sw', x: o.x, y: o.y },
        { id: 'se', x: o.x + o.w, y: o.y },
      ];
    }
    if (sel.kind === 'light') return [{ id: 'reach', x: o.x + (o.reach || 80), y: o.y }];
    if (sel.kind === 'checkpoint') return [{ id: 'r', x: o.x + (o.r || 8), y: o.y }];
    if (sel.kind === 'start' || sel.kind === 'startB') {
      const v = headingVec(o.heading);
      return [{ id: 'heading', x: o.x + v.x * 11, y: o.y + v.y * 11 }];
    }
    if (sel.kind === 'tape') return o.points.map((p, i) => ({ id: i, x: p[0], y: p[1] }));
    return [];
  }

  function hitHandle(w, scale) {
    const o = objOf(selection);
    if (!o) return null;
    const tol = 7 / scale;
    for (const h of handlesOf(selection, o)) if (dist(w.x, w.y, h.x, h.y) <= tol) return h;
    return null;
  }

  function normRect(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  function headingTo(from, to) {
    const ang = Math.atan2(to.x - from.x, to.y - from.y) / DEG;
    const h = snap ? Math.round(ang / 15) * 15 : Math.round(ang);
    return ((h % 360) + 360) % 360;
  }

  /** Freehand points -> smooth tape: two rounds of corner cutting, then ~2 cm spacing. */
  function smoothPath(pts) {
    let p = pts;
    for (let k = 0; k < 2 && p.length >= 3; k++) {
      const out = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const [ax, ay] = p[i];
        const [bx, by] = p[i + 1];
        out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
      }
      out.push(p[p.length - 1]);
      p = out;
    }
    const out = [p[0]];
    let acc = 0;
    for (let i = 1; i < p.length; i++) {
      acc += dist(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
      if (acc >= 2 || i === p.length - 1) {
        out.push(p[i]);
        acc = 0;
      }
    }
    return out.map(([x, y]) => [r1(x), r1(y)]);
  }

  function pathLength(pts) {
    let n = 0;
    for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    return n;
  }

  // ---- pointer interaction (called by the arena, coordinates in cm) ---------------------------

  /** Returns true when the editor takes the press; false lets the arena drag the robot or pan. */
  function mouseDown(w, info) {
    if (!active || !editable() || info.button === 1) return false;
    const p = snapPt(w);
    if (tool === 'select') {
      if (selection && hitHandle(w, info.scale)) {
        const h = hitHandle(w, info.scale);
        begin();
        drag = { kind: 'handle', sel: selection, handle: h.id, orig: clone(objOf(selection)) };
        return true;
      }
      if (info.robotHit) return false;
      const hit = hitTest(w, info.scale);
      selection = hit;
      refreshProps();
      if (hit) {
        begin();
        drag = { kind: 'move', sel: hit, orig: clone(objOf(hit)), from: w };
        return true;
      }
      return false;
    }
    if (RECT_TOOLS[tool]) {
      begin();
      drag = { kind: 'rect', tool, anchor: p, rect: null };
      return true;
    }
    if (tool === 'light') {
      begin();
      floor.lights.push({ x: p.x, y: p.y, brightness: 100, reach: 80 });
      selection = { kind: 'light', index: floor.lights.length - 1 };
      drag = { kind: 'placed' };
      commit();
      return true;
    }
    if (tool === 'checkpoint') {
      begin();
      floor.checkpoints.push({ x: p.x, y: p.y, r: 8 });
      ensureGoal('checkpoints');
      selection = { kind: 'checkpoint', index: floor.checkpoints.length - 1 };
      drag = { kind: 'placed' };
      commit();
      return true;
    }
    if (tool === 'start' || tool === 'startB') {
      begin();
      // the Start B tool puts a second Finch on the floor the first time it is used (d-24)
      if (tool === 'startB' && !floor.startB) floor.startB = { x: p.x, y: p.y, heading: floor.start.heading };
      const mark = tool === 'start' ? floor.start : floor.startB;
      mark.x = p.x;
      mark.y = p.y;
      clampStart();
      selection = { kind: tool };
      drag = { kind: 'start', mark, from: { x: mark.x, y: mark.y } };
      refreshProps();
      return true;
    }
    if (tool === 'tape') {
      if (!pending) pending = { points: [], cursor: null };
      const last = pending.points[pending.points.length - 1];
      if (!last || dist(last[0], last[1], p.x, p.y) > 0.5) pending.points.push([p.x, p.y]);
      pending.cursor = p;
      drag = { kind: 'placed' };
      return true;
    }
    if (tool === 'curve') {
      begin();
      drag = { kind: 'curve', points: [[r1(w.x), r1(w.y)]] };
      return true;
    }
    return false;
  }

  function mouseMove(w, info) {
    if (!active || !editable()) return;
    if (!drag) {
      if (pending) pending.cursor = snapPt(w);
      return;
    }
    const p = snapPt(w);
    if (drag.kind === 'rect') {
      drag.rect = normRect(drag.anchor, p);
    } else if (drag.kind === 'move') {
      const o = objOf(drag.sel);
      const org = drag.orig;
      const dx = w.x - drag.from.x;
      const dy = w.y - drag.from.y;
      if (drag.sel.kind === 'tape') {
        const nx = snapV(org.points[0][0] + dx);
        const ny = snapV(org.points[0][1] + dy);
        const ddx = nx - org.points[0][0];
        const ddy = ny - org.points[0][1];
        o.points = org.points.map(([x, y]) => [r1(x + ddx), r1(y + ddy)]);
      } else {
        o.x = snapV(org.x + dx);
        o.y = snapV(org.y + dy);
        if (drag.sel.kind === 'start' || drag.sel.kind === 'startB') clampStart();
      }
    } else if (drag.kind === 'handle') {
      const o = objOf(drag.sel);
      const org = drag.orig;
      const id = drag.handle;
      if (isRect(drag.sel.kind)) {
        let x0 = org.x;
        let x1 = org.x + org.w;
        let y0 = org.y;
        let y1 = org.y + org.h;
        if (id === 'nw' || id === 'sw') x0 = p.x;
        else x1 = p.x;
        if (id === 'nw' || id === 'ne') y1 = p.y;
        else y0 = p.y;
        o.x = r1(Math.min(x0, x1));
        o.y = r1(Math.min(y0, y1));
        o.w = r1(Math.max(1, Math.abs(x1 - x0)));
        o.h = r1(Math.max(1, Math.abs(y1 - y0)));
      } else if (id === 'reach') {
        o.reach = Math.max(5, Math.round(dist(o.x, o.y, w.x, w.y)));
      } else if (id === 'r') {
        o.r = Math.max(2, Math.round(dist(o.x, o.y, w.x, w.y)));
      } else if (id === 'heading') {
        o.heading = headingTo(o, w);
      } else if (drag.sel.kind === 'tape') {
        o.points[id] = [p.x, p.y];
      }
    } else if (drag.kind === 'start') {
      if (dist(w.x, w.y, drag.from.x, drag.from.y) > 3) drag.mark.heading = headingTo(drag.from, w);
    } else if (drag.kind === 'curve') {
      const last = drag.points[drag.points.length - 1];
      if (dist(last[0], last[1], w.x, w.y) >= 1.5) drag.points.push([r1(w.x), r1(w.y)]);
    }
    if (drag.kind !== 'rect' && drag.kind !== 'curve') updatePropValues();
  }

  function mouseUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'rect') {
      if (d.rect && d.rect.w >= 1 && d.rect.h >= 1) {
        const o = { x: r1(d.rect.x), y: r1(d.rect.y), w: r1(d.rect.w), h: r1(d.rect.h) };
        if (d.tool === 'box') o.kind = 'box';
        if (d.tool === 'slope') o.uphill = 0;
        const kind = RECT_TOOLS[d.tool];
        arrOf(kind).push(o);
        if (d.tool === 'finish') ensureGoal('finish');
        selection = { kind, index: arrOf(kind).length - 1 };
        commit();
      } else undoStack.pop();
    } else if (d.kind === 'curve') {
      const pts = smoothPath(d.points);
      if (pts.length >= 2 && pathLength(pts) >= 3) {
        floor.tape.push({ points: pts, width: tapeWidth, color: tapeColor });
        selection = { kind: 'tape', index: floor.tape.length - 1 };
        commit();
      } else undoStack.pop();
    } else if (d.kind === 'move' || d.kind === 'handle' || d.kind === 'start') {
      commit();
    }
  }

  /** Double-click finishes a tape; returns true when the arena should not re-fit the view. */
  function dblClick() {
    if (!active || !editable()) return false;
    if (tool === 'tape') {
      finishTape();
      return true;
    }
    return false;
  }

  function finishTape() {
    if (!pending) return;
    const pts = [];
    for (const p of pending.points) {
      const last = pts[pts.length - 1];
      if (!last || dist(last[0], last[1], p[0], p[1]) > 0.5) pts.push(p);
    }
    pending = null;
    if (pts.length < 2) return;
    begin();
    floor.tape.push({ points: pts, width: tapeWidth, color: tapeColor });
    selection = { kind: 'tape', index: floor.tape.length - 1 };
    commit();
  }

  function cancelPending() {
    pending = null;
    if (drag && drag.kind === 'curve') drag = null;
  }

  /** The cursor the arena should show, or null to fall back to its own (robot grab / pan). */
  function cursor(w, info) {
    if (!active || !editable()) return null;
    if (tool !== 'select') return 'crosshair';
    if (drag) return 'grabbing';
    if (selection && hitHandle(w, info.scale)) return 'pointer';
    if (info.robotHit) return null;
    return hitTest(w, info.scale) ? 'move' : null;
  }

  window.addEventListener('keydown', (e) => {
    if (!active || !editable()) return;
    const t = e.target;
    if (t && (t.closest?.('.CodeMirror') || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (e.key === 'Escape') {
      if (pending || drag) cancelPending();
      else {
        selection = null;
        refreshProps();
      }
    } else if (e.key === 'Enter' && pending) {
      e.preventDefault();
      finishTape();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
      e.preventDefault();
      deleteSelection();
    }
  });

  // ---- overlay (drawn by the arena inside its centimetre transform, y up) -------------------

  function drawOverlay(ctx, scale) {
    if (!active || !editable()) return;
    const px = (n) => n / scale;
    const accent = '#2f80ed';
    if (snap && scale > 1.6) {
      ctx.fillStyle = 'rgba(47,128,237,0.28)';
      for (let x = 0; x <= floor.width; x += GRID) {
        for (let y = 0; y <= floor.height; y += GRID) {
          if (x % 10 === 0 && y % 10 === 0) continue;
          ctx.fillRect(x - px(1), y - px(1), px(2), px(2));
        }
      }
    }
    const handleBox = (x, y) => {
      const s = px(8);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = accent;
      ctx.lineWidth = px(1.5);
      ctx.setLineDash([]);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    };
    const o = objOf(selection);
    if (selection && o) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = px(1.5);
      ctx.setLineDash([px(6), px(4)]);
      if (isRect(selection.kind)) {
        ctx.strokeRect(o.x, o.y, o.w, o.h);
      } else if (selection.kind === 'light') {
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.reach || 80, 0, Math.PI * 2);
        ctx.stroke();
      } else if (selection.kind === 'start' || selection.kind === 'startB') {
        ctx.beginPath();
        ctx.arc(o.x, o.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      } else if (selection.kind === 'checkpoint') {
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r || 8, 0, Math.PI * 2);
        ctx.stroke();
      } else if (selection.kind === 'tape') {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(47,128,237,0.45)';
        ctx.lineWidth = (o.width || 2.5) + px(6);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        o.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const h of handlesOf(selection, o)) handleBox(h.x, h.y);
    }
    if (drag && drag.kind === 'rect' && drag.rect) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = px(1.5);
      ctx.setLineDash([px(6), px(4)]);
      ctx.strokeRect(drag.rect.x, drag.rect.y, drag.rect.w, drag.rect.h);
      ctx.setLineDash([]);
    }
    if (drag && drag.kind === 'curve' && drag.points.length > 1) {
      ctx.strokeStyle = tapeColor;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = tapeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      drag.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (pending && pending.points.length) {
      ctx.strokeStyle = tapeColor;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = tapeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pending.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (pending.cursor) ctx.lineTo(pending.cursor.x, pending.cursor.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      for (const [x, y] of pending.points) handleBox(x, y);
    }
  }

  // ---- public ----------------------------------------------------------------------------------

  function setFloor(f) {
    // Floors saved before Milestone 4 lack the goal keys; give them empty lists (d-20).
    if (f) for (const k of ['checkpoints', 'finishZones', 'goals']) if (!Array.isArray(f[k])) f[k] = [];
    if (f && f.startB === undefined) f.startB = null; // one Finch unless the Start B tool adds a second (d-24)
    if (floor !== f) {
      clearTimeout(saveTimer);
      if (dirty) saveNow();
      floor = f;
      selection = null;
      pending = null;
      drag = null;
      undoStack = [];
      redoStack = [];
      dirty = false;
      propsKey = null;
      setStatus(editable() ? 'Saved' : '', editable() ? 'ok' : '');
    }
    renderList();
    refreshSettings();
    refreshProps();
    hint(
      editable()
        ? TOOLS.find((x) => x.id === tool).hint
        : floor
          ? `${floor.locked ? 'This assignment floor is' : 'Built-in floors are'} read-only. Press Copy to make an editable copy.`
          : '',
    );
  }

  function setActive(v) {
    active = !!v;
    if (!active) {
      cancelPending();
      drag = null;
      saveNow();
    }
    hint(els.hint.textContent);
  }

  setTool('select');
  refreshSettings();
  refreshProps();

  return {
    setFloor,
    setActive,
    refreshList: renderList,
    saveNow,
    setTool,
    undo,
    redo,
    deleteSelection,
    finishTape,
    mouseDown,
    mouseMove,
    mouseUp,
    dblClick,
    cursor,
    drawOverlay,
    get active() {
      return active;
    },
    get editable() {
      return editable();
    },
    get tool() {
      return tool;
    },
    get floor() {
      return floor;
    },
    get selection() {
      return selection;
    },
    set selection(s) {
      selection = s;
      refreshProps();
    },
    get canUndo() {
      return undoStack.length;
    },
    get canRedo() {
      return redoStack.length;
    },
  };
}
