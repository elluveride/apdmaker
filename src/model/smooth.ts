import {
  dist,
  distToSegment,
  fitCubic,
  flatten,
  mul,
  nearestOnPolyline,
  norm,
  resample,
  sub,
  translateNode,
  type Segment,
} from './geometry';
import type { AirportDoc, ID, PathNode, Taxiway, Vec } from './types';

export interface SmoothResult {
  nodes: PathNode[];
  straight: boolean;
  /** Number of curves the path was redrawn with; 1 is a single curve. */
  pieces: number;
  /** Farthest the old path strays from the new one, ft. */
  deviation: number;
  /** When one curve couldn't follow the route: how far it would have strayed, ft. */
  singleCurveError?: number;
}

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

/** How closely a curve must follow the drawn route: about two taxiway widths. */
export const routeTolerance = (pathLength: number, width: number): number =>
  Math.max(2 * width, 120, Math.min(pathLength * 0.02, 250));

interface Piece {
  from: number;
  to: number;
  start: Vec;
  end: Vec;
  seg: Segment;
}

/** Split a route one curve can't follow at its worst point until every piece follows it. */
function splitPieces(pts: Vec[], from: number, to: number, start: Vec, end: Vec, tolerance: number, depth: number): Piece[] {
  const fit = fitCubic(pts.slice(from, to + 1), { start, end });
  if (fit.error <= tolerance || to - from < 12 || depth >= 5) return [{ from, to, start, end, seg: fit.seg }];
  const k = from + Math.min(to - from - 6, Math.max(5, fit.worst));
  const dir = norm(sub(pts[k + 2], pts[k - 2]));
  return [
    ...splitPieces(pts, from, k, start, mul(dir, -1), tolerance, depth + 1),
    ...splitPieces(pts, k, to, dir, end, tolerance, depth + 1),
  ];
}

/** Rejoin neighbours wherever one curve can still follow both, so the piece count stays minimal. */
function mergePieces(pts: Vec[], pieces: Piece[], tolerance: number): Piece[] {
  const out = pieces.slice();
  for (let i = 0; i < out.length - 1; ) {
    const a = out[i];
    const b = out[i + 1];
    const fit = fitCubic(pts.slice(a.from, b.to + 1), { start: a.start, end: b.end });
    if (fit.error <= tolerance) {
      out.splice(i, 2, { from: a.from, to: b.to, start: a.start, end: b.end, seg: fit.seg });
      i = Math.max(0, i - 1);
    } else {
      i++;
    }
  }
  return out;
}

/** True when some interior point turns sharply instead of flowing through. */
function hasCorners(nodes: PathNode[]): boolean {
  return nodes.slice(1, -1).some((n) => {
    if (!n.in || !n.out) return true;
    const a = norm(sub(n.p, n.in));
    const b = norm(sub(n.out, n.p));
    return a.x * b.x + a.y * b.y < 0.999;
  });
}

function segmentsToNodes(segs: Segment[]): PathNode[] {
  const nodes: PathNode[] = [{ p: segs[0].p0, out: segs[0].c1 }];
  segs.forEach((s, i) => {
    const next = segs[i + 1];
    nodes.push(next ? { p: s.p3, in: s.c2, out: next.c1, smooth: true } : { p: s.p3, in: s.c2 });
  });
  return nodes;
}

/** Farthest any point of `a` lies from path `b`. */
function pathDistance(a: PathNode[], b: PathNode[]): number {
  const target = flatten(b, false, 10);
  return Math.max(0, ...resample(flatten(a, false, 10), 96).map((p) => nearestOnPolyline(target, p)?.dist ?? 0));
}

/**
 * Keep the first and last points and redraw everything between them as the
 * smoothest curve that still follows the drawn route: a straight line when the
 * route never strays far from one, otherwise a single curve, and only when one
 * curve would wander off the route, the fewest curves joined without corners.
 */
export function autoSmooth(nodes: PathNode[], width: number): SmoothResult {
  if (nodes.length < 2) return { nodes, straight: true, pieces: 0, deviation: 0 };
  const first = nodes[0].p;
  const last = nodes[nodes.length - 1].p;
  const poly = flatten(nodes, false, 10);
  const pts = resample(poly, Math.min(400, Math.max(64, Math.round(poly.length / 40))));
  const offsets = pts.map((p) => distToSegment(p, first, last));
  const bulge = Math.max(0, ...offsets);
  const mean = offsets.reduce((sum, d) => sum + d, 0) / offsets.length;

  if (isNearlyStraight(bulge, mean, straightTolerance(dist(first, last), width))) {
    return { nodes: [{ p: first }, { p: last }], straight: true, pieces: 0, deviation: bulge };
  }
  // Already a single curve: refitting would only nudge it, so smoothing twice changes nothing.
  if (nodes.length === 2) return { nodes, straight: false, pieces: 1, deviation: 0 };

  const tolerance = routeTolerance(poly.length, width);
  const single = fitCubic(pts);
  let result: SmoothResult;
  if (single.error <= tolerance) {
    result = {
      nodes: [{ p: first, out: single.seg.c1 }, { p: last, in: single.seg.c2 }],
      straight: false,
      pieces: 1,
      deviation: single.error,
    };
  } else {
    const n = pts.length;
    const start = norm(sub(pts[2], pts[0]));
    const end = norm(sub(pts[n - 3], pts[n - 1]));
    const segs = mergePieces(pts, splitPieces(pts, 0, n - 1, start, end, tolerance, 0), tolerance).map((p) => p.seg);
    const smoothed = segmentsToNodes(segs);
    result = {
      nodes: smoothed,
      straight: false,
      pieces: segs.length,
      deviation: pathDistance(nodes, smoothed),
      singleCurveError: single.error,
    };
  }
  // A path that already flows without corners is left alone unless smoothing would simplify it.
  if (result.nodes.length >= nodes.length && (!hasCorners(nodes) || pathDistance(result.nodes, nodes) < 2)) {
    return { nodes, straight: false, pieces: nodes.length - 1, deviation: 0 };
  }
  return result;
}

/** Taxiway ends within this distance of a centerline count as attached to it. */
const ATTACH_TOLERANCE = 2;

export interface SmoothTaxiwayResult extends SmoothResult {
  doc: AirportDoc;
  before: number;
  /** Ends of other taxiways that were slid along with the curve. */
  reattached: number;
}

/** Auto-smooth one taxiway and slide any taxiway ends that met its centerline onto the new curve. */
export function autoSmoothTaxiway(doc: AirportDoc, id: ID): SmoothTaxiwayResult | null {
  const t = doc.features.find((f): f is Taxiway => f.id === id && f.kind === 'taxiway');
  if (!t || t.closed || t.nodes.length < 2) return null;

  const result = autoSmooth(t.nodes, t.width);
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
