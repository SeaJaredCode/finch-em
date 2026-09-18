// The arena: a top-down canvas view of the floor and the robot, with zoom, pan, and drag/rotate.
// In edit mode (Milestone 2) pointer events go to the floor editor first and its overlay is drawn
// on top of the floor; see flooreditor.js. A replay or a gallery drawing (Milestone 3, d-15) is a
// "scene" with the same fields as the World ({ floor, robots, trail, ink, time, input, marker });
// while one is set with setScene() the arena draws it instead of the live world.
import { ROBOT } from './sim/robot.js';
import { headingVec, localToWorld, dist, clamp, DEG } from './sim/geometry.js';

const BACKGROUNDS = { white: '#fbfbf8', wood: '#d9b382', carpet: '#8f9aa6' };
const led = (c) => (c.r || c.g || c.b ? `rgb(${Math.round(c.r * 2.55)},${Math.round(c.g * 2.55)},${Math.round(c.b * 2.55)})` : null);
// Two Finches (Milestone 6, d-24): A is blue and B amber — trails, start-mark letters and robot badges.
const TRAIL_COLORS = { A: 'rgba(47,128,237,0.55)', B: 'rgba(217,119,6,0.6)' };
const ROBOT_TINT = { A: '#2f80ed', B: '#d97706' };

