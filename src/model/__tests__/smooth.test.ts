import { describe, expect, it } from 'vitest';
import { angleBetween, flatten, nearestOnPolyline, pathSegments, isStraight, sub } from '../geometry';
import { autoSmooth, autoSmoothTaxiway, cleanTaxiwayName, turnRadius, type Anchor } from '../smooth';
import { emptyDoc, newRunway, newTaxiway } from '../defaults';
import type { PathNode } from '../types';

const P = (x: number, y: number): PathNode => ({ p: { x, y } });
const RUNWAY: Anchor = { axis: { x: 1, y: 0 }, runway: true };

/** Every segment is either a straight leg or a turn whose handles hug a circle. */
function straightLegsAndArcs(nodes: PathNode[]): boolean {
  return pathSegments(nodes, false).every((s) => isStraight(s) || (s.c1 !== s.p0 && s.c2 !== s.p3));
}

describe('turnRadius (AC 150/5300-13A tables 4-4 to 4-10)', () => {
  it('uses the tabulated centerline radius for the taxiway width and turn', () => {
    expect(turnRadius(25, 90)).toBe(40);
    expect(turnRadius(50, 90)).toBe(60);
    expect(turnRadius(75, 90)).toBe(95);
    expect(turnRadius(75, 45)).toBe(110);
    expect(turnRadius(100, 150)).toBe(150);
    expect(turnRadius(75, 105)).toBeCloseTo(105);
  });
});

describe('autoSmooth', () => {
  it('straightens a path that wobbles close to its chord and keeps its ends', () => {
    const r = autoSmooth([P(0, 0), P(500, 20), P(1000, -25), P(1500, 15), P(2000, 0)], 50);
    expect(r.straight).toBe(true);
    expect(r.nodes).toEqual([{ p: { x: 0, y: 0 } }, { p: { x: 2000, y: 0 } }]);
  });

  it('straightens brief wobbles bigger than the tolerance, like a click that snapped a grid step off', () => {
    expect(autoSmooth([P(0, 0), P(1330, 0), P(2660, 200), P(3990, 0), P(5320, 0)], 75).straight).toBe(true);
    expect(autoSmooth([P(0, 0), P(1330, -200), P(2660, 0), P(3990, -200), P(5320, 0)], 75).straight).toBe(true);
  });

  it('rebuilds a jagged bend as straight legs joined by an FAA-radius turn', () => {
    const nodes = [P(0, 0), P(600, 30), P(900, 150), P(1080, 420), P(1100, 1000)];
    const r = autoSmooth(nodes, 50);
    expect(r.straight).toBe(false);
    expect(r.nodes[0].p).toEqual({ x: 0, y: 0 });
    expect(r.nodes[r.nodes.length - 1].p).toEqual({ x: 1100, y: 1000 });
    expect(straightLegsAndArcs(r.nodes)).toBe(true);
    expect(r.radii.length).toBeGreaterThan(0);
    for (const radius of r.radii) expect(radius).toBeLessThanOrEqual(80);
    expect(r.deviation).toBeLessThan(150);
  });

  it('keeps a parallel taxiway parallel: square off the runway, 95 ft turns, straight along', () => {
    const nodes: PathNode[] = [
      P(-5000, -700),
      { p: { x: -4750, y: -1100 }, in: { x: -5000, y: -1060 } },
      { p: { x: 4750, y: -1100 }, out: { x: 5000, y: -1060 } },
      P(5000, -700),
    ];
    const r = autoSmooth(nodes, 75, { start: RUNWAY, end: RUNWAY });
    expect(r.straight).toBe(false);
    expect(r.radii).toEqual([95, 95]);
    // Leaves and rejoins the runway at right angles.
    expect(Math.abs(r.nodes[1].p.x - -5000)).toBeLessThan(0.5);
    expect(Math.abs(r.nodes[r.nodes.length - 2].p.x - 5000)).toBeLessThan(0.5);
    // The long leg runs along where it was drawn.
    const top = r.nodes.filter((n) => Math.abs(n.p.x) < 4800);
    for (const n of top) expect(Math.abs(n.p.y - -1100)).toBeLessThan(15);
    expect(straightLegsAndArcs(r.nodes)).toBe(true);
    // Smoothing again changes nothing.
    expect(autoSmooth(r.nodes, 75, { start: RUNWAY, end: RUNWAY }).nodes).toBe(r.nodes);
  });

  it('squares a connector that leaves the runway a little off perpendicular', () => {
    const r = autoSmooth([P(0, 0), P(120, -400), P(1500, -420)], 50, { start: RUNWAY });
    const firstLeg = sub(r.nodes[1].p, r.nodes[0].p);
    expect(angleBetween(firstLeg, { x: 0, y: -1 })).toBeLessThan(0.5);
    expect(r.squared).toBe(1);
  });

  it('turns a shallow runway exit into a 30 degree exit', () => {
    const r = autoSmooth([P(0, 0), P(820, -574), P(3000, -600)], 75, { start: RUNWAY });
    const firstLeg = sub(r.nodes[1].p, r.nodes[0].p);
    expect(angleBetween(firstLeg, { x: 1, y: 0 })).toBeCloseTo(30, 0);
  });

  it('turns a curve clicked out in small steps into one turn', () => {
    // Six clicks sweeping from north-bound to east-bound, starting on a runway.
    const clicks = [P(0, 0), P(160, -720), P(533, -1253), P(1333, -1547), P(2667, -1627), P(3733, -1600)];
    const r = autoSmooth(clicks, 75, { start: RUNWAY });
    expect(r.radii).toHaveLength(1);
    // About a 90 degree turn for a 75 ft taxiway: 95 ft in the FAA table.
    expect(r.radii[0]).toBeGreaterThanOrEqual(95);
    expect(r.radii[0]).toBeLessThanOrEqual(97);
    expect(angleBetween(sub(r.nodes[1].p, r.nodes[0].p), { x: 0, y: -1 })).toBeLessThan(0.5);
    expect(straightLegsAndArcs(r.nodes)).toBe(true);
  });

  it('turns a drawn quarter-curve into one square corner with an FAA-radius turn', () => {
    const curve: PathNode[] = [
      { p: { x: 0, y: 0 }, out: { x: -300, y: 0 } },
      { p: { x: -700, y: 700 }, in: { x: -700, y: 300 } },
    ];
    const r = autoSmooth(curve, 75);
    expect(r.radii).toEqual([95]);
    expect(r.deviation).toBeLessThan(250);
  });

  it('keeps a U clicked out in steps as two turns, not one', () => {
    const clicks = [P(0, 0), P(0, -300), P(150, -520), P(400, -600), P(2000, -600), P(2250, -520), P(2400, -300), P(2400, 0)];
    const r = autoSmooth(clicks, 50);
    expect(r.radii).toHaveLength(2);
  });

  it('keeps a deliberate sideways jog as turns, not a diagonal', () => {
    expect(autoSmooth([P(0, 0), P(1000, 0), P(1500, 300), P(2500, 300)], 50).straight).toBe(false);
  });
});

