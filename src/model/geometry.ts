import type { PathNode, Vec } from './types';

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const mid = (a: Vec, b: Vec): Vec => lerp(a, b, 0.5);
export const eq = (a: Vec, b: Vec, eps = 1e-6): boolean => dist(a, b) < eps;

export function norm(a: Vec): Vec {
  const l = len(a);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Left of a travel direction, in screen space (y down). */
export const leftOf = (d: Vec): Vec => ({ x: d.y, y: -d.x });
export const rightOf = (d: Vec): Vec => ({ x: -d.y, y: d.x });

export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (d: number): number => (d * Math.PI) / 180;
export const wrap360 = (d: number): number => ((d % 360) + 360) % 360;

/** True bearing from `from` to `to`, degrees clockwise from north. */
export const bearing = (from: Vec, to: Vec): number =>
  wrap360(deg(Math.atan2(to.x - from.x, -(to.y - from.y))));

/** Unit vector pointing along a bearing. */
export const dirFromBearing = (b: number): Vec => ({ x: Math.sin(rad(b)), y: -Math.cos(rad(b)) });

export function rotateAround(p: Vec, c: Vec, degrees: number): Vec {
  const r = rad(degrees);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Rotation (deg, clockwise) that keeps text running along `d` but never upside down. */
export function uprightAngle(d: Vec): number {
  let a = deg(Math.atan2(d.y, d.x));
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
}

export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  return dist(p, closestOnSegment(p, a, b));
}

export function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return lerp(a, b, t);
}

export function pointInPolygon(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Vec[]): Box | null {
  if (points.length === 0) return null;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    box.minX = Math.min(box.minX, p.x);
    box.minY = Math.min(box.minY, p.y);
    box.maxX = Math.max(box.maxX, p.x);
    box.maxY = Math.max(box.maxY, p.y);
  }
  return box;
}

export const padBox = (b: Box, pad: number): Box => ({
  minX: b.minX - pad,
  minY: b.minY - pad,
  maxX: b.maxX + pad,
  maxY: b.maxY + pad,
});

/* ------------------------------------------------------------------ */
/* Cubic bezier paths                                                  */
/* ------------------------------------------------------------------ */

export interface Segment {
  p0: Vec;
  c1: Vec;
  c2: Vec;
  p3: Vec;
}

export function pathSegments(nodes: PathNode[], closed: boolean): Segment[] {
  const segs: Segment[] = [];
  const count = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    segs.push({ p0: a.p, c1: a.out ?? a.p, c2: b.in ?? b.p, p3: b.p });
  }
  return segs;
}

export const isStraight = (s: Segment): boolean => eq(s.c1, s.p0) && eq(s.c2, s.p3);

export function bezierPoint(s: Segment, t: number): Vec {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p3.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p3.y,
  };
}

/** B'(t), not normalized. */
export function bezierDerivative(s: Segment, t: number): Vec {
  const u = 1 - t;
  return {
    x: 3 * u * u * (s.c1.x - s.p0.x) + 6 * u * t * (s.c2.x - s.c1.x) + 3 * t * t * (s.p3.x - s.c2.x),
    y: 3 * u * u * (s.c1.y - s.p0.y) + 6 * u * t * (s.c2.y - s.c1.y) + 3 * t * t * (s.p3.y - s.c2.y),
  };
}

export function bezierTangent(s: Segment, t: number): Vec {
  const d = bezierDerivative(s, t);
  if (len(d) > 1e-9) return norm(d);
  // A handle sitting on its end point zeroes the derivative there; the curve
  // still leaves toward the other handle, and only a straight line falls back to the chord.
  const toward = t < 0.5 ? sub(s.c2, s.p0) : sub(s.p3, s.c1);
  return len(toward) > 1e-9 ? norm(toward) : norm(sub(s.p3, s.p0));
}

