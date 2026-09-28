/**
 * SIDs and STARs: where their routes go and how the chart says it. Pure
 * functions over an airport's procedures and the fixes they use.
 */
import { formatFrequency, type Fix, type Navaid, type NavaidType } from '../nav/data';
import { destination, distanceNm, trueCourse, wrap360, type LatLon } from '../nav/geo';
import { uid } from './defaults';
import { runwayInfos } from './runway';
import { worldToLatLon } from './sheet';
import type { AirportDoc, AltLimits, FixKind, ProcFix, ProcLeg, ProcRoute, Procedure, Runway } from './types';

const NAVAID_KINDS: Record<NavaidType, FixKind> = {
  VOR: 'vor',
  'VOR-DME': 'vordme',
  VORTAC: 'vortac',
  TACAN: 'tacan',
  DME: 'dme',
  NDB: 'ndb',
  'NDB-DME': 'ndb',
};

export const isNavaidKind = (k: FixKind) => k !== 'waypoint' && k !== 'fix';

export const NAVAID_LABEL: Record<FixKind, string> = {
  waypoint: 'Waypoint',
  fix: 'Fix',
  vor: 'VOR',
  vordme: 'VOR/DME',
  vortac: 'VORTAC',
  tacan: 'TACAN',
  dme: 'DME',
  ndb: 'NDB',
};

export function procFixFromNavaid(n: Navaid): ProcFix {
  return { ident: n.ident, lat: n.lat, lon: n.lon, kind: NAVAID_KINDS[n.type], name: n.name.toUpperCase(), freq: formatFrequency(n), source: 'ourairports' };
}

/** NASR use codes for waypoints (charted as RNAV waypoints); the rest are reporting points and intersections. */
const WAYPOINT_USES = new Set(['WP', 'CN', 'NRS', 'MW']);

export function procFixFromFaa(f: Fix): ProcFix {
  return { ident: f.ident, lat: f.lat, lon: f.lon, kind: WAYPOINT_USES.has(f.use) ? 'waypoint' : 'fix', source: 'faa' };
}

export function newProcedure(type: Procedure['type'], runways: string[]): Procedure {
  const route = (kind: ProcRoute['kind'], name: string): ProcRoute => ({ id: uid(), kind, name, legs: [] });
  return {
    id: uid(),
    type,
    name: type === 'SID' ? 'NEW ONE' : 'NEW ONE',
    code: 'NEW1',
    rnav: false,
    routes: runways.length ? runways.map((r) => route('runway', r)) : [route('common', '')],
    ...(type === 'SID' ? { maintain: '', expect: '' } : {}),
    notes: '',
  };
}

/* ------------------------------------------------------------------ */
/* Runway ends                                                        */
/* ------------------------------------------------------------------ */

export interface RunwayEndPoint extends LatLon {
  name: string;
  /** True heading a departure from this end rolls along. */
  heading: number;
}

/** Every runway end with a position, by its designator, e.g. "26L". Needs the airport's location. */
export function runwayEnds(doc: AirportDoc): Map<string, { threshold: RunwayEndPoint; departureEnd: LatLon }> {
  const { refLat, refLon } = doc.meta;
  const ends = new Map<string, { threshold: RunwayEndPoint; departureEnd: LatLon }>();
  if (refLat === undefined || refLon === undefined) return ends;
  const infos = runwayInfos(doc);
  for (const r of doc.features.filter((f): f is Runway => f.kind === 'runway' && !f.hidden)) {
    const info = infos.get(r.id);
    if (!info) continue;
    const a = worldToLatLon(r.a, refLat, refLon);
    const b = worldToLatLon(r.b, refLat, refLon);
    ends.set(info.names[0], { threshold: { ...a, name: info.names[0], heading: info.trueHdg[0] }, departureEnd: b });
    ends.set(info.names[1], { threshold: { ...b, name: info.names[1], heading: info.trueHdg[1] }, departureEnd: a });
  }
  return ends;
}

/* ------------------------------------------------------------------ */
/* Where routes go                                                    */
/* ------------------------------------------------------------------ */

export interface ProcPoint extends LatLon {
  fix?: ProcFix;
  alt?: AltLimits;
  speed?: number;
}

export interface ProcSegment {
  from: LatLon;
  to: LatLon;
  /** Magnetic course, degrees. */
  course: number;
  distance: number;
  /** A track between fixes, a heading flown, or open-ended radar vectors. */
  kind: 'track' | 'heading' | 'vectors' | 'direct';
}

