import { describe, expect, it } from 'vitest';
import { emptyDoc, newRunway } from '../defaults';
import { rotateFeature, translateFeature } from '../featureOps';
import { pointInPolygon } from '../geometry';
import {
  assembleRings,
  improvement,
  interiorPoint,
  IMPROVE_KINDS,
  lengthFt,
  lineNodes,
  osmFeatures,
  OSM_CREDIT,
  rotationOf,
  taxiwayChains,
  taxiwayRef,
  withImprovement,
  type OsmElement,
  type OsmWay,
} from '../osmAirport';
import { worldToLatLon } from '../sheet';
import type { AirportDoc, Area, Runway, Taxiway, Vec } from '../types';

const REF = { lat: 33.4, lon: -112 };
/** A lat/lon from world feet (x east, y south). */
const ll = (x: number, y: number) => worldToLatLon({ x, y }, REF.lat, REF.lon);

let ids = 1;
const way = (tags: Record<string, string>, pts: [number, number][], nodes?: number[]): OsmWay => ({
  type: 'way',
  id: ids++,
  tags,
  geometry: pts.map(([x, y]) => ll(x, y)),
  nodes: nodes ?? pts.map(() => ids++),
});
const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

/** A made-up airport as OSM would map it: one east-west runway, a parallel taxiway in two pieces, a connector, an apron, a terminal and a windsock. */
function osmAirport(): OsmElement[] {
  const shared = 900001;
  return [
    way({ aeroway: 'runway', ref: '09/27', width: '45', surface: 'asphalt' }, [[-5000, 0], [5000, 0]]),
    way({ aeroway: 'taxiway', ref: 'A' }, [[-4800, -600], [-1000, -600], [0, -600]], [1, 2, shared]),
    way({ aeroway: 'taxiway', ref: 'A' }, [[0, -600], [2000, -600], [4800, -600]], [shared, 3, 4]),
    way({ aeroway: 'taxiway', ref: 'A1' }, [[-4800, -600], [-4800, 0]]),
    way({ aeroway: 'apron', name: 'Main Ramp' }, box(-1500, -1500, 1500, -800)),
    way({ building: 'yes' }, box(-2000, -3000, -1100, -2980)),
    way({ aeroway: 'terminal', building: 'yes', name: 'Terminal' }, box(-500, -2200, 500, -1700)),
    way({ aeroway: 'terminal', building: 'yes', name: 'Swift Aviation' }, box(3000, -2200, 3100, -2100)),
    way({ building: 'roof' }, box(2000, -2200, 2100, -2100)),
    { type: 'node', id: ids++, ...ll(3000, 500), tags: { aeroway: 'windsock' } },
  ];
}

const realDoc = (): AirportDoc => {
  const r = newRunway({ x: -5000, y: 0 }, { x: 5000, y: 0 }, 150);
  r.ends = [{ ...r.ends[0], designator: '9' }, { ...r.ends[1], designator: '27' }];
  return { ...emptyDoc(), meta: { ...emptyDoc().meta, refLat: REF.lat, refLon: REF.lon, magVar: 0 }, features: [r] };
};

