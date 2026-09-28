import { describe, expect, it } from 'vitest';
import { distanceNm, trueCourse, wrap360 } from '../../nav/geo';
import {
  fmtAlt,
  fmtHeading,
  fmtLimits,
  procedureText,
  procTitle,
  routeGeometry,
  runwayEnds,
  transitionCode,
} from '../procedure';
import { sampleDoc } from '../sample';
import type { AirportDoc, ProcFix, Procedure } from '../types';

const BLH: ProcFix = { ident: 'BLH', lat: 33.5968, lon: -114.7607, kind: 'vortac', name: 'BLYTHE', freq: '117.4', source: 'ourairports' };
const ZELMA: ProcFix = { ident: 'ZELMA', lat: 33.42, lon: -112.6, kind: 'waypoint', source: 'custom' };

const withFixes = (): AirportDoc => ({ ...sampleDoc(), fixes: [BLH, ZELMA] });

const sid: Procedure = {
  id: 's',
  type: 'SID',
  name: 'Cactus One',
  code: 'CACTS1',
  rnav: false,
  routes: [
    { id: 'r', kind: 'runway', name: '26L', legs: [{ type: 'heading', heading: 262, untilAlt: 3000 }, { type: 'fix', fix: 'ZELMA', alt: { atOrAbove: 5000 } }] },
    { id: 't', kind: 'transition', name: 'Blythe', legs: [{ type: 'fix', fix: 'ZELMA' }, { type: 'fix', fix: 'BLH', alt: { atOrAbove: 9000, atOrBelow: 9000 }, speed: 250 }] },
  ],
  maintain: '7000',
  expect: 'FL230 10 minutes after departure',
  notes: '',
};

describe('SID and STAR routes', () => {
  it('knows where each runway end is once the airport is placed', () => {
    const ends = runwayEnds(sampleDoc());
    expect([...ends.keys()].sort()).toEqual(['21', '26L', '26R', '3', '8L', '8R']);
    // Departing 26L rolls toward the 8R threshold, a runway length away.
    const e = ends.get('26L')!;
    // Within 0.2%: the drawing's flat local projection against great-circle distance.
    expect(Math.abs(distanceNm(e.threshold, e.departureEnd) * 6076.12 - 7500)).toBeLessThan(15);
  });

  it('flies a SID from the runway: heading, then direct, then on track', () => {
    const doc = withFixes();
    const g = routeGeometry(sid, sid.routes[0], doc);
    expect(g.segments.map((s) => s.kind)).toEqual(['heading', 'direct']);
    expect(g.segments[0].course).toBe(262);
    expect(g.points.at(-1)?.fix?.ident).toBe('ZELMA');

    const t = routeGeometry(sid, sid.routes[1], doc);
    const course = wrap360(trueCourse(ZELMA, BLH) - doc.meta.magVar);
    expect(t.segments).toHaveLength(1);
    expect(t.segments[0].kind).toBe('track');
    expect(t.segments[0].course).toBeCloseTo(course, 6);
    expect(t.segments[0].distance).toBeCloseTo(distanceNm(ZELMA, BLH), 6);
  });

  it('writes the procedure the way the chart says it', () => {
    const doc = withFixes();
    const text = procedureText(sid, doc);
    expect(text[0]).toBe('TAKEOFF RUNWAY 26L: Climb heading 262° to 3000, then direct ZELMA, cross ZELMA at or above 5000.');
    expect(text[1]).toBe('Maintain 7000. Expect FL230 10 minutes after departure.');
    const course = fmtHeading(wrap360(trueCourse(ZELMA, BLH) - doc.meta.magVar));
    expect(text[2]).toBe(`BLYTHE TRANSITION (CACTS1.BLH): From ZELMA, then on track ${course} to BLH VORTAC, cross BLH at 9000 and at 250K.`);
    expect(procTitle(sid)).toBe('CACTUS ONE DEPARTURE');
  });

  it('runs a STAR landing route on to its runway', () => {
    const doc = withFixes();
    const star: Procedure = {
      ...sid,
      type: 'STAR',
      routes: [
        { id: 't', kind: 'transition', name: 'Blythe', legs: [{ type: 'fix', fix: 'BLH' }, { type: 'fix', fix: 'ZELMA' }] },
        { id: 'r', kind: 'runway', name: '8R', legs: [{ type: 'fix', fix: 'ZELMA' }, { type: 'heading', heading: 80 }] },
      ],
    };
    const landing = routeGeometry(star, star.routes[1], doc);
    expect(landing.segments.map((s) => s.kind)).toEqual(['vectors']);
    expect(transitionCode(star, star.routes[0])).toBe('BLH.CACTS1');
    expect(procedureText(star, doc)[1]).toBe('LANDING RUNWAY 8R: From ZELMA, then fly heading 080° for radar vectors.');
    const direct = routeGeometry({ ...star, routes: [{ ...star.routes[1], legs: [{ type: 'fix', fix: 'ZELMA' }] }] }, { ...star.routes[1], legs: [{ type: 'fix', fix: 'ZELMA' }] }, doc);
    expect(direct.segments[0].kind).toBe('direct');
    expect(direct.segments[0].to).toEqual({ lat: runwayEnds(doc).get('8R')!.threshold.lat, lon: runwayEnds(doc).get('8R')!.threshold.lon });
  });

  it('charts altitudes and limits', () => {
    expect(fmtAlt(5000)).toBe('5000');
    expect(fmtAlt(23000)).toBe('FL230');
    expect(fmtLimits({ atOrAbove: 5000 })).toBe('at or above 5000');
    expect(fmtLimits({ atOrBelow: 11000 })).toBe('at or below 11000');
    expect(fmtLimits({ atOrAbove: 9000, atOrBelow: 12000 })).toBe('between 9000 and 12000');
    expect(fmtHeading(0)).toBe('360°');
    expect(fmtHeading(5)).toBe('005°');
  });
});
