// Geometry helpers for the simulation. World units are centimetres, x to the right, y up (north).
// Headings are degrees clockwise from north (0 = up, 90 = right).

export const DEG = Math.PI / 180;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function normDeg(d) {
  d = d % 360;
  return d < 0 ? d + 360 : d;
}

/** Unit vector pointing along a heading. */
export function headingVec(heading) {
  const r = heading * DEG;
  return { x: Math.sin(r), y: Math.cos(r) };
}

/** Point at (forward, right) offsets from a pose, in world coordinates. */
export function localToWorld(pose, forward, right) {
  const f = headingVec(pose.heading);
  const s = headingVec(pose.heading + 90);
  return { x: pose.x + forward * f.x + right * s.x, y: pose.y + forward * f.y + right * s.y };
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/** True when a circle overlaps an axis-aligned rectangle {x,y,w,h}. */
export function circleRectHit(cx, cy, r, rect) {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** Distance along a ray (origin, unit direction) to an axis-aligned rectangle, or Infinity. */
export function rayRect(ox, oy, dx, dy, rect) {
  if (pointInRect(ox, oy, rect)) return 0;
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const [o, d, lo, hi] of [
    [ox, dx, rect.x, rect.x + rect.w],
    [oy, dy, rect.y, rect.y + rect.h],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  if (tmax < 0) return Infinity;
  return tmin >= 0 ? tmin : 0;
}

/** Distance along a ray (origin, unit direction) to a circle, or Infinity when the ray misses it (d-24: the other robot). */
export function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx;
  const fy = oy - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // the origin is inside the circle
  const b = fx * dx + fy * dy;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

/** Distance from a point to a line segment. */
export function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** Distance from a point to a polyline (array of [x, y]). */
export function polylineDist(px, py, points) {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const d = segDist(px, py, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

/** Relative luminance (0..1) of a #rrggbb colour. */
export function hexLuminance(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function jitter(amount) {
  return (Math.random() * 2 - 1) * amount;
}
