import { describe, expect, it } from 'vitest';
import { angleBetween, bezierPoint, bezierTangent, dist, flatten, nearestOnPolyline, pathSegments, isStraight, sub } from '../geometry';
import { autoSmooth, autoSmoothTaxiway, cleanTaxiwayName, runwayExits, turnRadius, type Anchor } from '../smooth';
import { emptyDoc, newRunway, newTaxiway } from '../defaults';
import type { AirportDoc, ID, PathNode, Taxiway } from '../types';

const P = (x: number, y: number): PathNode => ({ p: { x, y } });
const RUNWAY: Anchor = { axis: { x: 1, y: 0 }, runway: true };
/** How far before the exit line crosses the runway a high-speed exit starts curving off: 1,500 ft x tan 15 degrees. */
const LEAD = 1500 * Math.tan(Math.PI / 12);
const taxiwayIn = (doc: AirportDoc, id: ID) => doc.features.find((f): f is Taxiway => f.id === id && f.kind === 'taxiway')!;

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

  it('rebuilds a jagged bend as straight legs joined by a clean turn', () => {
    const nodes = [P(0, 0), P(600, 30), P(900, 150), P(1080, 420), P(1100, 1000)];
    for (const turns of ['drawn', 'tight'] as const) {
      const r = autoSmooth(nodes, 50, { turns });
      expect(r.straight).toBe(false);
      expect(r.nodes[0].p).toEqual({ x: 0, y: 0 });
      expect(r.nodes[r.nodes.length - 1].p).toEqual({ x: 1100, y: 1000 });
      expect(straightLegsAndArcs(r.nodes)).toBe(true);
      expect(r.radii.length).toBeGreaterThan(0);
    }
    // Tight turns use the FAA table (at most 80 ft for a 50 ft taxiway); drawn ones are never tighter.
    for (const radius of autoSmooth(nodes, 50, { turns: 'tight' }).radii) expect(radius).toBeLessThanOrEqual(80);
    for (const radius of autoSmooth(nodes, 50).radii) expect(radius).toBeGreaterThanOrEqual(60);
  });

  it('keeps a parallel taxiway parallel: square off the runway, straight along', () => {
    const nodes: PathNode[] = [
      P(-5000, -700),
      { p: { x: -4750, y: -1100 }, in: { x: -5000, y: -1060 } },
      { p: { x: 4750, y: -1100 }, out: { x: 5000, y: -1060 } },
      P(5000, -700),
    ];
    const anchors = { start: RUNWAY, end: RUNWAY };
    for (const turns of ['drawn', 'tight'] as const) {
      const r = autoSmooth(nodes, 75, { anchors, turns });
      expect(r.straight).toBe(false);
      expect(r.squared).toBe(2);
      // Leaves and rejoins the runway at right angles.
      expect(Math.abs(r.nodes[1].p.x - -5000)).toBeLessThan(0.5);
      expect(Math.abs(r.nodes[r.nodes.length - 2].p.x - 5000)).toBeLessThan(0.5);
      // The long leg runs along where it was drawn.
      for (const n of r.nodes.filter((q) => Math.abs(q.p.x) < 4500)) expect(Math.abs(n.p.y - -1100)).toBeLessThan(15);
      expect(straightLegsAndArcs(r.nodes)).toBe(true);
      // Smoothing again changes nothing.
      expect(autoSmooth(r.nodes, 75, { anchors, turns }).nodes).toBe(r.nodes);
    }
    expect(autoSmooth(nodes, 75, { anchors, turns: 'tight' }).radii).toEqual([95, 95]);
    // As drawn, the corners keep the wider sweep they were drawn with.
    for (const radius of autoSmooth(nodes, 75, { anchors }).radii) expect(radius).toBeGreaterThan(95);
  });

  it('squares a connector drawn a few degrees off perpendicular', () => {
    const r = autoSmooth([P(0, 0), P(40, -400), P(1500, -420)], 50, { anchors: { start: RUNWAY } });
    expect(angleBetween(sub(r.nodes[1].p, r.nodes[0].p), { x: 0, y: -1 })).toBeLessThan(0.5);
    expect(r.squared).toBe(1);
  });

  it('keeps a connector drawn at a deliberate angle', () => {
    // About 73 degrees off the runway: on purpose, so it stays.
    const r = autoSmooth([P(0, 0), P(120, -400), P(1500, -420)], 50, { anchors: { start: RUNWAY } });
    expect(r.squared).toBe(0);
    expect(angleBetween(sub(r.nodes[1].p, r.nodes[0].p), { x: 1, y: 0 })).toBeCloseTo(73.3, 0);
  });

  it('turns a runway exit drawn near 30 degrees into a high-speed exit', () => {
    const r = autoSmooth([P(0, 0), P(820, -512), P(3000, -600)], 75, { anchors: { start: RUNWAY } });
    expect(r.leadOffs).toEqual([{ radius: 1500, highSpeed: true }]);
    // After the curve off the runway, the exit leg runs at 30 degrees.
    expect(angleBetween(sub(r.nodes[2].p, r.nodes[1].p), { x: 1, y: 0 })).toBeCloseTo(30, 0);
  });

  it('leaves a 45 degree exit at 45 degrees, meeting the runway without a curve', () => {
    const r = autoSmooth([P(0, 0), P(600, -600), P(3000, -620)], 75, { anchors: { start: RUNWAY } });
    expect(r.leadOffs).toEqual([]);
    expect(angleBetween(sub(r.nodes[1].p, r.nodes[0].p), { x: 1, y: 0 })).toBeCloseTo(45, 0);
  });

  it('turns a curve clicked out in small steps into one turn, as wide as it was drawn', () => {
    // Six clicks sweeping from north-bound to east-bound, starting on a runway.
    const clicks = [P(0, 0), P(160, -720), P(533, -1253), P(1333, -1547), P(2667, -1627), P(3733, -1600)];
    const drawn = autoSmooth(clicks, 75, { anchors: { start: RUNWAY } });
    expect(drawn.radii).toHaveLength(1);
    expect(drawn.radii[0]).toBeGreaterThan(500);
    expect(straightLegsAndArcs(drawn.nodes)).toBe(true);
    // Tight: the drawn 77 degree departure is deliberate, so this is about a 79 degree turn,
    // which the FAA table puts between its 60 and 90 degree radii (110 and 95 ft).
    const tight = autoSmooth(clicks, 75, { anchors: { start: RUNWAY }, turns: 'tight' });
    expect(tight.radii).toHaveLength(1);
    expect(tight.radii[0]).toBeGreaterThanOrEqual(95);
    expect(tight.radii[0]).toBeLessThanOrEqual(110);
  });

  it('turns a drawn quarter-curve into one circular turn', () => {
    const curve: PathNode[] = [
      { p: { x: 0, y: 0 }, out: { x: -300, y: 0 } },
      { p: { x: -700, y: 700 }, in: { x: -700, y: 300 } },
    ];
    expect(autoSmooth(curve, 75, { turns: 'tight' }).radii).toEqual([95]);
    const drawn = autoSmooth(curve, 75);
    expect(drawn.radii).toHaveLength(1);
    expect(drawn.radii[0]).toBeGreaterThan(500);
    expect(drawn.deviation).toBeLessThan(60);
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
    // Leaves the runway at about 84 degrees: meant to be square.
    const t = newTaxiway([P(0, 0), P(-40, -380), P(-1400, -400)], 'C', 50);
    const res = autoSmoothTaxiway({ ...emptyDoc(), features: [rwy, t] }, t.id)!;
    expect(res.squared).toBe(1);
    const leg = sub(res.nodes[1].p, res.nodes[0].p);
    expect(angleBetween(leg, { x: 0, y: -1 })).toBeLessThan(0.5);
  });

  it('gives a runway exit the angle chosen for it by sliding its turn along the next leg', () => {
    const rwy = newRunway({ x: -3000, y: 0 }, { x: 3000, y: 0 });
    // Leaves the runway at 40 degrees, then turns onto a parallel 400 ft away.
    const drawn = newTaxiway([P(0, 0), P(477, -400), P(2000, -400)], 'D', 50);
    expect(runwayExits({ ...emptyDoc(), features: [rwy, drawn] }, drawn)[0].angle).toBeCloseTo(40, 0);
    for (const exitAngle of [30, 45, 90]) {
      const t = { ...drawn, exitAngle };
      const res = autoSmoothTaxiway({ ...emptyDoc(), features: [rwy, t] }, t.id)!;
      expect(res.exits).toBe(1);
      const [exit] = runwayExits(res.doc, taxiwayIn(res.doc, t.id));
      expect(exit.angle).toBeCloseTo(exitAngle, 1);
      // The exit line still crosses the centerline at the origin; a 30 degree exit curves off before it.
      expect(exit.leadOff).toBe(exitAngle === 30);
      expect(res.nodes[0].p.x).toBeCloseTo(exitAngle === 30 ? -LEAD : 0, 6);
      expect(res.nodes[0].p.y).toBeCloseTo(0, 6);
      expect(res.nodes[res.nodes.length - 1].p).toEqual({ x: 2000, y: -400 });
      // Still leaning the way it was drawn, toward +x.
      expect(res.nodes[1].p.x).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('slides a straight connector along the runway to give it the chosen angle', () => {
    const rwy = newRunway({ x: -3000, y: 0 }, { x: 3000, y: 0 });
    const t = { ...newTaxiway([P(0, 0), P(0, -400)], 'E', 50), exitAngle: 30 };
    const doc = { ...emptyDoc(), features: [rwy, t] };
    const res = autoSmoothTaxiway(doc, t.id)!;
    expect(res.exits).toBe(1);
    // A curve off the runway, then the straight connector.
    expect(res.nodes).toHaveLength(3);
    expect(res.straight).toBe(true);
    expect(res.nodes[2].p).toEqual({ x: 0, y: -400 });
    expect(res.nodes[0].p.y).toBeCloseTo(0, 6);
    expect(Math.abs(res.nodes[0].p.x)).toBeCloseTo(400 / Math.tan(Math.PI / 6) + LEAD, 3);
    expect(runwayExits(res.doc, taxiwayIn(res.doc, t.id))[0].angle).toBeCloseTo(30, 1);
    // Setting it again changes nothing.
    const again = autoSmoothTaxiway(res.doc, t.id)!;
    expect(again.nodes).toEqual(res.nodes);
  });

  it('leans a square exit the way the taxiway carries on', () => {
    const rwy = newRunway({ x: -3000, y: 0 }, { x: 3000, y: 0 });
    for (const [east, onward] of [[true, 2000], [false, -2000]] as const) {
      const t = { ...newTaxiway([P(0, 0), P(0, -400), P(onward, -400)], 'G', 50), exitAngle: 30 };
      const res = autoSmoothTaxiway({ ...emptyDoc(), features: [rwy, t] }, t.id)!;
      expect(res.exits).toBe(1);
      // Traffic runs toward the lean, so the curve off the runway starts behind the exit.
      expect(res.nodes[0].p.x).toBeCloseTo(east ? -LEAD : LEAD, 6);
      expect(res.nodes[1].p.x > 0).toBe(east);
      expect(runwayExits(res.doc, taxiwayIn(res.doc, t.id))[0].angle).toBeCloseTo(30, 1);
    }
  });

  it('leans a square connector the other way when the runway ends too soon', () => {
    // Either way works for a runway drawn b to a, too.
    for (const [a, b] of [[-300, 3000], [3000, -300]]) {
      const rwy = newRunway({ x: a, y: 0 }, { x: b, y: 0 });
      const t = { ...newTaxiway([P(0, 0), P(0, -400)], 'F', 50), exitAngle: 30 };
      const res = autoSmoothTaxiway({ ...emptyDoc(), features: [rwy, t] }, t.id)!;
      expect(res.exits).toBe(1);
      expect(res.nodes[0].p.x).toBeCloseTo(400 / Math.tan(Math.PI / 6) + LEAD, 3);
    }
  });

  it('curves a high-speed exit off the runway centerline on a 1,500 ft radius', () => {
    const rwy = newRunway({ x: -3000, y: 0 }, { x: 3000, y: 0 });
    // A 30 degree exit onto a parallel taxiway 400 ft away.
    const drawn = newTaxiway([P(0, 0), P(400 / Math.tan(Math.PI / 6), -400), P(3000, -400)], 'H', 75);
    for (const turns of ['drawn', 'tight'] as const) {
      const res = autoSmoothTaxiway({ ...emptyDoc(), features: [rwy, drawn] }, drawn.id, turns)!;
      expect(res.leadOffs).toEqual([{ radius: 1500, highSpeed: true }]);
      expect(res.radii).toHaveLength(1);
      // Tangent to the centerline where it starts, then a true 1,500 ft arc turning 30 degrees.
      expect(res.nodes[0].p.x).toBeCloseTo(-LEAD, 6);
      const arc = pathSegments(res.nodes, false)[0];
      expect(angleBetween(bezierTangent(arc, 0), { x: 1, y: 0 })).toBeLessThan(0.01);
      expect(angleBetween(bezierTangent(arc, 1), { x: 1, y: 0 })).toBeCloseTo(30, 6);
      const center = { x: -LEAD, y: -1500 };
      for (const k of [0.25, 0.5, 0.75]) expect(dist(bezierPoint(arc, k), center)).toBeCloseTo(1500, -0.5);
      const [exit] = runwayExits(res.doc, taxiwayIn(res.doc, drawn.id));
      expect(exit).toMatchObject({ leadOff: true });
      expect(exit.angle).toBeCloseTo(30, 6);
      // Smoothing it again changes nothing.
      expect(autoSmoothTaxiway(res.doc, drawn.id, turns)!.nodes).toEqual(res.nodes);
    }
  });

  it('curves a high-speed exit drawn from the taxiway side off the runway too', () => {
    const rwy = newRunway({ x: -3000, y: 0 }, { x: 3000, y: 0 });
    const drawn = newTaxiway([P(3000, -400), P(400 / Math.tan(Math.PI / 6), -400), P(0, 0)], 'J', 75);
    const res = autoSmoothTaxiway({ ...emptyDoc(), features: [rwy, drawn] }, drawn.id)!;
    expect(res.leadOffs).toEqual([{ radius: 1500, highSpeed: true }]);
    expect(res.nodes[res.nodes.length - 1].p.x).toBeCloseTo(-LEAD, 6);
    expect(runwayExits(res.doc, taxiwayIn(res.doc, drawn.id))[0].angle).toBeCloseTo(30, 6);
    expect(autoSmoothTaxiway(res.doc, drawn.id)!.nodes).toEqual(res.nodes);
  });

  it('drops the curve off the runway when a high-speed exit is given another angle', () => {
    const rwy = newRunway({ x: -3000, y: 0 }, { x: 3000, y: 0 });
    const drawn = newTaxiway([P(0, 0), P(400 / Math.tan(Math.PI / 6), -400), P(3000, -400)], 'H', 75);
    const fast = autoSmoothTaxiway({ ...emptyDoc(), features: [rwy, drawn] }, drawn.id)!;
    const t = { ...taxiwayIn(fast.doc, drawn.id), exitAngle: 90 };
    const res = autoSmoothTaxiway({ ...fast.doc, features: [rwy, t] }, t.id)!;
    expect(res.leadOffs).toEqual([]);
    // Straight off the runway where the high-speed exit's line crossed it.
    expect(res.nodes[0].p.x).toBeCloseTo(0, 6);
    expect(res.nodes[0].p.y).toBeCloseTo(0, 6);
    const [exit] = runwayExits(res.doc, taxiwayIn(res.doc, t.id));
    expect(exit.leadOff).toBe(false);
    expect(exit.angle).toBeCloseTo(90, 6);
  });

  it('leaves the exit alone when no lean fits on the runway', () => {
    const rwy = newRunway({ x: -300, y: 0 }, { x: 300, y: 0 });
    const t = { ...newTaxiway([P(0, 0), P(0, -400)], 'F', 50), exitAngle: 30 };
    const res = autoSmoothTaxiway({ ...emptyDoc(), features: [rwy, t] }, t.id)!;
    expect(res.exits).toBe(0);
    expect(res.nodes).toBe(t.nodes);
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

