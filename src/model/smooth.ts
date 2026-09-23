import {
  add,
  angleBetween,
  bezierTangent,
  dist,
  distToSegment,
  dot,
  flatten,
  leftOf,
  lineIntersection,
  mul,
  nearestOnPolyline,
  norm,
  pathSegments,
  pointAtLength,
  rad,
  resample,
  rightOf,
  simplify,
  sub,
  translateNode,
  type Line,
} from './geometry';
import type { AirportDoc, ID, PathNode, Runway, Taxiway, Vec } from './types';

/* ------------------------------------------------------------------ */
/* FAA geometry                                                        */
/* ------------------------------------------------------------------ */

/** Turn angles (heading change) the FAA tabulates, degrees. */
const TURN_ANGLES = [30, 45, 60, 90, 120, 135, 150];

/**
 * Taxiway centerline turn radius (R-CL, ft) by taxiway width and turn angle,
 * from AC 150/5300-13A tables 4-4 to 4-10 (TDG 1B, 2, 3, 5 and 6/7).
 */
const CENTERLINE_RADII: { maxWidth: number; radii: number[] }[] = [
  { maxWidth: 25, radii: [50, 50, 50, 40, 50, 50, 50] },
  { maxWidth: 35, radii: [75, 75, 75, 60, 75, 75, 80] },
  { maxWidth: 50, radii: [75, 75, 75, 60, 75, 80, 80] },
  { maxWidth: 75, radii: [110, 110, 110, 95, 115, 120, 120] },
  { maxWidth: Infinity, radii: [150, 150, 150, 115, 140, 150, 150] },
];

export function turnRadius(width: number, turn: number): number {
  const radii = CENTERLINE_RADII.find((r) => width <= r.maxWidth)!.radii;
  if (turn <= TURN_ANGLES[0]) return radii[0];
  const i = TURN_ANGLES.findIndex((_, k) => k < TURN_ANGLES.length - 1 && turn <= TURN_ANGLES[k + 1]);
  if (i < 0) return radii[radii.length - 1];
  const k = (turn - TURN_ANGLES[i]) / (TURN_ANGLES[i + 1] - TURN_ANGLES[i]);
  return radii[i] + (radii[i + 1] - radii[i]) * k;
}

/** What a taxiway end connects to: the direction of the runway or taxiway centerline it meets. */
export interface Anchor {
  axis: Vec;
  runway: boolean;
}

/* ------------------------------------------------------------------ */
/* Straight or not                                                     */
/* ------------------------------------------------------------------ */

/**
 * How far a path may bow away from its chord and still count as straight:
 * its own width, or 3% of its length up to 150 ft, so a long parallel
 * taxiway never collapses onto the runway it serves.
 */
export const straightTolerance = (chord: number, width: number): number =>
  Math.max(width, Math.min(chord * 0.03, 150));

/**
 * Straight if the path never strays past the tolerance, or strays only briefly
 * (under twice the tolerance) while hugging the line on average. A real bend,
 * like a parallel taxiway stepping away from its runway, is off the line for
 * most of its length and fails the average.
 */
export const isNearlyStraight = (maxOffset: number, meanOffset: number, tolerance: number): boolean =>
  maxOffset <= tolerance || (maxOffset <= 2 * tolerance && meanOffset <= 0.7 * tolerance);

/* ------------------------------------------------------------------ */
/* Corners: where the straight legs of the drawing meet                */
/* ------------------------------------------------------------------ */

/** A bend of at least this is a real corner on its own. */
const SHARP_BEND = 45;
/** Gentle bends in a row add up to one turn of at most this; more is split at the longest leg. */
const MAX_GROUPED_TURN = 120;
/** Legs meeting at less than this are one leg. */
const NEGLIGIBLE_BEND = 10;

const lineThrough = (a: Vec, b: Vec): Line => ({ p: a, d: norm(sub(b, a)) });

function bendAt(v: Vec[], i: number): { angle: number; side: number } {
  const d1 = sub(v[i], v[i - 1]);
  const d2 = sub(v[i + 1], v[i]);
  return { angle: angleBetween(d1, d2), side: Math.sign(d1.x * d2.y - d1.y * d2.x) };
}

/**
 * Point the leg straight into what it connects to: square to a runway or
 * taxiway when within 20 degrees of square, or exactly 30 degrees for a
 * runway exit drawn within 10 degrees of that. Returns null to leave it.
 */
function squareTo(d: Vec, anchor: Anchor): Vec | null {
  const axis = dot(d, anchor.axis) >= 0 ? anchor.axis : mul(anchor.axis, -1);
  const side = dot(d, leftOf(axis)) >= 0 ? leftOf(axis) : rightOf(axis);
  const angle = angleBetween(d, axis);
  if (angle >= 70) return side;
  if (anchor.runway && Math.abs(angle - 30) <= 10) {
    return norm(add(mul(axis, Math.cos(rad(30))), mul(side, Math.sin(rad(30)))));
  }
  return null;
}