export function createArena(canvas, { world, onRobotMoved }) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 4, ox: 0, oy: 0 }; // px per cm; screen = (ox + x*scale, oy - y*scale)
  let drag = null;
  let fitted = false;
  let cssW = 0;
  let cssH = 0;
  let editor = null; // the floor editor, when one is attached
  let scene = null; // a replay / gallery scene drawn instead of the world (Milestone 3)

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (rect.width !== cssW || rect.height !== cssH) {
      cssW = rect.width;
      cssH = rect.height;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      if (!fitted) fit();
    }
  }

  function fit() {
    const f = (scene || world).floor;
    if (!f || !cssW) return;
    const pad = 24;
    view.scale = Math.min((cssW - pad * 2) / f.width, (cssH - pad * 2) / f.height);
    view.ox = (cssW - f.width * view.scale) / 2;
    view.oy = cssH - (cssH - f.height * view.scale) / 2;
    fitted = true;
  }

  const toScreen = (x, y) => ({ sx: view.ox + x * view.scale, sy: view.oy - y * view.scale });
  const toWorld = (sx, sy) => ({ x: (sx - view.ox) / view.scale, y: (view.oy - sy) / view.scale });

  function pointer(e) {
    const rect = canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  const editing = () => !scene && editor && editor.active;
  /** The live robot under a point (the nearest when two overlap), or null; a replay's robots cannot be dragged. */
  const robotAt = (w) => {
    if (scene) return null;
    let best = null;
    let bestD = ROBOT.bodyRadius + 2;
    for (const robot of world.robots) {
      const d = dist(w.x, w.y, robot.x, robot.y);
      if (d <= bestD) {
        best = robot;
        bestD = d;
      }
    }
    return best;
  };
  const pointerInfo = (e, w) => ({ scale: view.scale, shift: e.shiftKey, button: e.button, robotHit: !!robotAt(w) });

  // ---- interaction ----
  canvas.addEventListener('mousedown', (e) => {
    const p = pointer(e);
    const w = toWorld(p.sx, p.sy);
    const robot = robotAt(w);
    if (editing() && editor.mouseDown(w, pointerInfo(e, w))) {
      drag = { kind: 'editor' };
      canvas.style.cursor = editor.cursor(w, pointerInfo(e, w)) || 'crosshair';
    } else if (e.button !== 1 && robot) {
      drag = e.shiftKey || e.button === 2 ? { kind: 'rotate', robot } : { kind: 'robot', robot, dx: robot.x - w.x, dy: robot.y - w.y };
      canvas.style.cursor = drag.kind === 'rotate' ? 'crosshair' : 'grabbing';
    } else {
      drag = { kind: 'pan', sx: p.sx, sy: p.sy, ox: view.ox, oy: view.oy };
      canvas.style.cursor = 'move';
    }
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    const p = pointer(e);
    if (!drag) {
      const w = toWorld(p.sx, p.sy);
      let cursor = null;
      if (editing()) {
        editor.mouseMove(w, pointerInfo(e, w));
        cursor = editor.cursor(w, pointerInfo(e, w));
      }
      canvas.style.cursor = cursor || (robotAt(w) ? 'grab' : 'default');
      return;
    }
    if (drag.kind === 'editor') {
      editor.mouseMove(toWorld(p.sx, p.sy), pointerInfo(e, toWorld(p.sx, p.sy)));
    } else if (drag.kind === 'pan') {
      view.ox = drag.ox + (p.sx - drag.sx);
      view.oy = drag.oy + (p.sy - drag.sy);
    } else if (drag.kind === 'robot') {
      const w = toWorld(p.sx, p.sy);
      const c = world.clampInside(w.x + drag.dx, w.y + drag.dy);
      drag.robot.x = c.x;
      drag.robot.y = c.y;
      onRobotMoved && onRobotMoved(drag.robot);
    } else if (drag.kind === 'rotate') {
      const w = toWorld(p.sx, p.sy);
      const r = drag.robot;
      const ang = Math.atan2(w.x - r.x, w.y - r.y) / DEG;
      r.heading = ((ang % 360) + 360) % 360;
      onRobotMoved && onRobotMoved(r);
    }
  });
  window.addEventListener('mouseup', () => {
    if (drag && drag.kind === 'editor' && editor) editor.mouseUp();
    drag = null;
    canvas.style.cursor = 'default';
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = pointer(e);
      const before = toWorld(p.sx, p.sy);
      const factor = Math.exp(-e.deltaY * 0.0015);
      view.scale = clamp(view.scale * factor, 0.5, 40);
      view.ox = p.sx - before.x * view.scale;
      view.oy = p.sy + before.y * view.scale;
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', () => {
    if (editing() && editor.dblClick()) return;
    fit();
  });

  // ---- drawing ----
  function draw() {
    resize();
    const w = scene || world; // a scene has the same shape as the world (d-15)
    const f = w.floor;
    if (!f || !cssW) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e4e7ec';
    ctx.fillRect(0, 0, cssW, cssH);

    const s = view.scale;
    ctx.save();
    // world transform: translate to origin, flip y
    ctx.translate(view.ox, view.oy);
    ctx.scale(s, -s);

    // floor
    ctx.fillStyle = BACKGROUNDS[f.background] || BACKGROUNDS.white;
    ctx.fillRect(0, 0, f.width, f.height);
    // grid every 10 cm
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1 / s;
    ctx.beginPath();
    for (let x = 10; x < f.width; x += 10) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, f.height);
    }
    for (let y = 10; y < f.height; y += 10) {
      ctx.moveTo(0, y);
      ctx.lineTo(f.width, y);
    }
    ctx.stroke();

    // dark areas
    for (const a of f.darkAreas || []) {
      ctx.fillStyle = 'rgba(20,24,40,0.72)';
      ctx.fillRect(a.x, a.y, a.w, a.h);
    }
    // slopes (uphill arrow)
    for (const sl of f.slopes || []) drawSlope(sl);
    // lights
    for (const l of f.lights || []) {
      const reach = l.reach || 80;
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, reach);
      const a = 0.25 + 0.5 * ((l.brightness ?? 100) / 100);
      g.addColorStop(0, `rgba(255,225,120,${a})`);
      g.addColorStop(0.5, `rgba(255,225,120,${a / 3})`);
      g.addColorStop(1, 'rgba(255,225,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(l.x, l.y, reach, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f5b400';
      ctx.beginPath();
      ctx.arc(l.x, l.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // tape
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const t of f.tape || []) {
      if (!t.points || t.points.length < 2) continue;
      ctx.strokeStyle = t.color || '#111';
      ctx.lineWidth = t.width || 2.5;
      ctx.beginPath();
      t.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    // walls and boxes
    for (const w of f.walls || []) {
      if (w.kind === 'box') {
        ctx.fillStyle = '#d3a866';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = '#8a6a3a';
        ctx.lineWidth = 0.6;
        ctx.strokeRect(w.x, w.y, w.w, w.h);
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(w.x, w.y);
        ctx.lineTo(w.x + w.w, w.y + w.h);
        ctx.moveTo(w.x + w.w, w.y);
        ctx.lineTo(w.x, w.y + w.h);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#5b6470';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = '#2f3640';
        ctx.lineWidth = 0.6;
        ctx.strokeRect(w.x, w.y, w.w, w.h);
      }
    }
    // goal markers (Milestone 4, d-20): finish zones and numbered checkpoints, under the start mark
    for (const z of f.finishZones || []) drawFinishZone(z);
    (f.checkpoints || []).forEach((c, i) => drawCheckpoint(c, i + 1));
    // start marks (a gallery drawing has none); a two-robot floor has one per Finch (d-24)
    if (f.start) drawStartMark(f.start, f.startB ? 'A' : null);
    if (f.startB) drawStartMark(f.startB, 'B');
    // trails: one per robot (d-24); a scene without per-robot trails carries a single legacy trail
    const robots = w.robots || [];
    const two = robots.length > 1;
    if (robots.some((r) => r.trail)) for (const r of robots) drawTrail(r.trail, TRAIL_COLORS[r.name]);
    else drawTrail(w.trail, TRAIL_COLORS.A);
    // pen ink (Milestone 3): on top of the trail, under the robot
    drawInk(w.ink);
    // robot(s), lettered when there are two
    for (const robot of robots) {
      drawRobot(robot, w.time || 0);
      if (two) drawRobotLabel(robot);
    }
    // the trail point she is hovering on the run timeline (replay)
    if (w.marker) {
      ctx.strokeStyle = '#d35400';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(w.marker.x, w.marker.y, 2.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    // a hand in front of a beak: each robot has its own (d-24); a scene without per-robot input has A's
    robots.forEach((robot, i) => {
      const input = robot.input || (i === 0 ? w.input : null);
      const hand = input ? input.hand : null;
      if (hand === null || hand === undefined) return;
      const p = localToWorld(robot, ROBOT.beakTip + hand, 0);
      const v = headingVec(robot.heading + 90);
      ctx.strokeStyle = '#d35400';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x - v.x * 6, p.y - v.y * 6);
      ctx.lineTo(p.x + v.x * 6, p.y + v.y * 6);
      ctx.stroke();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(1, -1);
      ctx.font = '4px system-ui';
      ctx.fillStyle = '#d35400';
      ctx.textAlign = 'center';
      ctx.fillText('hand', 0, -7);
      ctx.restore();
    });
    // editor overlay (selection, handles, pending tape, snap grid)
    if (editing()) {
      ctx.save();
      editor.drawOverlay(ctx, s);
      ctx.restore();
    }
    ctx.restore();

    drawCompass();
    drawScaleBar();
  }

  function drawSlope(sl) {
    ctx.fillStyle = 'rgba(150,100,220,0.18)';
    ctx.fillRect(sl.x, sl.y, sl.w, sl.h);
    ctx.strokeStyle = 'rgba(110,60,190,0.6)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 1.5]);
    ctx.strokeRect(sl.x, sl.y, sl.w, sl.h);
    ctx.setLineDash([]);
    const cx = sl.x + sl.w / 2;
    const cy = sl.y + sl.h / 2;
    const v = headingVec(sl.uphill || 0);
    const len = Math.max(4, Math.min(sl.w, sl.h) * 0.35);
    const tx = cx + v.x * len;
    const ty = cy + v.y * len;
    const side = headingVec((sl.uphill || 0) + 90);
    ctx.strokeStyle = 'rgba(90,40,170,0.9)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(cx - v.x * len, cy - v.y * len);
    ctx.lineTo(tx, ty);
    ctx.moveTo(tx - v.x * 3 - side.x * 2.2, ty - v.y * 3 - side.y * 2.2);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx - v.x * 3 + side.x * 2.2, ty - v.y * 3 + side.y * 2.2);
    ctx.stroke();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, -1);
    ctx.font = '3.5px system-ui';
    ctx.fillStyle = 'rgba(90,40,170,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText('uphill', 0, len + 5);
    ctx.restore();
  }

  /** Pen strokes: [{ color, width, points: [[x, y, t], ...] }] in floor centimetres. */
  function drawInk(ink) {
    if (!ink || !ink.length) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of ink) {
      const pts = s.points || [];
      if (!pts.length) continue;
      const width = s.width || 0.7;
      ctx.strokeStyle = s.color || '#d62828';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = width;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], width / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i) ctx.lineTo(pts[i][0], pts[i][1]);
        else ctx.moveTo(pts[i][0], pts[i][1]);
      }
      ctx.stroke();
    }
  }

  /** A finish zone {x, y, w, h}: a chequered flag in a green frame, labelled FINISH. */
  function drawFinishZone(z) {
    ctx.fillStyle = 'rgba(46,160,67,0.12)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    const cell = Math.max(1.5, Math.min(z.w, z.h) / 6);
    const cols = Math.min(60, Math.ceil(z.w / cell));
    const rows = Math.min(60, Math.ceil(z.h / cell));
    ctx.fillStyle = 'rgba(30,60,40,0.2)';
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if ((i + j) % 2 === 0) ctx.fillRect(z.x + i * cell, z.y + j * cell, Math.min(cell, z.w - i * cell), Math.min(cell, z.h - j * cell));
      }
    }
    ctx.strokeStyle = 'rgba(46,160,67,0.9)';
    ctx.lineWidth = 0.7;
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.save();
    ctx.translate(z.x + z.w / 2, z.y + z.h / 2);
    ctx.scale(1, -1);
    ctx.font = `bold ${Math.max(2.5, Math.min(5, z.w / 7))}px system-ui`;
    ctx.fillStyle = 'rgba(20,90,40,0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', 0, 0);
    ctx.restore();
  }

  /** A checkpoint {x, y, r}: an orange ring with its number (the visiting order). */
  function drawCheckpoint(c, n) {
    const r = c.r || 8;
    ctx.fillStyle = 'rgba(245,158,11,0.15)';
    ctx.strokeStyle = 'rgba(217,119,6,0.9)';
    ctx.lineWidth = 0.6;
    ctx.setLineDash([1.5, 1]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(1, -1);
    ctx.font = `bold ${Math.max(3, Math.min(6, r * 0.8))}px system-ui`;
    ctx.fillStyle = 'rgba(180,83,9,0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  }

  /** A start mark; `label` names the Finch that starts there on a two-robot floor (d-24). */
  function drawStartMark(start, label) {
    ctx.save();
    ctx.translate(start.x, start.y);
    ctx.rotate(-start.heading * DEG);
    ctx.strokeStyle = label ? ROBOT_TINT[label] : 'rgba(46,160,67,0.9)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([1.2, 1]);
    ctx.strokeRect(-6.5, -6.5, 13, 13);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(0, 4);
    ctx.moveTo(-2, 2);
    ctx.lineTo(0, 4);
    ctx.lineTo(2, 2);
    ctx.stroke();
    ctx.restore();
    if (label) letter(start.x + 8, start.y - 8, label, 3.5);
  }

  /** One robot's trail (its path this run) in its colour. */
  function drawTrail(points, color) {
    const trail = points || [];
    if (trail.length < 2) return;
    ctx.strokeStyle = color || TRAIL_COLORS.A;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    trail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }

  /** An upright letter in a coloured disc, in floor coordinates. */
  function letter(x, y, text, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, -1);
    ctx.fillStyle = ROBOT_TINT[text] || '#333';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${size}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, size * 0.05);
    ctx.restore();
  }

  /** The letter beside a robot when the floor holds two (d-24), upright whatever its heading. */
  function drawRobotLabel(robot) {
    letter(robot.x + 8.5, robot.y + 8.5, robot.name, 4);
  }

  function drawRobot(robot, now) {
    ctx.save();
    ctx.translate(robot.x, robot.y);
    // rotate so that local +y points along the heading
    ctx.rotate(-robot.heading * DEG);
    const R = ROBOT;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    roundRect(-R.width / 2 + 0.4, -R.rearLength - 0.4, R.width, R.frontLength + R.rearLength, 2.5);
    ctx.fill();
    // wheels
    ctx.fillStyle = '#222';
    ctx.fillRect(-R.track / 2 - 1.2, -R.wheelDiameter / 2, 1.2, R.wheelDiameter);
    ctx.fillRect(R.track / 2, -R.wheelDiameter / 2, 1.2, R.wheelDiameter);
    // body
    ctx.fillStyle = robot.blocked ? '#f2f2f2' : '#fafafa';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.35;
    roundRect(-R.width / 2, -R.rearLength, R.width, R.frontLength + R.rearLength, 2.5);
    ctx.fill();
    ctx.stroke();
    // beak
    const beak = led(robot.beak);
    ctx.beginPath();
    ctx.moveTo(-2.4, R.frontLength - 0.2);
    ctx.lineTo(0, R.beakTip);
    ctx.lineTo(2.4, R.frontLength - 0.2);
    ctx.closePath();
    ctx.fillStyle = beak || '#cfcfcf';
    ctx.fill();
    ctx.stroke();
    if (beak) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = beak;
      ctx.beginPath();
      ctx.arc(0, R.frontLength + 1, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // tail LEDs
    robot.tail.forEach((c, i) => {
      const col = led(c);
      ctx.beginPath();
      ctx.arc(-3.75 + i * 2.5, -R.rearLength + 1.1, 0.75, 0, Math.PI * 2);
      ctx.fillStyle = col || '#cfcfcf';
      ctx.fill();
      if (col) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(-3.75 + i * 2.5, -R.rearLength + 1.1, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
    // micro:bit display 5x5 (row 1 at the front)
    const frame = robot.displayFrame(now);
    const cell = 0.85;
    const gx = -2 * cell;
    const gy = 1.4;
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(gx - 0.7, gy - 4 * cell - 0.7, 4 * cell + 1.4, 4 * cell + 1.4);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        ctx.beginPath();
        ctx.arc(gx + c * cell, gy - r * cell, 0.3, 0, Math.PI * 2);
        ctx.fillStyle = frame[r * 5 + c] ? '#ff3b30' : '#4a4a4a';
        ctx.fill();
      }
    }
    // buzzer indicator
    if (robot.buzzer) {
      ctx.save();
      ctx.scale(1, -1);
      ctx.font = 'bold 3px system-ui';
      ctx.fillStyle = '#d35400';
      ctx.textAlign = 'center';
      ctx.fillText('♪', 0, 6.2);
      ctx.restore();
    }
    // pen (Milestone 3): a coloured dot at the pose while the pen is down
    if (robot.pen && robot.pen.down) {
      ctx.fillStyle = robot.pen.color || '#d62828';
      ctx.beginPath();
      ctx.arc(0, 0, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 0.25;
      ctx.stroke();
    }
    // line sensors (underside) as tiny dots for reference
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (const lat of [-R.lineSensorLateral, R.lineSensorLateral]) {
      ctx.beginPath();
      ctx.arc(lat, R.lineSensorForward, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawCompass() {
    const cx = cssW - 34;
    const cy = 34;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 12);
    ctx.lineTo(cx, cy - 12);
    ctx.moveTo(cx - 5, cy - 6);
    ctx.lineTo(cx, cy - 12);
    ctx.lineTo(cx + 5, cy - 6);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, cy - 13);
    ctx.restore();
  }

  function drawScaleBar() {
    const cm = view.scale > 8 ? 10 : view.scale > 3 ? 20 : 50;
    const px = cm * view.scale;
    const x = 14;
    const y = cssH - 14;
    ctx.save();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.moveTo(x + px, y - 4);
    ctx.lineTo(x + px, y + 4);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(cm + ' cm', x + 4, y - 6);
    ctx.restore();
  }

  return {
    draw,
    fit: () => {
      resize();
      fit();
    },
    floorChanged: () => {
      fitted = false;
      resize();
      fit();
    },
    /** Attach the floor editor (Milestone 2); it gets pointer events first while active. */
    setEditor: (ed) => {
      editor = ed;
    },
    toWorld,
    toScreen,
    /** Draw a replay or gallery scene instead of the live world (null goes back to the world). */
    setScene: (s) => {
      scene = s;
      fitted = false;
      resize();
      fit();
    },
    get scene() {
      return scene;
    },
    get view() {
      return view;
    },
  };
}
