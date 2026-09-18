// The Runs section (Milestone 3, d-15): every recorded run newest first, filterable by program
// and floor; a replay with a scrubber that drives the arena (arena.setScene), the sensor panel
// (panel.setOverride) and the console (consoleUi.showEntries); a sensor timeline chart linked to
// the trail as she hovers; delete and prune; and the gallery of saved drawings.
//
//   const runs = createRuns({ root, arena, panel, consoleUi, onOpen, onHint, onError, onSaved });
//   runs.load(profileId); runs.add(run); runs.openRun(id); runs.saveDrawing({...}); runs.close()
import { api } from './api.js';
import { Robot } from './sim/robot.js';
import { TRACE_FIELDS } from './recorder.js';

const BACKGROUNDS = { white: '#fbfbf8', wood: '#d9b382', carpet: '#8f9aa6' };
// Timeline series: `field` names a trace column (recorder.js TRACE_FIELDS); the chart shows Finch A's.
// A two-robot run (d-24) carries B's columns under the same names suffixed B; the replay reads every
// column by name from the run's trace.fields, so older runs and two-robot runs both play back.
const SERIES = [
  { label: 'Line L', color: '#1d4ed8', field: 'lineL' },
  { label: 'Line R', color: '#7c3aed', field: 'lineR' },
  { label: 'Light L', color: '#f59e0b', field: 'lightL' },
  { label: 'Light R', color: '#b45309', field: 'lightR' },
  { label: 'Distance (÷3)', color: '#15803d', field: 'distance', scale: 1 / 3 },
];
const KEEP = 50; // "keep the last 50 runs per program"
const HOVER_HINT = 'Hover the timeline to see the readings at that moment; click or drag on it to scrub there.';
const M = { l: 30, r: 10, t: 8, b: 18 }; // chart margins (px)

const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
};
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Index of the last sample whose time is <= t (or -1). Samples are sorted by time. */
function indexAt(samples, t) {
  if (!samples.length || samples[0][0] > t + 1e-9) return -1;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid][0] <= t + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function nearestSample(samples, t) {
  const i = indexAt(samples, t);
  if (i < 0) return samples.length ? 0 : -1;
  const j = i + 1;
  if (j < samples.length && Math.abs(samples[j][0] - t) < Math.abs(samples[i][0] - t)) return j;
  return i;
}

function lerpHeading(a, b, f) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * f;
}