/**
 * Where the drawing's straight legs meet. A run of gentle bends in the same
 * direction is one turn clicked or drawn in steps (an airplane couldn't
 * straighten out between them; AC 150/5300-13A, appendix 8), so it collapses to
 * the single corner where the legs on either side meet. Bends under 10 degrees
 * are wobble and don't break a run; a real straight between turns does.
 */
function routeCorners(pts: Vec[], width: number, startDir: Vec, endDir: Vec): Vec[] {
  const idx = simplify(pts, Math.max(5, width * 0.2));
  const v = idx.map((i) => pts[i]);
  // The drawing's own direction leaving or reaching a vertex: exact on straight legs, and on a
  // curve the true tangent rather than a chord that cuts across the bend.
  const heading = (k: number, forward: boolean): Line => {
    if (forward && k === 0) return { p: v[0], d: startDir };
    if (!forward && k === v.length - 1) return { p: v[k], d: endDir };
    const i = idx[k];
    const j = forward ? Math.min(i + 1, idx[k + 1]) : Math.max(i - 1, idx[k - 1]);
    return { p: v[k], d: norm(forward ? sub(pts[j], pts[i]) : sub(pts[i], pts[j])) };
  };
  const legLength = (k: number) => dist(v[k], v[k + 1]);
  const bends = v.map((_, i) => (i > 0 && i < v.length - 1 ? bendAt(v, i) : { angle: 0, side: 0 }));
  const signed = (i: number) => bends[i].angle * bends[i].side;
  // A leg much longer than both neighbours is a straight between two turns, not a chord of one curve.
  const isStraightBetween = (k: number) => legLength(k) > 2 * Math.max(legLength(k - 1), legLength(k + 1));

  /** The corner(s) for bends i..j, all gentle and turning the same way. */
  const resolve = (i: number, j: number): Vec[] => {
    let total = 0;
    for (let k = i; k <= j; k++) total += signed(k);
    if (Math.abs(total) < NEGLIGIBLE_BEND) return [];
    if (Math.abs(total) > MAX_GROUPED_TURN && j > i) {
      let split = i;
      for (let k = i; k < j; k++) if (legLength(k) > legLength(split)) split = k;
      return [...resolve(i, split), ...resolve(split + 1, j)];
    }
    const corner = lineIntersection(heading(i - 1, true), heading(j + 1, false));
    const reach = dist(v[i - 1], v[j + 1]);
    return corner && dist(corner, v[i]) <= reach && dist(corner, v[j]) <= reach ? [corner] : v.slice(i, j + 1);
  };

  const corners: Vec[] = [v[0]];
  let i = 1;
  while (i < v.length - 1) {
    if (bends[i].angle >= SHARP_BEND) {
      corners.push(v[i]);
      i++;
      continue;
    }
    let side = bends[i].angle >= NEGLIGIBLE_BEND ? bends[i].side : 0;
    let j = i;
    while (j + 1 < v.length - 1) {
      const next = bends[j + 1];
      if (next.angle >= SHARP_BEND || isStraightBetween(j)) break;
      if (next.angle >= NEGLIGIBLE_BEND) {
        if (side === 0) side = next.side;
        else if (next.side !== side) break;
      }
      j++;
    }
    corners.push(...resolve(i, j));
    i = j + 1;
  }
  corners.push(v[v.length - 1]);

  // Merging can leave neighbouring legs nearly in line: those are one leg.
  for (let k = 1; k < corners.length - 1; ) {
    if (bendAt(corners, k).angle < NEGLIGIBLE_BEND) corners.splice(k, 1);
    else k++;
  }
  return corners;
}

/** Square the first and last legs to the runway or taxiway they meet, where they nearly are already. */
function squareEnds(corners: Vec[], width: number, anchors: { start?: Anchor; end?: Anchor }): number {
  if (corners.length < 3) return 0;
  let squared = 0;
  const trySquare = (end: number, corner: number, beyond: number, anchor?: Anchor) => {
    if (!anchor) return;
    const from = corners[end];
    const d = squareTo(norm(sub(corners[corner], from)), anchor);
    if (!d) return;
    const moved = lineIntersection({ p: from, d }, lineThrough(corners[corner], corners[beyond]));
    const reach = dist(corners[corner], corners[beyond]) + dist(from, corners[corner]);
    if (moved && dot(sub(moved, from), d) > width && dist(moved, corners[corner]) <= reach) {
      corners[corner] = moved;
      squared++;
    }
  };
  const n = corners.length;
  trySquare(0, 1, 2, anchors.start);
  trySquare(n - 1, n - 2, n - 3, anchors.end);
  return squared;
}

