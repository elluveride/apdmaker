/**
 * Airports from OpenStreetMap: its taxiways, aprons, buildings, runways and
 * field symbols as chart features, and a merge that adds the ones an airport
 * is missing without moving or changing anything already drawn.
 */
import { newArea, newRunway, newSymbol, newTaxiway, defaultEnd } from './defaults';
import { cross, dist, distToSegment, flatten, norm, pointInPolygon, simplify, smoothNode, sub } from './geometry';
import { runwayInfos, toRunwayFrame } from './runway';
import { latToWorldY, lonToWorldX } from './sheet';
import type { AirportDoc, Area, Feature, MapSymbol, PathNode, Runway, RunwayEnd, Suffix, SurfaceType, SymbolType, Taxiway, Vec } from './types';

/* ------------------------------------------------------------------ */
/* OpenStreetMap elements, as Overpass returns them with `out geom`    */
/* ------------------------------------------------------------------ */

type Tags = Record<string, string>;
interface LatLon {
  lat: number;
  lon: number;
}
export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Tags;
}
export interface OsmWay {
  type: 'way';
  id: number;
  nodes?: number[];
  geometry?: LatLon[];
  tags?: Tags;
}
export interface OsmRelation {
  type: 'relation';
  id: number;
  members?: { type: string; ref: number; role: string; geometry?: LatLon[] }[];
  tags?: Tags;
}
export type OsmElement = OsmNode | OsmWay | OsmRelation;

export const OSM_CREDIT = 'Taxiways, aprons and buildings © OpenStreetMap contributors (ODbL).';

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

/** A length tag in feet: OSM lengths are metres unless they say otherwise. */
export function lengthFt(s: string | undefined): number | undefined {
  const m = /^\s*([\d.]+)\s*(m|ft|')?\s*$/i.exec(s ?? '');
  if (!m) return undefined;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  return m[2] && /ft|'/i.test(m[2]) ? v : v * 3.28084;
}

export function osmSurface(s: string | undefined): SurfaceType | null {
  if (!s) return 'asphalt';
  if (/water/i.test(s)) return null;
  if (/concrete/i.test(s)) return 'concrete';
  if (/grass|turf/i.test(s)) return 'turf';
  if (/gravel|dirt|ground|unpaved|sand|compacted|earth|clay/i.test(s)) return 'gravel';
  return 'asphalt';
}

/** A taxiway's designator: its `ref`, or a name like "Taxiway B4". */
export function taxiwayRef(tags: Tags | undefined): string {
  const ref = (tags?.ref ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z0-9]{1,8}$/.test(ref)) return ref;
  const m = /^(?:taxiway|twy)\s+([a-z0-9]{1,8})$/i.exec((tags?.name ?? '').trim());
  return m ? m[1].toUpperCase() : '';
}

const endFromRef = (part: string): RunwayEnd | null => {
  const m = /^0*(\d{1,2})([LRC]?)$/.exec(part.trim().toUpperCase());
  return m ? { ...defaultEnd(), designator: m[1], suffix: m[2] as Suffix } : null;
};

/** Heading difference of two lines, ignoring direction, degrees 0..90. */
function lineAngle(a: Vec, b: Vec): number {
  const d = Math.abs((Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x)) * (180 / Math.PI)) % 180;
  return Math.min(d, 180 - d);
}

/**
 * Walkways, walls and canopies are mapped as buildings too, but airport
 * diagrams leave them out: skip outlines much longer than they are wide.
 */
export function isSliver(pts: Vec[]): boolean {
  let per = 0;
  for (let i = 0; i < pts.length; i++) per += dist(pts[i], pts[(i + 1) % pts.length]);
  const half = per / 2;
  const disc = half * half - 4 * ringArea(pts);
  const width = (half - Math.sqrt(Math.max(0, disc))) / 2;
  const length = half - width;
  return width < 40 && length > 8 * width;
}

function ringArea(pts: Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += cross(pts[i], pts[(i + 1) % pts.length]);
  return Math.abs(s) / 2;
}

const centroid = (pts: Vec[]): Vec => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