export interface RouteGeometry {
  route: ProcRoute;
  points: ProcPoint[];
  segments: ProcSegment[];
}

/** How far a heading leg is drawn before it turns toward the next fix, NM. */
const HEADING_LEG_NM = 4;
/** How far radar vectors are drawn, NM. */
const VECTORS_NM = 8;

export const fixIndex = (doc: AirportDoc) => new Map((doc.fixes ?? []).map((f) => [f.ident, f]));

/**
 * The points and segments a route flies. A SID's runway route starts at the
 * end its departures lift off from; a STAR's runway route ends at the runway.
 */
export function routeGeometry(proc: Procedure, route: ProcRoute, doc: AirportDoc): RouteGeometry {
  const fixes = fixIndex(doc);
  const magVar = doc.meta.magVar;
  const mag = (trueDeg: number) => wrap360(trueDeg - magVar);
  const end = route.kind === 'runway' ? runwayEnds(doc).get(route.name) : undefined;
  const points: ProcPoint[] = [];
  const segments: ProcSegment[] = [];
  let at: LatLon | null = proc.type === 'SID' && end ? end.departureEnd : null;
  let afterHeading = false;
  if (at) points.push({ ...at });

  route.legs.forEach((leg, i) => {
    if (leg.type === 'heading') {
      const trueHdg = wrap360(leg.heading + magVar);
      const origin = at ?? (end ? end.threshold : null);
      if (!origin) return;
      const last = i === route.legs.length - 1;
      const vectors = last && leg.untilAlt === undefined;
      const to = destination(origin, trueHdg, vectors ? VECTORS_NM : HEADING_LEG_NM);
      segments.push({ from: origin, to, course: leg.heading, distance: 0, kind: vectors ? 'vectors' : 'heading' });
      at = to;
      afterHeading = true;
      return;
    }
    const fix = fixes.get(leg.fix);
    if (!fix) return;
    const to = { lat: fix.lat, lon: fix.lon };
    if (at) {
      segments.push({ from: at, to, course: mag(trueCourse(at, to)), distance: distanceNm(at, to), kind: afterHeading ? 'direct' : 'track' });
    }
    points.push({ ...to, fix, alt: leg.alt, speed: leg.speed });
    at = to;
    afterHeading = false;
  });

  // A STAR's landing route runs on to the runway it serves.
  if (proc.type === 'STAR' && end && at && route.legs.at(-1)?.type === 'fix') {
    const to = { lat: end.threshold.lat, lon: end.threshold.lon };
    segments.push({ from: at, to, course: mag(trueCourse(at, to)), distance: distanceNm(at, to), kind: 'direct' });
  }
  return { route, points, segments };
}

/* ------------------------------------------------------------------ */
/* How the chart says it                                              */
/* ------------------------------------------------------------------ */

export const fmtHeading = (deg: number) => `${String(Math.round(wrap360(deg)) || 360).padStart(3, '0')}°`;

/** An altitude as charted: flight levels from FL180 up. */
export const fmtAlt = (ft: number) => (ft >= 18000 ? `FL${Math.round(ft / 100)}` : String(Math.round(ft)));

export function fmtLimits(alt?: AltLimits): string {
  if (!alt) return '';
  const { atOrAbove: lo, atOrBelow: hi } = alt;
  if (lo !== undefined && hi !== undefined) return lo === hi ? `at ${fmtAlt(lo)}` : `between ${fmtAlt(lo)} and ${fmtAlt(hi)}`;
  if (lo !== undefined) return `at or above ${fmtAlt(lo)}`;
  if (hi !== undefined) return `at or below ${fmtAlt(hi)}`;
  return '';
}

function crossing(leg: ProcLeg & { type: 'fix' }): string {
  const parts = [fmtLimits(leg.alt), leg.speed ? `at ${leg.speed}K` : ''].filter(Boolean);
  return parts.length ? `, cross ${leg.fix} ${parts.join(' and ')}` : '';
}

const fixName = (ident: string, fixes: Map<string, ProcFix>) => {
  const f = fixes.get(ident);
  return f && isNavaidKind(f.kind) ? `${ident} ${NAVAID_LABEL[f.kind]}` : ident;
};