function niceStep(elapsed) {
  const raw = Math.max(elapsed, 0.01) / 6;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

export function createRuns({ root, arena, panel, consoleUi, onOpen, onHint, onError, onSaved }) {
  const q = (sel) => root.querySelector(sel);
  const els = {
    count: q('#runs-count'),
    programFilter: q('#runs-filter-program'),
    floorFilter: q('#runs-filter-floor'),
    prune: q('#runs-prune'),
    list: q('#runs-list'),
    detail: q('#run-detail'),
    title: q('#run-title'),
    meta: q('#run-meta'),
    verdict: q('#run-verdict'),
    controls: q('.run-controls'),
    play: q('#run-play'),
    scrub: q('#run-scrub'),
    scrubTime: q('#run-scrub-time'),
    chartWrap: q('.run-chart-wrap'),
    chart: q('#run-chart'),
    legend: q('#run-chart-legend'),
    hover: q('#run-hover'),
    saveDrawing: q('#run-save-drawing'),
    del: q('#run-delete'),
    close: q('#run-close'),
    galleryCount: q('#gallery-count'),
    gallery: q('#gallery-list'),
  };
  const ctx = els.chart.getContext('2d');

  let profileId = null;
  let runs = []; // summaries (no data), newest first
  let drawings = [];
  let lastRunId = null;
  let active = false;
  let open = null; // { kind:'run', run, scene, samples, positions, t, playing, raf, shownConsole } | { kind:'drawing', drawing, scene }
  let hoverIdx = -1;

  const report = (m) => onError && onError(m);
  const summary = (run) => {
    const { data, ...rest } = run;
    return rest;
  };
  const filtered = () =>
    runs.filter(
      (r) => (!els.programFilter.value || r.programId === els.programFilter.value) && (!els.floorFilter.value || r.floorId === els.floorFilter.value),
    );

  // ---- loading ------------------------------------------------------------------------------

  /** Load a profile's runs and drawings (replaces the previous profile's). */
  async function load(pid) {
    close();
    profileId = pid;
    runs = [];
    drawings = [];
    lastRunId = null;
    if (pid) {
      try {
        runs = await api.listRuns(pid);
        drawings = await api.listDrawings(pid);
      } catch (err) {
        report('Could not load your runs: ' + err.message);
      }
    }
    renderFilters();
    renderList();
    renderGallery();
  }

  async function refresh() {
    if (!profileId) return;
    try {
      runs = await api.listRuns(profileId);
      drawings = await api.listDrawings(profileId);
    } catch (err) {
      report('Could not refresh your runs: ' + err.message);
      return;
    }
    renderFilters();
    renderList();
    renderGallery();
  }

  /** A run was just recorded (main.js): put it at the top of the list. */
  function add(run) {
    if (!run || run.profileId !== profileId) return;
    runs.unshift(summary(run));
    lastRunId = run.id;
    renderFilters();
    renderList();
  }

  // ---- list and filters ---------------------------------------------------------------------

  function renderFilters() {
    const fill = (sel, allLabel, pairs) => {
      const prev = sel.value;
      sel.innerHTML = `<option value="">${allLabel}</option>` + pairs.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
      sel.value = pairs.some(([id]) => id === prev) ? prev : '';
    };
    const programs = new Map();
    const floors = new Map();
    for (const r of runs) {
      if (!programs.has(r.programId)) programs.set(r.programId, r.programName);
      if (!floors.has(r.floorId)) floors.set(r.floorId, r.floorName);
    }
    fill(els.programFilter, 'All programs', [...programs]);
    fill(els.floorFilter, 'All floors', [...floors]);
  }

  function renderList() {
    els.list.innerHTML = '';
    const rows = filtered();
    els.count.textContent = runs.length ? `(${rows.length === runs.length ? runs.length : rows.length + ' of ' + runs.length})` : '';
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'run-empty';
      empty.textContent = runs.length ? 'No runs match these filters.' : 'No runs yet. Press ▶ Run — every run is recorded here so you can replay it.';
      els.list.appendChild(empty);
      return;
    }
    for (const r of rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'run-item' + (open && open.kind === 'run' && open.run.id === r.id ? ' active' : '');
      b.title = `Replay this run of ${r.programName}`;
      const name = document.createElement('span');
      name.className = 'run-name';
      name.textContent = r.programName;
      const sub = document.createElement('span');
      sub.className = 'run-sub';
      sub.append(`${r.floorName} · ${fmtDate(r.createdAt)} · ${Number(r.elapsed).toFixed(1)} s · `);
      const st = document.createElement('span');
      st.className = 'run-status ' + r.status;
      st.textContent = r.status;
      sub.append(st);
      if (r.hasPen) sub.append(' · ✎ pen');
      if (r.verdict) {
        // the goal verdict (Milestone 4, d-20), e.g. "✗ Fail — touched wall at 4.2 s"
        const v = document.createElement('span');
        v.className = 'run-verdict ' + (r.passed ? 'pass' : 'fail');
        v.textContent = (r.passed ? '✓ ' : '✗ ') + r.verdict;
        sub.append(' · ', v);
      }
      b.append(name, sub);
      b.addEventListener('click', () => openRun(r.id));
      els.list.appendChild(b);
    }
  }
  els.programFilter.addEventListener('change', renderList);
  els.floorFilter.addEventListener('change', renderList);

  // ---- replay -------------------------------------------------------------------------------

  function buildScene(floor, ink) {
    const robots = [new Robot('A')];
    if (floor.startB) robots.push(new Robot('B')); // the run was on a two-robot floor (d-24)
    for (const robot of robots) {
      const start = (robot.name === 'B' && floor.startB) || floor.start || { x: floor.width / 2, y: floor.height / 2, heading: 0 };
      robot.placeAt(start.x, start.y, start.heading);
    }
    return { floor, robots, trail: [], ink: ink || [], input: { hand: null }, time: 0, marker: null, replay: true };
  }

  /** Open a run: the arena, readouts and console show it, and it starts replaying from the top. */
  async function openRun(id) {
    if (onOpen) await onOpen();
    let run;
    try {
      run = await api.getRun(id);
    } catch (err) {
      report('Could not load that run: ' + err.message);
      return;
    }
    if (open) closeScene();
    const d = run.data || {};
    d.trace = d.trace || { fields: [], samples: [] };
    d.ink = d.ink || [];
    d.console = d.console || [];
    const samples = d.trace.samples || [];
    // column index by name; a run recorded before trace.fields existed has robot A's columns
    const col = {};
    (d.trace.fields && d.trace.fields.length ? d.trace.fields : TRACE_FIELDS).forEach((f, i) => (col[f] = i));
    const scene = buildScene(d.floor, []);
    const positions = {};
    for (const r of scene.robots) {
      const sfx = r.name === 'A' ? '' : r.name;
      positions[r.name] = col['x' + sfx] === undefined ? [] : samples.map((s) => [s[col['x' + sfx]], s[col['y' + sfx]]]);
    }
    open = {
      kind: 'run',
      run,
      scene,
      samples,
      col,
      positions,
      t: 0,
      playing: false,
      raf: 0,
      shownConsole: -1,
    };
    els.detail.hidden = false;
    els.detail.dataset.kind = 'run';
    els.title.textContent = `${run.programName} on ${run.floorName}`;
    const err = d.error ? ` — ${d.error.type}: ${d.error.message}${d.error.line ? ` (line ${d.error.line})` : ''}` : '';
    els.meta.textContent =
      `${fmtDate(run.createdAt)} · ${run.status}${err} · ${Number(run.elapsed).toFixed(2)} s at ${d.speed || 1}× · ` +
      `wheels L ${Number(run.wheelLeft).toFixed(1)} cm / R ${Number(run.wheelRight).toFixed(1)} cm · ${samples.length} samples`;
    // the goal verdict with every goal's outcome (Milestone 4)
    const v = d.verdict;
    els.verdict.hidden = !v;
    if (v) {
      els.verdict.className = 'run-verdict-box ' + (v.pass ? 'pass' : 'fail');
      els.verdict.innerHTML =
        `<div class="run-verdict-text">${escapeHtml(v.text)}</div>` +
        (v.goals || []).map((g) => `<div class="run-verdict-goal">${g.pass ? '✓' : '✗'} ${escapeHtml(g.label)} — ${escapeHtml(g.reason)}</div>`).join('');
    }
    els.scrub.max = String(Math.max(run.elapsed, 0.01));
    els.scrub.value = '0';
    els.saveDrawing.disabled = !d.ink.length;
    for (const el of [els.controls, els.chartWrap, els.legend, els.hover, els.saveDrawing, els.del]) el.hidden = false;
    els.legend.innerHTML =
      (col.xB !== undefined ? '<span>Finch A:</span>' : '') +
      SERIES.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.label}</span>`).join('');
    els.hover.textContent = HOVER_HINT;
    arena.setScene(open.scene);
    onHint && onHint('Replay — the robot, ink, readouts and console follow the scrubber · Close returns to the live robot');
    renderList();
    setTime(0);
    play();
  }

  /** Move the replay to simulation time t: pose, trail, ink, readouts, console and chart follow. */
  function setTime(t) {
    const o = open;
    if (!o || o.kind !== 'run') return;
    const run = o.run;
    t = Math.max(0, Math.min(run.elapsed, Number(t) || 0));
    o.t = t;
    const s = o.samples;
    const col = o.col;
    const robots = o.scene.robots;
    const idx = indexAt(s, t);
    const override = {};
    for (const robot of robots) {
      const sfx = robot.name === 'A' ? '' : robot.name; // B's columns carry the same names suffixed B (d-24)
      const c = (name) => col[name + sfx];
      const a = idx >= 0 ? s[idx] : null;
      if (a && c('x') !== undefined) {
        const b = s[idx + 1];
        let x = a[c('x')];
        let y = a[c('y')];
        let h = a[c('heading')];
        if (b && b[0] > a[0]) {
          const f = (t - a[0]) / (b[0] - a[0]);
          x = a[c('x')] + (b[c('x')] - a[c('x')]) * f;
          y = a[c('y')] + (b[c('y')] - a[c('y')]) * f;
          h = lerpHeading(a[c('heading')], b[c('heading')], f);
        }
        robot.placeAt(x, y, h);
        robot.trail = (o.positions[robot.name] || []).slice(0, idx + 1).concat([[x, y]]);
        const v = (name) => (c(name) === undefined ? undefined : a[c(name)]);
        override[robot.name] = { x, y, heading: h, lineL: v('lineL'), lineR: v('lineR'), lightL: v('lightL'), lightR: v('lightR'), distance: v('distance'), encoderL: v('encoderL'), encoderR: v('encoderR') };
      } else {
        robot.trail = [];
        override[robot.name] = { x: robot.x, y: robot.y, heading: robot.heading };
      }
    }
    o.scene.trail = robots[0].trail;
    panel.setOverride(override);
    // ink drawn so far; each Finch's pen dot shows while its stroke is in progress
    const ink = [];
    const pens = {};
    for (const st of run.data.ink) {
      const pts = st.points;
      if (!pts.length || pts[0][2] > t + 1e-9) continue;
      let n = 0;
      let lo = 0;
      let hi = pts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (pts[mid][2] <= t + 1e-9) lo = mid;
        else hi = mid - 1;
      }
      n = lo + 1;
      ink.push({ color: st.color, width: st.width, points: pts.slice(0, n) });
      if (pts[pts.length - 1][2] >= t - 1e-9) pens[st.robot || 'A'] = st.color;
    }
    o.scene.ink = ink;
    for (const robot of robots) {
      const color = pens[robot.name];
      robot.pen.down = !!color;
      if (color) robot.pen.color = color;
    }
    o.scene.time = t;
    els.scrub.value = String(t);
    els.scrubTime.textContent = t.toFixed(2) + ' s';
    const lines = run.data.console;
    let n = 0;
    while (n < lines.length && lines[n][0] <= t + 1e-9) n++;
    if (n !== o.shownConsole) {
      consoleUi.showEntries(lines, t);
      o.shownConsole = n;
    }
    drawChart();
  }

  function play() {
    const o = open;
    if (!o || o.kind !== 'run') return;
    if (o.t >= o.run.elapsed - 1e-9) setTime(0);
    o.playing = true;
    els.play.textContent = '❚❚ Pause';
    let last = performance.now();
    const step = (now) => {
      if (open !== o || !o.playing) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setTime(o.t + dt);
      if (o.t >= o.run.elapsed - 1e-9) {
        pause();
        return;
      }
      o.raf = requestAnimationFrame(step);
    };
    o.raf = requestAnimationFrame(step);
  }

  function pause() {
    const o = open;
    if (!o || o.kind !== 'run') return;
    o.playing = false;
    cancelAnimationFrame(o.raf);
    els.play.textContent = o.t >= o.run.elapsed - 1e-9 ? '↻ Replay again' : '▶ Replay';
  }

  els.play.addEventListener('click', () => {
    if (open && open.kind === 'run' && open.playing) pause();
    else play();
  });
  els.scrub.addEventListener('input', () => {
    pause();
    setTime(Number(els.scrub.value));
  });
  els.close.addEventListener('click', () => close());

  // ---- timeline chart -----------------------------------------------------------------------

  function chartSize() {
    const rect = els.chartWrap.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  function drawChart() {
    const o = open;
    if (!o || o.kind !== 'run') return;
    const { w, h } = chartSize();
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (els.chart.width !== Math.round(w * dpr) || els.chart.height !== Math.round(h * dpr)) {
      els.chart.width = Math.round(w * dpr);
      els.chart.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const elapsed = Math.max(o.run.elapsed, 0.01);
    const px = (t) => M.l + (t / elapsed) * (w - M.l - M.r);
    const py = (v) => M.t + (1 - Math.max(0, Math.min(100, v)) / 100) * (h - M.t - M.b);
    // grid and axes
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [0, 25, 50, 75, 100]) {
      ctx.beginPath();
      ctx.moveTo(M.l, py(v));
      ctx.lineTo(w - M.r, py(v));
      ctx.stroke();
      ctx.fillText(String(v), M.l - 4, py(v));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = niceStep(elapsed);
    for (let t = 0; t <= elapsed + 1e-9; t += step) ctx.fillText(t.toFixed(step < 1 ? 1 : 0) + ' s', px(t), h - M.b + 3);
    // series
    const s = o.samples;
    for (const ser of SERIES) {
      const ci = o.col[ser.field];
      if (ci === undefined) continue;
      ctx.strokeStyle = ser.color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      s.forEach((row, i) => {
        const x = px(row[0]);
        const y = py((row[ci] ?? 0) * (ser.scale || 1));
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    // hover cursor and the scrub position
    if (hoverIdx >= 0 && s[hoverIdx]) {
      ctx.strokeStyle = '#d35400';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px(s[hoverIdx][0]), M.t);
      ctx.lineTo(px(s[hoverIdx][0]), h - M.b);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#2f80ed';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px(o.t), M.t);
    ctx.lineTo(px(o.t), h - M.b);
    ctx.stroke();
  }

  function sampleAtClientX(clientX) {
    const o = open;
    if (!o || o.kind !== 'run' || !o.samples.length) return -1;
    const rect = els.chart.getBoundingClientRect();
    const { w } = chartSize();
    const t = ((clientX - rect.left - M.l) / Math.max(1, w - M.l - M.r)) * Math.max(o.run.elapsed, 0.01);
    return nearestSample(o.samples, Math.max(0, Math.min(o.run.elapsed, t)));
  }

  /** Highlight the hovered sample on the chart and its trail point on the arena. */
  function setHover(i) {
    hoverIdx = i;
    const o = open;
    if (!o || o.kind !== 'run') return;
    if (i >= 0 && o.samples[i]) {
      const r = o.samples[i];
      const v = (name) => r[o.col[name]];
      o.scene.marker = { x: v('x'), y: v('y') };
      els.hover.textContent =
        `${r[0].toFixed(2)} s — line L ${v('lineL')} / R ${v('lineR')} · light L ${v('lightL')} / R ${v('lightR')} · ` +
        `distance ${v('distance') >= 300 ? 'out of range' : v('distance') + ' cm'} · at (${Number(v('x')).toFixed(0)}, ${Number(v('y')).toFixed(0)}) cm`;
    } else {
      o.scene.marker = null;
      els.hover.textContent = HOVER_HINT;
    }
    drawChart();
  }

  els.chart.addEventListener('mousemove', (e) => {
    const i = sampleAtClientX(e.clientX);
    setHover(i);
    if (e.buttons & 1 && i >= 0) {
      pause();
      setTime(open.samples[i][0]);
    }
  });
  els.chart.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const i = sampleAtClientX(e.clientX);
    if (i < 0) return;
    pause();
    setTime(open.samples[i][0]);
  });
  els.chart.addEventListener('mouseleave', () => setHover(-1));
  window.addEventListener('resize', () => drawChart());

  // ---- delete, prune, save drawing ----------------------------------------------------------

  els.del.addEventListener('click', async () => {
    const o = open;
    if (!o || o.kind !== 'run') return;
    if (!window.confirm('Delete this run? This cannot be undone (a drawing saved from it stays in the gallery).')) return;
    await deleteRun(o.run.id);
  });

  async function deleteRun(id) {
    try {
      await api.deleteRun(id);
    } catch (err) {
      report('Could not delete the run: ' + err.message);
      return false;
    }
    runs = runs.filter((r) => r.id !== id);
    if (lastRunId === id) lastRunId = null;
    if (open && open.kind === 'run' && open.run.id === id) closeScene();
    renderFilters();
    renderList();
    return true;
  }

  els.prune.addEventListener('click', async () => {
    if (!profileId) return;
    if (!window.confirm(`Keep only the newest ${KEEP} runs of each program and delete the rest?`)) return;
    await prune();
  });

  async function prune(keep = KEEP) {
    if (!profileId) return 0;
    let n = 0;
    try {
      n = await api.pruneRuns(profileId, keep);
    } catch (err) {
      report('Could not prune the runs: ' + err.message);
      return 0;
    }
    close();
    await refresh();
    consoleUi.hint(`Pruned ${n} run${n === 1 ? '' : 's'}; the newest ${keep} of each program are kept.`);
    return n;
  }

  els.saveDrawing.addEventListener('click', () => {
    const o = open;
    if (!o || o.kind !== 'run') return;
    saveDrawing({ strokes: o.run.data.ink, floor: o.run.data.floor, runId: o.run.id, programName: o.run.programName, floorName: o.run.floorName });
  });

  /** Keep pen ink as a titled drawing in the gallery. `title` skips the prompt (automation). */
  async function saveDrawing({ strokes, floor, runId, programName, floorName, title }) {
    if (!profileId) return null;
    if (!strokes || !strokes.length) {
      consoleUi.hint('There is no ink to keep yet — put the pen down (panel or bird.penDown()) and run a program first.');
      return null;
    }
    if (title === undefined) {
      title = window.prompt('Title for this drawing:', programName ? `${programName} drawing` : 'My drawing');
      if (title === null) return null;
    }
    try {
      const d = await api.createDrawing(profileId, {
        title: String(title).trim() || 'Untitled drawing',
        runId: runId || null,
        programName: programName || '',
        floorName: floorName || '',
        width: floor.width,
        height: floor.height,
        background: floor.background || 'white',
        strokes: strokes.map((s) => ({ color: s.color, width: s.width, points: s.points })),
      });
      drawings.unshift(d);
      onSaved && onSaved(); // a banner from an earlier failed save is stale now
      renderGallery();
      consoleUi.hint(`Saved "${d.title}" to the gallery (Runs section).`);
      return d;
    } catch (err) {
      report('Could not save the drawing: ' + err.message);
      return null;
    }
  }

  // ---- gallery ------------------------------------------------------------------------------

  function thumbnail(canvas, d) {
    const W = 160;
    const H = Math.max(40, Math.round(W * (d.height / d.width)));
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    g.fillStyle = BACKGROUNDS[d.background] || BACKGROUNDS.white;
    g.fillRect(0, 0, W, H);
    const s = W / d.width;
    g.save();
    g.translate(0, H);
    g.scale(s, -s);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const st of d.strokes || []) {
      const pts = st.points || [];
      if (!pts.length) continue;
      g.strokeStyle = st.color || '#d62828';
      g.lineWidth = Math.max(st.width || 0.7, 1.5 / s);
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      if (pts.length === 1) g.lineTo(pts[0][0] + 0.01, pts[0][1]);
      g.stroke();
    }
    g.restore();
  }

  function renderGallery() {
    els.gallery.innerHTML = '';
    els.galleryCount.textContent = drawings.length ? `(${drawings.length})` : '';
    if (!drawings.length) {
      const empty = document.createElement('div');
      empty.className = 'gallery-empty';
      empty.textContent = 'No drawings yet. Put the pen down (panel or bird.penDown()), run a program, then press Save drawing…';
      els.gallery.appendChild(empty);
      return;
    }
    for (const d of drawings) {
      const item = document.createElement('div');
      item.className = 'gallery-item' + (open && open.kind === 'drawing' && open.drawing.id === d.id ? ' active' : '');
      const c = document.createElement('canvas');
      thumbnail(c, d);
      c.title = 'Show this drawing on the arena';
      c.addEventListener('click', () => openDrawing(d));
      const name = document.createElement('div');
      name.className = 'gallery-name';
      name.textContent = d.title;
      name.title = d.title;
      const meta = document.createElement('div');
      meta.className = 'gallery-meta';
      meta.textContent = `${d.programName || 'Pen'} · ${fmtDate(d.createdAt)}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        if (!window.confirm(`Delete the drawing "${d.title}"?`)) return;
        await deleteDrawing(d.id);
      });
      item.append(c, name, meta, del);
      els.gallery.appendChild(item);
    }
  }

  async function deleteDrawing(id) {
    try {
      await api.deleteDrawing(id);
    } catch (err) {
      report('Could not delete the drawing: ' + err.message);
      return false;
    }
    drawings = drawings.filter((x) => x.id !== id);
    if (open && open.kind === 'drawing' && open.drawing.id === id) closeScene();
    renderGallery();
    return true;
  }

  /** Show a gallery drawing on the arena (a floor of its size with only the ink on it). */
  async function openDrawing(d) {
    if (onOpen) await onOpen();
    if (open) closeScene();
    const floor = { id: 'drawing', name: d.title, width: d.width, height: d.height, background: d.background, start: null, tape: [], walls: [], lights: [], darkAreas: [], slopes: [] };
    open = { kind: 'drawing', drawing: d, scene: { floor, robots: [], trail: [], ink: d.strokes || [], input: { hand: null }, time: 0, marker: null } };
    els.detail.hidden = false;
    els.detail.dataset.kind = 'drawing';
    els.title.textContent = `Drawing: ${d.title}`;
    els.meta.textContent = `${d.programName ? d.programName + ' · ' : ''}${d.floorName ? d.floorName + ' · ' : ''}${fmtDate(d.createdAt)} · ${d.width} × ${d.height} cm`;
    for (const el of [els.controls, els.chartWrap, els.legend, els.hover, els.saveDrawing, els.del, els.verdict]) el.hidden = true;
    arena.setScene(open.scene);
    onHint && onHint('Gallery — press Close to go back to the live robot');
    renderList();
    renderGallery();
  }

  // ---- closing ------------------------------------------------------------------------------

  function closeScene() {
    if (!open) return;
    if (open.kind === 'run') {
      open.playing = false;
      cancelAnimationFrame(open.raf);
    }
    open = null;
    hoverIdx = -1;
    arena.setScene(null);
    panel.setOverride(null);
    consoleUi.restore();
    els.detail.hidden = true;
    onHint && onHint(null);
  }

  /** Back to the live robot (no-op when nothing is open). */
  function close() {
    if (!open) return;
    closeScene();
    renderList();
    renderGallery();
  }

  /** The Runs section was shown (refresh the list) or hidden (any replay closes). */
  function setActive(v) {
    active = !!v;
    if (active) refresh();
    else close();
  }

  return {
    load,
    refresh,
    add,
    openRun,
    openDrawing,
    close,
    setTime,
    play,
    pause,
    deleteRun,
    deleteDrawing,
    prune,
    saveDrawing,
    setActive,
    get active() {
      return active;
    },
    get runs() {
      return runs;
    },
    get drawings() {
      return drawings;
    },
    get open() {
      return open;
    },
    get lastRunId() {
      return lastRunId;
    },
  };
}