/** Outer rings of a multipolygon, joined from its member ways. */
export function assembleRings(parts: LatLon[][]): LatLon[][] {
  const key = (p: LatLon) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  const left = parts.filter((p) => p.length > 1).map((p) => [...p]);
  const rings: LatLon[][] = [];
  while (left.length) {
    const ring = left.shift()!;
    let grew = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grew) {
      grew = false;
      const end = key(ring[ring.length - 1]);
      const i = left.findIndex((p) => key(p[0]) === end || key(p[p.length - 1]) === end);
      if (i >= 0) {
        const next = left.splice(i, 1)[0];
        const along = key(next[0]) === end ? next : [...next].reverse();
        ring.push(...along.slice(1));
        grew = true;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/* ------------------------------------------------------------------ */
/* Taxiway centerlines                                                 */
/* ------------------------------------------------------------------ */

export interface Chain {
  ref: string;
  coords: LatLon[];
}

/**
 * OSM splits a taxiway into many ways. Join the ones with the same designator
 * end to end, stopping where it branches, so each piece is one continuous line.
 */
export function taxiwayChains(ways: OsmWay[]): Chain[] {
  const groups = new Map<string, OsmWay[]>();
  for (const w of ways) {
    if (!w.geometry || w.geometry.length < 2) continue;
    const ref = taxiwayRef(w.tags);
    groups.set(ref, [...(groups.get(ref) ?? []), w]);
  }
  const chains: Chain[] = [];
  for (const [ref, group] of groups) {
    const ends = (w: OsmWay): [string, string] => {
      const g = w.geometry!;
      const id = (i: number) => (w.nodes && w.nodes.length === g.length ? String(w.nodes[i]) : `${g[i].lat.toFixed(7)},${g[i].lon.toFixed(7)}`);
      return [id(0), id(g.length - 1)];
    };
    const at = new Map<string, number[]>();
    group.forEach((w, i) => {
      for (const k of ends(w)) at.set(k, [...(at.get(k) ?? []), i]);
    });
    const used = new Set<number>();
    // The way continuing a chain through `node`, if the chain doesn't branch there.
    const onward = (node: string, from: number): number | null => {
      const here = at.get(node) ?? [];
      if (here.length !== 2) return null;
      const other = here[0] === from ? here[1] : here[0];
      return used.has(other) || other === from ? null : other;
    };
    group.forEach((_, start) => {
      if (used.has(start)) return;
      used.add(start);
      let coords = [...group[start].geometry!];
      let [head, tail] = ends(group[start]);
      for (let next = onward(tail, start), from = start; next !== null; next = onward(tail, from)) {
        used.add(next);
        const [a, b] = ends(group[next]);
        const g = group[next].geometry!;
        coords = coords.concat((a === tail ? g : [...g].reverse()).slice(1));
        tail = a === tail ? b : a;
        from = next;
      }
      for (let prev = onward(head, start), from = start; prev !== null; prev = onward(head, from)) {
        used.add(prev);
        const [a, b] = ends(group[prev]);
        const g = group[prev].geometry!;
        coords = (b === head ? g : [...g].reverse()).slice(0, -1).concat(coords);
        head = b === head ? a : b;
        from = prev;
      }
      chains.push({ ref, coords });
    });
  }
  return chains;
}

/**
 * A centerline as path nodes: points that don't change its shape by more than
 * `eps` feet dropped, and gentle bends given curve handles so fillets drawn as
 * a run of short straights come out as the curves they are.
 */
export function lineNodes(pts: Vec[], eps: number, closed = false): PathNode[] {
  const clean = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 0.5);
  if (closed && clean.length > 2 && dist(clean[0], clean[clean.length - 1]) < 0.5) clean.pop();
  const kept = closed ? simplify([...clean, clean[0]], eps).filter((i) => i < clean.length) : simplify(clean, eps);
  const nodes: PathNode[] = kept.map((i) => ({ p: clean[i] }));
  if (closed) return nodes;
  return nodes.map((n, i) => {
    if (i === 0 || i === nodes.length - 1) return n;
    const a = norm(sub(n.p, nodes[i - 1].p));
    const b = norm(sub(nodes[i + 1].p, n.p));
    const bend = (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y))) * 180) / Math.PI;
    const short = Math.min(dist(n.p, nodes[i - 1].p), dist(n.p, nodes[i + 1].p)) < 400;
    return bend < 50 && short ? smoothNode(nodes, i, false) : n;
  });
}

