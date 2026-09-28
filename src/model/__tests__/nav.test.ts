import { describe, expect, it } from 'vitest';
import { destination, distanceNm, formatLatLon, radialDme, trueCourse } from '../../nav/geo';
import { airportFromRow, formatFrequency, tilesCovering } from '../../nav/data';

describe('great-circle navigation', () => {
  it('measures distances and courses', () => {
    expect(distanceNm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(60.04, 2);
    expect(trueCourse({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(trueCourse({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(trueCourse({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 6);
  });

  it('goes somewhere and comes back', () => {
    const phx = { lat: 33.4343, lon: -112.0116 };
    const p = destination(phx, 245, 120);
    expect(distanceNm(phx, p)).toBeCloseTo(120, 6);
    expect(trueCourse(phx, p)).toBeCloseTo(245, 6);
  });

  it('turns a charted radial and DME into a position using the variation', () => {
    const vor = { lat: 0, lon: 0 };
    const p = radialDme(vor, 90, 30, 10);
    expect(trueCourse(vor, p)).toBeCloseTo(100, 6);
    expect(distanceNm(vor, p)).toBeCloseTo(30, 6);
  });

  it('writes charted coordinates', () => {
    expect(formatLatLon({ lat: 33.4375, lon: -112.0125 })).toBe("N33°26.25' W112°00.75'");
  });
});

describe('real-world data files', () => {
  it('decodes compact rows and charts frequencies', () => {
    expect(airportFromRow(['KPHX', 'L', 'Phoenix Sky Harbor', 33.4, -112, 1135, 'US', 'Phoenix', 'PHX'])).toMatchObject({ ident: 'KPHX', type: 'large', elevation: 1135 });
    expect(formatFrequency({ type: 'VORTAC', freqKhz: 115600 })).toBe('115.6');
    expect(formatFrequency({ type: 'VOR-DME', freqKhz: 112650 })).toBe('112.65');
    expect(formatFrequency({ type: 'NDB', freqKhz: 373 })).toBe('373');
  });

  it('lists the tiles a box covers, across the antimeridian too', () => {
    expect(tilesCovering(33, -113, 34, -111, 5)).toEqual(['30_-115']);
    expect(tilesCovering(31, -116, 36, -109, 5)).toEqual(['30_-120', '30_-115', '30_-110', '35_-120', '35_-115', '35_-110']);
    expect(tilesCovering(50, 178, 52, 182, 5)).toEqual(['50_175', '50_-180']);
  });
});