describe('autoSmoothTaxiway', () => {
  it('slides taxiways attached to the old centerline onto the new one', () => {
    const main = newTaxiway([P(0, 0), P(800, -45), P(1600, 40), P(2400, 0)], 'A', 50);
    const attachAt = nearestOnPolyline(flatten(main.nodes, false), { x: 1600, y: 300 })!.point;
    const spur = newTaxiway([{ p: attachAt }, P(1600, 600)], 'B', 50);
    const res = autoSmoothTaxiway({ ...emptyDoc(), features: [main, spur] }, main.id)!;
    expect(res.straight).toBe(true);
    expect(res.reattached).toBe(1);
    const newSpur = res.doc.features.find((f) => f.id === spur.id)!;
    const newMain = res.doc.features.find((f) => f.id === main.id)!;
    if (newSpur.kind !== 'taxiway' || newMain.kind !== 'taxiway') throw new Error('kinds');
    expect(nearestOnPolyline(flatten(newMain.nodes, false), newSpur.nodes[0].p)!.dist).toBeLessThan(0.5);
    expect(newSpur.nodes[1].p).toEqual({ x: 1600, y: 600 });
  });

  it('squares a taxiway to the runway it starts on', () => {
    const rwy = newRunway({ x: -3000, y: 0 }, { x: 3000, y: 0 });
    const t = newTaxiway([P(0, 0), P(-110, -380), P(-1400, -400)], 'C', 50);
    const res = autoSmoothTaxiway({ ...emptyDoc(), features: [rwy, t] }, t.id)!;
    expect(res.squared).toBe(1);
    const leg = sub(res.nodes[1].p, res.nodes[0].p);
    expect(angleBetween(leg, { x: 0, y: -1 })).toBeLessThan(0.5);
  });

  it('leaves taxiways that only pass nearby alone', () => {
    const main = newTaxiway([P(0, 0), P(2400, 0)], 'A', 50);
    const other = newTaxiway([P(1000, 40), P(1000, 600)], 'B', 50);
    const res = autoSmoothTaxiway({ ...emptyDoc(), features: [main, other] }, main.id)!;
    expect(res.reattached).toBe(0);
    expect(res.doc.features[1]).toBe(other);
  });
});

describe('cleanTaxiwayName', () => {
  it('upper-cases and strips characters charts do not use', () => {
    expect(cleanTaxiwayName('a1')).toBe('A1');
    expect(cleanTaxiwayName('b!@#2')).toBe('B2');
    expect(cleanTaxiwayName('taxilane k9 extra')).toBe('TAXILANE');
  });
});