/* ------------------------------------------------------------------ */
/* Everything OSM has for an airport, as features                      */
/* ------------------------------------------------------------------ */

export interface OsmFeatures {
  runways: Runway[];
  /** Taxiways without a width yet: the merge picks one that matches the drawing. */
  taxiways: Taxiway[];
  aprons: Area[];
  buildings: Area[];
  symbols: MapSymbol[];
}

const MIN_BUILDING_SQFT = 800;
/** Aprons smaller than this, or near a bigger labelled one, keep their name without showing it. */
const LABELLED_APRON_SQFT = 250_000;
const APRON_LABEL_SPACING_FT = 1200;
/** Only passenger terminals this big get their name on the chart; FBOs keep theirs hidden. */
const LABELLED_TERMINAL_SQFT = 200_000;
const MIN_APRON_SQFT = 4000;
const MIN_TAXIWAY_FT = 60;
const LABEL_SPACING_FT = 1500;
const SKIP_BUILDINGS = /^(roof|carport|construction|ruins|no)$/;

function symbolOf(tags: Tags): SymbolType | null {
  const aeroway = tags.aeroway ?? '';
  if (aeroway === 'windsock') return 'windcone';
  if (aeroway === 'helipad') return 'helipad';
  if (aeroway === 'control_tower' || (tags.man_made === 'tower' && (/^(airport_control|control|observation)$/.test(tags['tower:type'] ?? '') || tags.service === 'aircraft_control')))
    return 'tower';
  if (aeroway === 'beacon' || tags.airmark === 'beacon') return 'beacon';
  return null;
}

/**
 * OSM elements as chart features, in feet from `ref`. `magVar` decides which
 * runway number goes on which end.
 */