/** De Casteljau split at t. */
export function splitBezier(s: Segment, t: number): [Segment, Segment] {
  const p01 = lerp(s.p0, s.c1, t);
  const p12 = lerp(s.c1, s.c2, t);
  const p23 = lerp(s.c2, s.p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  return [
    { p0: s.p0, c1: p01, c2: p012, p3: m },
    { p0: m, c1: p123, c2: p23, p3: s.p3 },
  ];
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

export function pathD(nodes: PathNode[], closed: boolean): string {
  if (nodes.length === 0) return '';
  let d = `M${f(nodes[0].p.x)} ${f(nodes[0].p.y)}`;
  for (const s of pathSegments(nodes, closed)) {
    d += isStraight(s)
      ? `L${f(s.p3.x)} ${f(s.p3.y)}`
      : `C${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.p3.x)} ${f(s.p3.y)}`;
  }
  return closed ? `${d}Z` : d;
}

export function polylineD(pts: Vec[], closed = false): string {
  if (pts.length === 0) return '';
  const body = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)} ${f(p.y)}`).join('');
  return closed ? `${body}Z` : body;
}

/* ------------------------------------------------------------------ */
/* Flattened paths, for hit testing, snapping and measuring            */
/* ------------------------------------------------------------------ */

export interface Polyline {
  pts: Vec[];
  /** Bezier segment each point belongs to, and its parameter there. */
  seg: number[];
  t: number[];
  /** Cumulative arc length at each point. */
  cum: number[];
  length: number;
}

function controlNetLength(s: Segment): number {
  return dist(s.p0, s.c1) + dist(s.c1, s.c2) + dist(s.c2, s.p3);
}

/** Flatten a path into a polyline; `step` caps the distance between samples. */
export function flatten(nodes: PathNode[], closed: boolean, step = 25): Polyline {
  const out: Polyline = { pts: [], seg: [], t: [], cum: [], length: 0 };
  if (nodes.length === 0) return out;
  const push = (p: Vec, seg: number, t: number) => {
    if (out.pts.length > 0) out.length += dist(out.pts[out.pts.length - 1], p);
    out.pts.push(p);
    out.seg.push(seg);
    out.t.push(t);
    out.cum.push(out.length);
  };
  push(nodes[0].p, 0, 0);
  pathSegments(nodes, closed).forEach((s, i) => {
    const n = Math.max(isStraight(s) ? 1 : 8, Math.min(400, Math.ceil(controlNetLength(s) / step)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      push(isStraight(s) ? lerp(s.p0, s.p3, t) : bezierPoint(s, t), i, t);
    }
  });
  return out;
}

export interface NearestHit {
  point: Vec;
  dist: number;
  /** Arc length along the polyline. */
  s: number;
  segIndex: number;
  t: number;
}

export function nearestOnPolyline(poly: Polyline, p: Vec): NearestHit | null {
  if (poly.pts.length === 0) return null;
  if (poly.pts.length === 1) {
    return { point: poly.pts[0], dist: dist(p, poly.pts[0]), s: 0, segIndex: 0, t: 0 };
  }
  let best: NearestHit | null = null;
  for (let i = 0; i < poly.pts.length - 1; i++) {
    const a = poly.pts[i];
    const b = poly.pts[i + 1];
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    const k = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
    const q = lerp(a, b, k);
    const d = dist(p, q);
    if (!best || d < best.dist) {
      const segIndex = poly.seg[i + 1];
      const t0 = poly.seg[i] === segIndex ? poly.t[i] : 0;
      best = {
        point: q,
        dist: d,
        s: poly.cum[i] + k * Math.sqrt(l2),
        segIndex,
        t: t0 + (poly.t[i + 1] - t0) * k,
      };
    }
  }
  return best;
}

export function pointAtLength(poly: Polyline, s: number): { point: Vec; tangent: Vec } {
  const pts = poly.pts;
  if (pts.length < 2) return { point: pts[0] ?? vec(0, 0), tangent: vec(1, 0) };
  const target = Math.max(0, Math.min(poly.length, s));
  let i = 0;
  while (i < pts.length - 2 && poly.cum[i + 1] < target) i++;
  const span = poly.cum[i + 1] - poly.cum[i];
  const k = span < 1e-9 ? 0 : (target - poly.cum[i]) / span;
  return { point: lerp(pts[i], pts[i + 1], k), tangent: norm(sub(pts[i + 1], pts[i])) };
}

/** `n` points evenly spaced by arc length, both ends included. */
export function resample(poly: Polyline, n: number): Vec[] {
  return Array.from({ length: n }, (_, i) => pointAtLength(poly, (poly.length * i) / (n - 1)).point);
}

/* ------------------------------------------------------------------ */
/* Lines                                                               */
/* ------------------------------------------------------------------ */

/** Ramer-Douglas-Peucker: indices of the points that keep a polyline within `eps` of the original. */
export function simplify(pts: Vec[], eps: number): number[] {
  if (pts.length < 3) return pts.map((_, i) => i);
  const keep = new Set([0, pts.length - 1]);
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let max = eps;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i], pts[a], pts[b]);
      if (d > max) {
        max = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep.add(worst);
      stack.push([a, worst], [worst, b]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}

export interface Line {
  p: Vec;
  /** Unit direction. */
  d: Vec;
}

export function lineIntersection(a: Line, b: Line): Vec | null {
  const den = cross(a.d, b.d);
  if (Math.abs(den) < 1e-9) return null;
  return add(a.p, mul(a.d, cross(sub(b.p, a.p), b.d) / den));
}

/** Unsigned angle between two directions, 0 to 180 degrees. */
export const angleBetween = (a: Vec, b: Vec): number =>
  deg(Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))));

/* ------------------------------------------------------------------ */
/* Node editing                                                        */
/* ------------------------------------------------------------------ */

export function translateNode(n: PathNode, d: Vec): PathNode {
  return {
    ...n,
    p: add(n.p, d),
    in: n.in && add(n.in, d),
    out: n.out && add(n.out, d),
  };
}

export function rotateNode(n: PathNode, c: Vec, degrees: number): PathNode {
  return {
    ...n,
    p: rotateAround(n.p, c, degrees),
    in: n.in && rotateAround(n.in, c, degrees),
    out: n.out && rotateAround(n.out, c, degrees),
  };
}

/** Move one handle; a smooth node swings its other handle to stay collinear. */
export function moveHandle(n: PathNode, which: 'in' | 'out', to: Vec, breakSymmetry = false): PathNode {
  const other = which === 'in' ? 'out' : 'in';
  const next: PathNode = { ...n, [which]: to };
  if (n.smooth && !breakSymmetry) {
    const dir = norm(sub(n.p, to));
    const otherLen = n[other] ? dist(n[other]!, n.p) : dist(to, n.p);
    next[other] = add(n.p, mul(dir, otherLen));
  }
  if (breakSymmetry) next.smooth = false;
  return next;
}

/** Give a node smooth handles aimed along its neighbours (Catmull-Rom style). */
export function smoothNode(nodes: PathNode[], i: number, closed: boolean): PathNode {
  const n = nodes[i];
  const prev = i > 0 ? nodes[i - 1] : closed ? nodes[nodes.length - 1] : undefined;
  const next = i < nodes.length - 1 ? nodes[i + 1] : closed ? nodes[0] : undefined;
  if (!prev && !next) return n;
  const a = prev?.p ?? n.p;
  const b = next?.p ?? n.p;
  const tangent = norm(sub(b, a));
  const inLen = prev ? dist(prev.p, n.p) / 3 : 0;
  const outLen = next ? dist(n.p, next.p) / 3 : 0;
  return {
    ...n,
    smooth: true,
    in: prev ? sub(n.p, mul(tangent, inLen)) : undefined,
    out: next ? add(n.p, mul(tangent, outLen)) : undefined,
  };
}

export const cornerNode = (n: PathNode): PathNode => ({ p: n.p });

/** Insert an anchor at (segIndex, t) without changing the curve's shape. */
export function insertNode(nodes: PathNode[], closed: boolean, segIndex: number, t: number): PathNode[] {
  const segs = pathSegments(nodes, closed);
  const s = segs[segIndex];
  if (!s) return nodes;
  const [left, right] = splitBezier(s, t);
  const straight = isStraight(s);
  const a = nodes[segIndex];
  const bIndex = (segIndex + 1) % nodes.length;
  const b = nodes[bIndex];
  const created: PathNode = straight
    ? { p: left.p3 }
    : { p: left.p3, in: left.c2, out: right.c1, smooth: true };
  const result = nodes.slice();
  if (!straight) {
    result[segIndex] = { ...a, out: left.c1 };
    result[bIndex] = { ...b, in: right.c2 };
  }
  result.splice(segIndex + 1, 0, created);
  return result;
}

export function reverseNodes(nodes: PathNode[]): PathNode[] {
  return nodes
    .slice()
    .reverse()
    .map((n) => ({ ...n, in: n.out, out: n.in }));
}

export function nodesCentroid(nodes: PathNode[]): Vec {
  if (nodes.length === 0) return vec(0, 0);
  const s = nodes.reduce((acc, n) => add(acc, n.p), vec(0, 0));
  return mul(s, 1 / nodes.length);
}