/* ------------------------------------------------------------------ */
/* Turns                                                               */
/* ------------------------------------------------------------------ */

interface Turn {
  at: Vec;
  d1: Vec;
  d2: Vec;
  angle: number;
  radius: number;
  tangent: number;
}

/** Arcs are drawn as cubic beziers; this handle length makes one match a circle closely. */
const arcHandle = (radius: number, sweepDeg: number) => (4 / 3) * Math.tan(rad(sweepDeg) / 4) * radius;

function turnNodes(t: Turn): PathNode[] {
  const a = sub(t.at, mul(t.d1, t.tangent));
  const b = add(t.at, mul(t.d2, t.tangent));
  if (t.angle <= 90) {
    const k = arcHandle(t.radius, t.angle);
    return [
      { p: a, out: add(a, mul(t.d1, k)) },
      { p: b, in: sub(b, mul(t.d2, k)) },
    ];
  }
  // Wide turns are split in two so each half stays accurate.
  const inward = dot(leftOf(t.d1), t.d2) >= 0 ? leftOf(t.d1) : rightOf(t.d1);
  const center = add(a, mul(inward, t.radius));
  const half = rad(t.angle / 2);
  const m = add(center, mul(add(mul(inward, -Math.cos(half)), mul(t.d1, Math.sin(half))), t.radius));
  const dm = norm(add(mul(t.d1, Math.cos(half)), mul(inward, Math.sin(half))));
  const k = arcHandle(t.radius, t.angle / 2);
  return [
    { p: a, out: add(a, mul(t.d1, k)) },
    { p: m, in: sub(m, mul(dm, k)), out: add(m, mul(dm, k)), smooth: true },
    { p: b, in: sub(b, mul(t.d2, k)) },
  ];
}

/** Straight legs between the corners, each corner rounded at the FAA radius (smaller only where legs are too short). */
function filletCorners(corners: Vec[], width: number): { nodes: PathNode[]; radii: number[] } {
  const turns: Turn[] = [];
  for (let i = 1; i < corners.length - 1; i++) {
    const d1 = norm(sub(corners[i], corners[i - 1]));
    const d2 = norm(sub(corners[i + 1], corners[i]));
    const angle = Math.min(170, angleBetween(d1, d2));
    const radius = turnRadius(width, angle);
    turns.push({ at: corners[i], d1, d2, angle, radius, tangent: radius * Math.tan(rad(angle) / 2) });
  }
  // Two turns sharing a leg split it in proportion to what each wants.
  const fitted = turns.map((t, i) => {
    const prev = turns[i - 1];
    const next = turns[i + 1];
    const before = dist(corners[i], corners[i + 1]) * (prev ? t.tangent / (t.tangent + prev.tangent) : 1);
    const after = dist(corners[i + 1], corners[i + 2]) * (next ? t.tangent / (t.tangent + next.tangent) : 1);
    const tangent = Math.min(t.tangent, before, after);
    return { ...t, tangent, radius: tangent / Math.tan(rad(t.angle) / 2) };
  });

  const nodes: PathNode[] = [{ p: corners[0] }];
  for (const t of fitted) {
    for (const n of turnNodes(t)) {
      const last = nodes[nodes.length - 1];
      if (dist(last.p, n.p) < 0.5) nodes[nodes.length - 1] = { ...last, out: n.out, smooth: !!(last.in && n.out) };
      else nodes.push(n);
    }
  }
  const tail = corners[corners.length - 1];
  const last = nodes[nodes.length - 1];
  if (dist(last.p, tail) < 0.5) nodes[nodes.length - 1] = { p: tail, in: last.in };
  else nodes.push({ p: tail });
  return { nodes, radii: fitted.map((t) => Math.round(t.radius)) };
}

/* ------------------------------------------------------------------ */
/* Auto-smooth                                                         */
/* ------------------------------------------------------------------ */

export interface SmoothResult {
  nodes: PathNode[];
  straight: boolean;
  /** Centerline radius of each turn, ft. */
  radii: number[];
  /** Ends straightened to meet a runway or taxiway square (or at 30 degrees for an exit). */
  squared: number;
  /** Farthest the old path strays from the new one, ft. */
  deviation: number;
}

/** Farthest any point of `a` lies from path `b`. */
function pathDistance(a: PathNode[], b: PathNode[]): number {
  const target = flatten(b, false, 10);
  return Math.max(0, ...resample(flatten(a, false, 10), 96).map((p) => nearestOnPolyline(target, p)?.dist ?? 0));
}

/**
 * Keep the first and last points and rebuild the taxiway the way real ones are
 * laid out: a straight line when the route never strays far from one, otherwise
 * straight legs meeting runways and taxiways square, joined by turns at the FAA
 * centerline radius for the taxiway's width.
 */