export function osmFeatures(elements: OsmElement[], ref: LatLon, magVar: number): OsmFeatures {
  const at = (p: LatLon): Vec => ({ x: lonToWorldX(p.lon, ref.lat, ref.lon), y: latToWorldY(p.lat, ref.lat) });
  const out: OsmFeatures = { runways: [], taxiways: [], aprons: [], buildings: [], symbols: [] };
  const taxiwayWays: OsmWay[] = [];
  const seenSymbols = new Set<string>();
  const addSymbol = (kind: SymbolType, p: Vec) => {
    const k = `${kind}${Math.round(p.x / 50)},${Math.round(p.y / 50)}`;
    if (seenSymbols.has(k)) return;
    seenSymbols.add(k);
    out.symbols.push(newSymbol(p, kind));
  };

  for (const e of elements) {
    const tags = e.tags ?? {};
    const aeroway = tags.aeroway ?? '';
    const symbol = symbolOf(tags);
    if (e.type === 'node') {
      if (symbol) addSymbol(symbol, at(e));
      continue;
    }

    // Closed outlines: aprons and buildings, from ways or multipolygons.
    const rings =
      e.type === 'way'
        ? e.geometry && e.geometry.length >= 4 && e.geometry[0].lat === e.geometry.at(-1)!.lat && e.geometry[0].lon === e.geometry.at(-1)!.lon
          ? [e.geometry]
          : []
        : assembleRings((e.members ?? []).filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry!));

    if (e.type === 'way' && aeroway === 'taxiway') {
      taxiwayWays.push(e);
      continue;
    }
    if (e.type === 'way' && aeroway === 'runway' && tags.area !== 'yes' && !tags.runway) {
      const g = e.geometry ?? [];
      const surface = osmSurface(tags.surface);
      if (g.length < 2 || !surface) continue;
      const a = at(g[0]);
      const b = at(g[g.length - 1]);
      const r = newRunway(a, b, Math.round(lengthFt(tags.width) ?? 100));
      r.surface = surface;
      const parts = (tags.ref ?? '').split('/').map(endFromRef);
      if (parts.length === 2 && parts[0] && parts[1]) {
        // The end whose number matches the a -> b heading is the one landing a -> b.
        const trueHdg = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
        const num = ((Math.round((trueHdg - magVar) / 10) % 36) + 36) % 36 || 36;
        const off = (n: string) => Math.min(Math.abs(Number(n) - num), 36 - Math.abs(Number(n) - num));
        r.ends = off(parts[0].designator) <= off(parts[1].designator) ? [parts[0], parts[1]] : [parts[1], parts[0]];
      }
      out.runways.push(r);
      continue;
    }

    for (const ring of rings) {
      const pts = ring.map(at);
      const area = ringArea(pts);
      const name = (tags.name ?? tags.ref ?? '').toUpperCase();
      if (aeroway === 'apron') {
        if (area < MIN_APRON_SQFT) continue;
        const a = newArea(lineNodes(pts, 6, true), 'apron', name);
        if (a.nodes.length >= 3) out.aprons.push(a);
      } else if ((tags.building && !SKIP_BUILDINGS.test(tags.building)) || aeroway === 'terminal' || aeroway === 'hangar') {
        if (area < MIN_BUILDING_SQFT || isSliver(pts)) continue;
        const b = newArea(lineNodes(pts, 2, true), 'building', name);
        b.showLabel = aeroway === 'terminal' && name !== '' && area >= LABELLED_TERMINAL_SQFT;
        if (b.nodes.length >= 3) out.buildings.push(b);
      }
    }
    if (symbol && rings.length) addSymbol(symbol, centroid(rings[0].map(at)));
  }

  // Name the big ramps on the chart, one per neighbourhood.
  const apronLabels: Vec[] = [];
  const bySize = [...out.aprons].sort((a, b) => ringArea(b.nodes.map((n) => n.p)) - ringArea(a.nodes.map((n) => n.p)));
  for (const a of bySize) {
    const pts = a.nodes.map((n) => n.p);
    const c = centroid(pts);
    a.showLabel = a.name !== '' && ringArea(pts) >= LABELLED_APRON_SQFT && !apronLabels.some((q) => dist(q, c) < APRON_LABEL_SPACING_FT);
    if (a.showLabel) apronLabels.push(c);
  }

  // OSM breaks a taxiway wherever another way meets it, so one designator can
  // come in many pieces. Label the longest, and others only away from a label.
  const pieces = taxiwayChains(taxiwayWays)
    .map((c) => {
      const pts = c.coords.map(at);
      let length = 0;
      for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);
      return { ref: c.ref, pts, length };
    })
    .filter((c) => c.length >= MIN_TAXIWAY_FT)
    .sort((a, b) => b.length - a.length);
  const labelled = new Map<string, Vec[]>();
  for (const c of pieces) {
    const t = newTaxiway(lineNodes(c.pts, 3), c.ref);
    const at_ = flatten(t.nodes, false, 20);
    const middle = at_.pts[Math.floor(at_.pts.length / 2)] ?? c.pts[0];
    const near = (labelled.get(c.ref) ?? []).some((p) => dist(p, middle) < LABEL_SPACING_FT);
    t.showLabel = c.ref !== '' && !near && c.length >= 150;
    if (t.showLabel) labelled.set(c.ref, [...(labelled.get(c.ref) ?? []), middle]);
    out.taxiways.push(t);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lining OSM up with the drawing                                      */
/* ------------------------------------------------------------------ */

/** x' = s·R·x + t, as a scale-rotation (a = s·cos, b = s·sin) and a shift. */
export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}
export const IDENTITY: Similarity = { a: 1, b: 0, tx: 0, ty: 0 };
export const applyTo = (T: Similarity, p: Vec): Vec => ({ x: T.a * p.x - T.b * p.y + T.tx, y: T.b * p.x + T.a * p.y + T.ty });
export const scaleOf = (T: Similarity) => Math.hypot(T.a, T.b);
export const rotationOf = (T: Similarity) => (Math.atan2(T.b, T.a) * 180) / Math.PI;

function mapFeature<T extends Feature>(f: T, T_: Similarity): T {
  const m = (p: Vec) => applyTo(T_, p);
  const k = scaleOf(T_);
  if (f.kind === 'runway') return { ...f, a: m(f.a), b: m(f.b), width: f.width * k };
  if (f.kind === 'taxiway' || f.kind === 'area')
    return { ...f, nodes: f.nodes.map((n) => ({ ...n, p: m(n.p), in: n.in && m(n.in), out: n.out && m(n.out) })) };
  if (f.kind === 'symbol') return { ...f, p: m(f.p) };
  return f;
}

const designators = (r: Runway, names?: [string, string]) =>
  names ?? (r.ends.map((e) => `${e.designator}${e.suffix === 'auto' ? '' : e.suffix}`) as [string, string]);

