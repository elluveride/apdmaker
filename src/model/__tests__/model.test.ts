import { describe, expect, it } from 'vitest';
import { bearing, flatten, insertNode, nearestOnPolyline, pathSegments, bezierPoint } from '../geometry';
import { headingNumber, runwayInfos, toMagnetic } from '../runway';
import { computeHoldLines } from '../holdShort';
import { defaultEnd, emptyDoc, newRunway, newTaxiway, nextTaxiwayName } from '../defaults';
import { sampleDoc } from '../sample';
import { formatDMS, niceCeil } from '../sheet';
import type { AirportDoc, Runway } from '../types';

const docWith = (...features: AirportDoc['features']): AirportDoc => ({
  ...emptyDoc(),
  meta: { ...emptyDoc().meta, magVar: 0 },
  features,
});

describe('headings', () => {
  it('measures true bearing clockwise from north with y pointing down', () => {
    expect(bearing({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(0);
    expect(bearing({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90);
    expect(bearing({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(180);
    expect(bearing({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(270);
  });

  it('applies east variation as magnetic = true - var', () => {
    expect(toMagnetic(100, 10)).toBeCloseTo(90);
    expect(toMagnetic(5, 10)).toBeCloseTo(355);
  });

  it('rounds to runway numbers with 36 instead of 0', () => {
    expect(headingNumber(84)).toBe(8);
    expect(headingNumber(85)).toBe(9);
    expect(headingNumber(2)).toBe(36);
    expect(headingNumber(356)).toBe(36);
    expect(headingNumber(174.9)).toBe(17);
  });
});

describe('runway designators', () => {
  it('numbers both ends of an east-west runway', () => {
    const r = newRunway({ x: -1000, y: 0 }, { x: 1000, y: 0 });
    const info = runwayInfos(docWith(r)).get(r.id)!;
    expect(info.names).toEqual(['9', '27']);
  });

  it('assigns L/R to parallel runways by lateral position', () => {
    const north = newRunway({ x: -1000, y: -500 }, { x: 1000, y: -500 });
    const south = newRunway({ x: 1000, y: 500 }, { x: -1000, y: 500 }); // drawn the other way
    const infos = runwayInfos(docWith(north, south));
    expect(infos.get(north.id)!.names).toEqual(['9L', '27R']);
    expect(infos.get(south.id)!.names).toEqual(['27L', '9R']);
  });

  it('assigns L/C/R to three parallels and honours manual overrides', () => {
    const rs = [-800, 0, 800].map((x) => newRunway({ x, y: 2000 }, { x, y: 0 }));
    const infos = runwayInfos(docWith(...rs));
    expect(rs.map((r) => infos.get(r.id)!.names[0])).toEqual(['36L', '36C', '36R']);

    const custom: Runway = { ...rs[1], ends: [{ ...defaultEnd(), designator: '1', suffix: '' }, defaultEnd()] };
    const info = runwayInfos(docWith(custom)).get(custom.id)!;
    expect(info.names).toEqual(['1', '18']);
  });
});

describe('bezier paths', () => {
  it('inserting a node keeps the curve shape', () => {
    const nodes = [
      { p: { x: 0, y: 0 }, out: { x: 100, y: 0 } },
      { p: { x: 200, y: 200 }, in: { x: 200, y: 100 } },
    ];
    const before = bezierPoint(pathSegments(nodes, false)[0], 0.75);
    const split = insertNode(nodes, false, 0, 0.5);
    expect(split).toHaveLength(3);
    const after = bezierPoint(pathSegments(split, false)[1], 0.5);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('finds the nearest point on a flattened path', () => {
    const poly = flatten([{ p: { x: 0, y: 0 } }, { p: { x: 100, y: 0 } }], false);
    const hit = nearestOnPolyline(poly, { x: 40, y: 30 })!;
    expect(hit.point.x).toBeCloseTo(40);
    expect(hit.dist).toBeCloseTo(30);
    expect(hit.t).toBeCloseTo(0.4);
  });
});

describe('hold short lines', () => {
  it('marks both sides of a taxiway crossing a runway, solid side away from it', () => {
    const r = newRunway({ x: -2000, y: 0 }, { x: 2000, y: 0 }, 150);
    const t = newTaxiway([{ p: { x: 0, y: -600 } }, { p: { x: 0, y: 600 } }], 'A');
    const doc = docWith(r, t);
    const holds = computeHoldLines(doc, runwayInfos(doc));
    expect(holds).toHaveLength(2);
    const ys = holds.map((h) => h.p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-250, 0);
    expect(ys[1]).toBeCloseTo(250, 0);
    const north = holds.find((h) => h.p.y < 0)!;
    expect(north.toward.y).toBeCloseTo(1);
    // Holding north of the runway facing south: runway 27's threshold (east) is on the left.
    expect(north.sign).toBe('27-9');
  });

  it('marks only the entry when a taxiway ends on the runway', () => {
    const r = newRunway({ x: -2000, y: 0 }, { x: 2000, y: 0 }, 75);
    const t = newTaxiway([{ p: { x: 0, y: -600 } }, { p: { x: 0, y: 0 } }], 'A');
    const doc = docWith(r, t);
    const holds = computeHoldLines(doc, runwayInfos(doc));
    expect(holds).toHaveLength(1);
    expect(holds[0].p.y).toBeCloseTo(-125, 0);
  });

  it('ignores a taxiway that never reaches the runway', () => {
    const r = newRunway({ x: -2000, y: 0 }, { x: 2000, y: 0 }, 150);
    const t = newTaxiway([{ p: { x: -1000, y: -200 } }, { p: { x: 1000, y: -200 } }], 'A');
    const doc = docWith(r, t);
    expect(computeHoldLines(doc, runwayInfos(doc))).toHaveLength(0);
  });
});

describe('sample and helpers', () => {
  it('builds the sample airport with the expected runway names', () => {
    const doc = sampleDoc();
    const names = [...runwayInfos(doc).values()].map((i) => i.names.join('/'));
    expect(names).toEqual(['8L/26R', '8R/26L', '3/21']);
  });

  it('skips I, O and X when naming taxiways', () => {
    const letters = 'ABCDEFGH'.split('').map((n) => newTaxiway([], n));
    expect(nextTaxiwayName(letters)).toBe('J');
  });

  it('formats coordinates and nice scales', () => {
    expect(formatDMS(33.4375, 'lat')).toBe('33°26\'15"N');
    expect(formatDMS(-112.5, 'lon')).toBe("112°30'W");
    expect(niceCeil(27.3)).toBe(28);
    expect(niceCeil(11.5)).toBe(12);
  });
});
