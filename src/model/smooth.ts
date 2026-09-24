import {
  add,
  angleBetween,
  bezierTangent,
  dist,
  distToSegment,
  dot,
  closestOnSegment,
  flatten,
  isStraight,
  leftOf,
  lineIntersection,
  mul,
  nearestOnPolyline,
  norm,
  pathSegments,
  pointAtLength,
  rad,
  resample,
  reverseNodes,
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
  /** The runway's two ends, which a taxiway end may slide between. */
  span?: [Vec, Vec];
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

/** A corner of the route, and how tight the drawing actually turned there (0 = a sharp corner). */
interface Corner {
  p: Vec;
  drawnRadius: number;
  /** A radius the turn must have whatever the turn style, like a high-speed exit's curve off the runway. */
  radius?: number;
}

const sharp = (p: Vec): Corner => ({ p, drawnRadius: 0 });

function bendAt(v: Vec[], i: number): { angle: number; side: number } {
  const d1 = sub(v[i], v[i - 1]);
  const d2 = sub(v[i + 1], v[i]);
  return { angle: angleBetween(d1, d2), side: Math.sign(d1.x * d2.y - d1.y * d2.x) };
}

/** Within this of square, a connection was meant to be square. */
const SQUARE_WITHIN = 8;
/** Within this of 30 degrees, a runway exit was meant to be a 30 degree exit. */
const EXIT_WITHIN = 5;

/** A high-speed exit leaves the runway at 30 degrees (AC 150/5300-13A, 409b)... */
export const HIGH_SPEED_ANGLE = 30;
/** ...curving off the runway centerline on a 1,500 ft radius, always (409d(2)). */
export const HIGH_SPEED_RADIUS = 1500;
/** A taxiway end within this of the runway's direction leaves it along the centerline, on a curve. */
const LEAD_OFF_WITHIN = 2;

/** Exit angles a runway exit can be set to, degrees from the runway centerline. */
export const MIN_EXIT_ANGLE = 15;
export const MAX_EXIT_ANGLE = 90;

export const clampExitAngle = (deg: number): number => Math.min(MAX_EXIT_ANGLE, Math.max(MIN_EXIT_ANGLE, deg));

/** The acute angle between a direction and a centerline, 0 to 90 degrees. */
export const angleToAxis = (d: Vec, axis: Vec): number => {
  const a = angleBetween(d, axis);
  return a > 90 ? 180 - a : a;
};

/**
 * Point the leg straight into what it connects to, but only when it was
 * clearly meant to be: square when within a few degrees of square, exactly 30
 * degrees for a runway exit drawn within a few degrees of that. Any other
 * angle is deliberate and stays. A runway exit given its own angle always
 * gets it, leaning the way it was drawn. Returns null to leave it.
 */
function squareTo(d: Vec, anchor: Anchor, exitAngle?: number): Vec | null {
  const axis = dot(d, anchor.axis) >= 0 ? anchor.axis : mul(anchor.axis, -1);
  const side = dot(d, leftOf(axis)) >= 0 ? leftOf(axis) : rightOf(axis);
  const toward = (deg: number) => norm(add(mul(axis, Math.cos(rad(deg))), mul(side, Math.sin(rad(deg)))));
  if (anchor.runway && exitAngle !== undefined) return toward(clampExitAngle(exitAngle));
  const angle = angleBetween(d, axis);
  if (angle >= 90 - SQUARE_WITHIN) return side;
  if (anchor.runway && Math.abs(angle - 30) <= EXIT_WITHIN) return toward(30);
  return null;
}

/**
 * Where the drawing's straight legs meet. A run of gentle bends in the same
 * direction is one turn clicked or drawn in steps (an airplane couldn't
 * straighten out between them; AC 150/5300-13A, appendix 8), so it collapses to
 * the single corner where the legs on either side meet. Bends under 10 degrees
 * are wobble and don't break a run; a real straight between turns does.
 */
function routeCorners(pts: Vec[], width: number, startDir: Vec, endDir: Vec, clicks: Vec[]): Corner[] {
  const idx = simplify(pts, Math.max(5, width * 0.2));
  // Resampling lands a few feet from the points that were actually placed; put corners back on them.
  const spacing = dist(pts[0], pts[1]);
  const v = idx.map((i) => {
    const near = clicks.find((c) => dist(c, pts[i]) <= spacing * 1.5);
    return near ?? pts[i];
  });
  // The line of the leg leaving or reaching vertex k. At the taxiway's own ends that is the exact
  // direction from the drawn handles; elsewhere the leg's chord, which on a long straight is exact
  // (a local tangent read thousands of feet away would swing the corner).
  const heading = (k: number, forward: boolean): Line => {
    if (forward && k === 0) return { p: v[0], d: startDir };
    if (!forward && k === v.length - 1) return { p: v[k], d: endDir };
    return forward ? lineThrough(v[k], v[k + 1]) : { p: v[k], d: norm(sub(v[k], v[k - 1])) };
  };
  const legLength = (k: number) => dist(v[k], v[k + 1]);
  const bends = v.map((_, i) => (i > 0 && i < v.length - 1 ? bendAt(v, i) : { angle: 0, side: 0 }));
  const signed = (i: number) => bends[i].angle * bends[i].side;
  // A leg much longer than both neighbours is a straight between two turns, not a chord of one curve.
  const isStraightBetween = (k: number) => legLength(k) > 2 * Math.max(legLength(k - 1), legLength(k + 1));

  /**
   * How tight the drawing turned around a corner: a circular arc of radius R
   * turning through D passes R(sec(D/2) - 1) from the corner, so measure that gap.
   */
  const drawnRadius = (corner: Vec, i: number, j: number, turn: number): number => {
    let gap = Infinity;
    for (let k = idx[i - 1]; k < idx[j + 1]; k++) gap = Math.min(gap, distToSegment(corner, pts[k], pts[k + 1]));
    const bulge = 1 / Math.cos(rad(turn) / 2) - 1;
    return bulge > 1e-6 && Number.isFinite(gap) ? gap / bulge : 0;
  };

  /** The corner(s) for bends i..j, all gentle and turning the same way. */
  const resolve = (i: number, j: number): Corner[] => {
    let total = 0;
    for (let k = i; k <= j; k++) total += signed(k);
    if (Math.abs(total) < NEGLIGIBLE_BEND) return [];
    if (Math.abs(total) > MAX_GROUPED_TURN && j > i) {
      let split = i;
      for (let k = i; k < j; k++) if (legLength(k) > legLength(split)) split = k;
      return [...resolve(i, split), ...resolve(split + 1, j)];
    }
    const before = heading(i - 1, true);
    const after = heading(j + 1, false);
    const corner = lineIntersection(before, after);
    const reach = dist(v[i - 1], v[j + 1]);
    if (!corner || dist(corner, v[i]) > reach || dist(corner, v[j]) > reach) return v.slice(i, j + 1).map(sharp);
    return [{ p: corner, drawnRadius: drawnRadius(corner, i, j, angleBetween(before.d, after.d)) }];
  };

  const corners: Corner[] = [sharp(v[0])];
  let i = 1;
  while (i < v.length - 1) {
    if (bends[i].angle >= SHARP_BEND) {
      corners.push(sharp(v[i]));
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
  corners.push(sharp(v[v.length - 1]));

  // Merging can leave neighbouring legs nearly in line: those are one leg.
  for (let k = 1; k < corners.length - 1; ) {
    if (bendAt(corners.map((c) => c.p), k).angle < NEGLIGIBLE_BEND) corners.splice(k, 1);
    else k++;
  }
  return corners;
}

/** Where a leg arriving at `at` in direction `d` leaves the runway, if that point is on the runway. */
function slideOnto(span: [Vec, Vec], at: Vec, d: Vec, width: number): Vec | null {
  const hit = lineIntersection({ p: at, d }, lineThrough(span[0], span[1]));
  if (!hit || dot(sub(at, hit), d) <= width) return null;
  const along = dot(sub(hit, span[0]), norm(sub(span[1], span[0])));
  return along >= 0 && along <= dist(span[0], span[1]) ? hit : null;
}

/** Which way traffic on the runway runs into an exit that leaves it in direction `d`: the way the exit leans. */
const leanOf = (d: Vec, axis: Vec): Vec => (dot(d, axis) >= 0 ? axis : mul(axis, -1));

/** A curve off the runway centerline at a taxiway end: the way traffic runs into it, and how wide it was drawn. */
interface LeadOff {
  along: Vec;
  drawnRadius: number;
}

/**
 * A taxiway that leaves a runway along its centerline curves off it. Read the
 * curve as the two straight lines it rounds off, the centerline and the exit
 * leg, and run the exit leg straight back to where they meet on the runway, so
 * the exit reads at the angle it really leaves at. Returns the curve so it can
 * be put back. Works on the start; reverse the nodes for the end.
 */
function straightenLeadOff(nodes: PathNode[], anchor?: Anchor): { nodes: PathNode[]; lead?: LeadOff } {
  if (!anchor?.runway || nodes.length < 2) return { nodes };
  const segs = pathSegments(nodes, false);
  const along = bezierTangent(segs[0], 0);
  if (isStraight(segs[0]) || angleToAxis(along, anchor.axis) >= LEAD_OFF_WITHIN) return { nodes };
  // The curve runs until the first straight stretch.
  let k = 0;
  while (k + 1 < segs.length && !isStraight(segs[k + 1])) k++;
  const pt = segs[k].p3;
  const out = bezierTangent(segs[k], 1);
  const turn = angleBetween(along, out);
  if (turn < 5 || turn > 120) return { nodes };
  const corner = lineIntersection({ p: nodes[0].p, d: anchor.axis }, { p: pt, d: out });
  if (!corner || dot(sub(pt, corner), out) <= 0) return { nodes };
  if (anchor.span && distToSegment(corner, anchor.span[0], anchor.span[1]) > 1) return { nodes };
  const joint = nodes[k + 1];
  return {
    nodes: [{ p: corner }, { p: joint.p, ...(joint.out ? { out: joint.out } : {}) }, ...nodes.slice(k + 2)],
    // A circular curve's tangents are equally long: radius x tan(half the turn).
    lead: { along, drawnRadius: dist(corner, pt) / Math.tan(rad(turn) / 2) },
  };
}

/** Straighten the curves off the runway at both ends of a taxiway. */
function straightenLeadOffs(nodes: PathNode[], anchors: { start?: Anchor; end?: Anchor }) {
  const start = straightenLeadOff(nodes, anchors.start);
  const end = straightenLeadOff(reverseNodes(start.nodes), anchors.end);
  return { nodes: end.lead ? reverseNodes(end.nodes) : start.nodes, start: start.lead, end: end.lead };
}

/**
 * The same, for a drawing whose first leg runs along the runway: the exit
 * starts where that leg turns off it. Cut the run along the runway off so that
 * corner becomes the end, and remember the curve so it can be put back.
 */
function cutLeadOffs(corners: Corner[], width: number, anchors: { start?: Anchor; end?: Anchor }) {
  const cut = (first: boolean, anchor?: Anchor): LeadOff | undefined => {
    if (!anchor?.runway || corners.length < 3) return undefined;
    const n = corners.length;
    const [end, corner] = first ? [0, 1] : [n - 1, n - 2];
    const along = norm(sub(corners[corner].p, corners[end].p));
    if (angleToAxis(along, anchor.axis) >= LEAD_OFF_WITHIN) return undefined;
    const from = corners[end].p;
    const onRunway = anchor.span
      ? closestOnSegment(corners[corner].p, anchor.span[0], anchor.span[1])
      : add(from, mul(anchor.axis, dot(sub(corners[corner].p, from), anchor.axis)));
    if (dist(onRunway, corners[corner].p) > width) return undefined;
    const drawnRadius = corners[corner].drawnRadius;
    corners[corner] = { ...corners[corner], p: onRunway };
    corners.splice(end, 1);
    return { along, drawnRadius };
  };
  return { start: cut(true, anchors.start), end: cut(false, anchors.end) };
}

/** A curve off the runway put on a taxiway end, and whether it is a high-speed exit's. */
interface AddedLeadOff {
  highSpeed: boolean;
}

/**
 * Curve the taxiway's runway ends off the runway centerline: a high-speed
 * (30 degree) exit on the 1,500 ft radius the FAA calls for, and a curve that
 * was drawn off the runway on the radius it was drawn with (the FAA minimum
 * when turns are tight), unless the exit was given its own angle.
 */
function addLeadOffs(
  corners: Corner[],
  width: number,
  anchors: { start?: Anchor; end?: Anchor },
  drawn: { start?: LeadOff; end?: LeadOff },
  style: TurnStyle,
  exitAngle?: number,
) {
  const put = (first: boolean, anchor?: Anchor, lead?: LeadOff): AddedLeadOff | undefined => {
    if (!anchor?.runway || corners.length < 2) return undefined;
    const n = corners.length;
    const [end, corner] = first ? [0, 1] : [n - 1, n - 2];
    const s = corners[end].p;
    const d = norm(sub(corners[corner].p, s));
    const along = lead && exitAngle === undefined ? lead.along : leanOf(d, anchor.axis);
    const turn = angleBetween(along, d);
    const highSpeed = Math.abs(turn - HIGH_SPEED_ANGLE) < 0.5;
    if (!highSpeed && (!lead || exitAngle !== undefined)) return undefined;
    if (turn < 1 || turn > 179) return undefined;
    const radius = highSpeed
      ? HIGH_SPEED_RADIUS
      : style === 'tight'
        ? turnRadius(width, turn)
        : Math.max(turnRadius(width, turn), lead!.drawnRadius);
    let pc = sub(s, mul(along, radius * Math.tan(rad(turn) / 2)));
    if (anchor.span) pc = closestOnSegment(pc, anchor.span[0], anchor.span[1]);
    corners[end] = { p: s, drawnRadius: 0, radius };
    corners.splice(first ? 0 : n, 0, sharp(pc));
    return { highSpeed };
  };
  return { start: put(true, anchors.start, drawn.start), end: put(false, anchors.end, drawn.end) };
}

/**
 * Which way a runway exit may lean at its new angle: the way it was drawn, or,
 * when it was drawn square and could go either way, the way the taxiway carries
 * on first and then the other.
 */
function exitLeans(drawn: Vec, axis: Vec, onward: Vec): Vec[] {
  if (angleToAxis(drawn, axis) < 90 - SQUARE_WITHIN) return [drawn];
  const side = norm(sub(drawn, mul(axis, dot(drawn, axis))));
  const first = dot(onward, axis) >= 0 ? 1 : -1;
  return [first, -first].map((sign) => norm(add(side, mul(axis, sign * 0.1))));
}

interface EndFixes {
  /** Ends squared up because they nearly were already. */
  squared: number;
  /** Runway exits given their chosen angle. */
  exits: number;
}

/**
 * Square the first and last legs to the runway or taxiway they meet where they
 * nearly are already, and give runway exits their chosen angle. The corner
 * after the end slides along the next leg; when there is no corner (a straight
 * connector) or it can't slide that far, a runway exit's end slides along the
 * runway instead.
 */
function squareEnds(corners: Corner[], width: number, anchors: { start?: Anchor; end?: Anchor }, exitAngle?: number): EndFixes {
  const fixes: EndFixes = { squared: 0, exits: 0 };
  const fixEnd = (first: boolean, anchor?: Anchor) => {
    if (!anchor) return;
    const n = corners.length;
    const [end, corner, beyond] = first ? [0, 1, 2] : [n - 1, n - 2, n - 3];
    const from = corners[end].p;
    const at = corners[corner].p;
    const drawn = norm(sub(at, from));
    const setAngle = anchor.runway && exitAngle !== undefined;
    const leans = setAngle ? exitLeans(drawn, anchor.axis, n >= 3 ? sub(corners[beyond].p, at) : drawn) : [drawn];
    for (const lean of leans) {
      const d = squareTo(lean, anchor, exitAngle);
      if (!d) return;
      if (n >= 3) {
        const next = corners[beyond].p;
        const moved = lineIntersection({ p: from, d }, lineThrough(at, next));
        const reach = dist(at, next) + dist(from, at);
        if (moved && dot(sub(moved, from), d) > width && dist(moved, at) <= reach && dot(sub(next, moved), sub(next, at)) > 0) {
          corners[corner] = { ...corners[corner], p: moved };
          if (setAngle) fixes.exits++;
          else fixes.squared++;
          return;
        }
      }
      const slid = setAngle && anchor.span ? slideOnto(anchor.span, at, d, width) : null;
      if (slid) {
        corners[end] = { ...corners[end], p: slid };
        fixes.exits++;
        return;
      }
    }
  };
  fixEnd(true, anchors.start);
  fixEnd(false, anchors.end);
  // A corner the new angle straightened out is no longer a corner.
  for (let i = corners.length - 2; i >= 1; i--) {
    if (angleBetween(sub(corners[i].p, corners[i - 1].p), sub(corners[i + 1].p, corners[i].p)) < 1) corners.splice(i, 1);
  }
  return fixes;
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

/** How turns are rounded: as tight as they were drawn, or all at the FAA minimum. */
export type TurnStyle = 'drawn' | 'tight';

/**
 * Straight legs between the corners, each corner a circular turn: the radius it
 * was drawn with (never tighter than the FAA minimum for the width), or the FAA
 * minimum itself when `style` is tight. Shrunk only where the legs are too short.
 */
function filletCorners(route: Corner[], width: number, style: TurnStyle): { nodes: PathNode[]; radii: number[] } {
  const corners = route.map((c) => c.p);
  const turns: Turn[] = [];
  for (let i = 1; i < corners.length - 1; i++) {
    const d1 = norm(sub(corners[i], corners[i - 1]));
    const d2 = norm(sub(corners[i + 1], corners[i]));
    const angle = Math.min(170, angleBetween(d1, d2));
    const minimum = turnRadius(width, angle);
    const radius = route[i].radius ?? (style === 'tight' ? minimum : Math.max(minimum, route[i].drawnRadius));
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
  /** Runway exits given the taxiway's chosen exit angle. */
  exits: number;
  /** Curves off the runway centerline at the ends, not counted in `radii`. */
  leadOffs: { radius: number; highSpeed: boolean }[];
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
 * straight legs joined by circular turns. Wobble goes; the angles and curves
 * that were drawn on purpose stay, with each turn as tight as it was drawn
 * (never tighter than the FAA minimum for the width), or at the FAA minimum
 * when `turns` is tight.
 */
export interface SmoothOptions {
  anchors?: { start?: Anchor; end?: Anchor };
  turns?: TurnStyle;
  /** Angle from the runway centerline for ends on a runway; unset keeps the drawn angle. */
  exitAngle?: number;
}

export function autoSmooth(
  nodes: PathNode[],
  width: number,
  { anchors = {}, turns = 'drawn', exitAngle }: SmoothOptions = {},
): SmoothResult {
  const unchanged = { nodes, straight: nodes.length <= 2, radii: [], squared: 0, exits: 0, leadOffs: [], deviation: 0 };
  if (nodes.length < 2) return unchanged;
  // Curves off a runway are read as the exit legs they round off, and put back afterwards.
  const work = straightenLeadOffs(nodes, anchors);
  const first = work.nodes[0].p;
  const last = work.nodes[work.nodes.length - 1].p;
  const poly = flatten(work.nodes, false, 10);
  const pts = resample(poly, Math.min(800, Math.max(64, Math.round(poly.length / 10))));
  const offsets = pts.map((p) => distToSegment(p, first, last));
  const bulge = Math.max(0, ...offsets);
  const mean = offsets.reduce((sum, d) => sum + d, 0) / offsets.length;

  const segs = pathSegments(work.nodes, false);
  const startDir = bezierTangent(segs[0], 0);
  const endDir = bezierTangent(segs[segs.length - 1], 1);
  // A taxiway still running along a runway at an end is never one straight line.
  const leadsOff = [anchors.start, anchors.end].some(
    (a, i) => a?.runway && angleToAxis(i === 0 ? startDir : endDir, a.axis) < LEAD_OFF_WITHIN,
  );
  const corners =
    !leadsOff && isNearlyStraight(bulge, mean, straightTolerance(dist(first, last), width))
      ? [sharp(first), sharp(last)]
      : routeCorners(pts, width, startDir, endDir, work.nodes.map((n) => n.p));
  const cut = cutLeadOffs(corners, width, anchors);
  const drawnLeadOffs = { start: work.start ?? cut.start, end: work.end ?? cut.end };
  const { squared, exits } = squareEnds(corners, width, anchors, exitAngle);
  const added = addLeadOffs(corners, width, anchors, drawnLeadOffs, turns, exitAngle);
  const { nodes: rebuilt, radii: allRadii } = filletCorners(corners, width, turns);
  // The curves off the runway are the first and last turns; report them apart from the rest.
  const radii = allRadii.slice(added.start ? 1 : 0, allRadii.length - (added.end ? 1 : 0));
  const leadOffs = [
    ...(added.start ? [{ radius: allRadii[0], highSpeed: added.start.highSpeed }] : []),
    ...(added.end ? [{ radius: allRadii[allRadii.length - 1], highSpeed: added.end.highSpeed }] : []),
  ];
  const result: SmoothResult = {
    nodes: rebuilt,
    straight: corners.length - leadOffs.length === 2,
    radii,
    squared,
    exits,
    leadOffs,
    deviation: pathDistance(nodes, rebuilt),
  };
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
      return { axis: norm(sub(f.b, f.a)), runway: true, span: [f.a, f.b] };
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

/** A taxiway end on a runway, the angle it leaves the runway centerline at, and whether it curves off it. */
export interface RunwayExit {
  runway: Runway;
  angle: number;
  leadOff: boolean;
}

/**
 * The ends of a taxiway that sit on a runway, with the angle each meets it at.
 * An end that curves off the centerline is measured where the curve ends.
 */
export function runwayExits(doc: AirportDoc, t: Taxiway): RunwayExit[] {
  if (t.closed || t.nodes.length < 2) return [];
  const segs = pathSegments(t.nodes, false);
  const exits: RunwayExit[] = [];
  for (const first of [true, false]) {
    const p = first ? t.nodes[0].p : t.nodes[t.nodes.length - 1].p;
    const runway = doc.features.find(
      (f): f is Runway => f.kind === 'runway' && !f.hidden && distToSegment(p, f.a, f.b) <= ATTACH_TOLERANCE + 1,
    );
    if (!runway) continue;
    const axis = sub(runway.b, runway.a);
    // Segments from this end inward, and the direction at either end of one.
    const inward = first ? segs : [...segs].reverse();
    const tangent = (i: number, far: boolean) => bezierTangent(inward[i], far === first ? 1 : 0);
    let d = tangent(0, false);
    const leadOff = angleToAxis(d, axis) < LEAD_OFF_WITHIN && !isStraight(inward[0]);
    if (leadOff) {
      let i = 0;
      while (i + 1 < inward.length && !isStraight(inward[i + 1])) i++;
      d = tangent(i, true);
    }
    exits.push({ runway, angle: angleToAxis(d, axis), leadOff });
  }
  return exits;
}

export interface SmoothTaxiwayResult extends SmoothResult {
  doc: AirportDoc;
  before: number;
  /** Ends of other taxiways that were slid along with the new centerline. */
  reattached: number;
}

/** Auto-smooth one taxiway and slide any taxiway ends that met its centerline onto the new one. */
export function autoSmoothTaxiway(doc: AirportDoc, id: ID, turns: TurnStyle = 'drawn'): SmoothTaxiwayResult | null {
  const t = doc.features.find((f): f is Taxiway => f.id === id && f.kind === 'taxiway');
  if (!t || t.closed || t.nodes.length < 2) return null;

  const anchors = {
    start: anchorAt(doc, t.id, t.nodes[0].p),
    end: anchorAt(doc, t.id, t.nodes[t.nodes.length - 1].p),
  };
  const result = autoSmooth(t.nodes, t.width, { anchors, turns, exitAngle: t.exitAngle });
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