export interface Fit {
  /** `georeferenced`: the drawing already sits where the real airport is. `fitted`: turned, scaled and shifted onto its runways. `position`: nothing to line up with. */
  kind: 'georeferenced' | 'fitted' | 'position';
  transform: Similarity;
  /** Runways matched between the drawing and OSM. */
  runways: number;
  /** The farthest a matched OSM runway end lies off the drawn centerline after the fit, ft. */
  error: number;
}

interface RunwayPair {
  mine: Runway;
  /** OSM's ends, in the same order as the drawn runway's. */
  a: Vec;
  b: Vec;
}

/**
 * Turn, scale and shift OSM's runways onto the drawn ones. Runway ends are a
 * weak guide (OSM maps pavement ends, a drawing may use thresholds), so the
 * turn comes from the runways' directions, the scale from their total length
 * (ignored within 1%), and the shift mostly from their centerlines.
 */
export function fitRunwayLines(pairs: RunwayPair[]): Similarity {
  let sx = 0;
  let sy = 0;
  let mineLen = 0;
  let osmLen = 0;
  for (const p of pairs) {
    const u = sub(p.b, p.a);
    const v = sub(p.mine.b, p.mine.a);
    const theta = Math.atan2(cross(u, v), u.x * v.x + u.y * v.y);
    const w = Math.hypot(v.x, v.y);
    sx += w * Math.cos(theta);
    sy += w * Math.sin(theta);
    mineLen += w;
    osmLen += Math.hypot(u.x, u.y);
  }
  const theta = Math.atan2(sy, sx);
  let s = osmLen > 0 ? mineLen / osmLen : 1;
  if (Math.abs(s - 1) < 0.01) s = 1;
  const R: Similarity = { a: s * Math.cos(theta), b: s * Math.sin(theta), tx: 0, ty: 0 };
  // Least squares for the shift: across each centerline counts fully, along it only a little.
  let m11 = 0;
  let m12 = 0;
  let m22 = 0;
  let r1 = 0;
  let r2 = 0;
  for (const p of pairs) {
    const d = norm(sub(p.mine.b, p.mine.a));
    const n = { x: -d.y, y: d.x };
    const m = applyTo(R, { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 });
    const r = sub(mid2(p.mine), m);
    for (const [e, w] of [
      [n, 1],
      [d, 0.05],
    ] as [Vec, number][]) {
      const k = w * (e.x * r.x + e.y * r.y);
      m11 += w * e.x * e.x;
      m12 += w * e.x * e.y;
      m22 += w * e.y * e.y;
      r1 += k * e.x;
      r2 += k * e.y;
    }
  }
  const det = m11 * m22 - m12 * m12;
  if (Math.abs(det) < 1e-9) return R;
  return { ...R, tx: (m22 * r1 - m12 * r2) / det, ty: (m11 * r2 - m12 * r1) / det };
}

/** The farthest any matched OSM runway end lies off its drawn centerline, ft. */
const offLine = (pairs: RunwayPair[], T: Similarity) =>
  Math.max(0, ...pairs.flatMap((p) => [p.a, p.b].map((q) => Math.abs(toRunwayFrame(p.mine, applyTo(T, q)).v))));

/**
 * How OSM lines up with the drawing: by the runways they share. A drawing
 * made from real coordinates already lines up; one traced from a picture may
 * be off by some feet, a few degrees or a few percent, so OSM is fitted onto
 * its runways rather than the other way round.
 */
