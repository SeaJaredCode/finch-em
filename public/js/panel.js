// The sensor & interaction panel: live readouts plus the controls that "touch" the robot.
// Milestone 3 (d-15) adds the pen controls and setOverride(), which makes the readouts show a
// replay's recorded values instead of the live sensors while a run is scrubbed.
// Two Finches (Milestone 6, d-24): a tab per robot. Every robot has its own panel input (buttons,
// orientation, shake, hand, sound, temperature) and pen, so the controls act on the robot whose tab
// is selected; the tab strip only shows while the floor holds two. A replay override is keyed by
// robot name ({ A: {...}, B: {...} }) and the tabs then follow the replayed run's robots.

const ORIENTATIONS = ['Level', 'Beak up', 'Beak down', 'Tilt left', 'Tilt right', 'Upside down'];

export function createPanel(root, { world, onPlaceAtStart, onPoseEdited, onSaveDrawing, onSteadyChange }) {
  const q = (sel) => root.querySelector(sel);
  const tabs = q('[data-c=robot-tabs]');
  let steady = false; // "Steady readouts": show the sensors without their jitter (display only)
  let override = null; // replay readouts by robot name: { A: { x, y, heading, lineL, lineR, lightL, lightR, distance, encoderL, encoderR }, B?: {...} }
  let selected = 'A';
  let tabsKey = '';

  /** The robots the panel can show: the world's, or the replayed run's while an override is set. */
  const names = () => (override ? Object.keys(override) : world.robots.map((r) => r.name));
  const robotName = () => (names().includes(selected) ? selected : names()[0] || 'A');
  const robot = () => world.robot(robotName()) || world.robots[0];

  const readouts = {
    distance: q('[data-r=distance]'),
    light: q('[data-r=light]'),
    line: q('[data-r=line]'),
    encoders: q('[data-r=encoders]'),
    compass: q('[data-r=compass]'),
    orientation: q('[data-r=orientation]'),
    accel: q('[data-r=accel]'),
    shaking: q('[data-r=shaking]'),
    buttons: q('[data-r=buttons]'),
    sound: q('[data-r=sound]'),
    temperature: q('[data-r=temperature]'),
    motors: q('[data-r=motors]'),
    pose: q('[data-r=pose]'),
  };

  // buttons A / B / Logo: hold with the mouse or with the a / b / l keys (on the selected robot)
  for (const btn of root.querySelectorAll('[data-button]')) {
    const key = btn.dataset.button;
    const press = (v) => {
      robot().input.buttons[key] = v;
      btn.classList.toggle('pressed', v);
    };
    btn.addEventListener('mousedown', () => press(true));
    btn.addEventListener('mouseup', () => press(false));
    btn.addEventListener('mouseleave', () => press(false));
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      press(true);
    });
    btn.addEventListener('touchend', () => press(false));
    btn._press = press;
  }
  const keyMap = { a: 'A', b: 'B', l: 'Logo' };
  const inEditor = (e) => {
    const t = e.target;
    return t && (t.closest('.CodeMirror') || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  };
  window.addEventListener('keydown', (e) => {
    if (inEditor(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = keyMap[e.key.toLowerCase()];
    if (k) {
      root.querySelector(`[data-button="${k}"]`)._press(true);
      e.preventDefault();
    }
    if (e.key.toLowerCase() === 's') {
      shake();
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.key.toLowerCase()];
    if (k) root.querySelector(`[data-button="${k}"]`)._press(false);
  });

  // orientation picker
  const orientationSel = q('[data-c=orientation]');
  orientationSel.innerHTML = ORIENTATIONS.map((o) => `<option value="${o}">${o}</option>`).join('');
  orientationSel.addEventListener('change', () => (robot().input.orientation = orientationSel.value));

  // Steady readouts: the live sensors flicker by a count or two like the real Finch's; this calms
  // the panel only. Programs still read the noisy values, so nothing a student writes changes.
  const steadyBox = q('[data-c=steady]');
  steadyBox.addEventListener('change', () => {
    steady = steadyBox.checked;
    onSteadyChange && onSteadyChange(steady);
    update(true);
  });

  /** Show the sensors with (false) or without (true) their jitter — the saved preference. */
  function setSteady(v) {
    steady = !!v;
    steadyBox.checked = steady;
    update(true);
  }

  // shake
  function shake() {
    robot().input.shakeUntil = world.time + 1.0;
  }
  q('[data-c=shake]').addEventListener('click', shake);

  // hand in front
  const handOn = q('[data-c=hand-on]');
  const handRange = q('[data-c=hand]');
  const handLabel = q('[data-c=hand-label]');
  const applyHand = () => {
    robot().input.hand = handOn.checked ? Number(handRange.value) : null;
    handLabel.textContent = handOn.checked ? `${handRange.value} cm` : 'off';
    handRange.disabled = !handOn.checked;
  };
  handOn.addEventListener('change', applyHand);
  handRange.addEventListener('input', applyHand);
  applyHand();

  // sound & temperature
  const soundRange = q('[data-c=sound]');
  const soundLabel = q('[data-c=sound-label]');
  soundRange.addEventListener('input', () => {
    robot().input.sound = Number(soundRange.value);
    soundLabel.textContent = soundRange.value;
  });
  const tempRange = q('[data-c=temperature]');
  const tempLabel = q('[data-c=temperature-label]');
  tempRange.addEventListener('input', () => {
    robot().input.temperature = Number(tempRange.value);
    tempLabel.textContent = tempRange.value + ' °C';
  });

  /** The controls show the selected robot's own input (each robot has its own, d-24). */
  function syncControls() {
    const inp = robot().input;
    if (document.activeElement !== orientationSel) orientationSel.value = inp.orientation;
    handOn.checked = inp.hand !== null && inp.hand !== undefined;
    if (handOn.checked) handRange.value = String(inp.hand);
    handLabel.textContent = handOn.checked ? `${handRange.value} cm` : 'off';
    handRange.disabled = !handOn.checked;
    soundRange.value = String(inp.sound);
    soundLabel.textContent = String(inp.sound);
    tempRange.value = String(inp.temperature);
    tempLabel.textContent = inp.temperature + ' °C';
    for (const btn of root.querySelectorAll('[data-button]')) btn.classList.toggle('pressed', !!inp.buttons[btn.dataset.button]);
  }

  // ---- a tab per Finch (Milestone 6, d-24) ----
  function renderTabs() {
    const list = names();
    const key = list.join(',') + '|' + robotName();
    if (key === tabsKey) return;
    tabsKey = key;
    tabs.hidden = list.length < 2;
    tabs.innerHTML = '';
    for (const n of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'robot-tab' + (n === robotName() ? ' active' : '');
      b.dataset.robot = n;
      b.textContent = `Finch ${n}`;
      b.title = n === 'A' ? "Finch('A') in a program — also plain Finch()" : `Finch('${n}') in a program`;
      b.addEventListener('click', () => selectRobot(n));
      tabs.appendChild(b);
    }
    syncControls();
  }

  /** Show (and touch) this robot: 'A' or 'B'. */
  function selectRobot(name) {
    selected = name;
    renderTabs();
    syncControls();
    update(true);
  }

  // pose editing
  const poseX = q('[data-c=pose-x]');
  const poseY = q('[data-c=pose-y]');
  const poseH = q('[data-c=pose-h]');
  const applyPose = () => {
    const r = robot();
    const c = world.clampInside(Number(poseX.value), Number(poseY.value));
    r.placeAt(c.x, c.y, Number(poseH.value));
    onPoseEdited && onPoseEdited(r);
  };
  for (const el of [poseX, poseY, poseH]) el.addEventListener('change', applyPose);
  q('[data-c=rot-left]').addEventListener('click', () => {
    robot().placeAt(robot().x, robot().y, robot().heading - 15);
  });
  q('[data-c=rot-right]').addEventListener('click', () => {
    robot().placeAt(robot().x, robot().y, robot().heading + 15);
  });
  q('[data-c=to-start]').addEventListener('click', () => onPlaceAtStart && onPlaceAtStart(robot()));

  // pen (Milestone 3, d-15): tape a marker under the robot, pick its colour, wipe the ink, keep a drawing
  const penToggle = q('[data-c=pen-toggle]');
  const penColor = q('[data-c=pen-color]');
  const penClear = q('[data-c=pen-clear]');
  const penSave = q('[data-c=pen-save]');
  penToggle.addEventListener('click', () => world.setPen(robot(), { down: !robot().pen.down }));
  penColor.addEventListener('input', () => world.setPen(robot(), { color: penColor.value }));
  penClear.addEventListener('click', () => world.clearInk());
  penSave.addEventListener('click', () => onSaveDrawing && onSaveDrawing());

  function refreshPen() {
    const pen = robot().pen;
    penToggle.textContent = pen.down ? 'Pen up' : 'Pen down';
    penToggle.title = pen.down ? 'Lift the marker off the floor (or call bird.penUp())' : 'Tape a marker under the robot (or call bird.penDown())';
    penToggle.classList.toggle('pressed', pen.down);
    if (document.activeElement !== penColor && penColor.value !== pen.color) penColor.value = pen.color;
    for (const el of [penToggle, penColor, penClear]) el.disabled = !!override;
    penSave.disabled = !!override || !world.ink.length;
  }

  /**
   * Replay (Milestone 3): show these recorded values instead of the live sensors; null = live.
   * Either one robot's readouts, or readouts keyed by robot name ({ A: {...}, B: {...} }, d-24).
   */
  function setOverride(values) {
    override = !values ? null : values.A || values.B ? values : { A: values };
    renderTabs();
    update(true);
  }

  let last = 0;
  function update(force) {
    const now = performance.now();
    if (!force && now - last < 90) return;
    last = now;
    renderTabs();
    const r = robot();
    if (!r) return;
    if (override) {
      const o = override[robotName()] || {};
      const n = (v) => (v === undefined || v === null ? '–' : v);
      readouts.distance.textContent = o.distance === undefined ? '–' : o.distance >= 300 ? `${o.distance} (out of range)` : `${o.distance} cm`;
      readouts.light.textContent = `${n(o.lightL)} / ${n(o.lightR)}`;
      readouts.line.textContent = `${n(o.lineL)} / ${n(o.lineR)}`;
      readouts.encoders.textContent = o.encoderL === undefined ? '–' : `${o.encoderL.toFixed(2)} / ${o.encoderR.toFixed(2)}`;
      readouts.compass.textContent = `${Math.round(o.heading || 0)}°`;
      for (const k of ['orientation', 'accel', 'shaking', 'buttons', 'sound', 'temperature']) readouts[k].textContent = '–';
      readouts.motors.textContent = 'replay';
      readouts.pose.textContent = o.x === undefined ? '–' : `${o.x.toFixed(1)}, ${o.y.toFixed(1)} @ ${Math.round(o.heading || 0)}°`;
      refreshPen();
      return;
    }
    const s = world.sensors(r, { noise: !steady });
    readouts.distance.textContent = s.distance >= 300 ? `${s.distance} (out of range)` : `${s.distance} cm`;
    readouts.light.textContent = `${s.lightL} / ${s.lightR}`;
    readouts.line.textContent = `${s.lineL} / ${s.lineR}`;
    readouts.encoders.textContent = `${s.encoderL.toFixed(2)} / ${s.encoderR.toFixed(2)}`;
    readouts.compass.textContent = `${s.compass}°`;
    readouts.orientation.textContent = s.orientation;
    readouts.accel.textContent = s.acceleration.map((v) => v.toFixed(1)).join(', ');
    readouts.shaking.textContent = s.shaking ? 'True' : 'False';
    readouts.buttons.textContent = ['A', 'B', 'Logo'].filter((k) => s.buttons[k]).join(' ') || 'none';
    readouts.sound.textContent = s.sound;
    readouts.temperature.textContent = `${s.temperature} °C`;
    const p = r.pending;
    readouts.motors.textContent = p
      ? p.kind === 'move'
        ? `setMove ${p.remaining.toFixed(1)} cm left`
        : `setTurn ${p.remaining.toFixed(0)}° left`
      : `${r.motors.left} / ${r.motors.right}${r.blocked ? ' (blocked)' : ''}`;
    readouts.pose.textContent = `${r.x.toFixed(1)}, ${r.y.toFixed(1)} @ ${r.heading.toFixed(0)}°`;
    if (document.activeElement !== poseX) poseX.value = r.x.toFixed(1);
    if (document.activeElement !== poseY) poseY.value = r.y.toFixed(1);
    if (document.activeElement !== poseH) poseH.value = r.heading.toFixed(0);
    refreshPen();
  }

  return {
    update,
    shake,
    setOverride,
    setSteady,
    selectRobot,
    get override() {
      return override;
    },
    /** The name of the robot whose tab is selected ('A' or 'B'). */
    get robotName() {
      return robotName();
    },
    get robot() {
      return robot();
    },
    /** True while the panel shows steady (jitter-free) readouts. */
    get steady() {
      return steady;
    },
  };
}
