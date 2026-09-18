// The goal list of the Floors pane (Milestone 4, d-20): one row per goal on the floor with its
// parameters and a Remove button, plus an "Add goal…" picker. Every mutation goes through the floor
// editor's mutate(fn) so it takes part in undo/redo and autosave; for a built-in floor the list is
// read-only. Rendered by flooreditor.js refreshSettings() into #floor-goals.
import { GOAL_TYPES, goalLabel, isTwoRobotGoal, newGoal } from './goals.js';

export function renderGoalList(root, floor, { editable, mutate }) {
  root.innerHTML = '';
  if (!floor) return;
  const goals = floor.goals || [];
  const title = document.createElement('div');
  title.className = 'pane-title';
  title.innerHTML = `<span>Goals <span class="muted">${goals.length ? `(${goals.length})` : ''}</span></span>`;
  root.appendChild(title);
  if (!goals.length) {
    const empty = document.createElement('div');
    empty.className = 'muted goal-empty';
    empty.textContent = editable
      ? 'No goal yet. Add one below — when a run ends, the verdict (Pass, or Fail with the reason and the moment) shows in the console and is kept with the run.'
      : 'This floor has no goal. Copy it to add one.';
    root.appendChild(empty);
  }
  goals.forEach((g, i) => {
    const row = document.createElement('div');
    row.className = 'goal-row';
    row.dataset.goal = g.type;
    const label = document.createElement('div');
    label.className = 'goal-label';
    label.textContent = `${i + 1}. ${goalLabel(g, !!floor.startB)}`;
    row.appendChild(label);
    const type = GOAL_TYPES.find((t) => t.id === g.type);
    if (type && type.params.length) {
      const params = document.createElement('div');
      params.className = 'control-row goal-params';
      for (const p of type.params) {
        const lab = document.createElement('label');
        lab.append(p.label + ' ');
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = String(p.min);
        inp.max = String(p.max);
        inp.step = String(p.step);
        inp.value = String(g[p.key] ?? p.dflt);
        inp.disabled = !editable;
        inp.dataset.param = p.key;
        inp.addEventListener('change', () => {
          const v = Number(inp.value);
          if (!Number.isFinite(v)) return;
          mutate(() => {
            g[p.key] = Math.min(p.max, Math.max(p.min, v));
          });
        });
        lab.appendChild(inp);
        params.appendChild(lab);
      }
      row.appendChild(params);
    }
    // which Finch the goal judges, on a two-robot floor (Milestone 6, d-24)
    if (floor.startB && !isTwoRobotGoal(g.type)) {
      const who = document.createElement('div');
      who.className = 'control-row goal-params';
      const lab = document.createElement('label');
      lab.append('judged on ');
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="A">Finch A</option><option value="B">Finch B</option>';
      sel.value = g.robot === 'B' ? 'B' : 'A';
      sel.disabled = !editable;
      sel.dataset.param = 'robot';
      sel.addEventListener('change', () =>
        mutate(() => {
          if (sel.value === 'B') g.robot = 'B';
          else delete g.robot;
        }),
      );
      lab.appendChild(sel);
      who.appendChild(lab);
      row.appendChild(who);
    }
    if (isTwoRobotGoal(g.type) && !floor.startB) row.appendChild(note('This goal needs two Finches: put the second start mark down with the Start B tool.'));
    // what the goal still needs on this floor
    if (g.type === 'finish' && !(floor.finishZones || []).length) row.appendChild(note('Place a finish zone with the Finish zone tool.'));
    if (g.type === 'checkpoints' && !(floor.checkpoints || []).length) row.appendChild(note('Place checkpoints with the Checkpoint tool; the robot must visit them in order.'));
    if ((g.type === 'stayOnTape' || g.type === 'lap') && !(floor.tape || []).length) row.appendChild(note('This floor has no tape yet.'));
    if (g.type === 'stopNearWall' && !(floor.walls || []).length) row.appendChild(note('This floor has no wall yet.'));
    if (editable) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'goal-remove';
      del.textContent = 'Remove goal';
      del.addEventListener('click', () => mutate(() => floor.goals.splice(i, 1)));
      row.appendChild(del);
    }
    root.appendChild(row);
  });
  if (editable) {
    const add = document.createElement('div');
    add.className = 'control-row goal-add';
    const sel = document.createElement('select');
    sel.id = 'goal-add';
    sel.title = 'Add a goal to this floor';
    sel.innerHTML = '<option value="">Add goal…</option>' + GOAL_TYPES.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
    sel.addEventListener('change', () => {
      const g = newGoal(sel.value);
      sel.value = '';
      if (g) mutate(() => floor.goals.push(g));
    });
    add.appendChild(sel);
    root.appendChild(add);
  }
}

function note(text) {
  const d = document.createElement('div');
  d.className = 'goal-note';
  d.textContent = text;
  return d;
}