export function fitToRunways(doc: AirportDoc, osm: Runway[]): Fit {
  const mine = doc.features.filter((f): f is Runway => f.kind === 'runway' && !f.hidden);
  const infos = runwayInfos(doc);
  const pairs: RunwayPair[] = [];
  const usedOsm = new Set<Runway>();
  for (const r of mine) {
    const names = designators(r, infos.get(r.id)?.names as [string, string] | undefined);
    const dir = sub(r.b, r.a);
    const match =
      osm.find((o) => !usedOsm.has(o) && sameRunway(names, designators(o))) ??
      osm.find((o) => !usedOsm.has(o) && lineAngle(dir, sub(o.b, o.a)) < 8 && distToSegment(mid2(o), r.a, r.b) < Math.max(1500, dist(r.a, r.b) / 2));
    if (!match) continue;
    usedOsm.add(match);
    const flip = dist(r.a, match.b) + dist(r.b, match.a) < dist(r.a, match.a) + dist(r.b, match.b);
    pairs.push({ mine: r, a: flip ? match.b : match.a, b: flip ? match.a : match.b });
  }
  if (!pairs.length) return { kind: 'position', transform: IDENTITY, runways: 0, error: 0 };
  // Real coordinates put OSM's runways on the drawn centerlines, even where their ends differ.
  const straight = pairs.every((p) => lineAngle(sub(p.mine.b, p.mine.a), sub(p.b, p.a)) < 1);
  if (straight && offLine(pairs, IDENTITY) <= 120) return { kind: 'georeferenced', transform: IDENTITY, runways: pairs.length, error: offLine(pairs, IDENTITY) };
  const T = fitRunwayLines(pairs);
  if (scaleOf(T) < 0.6 || scaleOf(T) > 1.6) return { kind: 'position', transform: IDENTITY, runways: 0, error: 0 };
  return { kind: 'fitted', transform: T, runways: pairs.length, error: offLine(pairs, T) };
}

const mid2 = (r: Runway): Vec => ({ x: (r.a.x + r.b.x) / 2, y: (r.a.y + r.b.y) / 2 });
const plain = (d: string) => d.replace(/^0+/, '').toUpperCase();
function sameRunway(a: [string, string], b: [string, string]): boolean {
  const [a0, a1] = a.map(plain);
  const [b0, b1] = b.map(plain);
  return !!a0 && !!a1 && ((a0 === b0 && a1 === b1) || (a0 === b1 && a1 === b0));
}

/* ------------------------------------------------------------------ */
/* What's missing                                                      */
/* ------------------------------------------------------------------ */

export type ImproveKind = 'runways' | 'taxiways' | 'aprons' | 'buildings' | 'symbols';
export const IMPROVE_KINDS: ImproveKind[] = ['taxiways', 'aprons', 'buildings', 'runways', 'symbols'];

export interface Improvement {
  fit: Fit;
  /** New features to add, by kind. */
  add: Record<ImproveKind, Feature[]>;
  /** How many OSM has that the drawing already covers, by kind. */
  have: Record<ImproveKind, number>;
}

/** Drawn taxiway segments bucketed on a grid, for asking what runs near a point. */
function taxiwayGrid(taxiways: Taxiway[]) {
  const CELL = 250;
  const cells = new Map<string, { a: Vec; b: Vec; t: Taxiway }[]>();
  const key = (i: number, j: number) => `${i},${j}`;
  for (const t of taxiways) {
    const pts = flatten(t.nodes, t.closed, 25).pts;
    const pad = t.width / 2 + NAMED_REACH;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      for (let x = Math.floor((Math.min(a.x, b.x) - pad) / CELL); x <= Math.floor((Math.max(a.x, b.x) + pad) / CELL); x++)
        for (let y = Math.floor((Math.min(a.y, b.y) - pad) / CELL); y <= Math.floor((Math.max(a.y, b.y) + pad) / CELL); y++) {
          const k = key(x, y);
          const list = cells.get(k) ?? [];
          list.push({ a, b, t });
          cells.set(k, list);
        }
    }
  }
  /** Whether a drawn taxiway runs within reach of `p`: close for any taxiway, farther for one of the same name. */
  return (p: Vec, name: string) =>
    (cells.get(key(Math.floor(p.x / CELL), Math.floor(p.y / CELL))) ?? []).some(
      (s) => distToSegment(p, s.a, s.b) < s.t.width / 2 + (name && s.t.name === name ? NAMED_REACH : REACH),
    );
}
const REACH = 35;
const NAMED_REACH = 150;

/** A point inside a polygon: the middle of its widest span across the middle. */
export function interiorPoint(pts: Vec[]): Vec {
  const ys = pts.map((p) => p.y);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2 + 0.01;
  const xs: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  xs.sort((p, q) => p - q);
  let best: Vec | null = null;
  let widest = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > widest) {
      widest = xs[i + 1] - xs[i];
      best = { x: (xs[i] + xs[i + 1]) / 2, y };
    }
  }
  return best ?? centroid(pts);
}

const outline = (a: Area) => flatten(a.nodes, true, 20).pts;

