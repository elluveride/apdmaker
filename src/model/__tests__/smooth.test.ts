import { describe, expect, it } from 'vitest';
import { bezierPoint, fitCubic, flatten, nearestOnPolyline, resample, type Segment } from '../geometry';
import { autoSmooth, autoSmoothTaxiway, cleanTaxiwayName, routeTolerance } from '../smooth';
import { emptyDoc, newTaxiway } from '../defaults';
import type { PathNode } from '../types';

const P = (x: number, y: number): PathNode => ({ p: { x, y } });

describe('fitCubic', () => {
  it('recovers a cubic from points sampled along it', () => {
    const seg: Segment = { p0: { x: 0, y: 0 }, c1: { x: 400, y: 0 }, c2: { x: 1000, y: 300 }, p3: { x: 1000, y: 900 } };
    const pts = resample(flatten([{ p: seg.p0, out: seg.c1 }, { p: seg.p3, in: seg.c2 }], false, 5), 64);
    const { seg: fit, error } = fitCubic(pts);
    expect(error).toBeLessThan(2);
    // Same shape: every point on the original lies on the fitted curve.
    const fitted = flatten([{ p: fit.p0, out: fit.c1 }, { p: fit.p3, in: fit.c2 }], false, 5);
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(nearestOnPolyline(fitted, bezierPoint(seg, t))!.dist).toBeLessThan(2);
    }
  });
});

describe('autoSmooth', () => {
  it('straightens a path that wobbles close to its chord and keeps its ends', () => {
    const nodes = [P(0, 0), P(500, 20), P(1000, -25), P(1500, 15), P(2000, 0)];
    const r = autoSmooth(nodes, 50);
    expect(r.straight).toBe(true);
    expect(r.nodes).toEqual([{ p: { x: 0, y: 0 } }, { p: { x: 2000, y: 0 } }]);
  });

  it('straightens brief wobbles bigger than the tolerance, like a click that snapped a grid step off', () => {
    expect(autoSmooth([P(0, 0), P(1330, 0), P(2660, 200), P(3990, 0), P(5320, 0)], 75).straight).toBe(true);
    expect(autoSmooth([P(0, 0), P(1330, -200), P(2660, 0), P(3990, -200), P(5320, 0)], 75).straight).toBe(true);
  });

  it('keeps a deliberate sideways jog as a curve', () => {
    expect(autoSmooth([P(0, 0), P(1000, 0), P(1500, 300), P(2500, 300)], 50).straight).toBe(false);
  });

  it('keeps a long parallel taxiway on its route instead of flattening it onto the runway', () => {
    const nodes: PathNode[] = [
      P(-5000, -700),
      { p: { x: -4750, y: -1100 }, in: { x: -5000, y: -1060 } },
      { p: { x: 4750, y: -1100 }, out: { x: 5000, y: -1060 } },
      P(5000, -700),
    ];
    const r = autoSmooth(nodes, 75);
    expect(r.straight).toBe(false);
    // One curve can't follow a U, so it splits into a few curves that can.
    expect(r.pieces).toBeGreaterThan(1);
    expect(r.deviation).toBeLessThanOrEqual(routeTolerance(10800, 75) + 5);
    expect(r.nodes[0].p).toEqual({ x: -5000, y: -700 });
    expect(r.nodes[r.nodes.length - 1].p).toEqual({ x: 5000, y: -700 });
    // Joins have no corners: each interior handle pair is collinear through its point.
    for (const n of r.nodes.slice(1, -1)) {
      const a = { x: n.p.x - n.in!.x, y: n.p.y - n.in!.y };
      const b = { x: n.out!.x - n.p.x, y: n.out!.y - n.p.y };
      const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
      expect(cos).toBeGreaterThan(0.999);
    }
    // And smoothing the result again changes nothing.
    expect(autoSmooth(r.nodes, 75).nodes).toBe(r.nodes);
  });

  it('turns a clearly bent path into one smooth curve that follows it', () => {
    // A jagged quarter turn: east, then south.
    const nodes = [P(0, 0), P(600, 30), P(900, 150), P(1080, 420), P(1100, 1000)];
    const r = autoSmooth(nodes, 50);
    expect(r.straight).toBe(false);
    expect(r.pieces).toBe(1);
    expect(r.nodes).toHaveLength(2);
    expect(r.nodes[0].p).toEqual({ x: 0, y: 0 });
    expect(r.nodes[1].p).toEqual({ x: 1100, y: 1000 });
    expect(r.nodes[0].out).toBeDefined();
    expect(r.nodes[1].in).toBeDefined();
    expect(r.deviation).toBeLessThan(80);
    expect(autoSmooth(r.nodes, 50).nodes).toBe(r.nodes);
  });
});

describe('autoSmoothTaxiway', () => {
  it('slides taxiways attached to the old centerline onto the new curve', () => {
    const main = newTaxiway([P(0, 0), P(800, -45), P(1600, 40), P(2400, 0)], 'A', 50);
    const oldPoly = flatten(main.nodes, false);
    const attachAt = nearestOnPolyline(oldPoly, { x: 1600, y: 300 })!.point;
    const spur = newTaxiway([{ p: attachAt }, P(1600, 600)], 'B', 50);
    const doc = { ...emptyDoc(), features: [main, spur] };

    const res = autoSmoothTaxiway(doc, main.id)!;
    expect(res.straight).toBe(true);
    expect(res.reattached).toBe(1);
    const newSpur = res.doc.features.find((f) => f.id === spur.id)!;
    const newMain = res.doc.features.find((f) => f.id === main.id)!;
    if (newSpur.kind !== 'taxiway' || newMain.kind !== 'taxiway') throw new Error('kinds');
    const onNew = nearestOnPolyline(flatten(newMain.nodes, false), newSpur.nodes[0].p)!;
    expect(onNew.dist).toBeLessThan(0.5);
    expect(newSpur.nodes[1].p).toEqual({ x: 1600, y: 600 });
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
