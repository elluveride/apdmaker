import { describe, expect, it } from 'vitest';
import type { RealAirport } from '../../nav/data';
import { distanceNm } from '../../nav/geo';
import { chartName, docFromRealAirport, frequenciesFrom, nearbyVariation, stateName, surfaceOf } from '../realAirport';
import { runwayInfos, runwayLength } from '../runway';
import type { Runway } from '../types';

const PHX: RealAirport = {
  ident: 'KPHX', type: 'large', name: 'Phoenix Sky Harbor International Airport', lat: 33.43434, lon: -112.01157,
  elevation: 1135, country: 'US', city: 'Phoenix', iata: 'PHX', region: 'US-AZ',
};

const runway = (over: Record<string, string>) => ({
  length_ft: '11489', width_ft: '150', surface: 'CON', closed: '0',
  le_ident: '08', le_latitude_deg: '33.4145', le_longitude_deg: '-112.0333', le_elevation_ft: '1126', le_heading_degT: '89.8', le_displaced_threshold_ft: '1000',
  he_ident: '26', he_latitude_deg: '33.4146', he_longitude_deg: '-111.9960', he_elevation_ft: '1113', he_heading_degT: '269.8', he_displaced_threshold_ft: '',
  ...over,
});

describe('starting from a real airport', () => {
  it('places each runway between its real ends, with its charted numbers', () => {
    const rows = [
      runway({ le_ident: '07L', he_ident: '25R', le_latitude_deg: '33.4436', he_latitude_deg: '33.4438' }),
      runway({ le_ident: '08', he_ident: '26' }),
      runway({ le_ident: 'H1', he_ident: '', surface: 'ASP' }),
      runway({ le_ident: '17', he_ident: '35', le_latitude_deg: '' }),
    ];
    const { doc, placed, skipped } = docFromRealAirport(PHX, rows, [], 11.5);
    expect(placed).toBe(2);
    expect(skipped).toBe(1);
    const [r1, r2] = doc.features as Runway[];
    const ft = distanceNm({ lat: 33.4145, lon: -112.0333 }, { lat: 33.4146, lon: -111.996 }) * 6076.12;
    expect(Math.abs(runwayLength(r2) - ft) / ft).toBeLessThan(0.002);
    expect(r2.surface).toBe('concrete');
    expect(r2.ends[0]).toMatchObject({ designator: '8', suffix: '', displaced: 1000, elevation: 1126 });
    expect(r2.ends[1]).toMatchObject({ designator: '26', displaced: 0 });
    expect(runwayInfos(doc).get(r1.id)?.names).toEqual(['7L', '25R']);
    // North of the airport's reference point means up the page.
    expect(r1.a.y).toBeLessThan(0);
    expect(doc.meta).toMatchObject({ name: 'PHOENIX SKY HARBOR INTL', ident: 'KPHX', city: 'PHOENIX', state: 'ARIZONA', elevation: 1135, magVar: 11.5, refLat: 33.43434, refLon: -112.01157 });
  });

  it('lists frequencies the way the chart does', () => {
    expect(
      frequenciesFrom([
        { type: 'TWR', frequency_mhz: '118.7' },
        { type: 'ATIS', frequency_mhz: '127.575' },
        { type: 'TWR', frequency_mhz: '120.9' },
        { type: 'GND', frequency_mhz: '119.75' },
        { type: 'CD', frequency_mhz: '118.1' },
        { type: 'UNIC', frequency_mhz: '122.95' },
        { type: 'MISC', frequency_mhz: '130' },
        { type: 'DEP', frequency_mhz: '119' },
      ]),
    ).toEqual([
      { name: 'ATIS', value: '127.575' },
      { name: 'CLNC DEL', value: '118.1' },
      { name: 'GND CON', value: '119.75' },
      { name: 'TOWER', value: '118.7 120.9' },
      { name: 'UNICOM', value: '122.95' },
      { name: 'DEP CON', value: '119.0' },
    ]);
  });

  it('shortens names, finds states, surfaces and a nearby variation', () => {
    expect(chartName('Falcon Field Airport')).toBe('FALCON FLD');
    expect(chartName('Luke Air Force Base')).toBe('LUKE AFB');
    expect(stateName('US-AZ')).toBe('ARIZONA');
    expect(stateName('GB-ENG')).toBe('');
    expect([surfaceOf('ASPH-G'), surfaceOf('CONC'), surfaceOf('TURF-F'), surfaceOf('GRVL')]).toEqual(['asphalt', 'concrete', 'turf', 'gravel']);
    const navaids = [
      { lat: 33.43, lon: -112.0, magVar: 11.8 },
      { lat: 35, lon: -112, magVar: 12.4 },
      { lat: 33.44, lon: -112.01, magVar: null },
    ];
    expect(nearbyVariation(PHX, navaids)).toBe(11.8);
    expect(nearbyVariation({ lat: 0, lon: 0 }, navaids)).toBeNull();
  });
});