/** A route's legs in words: "Climb heading 262° to 3000, then direct BLH VORTAC, then on track 245° to ZELMA". */
export function legsText(proc: Procedure, route: ProcRoute, doc: AirportDoc): string {
  const fixes = fixIndex(doc);
  const geo = routeGeometry(proc, route, doc);
  const out: string[] = [];
  let seg = 0;
  let prev: ProcLeg | null = null;
  const startsAtFix = !(proc.type === 'SID' && route.kind === 'runway');
  route.legs.forEach((leg, i) => {
    if (leg.type === 'heading') {
      const until = leg.untilAlt !== undefined ? ` to ${fmtAlt(leg.untilAlt)}` : ' for radar vectors';
      const verb = proc.type === 'SID' && i === 0 ? 'Climb' : i === 0 ? 'Fly' : 'fly';
      out.push(`${verb} heading ${fmtHeading(leg.heading)}${until}`);
      seg++;
    } else if (!fixes.has(leg.fix)) {
      out.push(`${leg.fix} (not placed yet)`);
    } else if (i === 0 && startsAtFix) {
      out.push(`From ${fixName(leg.fix, fixes)}${crossing(leg).replace(`, cross ${leg.fix} `, ', cross ')}`);
    } else {
      const s = geo.segments[seg++];
      out.push(
        prev?.type === 'heading' || !s || s.kind === 'direct'
          ? `direct ${fixName(leg.fix, fixes)}${crossing(leg)}`
          : `on track ${fmtHeading(s.course)} to ${fixName(leg.fix, fixes)}${crossing(leg)}`,
      );
    }
    prev = leg;
  });
  return out.map((t, i) => (i === 0 ? t : `then ${t}`)).join(', ');
}

/** The charted name, e.g. "CACTUS ONE DEPARTURE" or "(RNAV) CACTUS ONE ARRIVAL". */
export const procTitle = (p: Procedure) =>
  `${p.name.toUpperCase()} ${p.type === 'SID' ? 'DEPARTURE' : 'ARRIVAL'}${p.rnav ? ' (RNAV)' : ''}`;

/** A transition's computer code: FAA SIDs read PROCEDURE.TRANSITION, STARs TRANSITION.PROCEDURE. */
export function transitionCode(p: Procedure, route: ProcRoute): string {
  const fixes = route.legs.filter((l): l is ProcLeg & { type: 'fix' } => l.type === 'fix').map((l) => l.fix);
  const code = p.code.toUpperCase();
  if (p.type === 'SID') return `${code}.${fixes.at(-1) ?? route.name.toUpperCase()}`;
  return `${fixes[0] ?? route.name.toUpperCase()}.${code}`;
}

/** The procedure's description as the chart prints it, one paragraph per part. */
export function procedureText(p: Procedure, doc: AirportDoc): string[] {
  const out: string[] = [];
  const kinds = (k: ProcRoute['kind']) => p.routes.filter((r) => r.kind === k && r.legs.length);
  const runway = kinds('runway');
  const common = kinds('common');
  const transitions = kinds('transition');
  const sentence = (t: string) => (t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : '');

  if (p.type === 'SID') {
    for (const r of runway) out.push(`TAKEOFF RUNWAY ${r.name}: ${sentence(legsText(p, r, doc))}`);
    for (const r of common) out.push(sentence(`then ${legsText(p, r, doc)}`).replace(/^Then then/, 'Then'));
    const climb = [p.maintain ? `Maintain ${p.maintain}` : '', p.expect ? `expect ${p.expect}` : ''].filter(Boolean).join('. ');
    if (climb) out.push(sentence(climb.replace('. expect', '. Expect')));
    for (const r of transitions) out.push(`${r.name.toUpperCase()} TRANSITION (${transitionCode(p, r)}): ${sentence(legsText(p, r, doc))}`);
  } else {
    for (const r of transitions) out.push(`${r.name.toUpperCase()} TRANSITION (${transitionCode(p, r)}): ${sentence(legsText(p, r, doc))}`);
    for (const r of common) out.push(sentence(legsText(p, r, doc)));
    for (const r of runway) out.push(`LANDING RUNWAY ${r.name}: ${sentence(legsText(p, r, doc))}`);
  }
  if (p.notes.trim()) out.push(p.notes.trim());
  return out;
}

/** Every fix a procedure uses, once each, in route order. */
export function procedureFixes(p: Procedure, doc: AirportDoc): ProcFix[] {
  const fixes = fixIndex(doc);
  const seen = new Map<string, ProcFix>();
  for (const r of p.routes) for (const l of r.legs) if (l.type === 'fix' && fixes.has(l.fix)) seen.set(l.fix, fixes.get(l.fix)!);
  return [...seen.values()];
}