/**
 * What OSM has that the drawing lacks, lined up with the drawing. Nothing
 * here changes an existing feature: taxiways that run along one already
 * drawn, aprons and buildings on top of ones already drawn, runways that are
 * already there and symbols near one of the same kind are all left out.
 */
export function improvement(doc: AirportDoc, osm: OsmFeatures): Improvement {
  const fit = fitToRunways(doc, osm.runways);
  const T = fit.transform;
  const k = scaleOf(T);
  const feats = doc.features.filter((f) => !f.hidden);
  const runways = feats.filter((f): f is Runway => f.kind === 'runway');
  const taxiways = feats.filter((f): f is Taxiway => f.kind === 'taxiway');
  const areas = feats.filter((f): f is Area => f.kind === 'area');
  const symbols = feats.filter((f): f is MapSymbol => f.kind === 'symbol');

  // New taxiways match the ones already drawn; otherwise they're sized for the runways.
  const widths = taxiways.map((t) => t.width).sort((a, b) => a - b);
  const widest = Math.max(0, ...runways.map((r) => r.width));
  const width = widths.length ? widths[Math.floor(widths.length / 2)] : widest >= 150 ? 75 : widest >= 100 ? 50 : 35;
  const edgeLines = taxiways.length > 0 && taxiways.filter((t) => t.edgeLines).length > taxiways.length / 2;

  const add: Record<ImproveKind, Feature[]> = { runways: [], taxiways: [], aprons: [], buildings: [], symbols: [] };
  const have: Record<ImproveKind, number> = { runways: 0, taxiways: 0, aprons: 0, buildings: 0, symbols: 0 };

  for (const o of osm.runways.map((r) => mapFeature(r, T))) {
    const there = runways.some((r) => lineAngle(sub(r.b, r.a), sub(o.b, o.a)) < 5 && distToSegment(mid2(o), r.a, r.b) < Math.max(r.width, 100));
    if (there) have.runways++;
    else add.runways.push(o);
  }

  const nearTaxiway = taxiwayGrid(taxiways);
  for (const o of osm.taxiways.map((t) => mapFeature(t, T))) {
    const pts = flatten(o.nodes, false, 50).pts;
    const covered = pts.filter((p) => nearTaxiway(p, o.name)).length >= 0.6 * pts.length;
    if (covered) have.taxiways++;
    else add.taxiways.push({ ...o, width, edgeLines });
  }

  // An apron or building is already there if the two overlap: either's inside point lies in the other.
  const outlines = (type: Area['areaType']) => areas.filter((a) => a.areaType === type).map(outline);
  for (const [type, list, into] of [
    ['apron', osm.aprons, 'aprons'],
    ['building', osm.buildings, 'buildings'],
  ] as const) {
    const drawnOutlines = outlines(type);
    const drawnInside = drawnOutlines.map(interiorPoint);
    for (const o of list.map((a) => mapFeature(a, T))) {
      const pts = flatten(o.nodes, true, 20).pts;
      const inner = interiorPoint(pts);
      const covered = drawnOutlines.some((d, i) => pointInPolygon(inner, d) || pointInPolygon(drawnInside[i], pts));
      if (covered) have[into]++;
      else add[into].push(o);
    }
  }
  for (const o of osm.symbols.map((s) => mapFeature(s, T))) {
    if (symbols.some((s) => s.symbol === o.symbol && dist(s.p, o.p) < 400 * k)) have.symbols++;
    else add.symbols.push(o);
  }
  return { fit, add, have };
}

/** The drawing with the chosen kinds of missing features added, and OSM credited in its notes. */
export function withImprovement(doc: AirportDoc, imp: Improvement, kinds: Iterable<ImproveKind>): AirportDoc {
  const added = [...kinds].flatMap((k) => imp.add[k]);
  if (!added.length) return doc;
  const fromOsm = added.some((f) => f.kind !== 'runway');
  const notes = doc.meta.notes.includes(OSM_CREDIT) || !fromOsm ? doc.meta.notes : [doc.meta.notes.trim(), OSM_CREDIT].filter(Boolean).join('\n');
  return { ...doc, meta: { ...doc.meta, notes }, features: [...doc.features, ...added] };
}

export const countAdded = (imp: Improvement, kinds: Iterable<ImproveKind>) => [...kinds].reduce((n, k) => n + imp.add[k].length, 0);