export function autoSmooth(nodes: PathNode[], width: number, anchors: { start?: Anchor; end?: Anchor } = {}): SmoothResult {
  const unchanged = { nodes, straight: nodes.length <= 2, radii: [], squared: 0, deviation: 0 };
  if (nodes.length < 2) return unchanged;
  const first = nodes[0].p;
  const last = nodes[nodes.length - 1].p;
  const poly = flatten(nodes, false, 10);
  const pts = resample(poly, Math.min(800, Math.max(64, Math.round(poly.length / 10))));
  const offsets = pts.map((p) => distToSegment(p, first, last));
  const bulge = Math.max(0, ...offsets);
  const mean = offsets.reduce((sum, d) => sum + d, 0) / offsets.length;

  let result: SmoothResult;
  if (isNearlyStraight(bulge, mean, straightTolerance(dist(first, last), width))) {
    result = { nodes: [{ p: first }, { p: last }], straight: true, radii: [], squared: 0, deviation: bulge };
  } else {
    const segs = pathSegments(nodes, false);
    const corners = routeCorners(pts, width, bezierTangent(segs[0], 0), bezierTangent(segs[segs.length - 1], 1));
    const squared = squareEnds(corners, width, anchors);
    const { nodes: rebuilt, radii } = filletCorners(corners, width);
    result = { nodes: rebuilt, straight: corners.length === 2, radii, squared, deviation: 0 };
    result.deviation = pathDistance(nodes, rebuilt);
  }
  // Smoothing a taxiway that is already smooth leaves it exactly as it is.
  if (pathDistance(result.nodes, nodes) < 3 && pathDistance(nodes, result.nodes) < 3) return unchanged;
  return result;
}

/** Taxiway ends within this distance of a centerline count as attached to it. */
const ATTACH_TOLERANCE = 2;

/** The runway or taxiway centerline a taxiway end sits on, if any. */
function anchorAt(doc: AirportDoc, self: ID, p: Vec): Anchor | undefined {
  for (const f of doc.features) {
    if (f.kind === 'runway' && !f.hidden && distToSegment(p, f.a, f.b) <= ATTACH_TOLERANCE + 1) {
      return { axis: norm(sub((f as Runway).b, (f as Runway).a)), runway: true };
    }
  }
  for (const f of doc.features) {
    if (f.kind !== 'taxiway' || f.id === self || f.hidden) continue;
    const poly = flatten(f.nodes, f.closed);
    const hit = nearestOnPolyline(poly, p);
    // Meeting the middle of another taxiway, not continuing from its end.
    if (hit && hit.dist <= ATTACH_TOLERANCE + 1 && hit.s > 20 && hit.s < poly.length - 20) {
      return { axis: pointAtLength(poly, hit.s).tangent, runway: false };
    }
  }
  return undefined;
}

export interface SmoothTaxiwayResult extends SmoothResult {
  doc: AirportDoc;
  before: number;
  /** Ends of other taxiways that were slid along with the new centerline. */
  reattached: number;
}

/** Auto-smooth one taxiway and slide any taxiway ends that met its centerline onto the new one. */
export function autoSmoothTaxiway(doc: AirportDoc, id: ID): SmoothTaxiwayResult | null {
  const t = doc.features.find((f): f is Taxiway => f.id === id && f.kind === 'taxiway');
  if (!t || t.closed || t.nodes.length < 2) return null;

  const anchors = {
    start: anchorAt(doc, t.id, t.nodes[0].p),
    end: anchorAt(doc, t.id, t.nodes[t.nodes.length - 1].p),
  };
  const result = autoSmooth(t.nodes, t.width, anchors);
  const oldPoly = flatten(t.nodes, false);
  const newPoly = flatten(result.nodes, false);
  let reattached = 0;

  const features = doc.features.map((f) => {
    if (f.id === t.id) return { ...t, nodes: result.nodes };
    if (f.kind !== 'taxiway') return f;
    const lastIndex = f.nodes.length - 1;
    let changed = false;
    const nodes = f.nodes.map((n, i) => {
      if (i !== 0 && i !== lastIndex) return n;
      const was = nearestOnPolyline(oldPoly, n.p);
      if (!was || was.dist > ATTACH_TOLERANCE) return n;
      const to = nearestOnPolyline(newPoly, n.p)!.point;
      if (dist(to, n.p) < 1e-6) return n;
      changed = true;
      reattached++;
      return translateNode(n, sub(to, n.p));
    });
    return changed ? { ...f, nodes } : f;
  });

  return { ...result, doc: { ...doc, features }, before: t.nodes.length, reattached };
}

/** Taxiway designators: letters and digits, upper case, kept short enough to chart. */
export const cleanTaxiwayName = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 8);