describe('reading OpenStreetMap', () => {
  it('reads lengths in metres unless they say feet', () => {
    expect(lengthFt('45')).toBeCloseTo(147.6, 1);
    expect(lengthFt('150 ft')).toBe(150);
    expect(lengthFt('wide')).toBeUndefined();
  });

  it('finds taxiway designators in ref or name', () => {
    expect(taxiwayRef({ ref: 'b 4' })).toBe('B4');
    expect(taxiwayRef({ name: 'Taxiway K' })).toBe('K');
    expect(taxiwayRef({ name: 'Cargo apron link' })).toBe('');
  });

  it('joins a taxiway split into ways back into one line, stopping where it branches', () => {
    const a = way({ ref: 'A' }, [[0, 0], [100, 0]], [1, 2]);
    const b = way({ ref: 'A' }, [[100, 0], [200, 0]], [2, 3]);
    const c = way({ ref: 'A' }, [[300, 0], [200, 0]], [4, 3]);
    const branch1 = way({ ref: 'B' }, [[0, 0], [0, 100]], [10, 11]);
    const branch2 = way({ ref: 'B' }, [[0, 100], [0, 200]], [11, 12]);
    const branch3 = way({ ref: 'B' }, [[0, 100], [100, 100]], [11, 13]);
    const chains = taxiwayChains([a, b, c, branch1, branch2, branch3]);
    expect(chains.filter((ch) => ch.ref === 'A').map((ch) => ch.coords.length)).toEqual([4]);
    expect(chains.filter((ch) => ch.ref === 'B')).toHaveLength(3);
  });

  it('joins multipolygon member ways into rings', () => {
    const p = (x: number, y: number) => ll(x, y);
    const rings = assembleRings([
      [p(0, 0), p(100, 0)],
      [p(100, 100), p(100, 0)],
      [p(100, 100), p(0, 100), p(0, 0)],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
  });

  it('keeps corners sharp and gives gentle bends curve handles', () => {
    const arc: Vec[] = Array.from({ length: 10 }, (_, i) => {
      const t = (i / 9) * (Math.PI / 2);
      return { x: 300 * Math.sin(t), y: 300 - 300 * Math.cos(t) };
    });
    const curved = lineNodes([{ x: -500, y: 0 }, ...arc, { x: 300, y: 800 }], 3);
    expect(curved.some((n) => n.smooth)).toBe(true);
    const corner = lineNodes([{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }], 3);
    expect(corner.map((n) => n.smooth ?? false)).toEqual([false, false, false]);
  });

  it('turns an airport into chart features in feet from the reference point', () => {
    const f = osmFeatures(osmAirport(), REF, 0);
    expect(f.runways).toHaveLength(1);
    const r = f.runways[0];
    expect(r.a.x).toBeCloseTo(-5000, 0);
    expect(r.width).toBe(148);
    expect(r.ends.map((e) => e.designator)).toEqual(['9', '27']);
    expect(f.taxiways.map((t) => t.name).sort()).toEqual(['A', 'A1']);
    expect(f.aprons.map((a) => a.name)).toEqual(['MAIN RAMP']);
    expect(f.buildings.map((b) => [b.name, b.showLabel])).toEqual([
      ['TERMINAL', true],
      ['SWIFT AVIATION', false],
    ]);
    expect(f.symbols.map((s) => s.symbol)).toEqual(['windcone']);
  });

  it('puts runway numbers on the right ends for the variation', () => {
    const w = way({ aeroway: 'runway', ref: '08/26' }, [[5000, 0], [-5000, 0]]);
    // Landing a -> b is westbound: 270° true, 259° magnetic with 11° east variation, so runway 26.
    expect(osmFeatures([w], REF, 11).runways[0].ends.map((e) => e.designator)).toEqual(['26', '8']);
  });
});

describe('adding real detail', () => {
  it('adds what is missing to an airport placed from real coordinates, and nothing twice', () => {
    const doc = realDoc();
    const imp = improvement(doc, osmFeatures(osmAirport(), REF, 0));
    expect(imp.fit.kind).toBe('georeferenced');
    expect(IMPROVE_KINDS.map((k) => imp.add[k].length)).toEqual([2, 1, 2, 0, 1]);
    expect(imp.have.runways).toBe(1);
    const next = withImprovement(doc, imp, IMPROVE_KINDS);
    expect(next.features.slice(0, 1)).toEqual(doc.features);
    expect(next.meta.notes).toContain(OSM_CREDIT);
    const again = improvement(next, osmFeatures(osmAirport(), REF, 0));
    expect(IMPROVE_KINDS.map((k) => again.add[k].length)).toEqual([0, 0, 0, 0, 0]);
  });

  it('sizes new taxiways like the ones already drawn', () => {
    const doc = realDoc();
    const t: Taxiway = { id: 't', kind: 'taxiway', name: 'Z', width: 60, nodes: [{ p: { x: 0, y: 2000 } }, { p: { x: 100, y: 2000 } }], showLabel: true, labelT: 0.5, edgeLines: true, closed: false };
    const imp = improvement({ ...doc, features: [...doc.features, t] }, osmFeatures(osmAirport(), REF, 0));
    expect(imp.add.taxiways.map((x) => [(x as Taxiway).width, (x as Taxiway).edgeLines])).toEqual([
      [60, true],
      [60, true],
    ]);
  });

  it('leaves out what is already drawn, even drawn a little off', () => {
    const doc = realDoc();
    const mine: Taxiway = { id: 'm', kind: 'taxiway', name: 'P', width: 50, nodes: [{ p: { x: -4800, y: -620 } }, { p: { x: 4800, y: -620 } }], showLabel: true, labelT: 0.5, edgeLines: false, closed: false };
    const ramp: Area = { id: 'r', kind: 'area', areaType: 'apron', name: '', nodes: box(-1400, -1450, 1400, -850).slice(0, 4).map(([x, y]) => ({ p: { x, y } })), showLabel: false };
    const imp = improvement({ ...doc, features: [...doc.features, mine, ramp] }, osmFeatures(osmAirport(), REF, 0));
    expect(imp.add.taxiways.map((t) => (t as Taxiway).name)).toEqual(['A1']);
    expect(imp.add.aprons).toHaveLength(0);
  });

  it('lines real data up with a traced drawing by its runways', () => {
    const traced = realDoc();
    // Traced a little turned and off: the drawing's runway is 2° clockwise and 300 ft east.
    traced.features = traced.features.map((f) => translateFeature(rotateFeature(f, 2), { x: 300, y: 0 }));
    const imp = improvement(traced, osmFeatures(osmAirport(), REF, 0));
    expect(imp.fit.kind).toBe('fitted');
    expect(rotationOf(imp.fit.transform)).toBeCloseTo(2, 1);
    expect(imp.fit.error).toBeLessThan(5);
    // The terminal comes along: its middle lands where the turn and shift put it.
    const terminal = imp.add.buildings[0] as Area;
    const c = interiorPoint(terminal.nodes.map((n) => n.p));
    const expected = { x: 300 + 1950 * Math.sin((2 * Math.PI) / 180), y: -1950 * Math.cos((2 * Math.PI) / 180) };
    expect(Math.hypot(c.x - expected.x, c.y - expected.y)).toBeLessThan(15);
  });

  it('leaves walkways and walls out of the buildings', () => {
    const f = osmFeatures(osmAirport(), REF, 0);
    expect(f.buildings).toHaveLength(2);
    expect(f.aprons[0].showLabel).toBe(true);
  });

  it('finds a point inside an L-shaped outline, where the centroid is not', () => {
    const L: Vec[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 100 }, { x: 0, y: 100 }];
    expect(pointInPolygon(interiorPoint(L), L)).toBe(true);
  });

  it('adds nothing and credits nobody when nothing is chosen', () => {
    const doc = realDoc();
    const imp = improvement(doc, osmFeatures(osmAirport(), REF, 0));
    expect(withImprovement(doc, imp, [])).toBe(doc);
    const runwaysOnly = withImprovement({ ...doc, features: [] as Runway[] }, imp, ['runways']);
    expect(runwaysOnly.meta.notes).not.toContain(OSM_CREDIT);
  });
});
