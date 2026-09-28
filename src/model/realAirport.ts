/**
 * Start an airport from real-world data: OurAirports' runways, with both
 * ends where they really are, and its frequencies.
 */
import type { RealAirport } from '../nav/data';
import { distanceNm, type LatLon } from '../nav/geo';
import { defaultEnd, emptyDoc, newRunway } from './defaults';
import { latToWorldY, lonToWorldX } from './sheet';
import type { AirportDoc, Frequency, Runway, RunwayEnd, Suffix, SurfaceType } from './types';

const US_STATES: Record<string, string> = {
  AL: 'ALABAMA', AK: 'ALASKA', AZ: 'ARIZONA', AR: 'ARKANSAS', CA: 'CALIFORNIA', CO: 'COLORADO', CT: 'CONNECTICUT',
  DE: 'DELAWARE', DC: 'DISTRICT OF COLUMBIA', FL: 'FLORIDA', GA: 'GEORGIA', HI: 'HAWAII', ID: 'IDAHO', IL: 'ILLINOIS',
  IN: 'INDIANA', IA: 'IOWA', KS: 'KANSAS', KY: 'KENTUCKY', LA: 'LOUISIANA', ME: 'MAINE', MD: 'MARYLAND',
  MA: 'MASSACHUSETTS', MI: 'MICHIGAN', MN: 'MINNESOTA', MS: 'MISSISSIPPI', MO: 'MISSOURI', MT: 'MONTANA',
  NE: 'NEBRASKA', NV: 'NEVADA', NH: 'NEW HAMPSHIRE', NJ: 'NEW JERSEY', NM: 'NEW MEXICO', NY: 'NEW YORK',
  NC: 'NORTH CAROLINA', ND: 'NORTH DAKOTA', OH: 'OHIO', OK: 'OKLAHOMA', OR: 'OREGON', PA: 'PENNSYLVANIA',
  RI: 'RHODE ISLAND', SC: 'SOUTH CAROLINA', SD: 'SOUTH DAKOTA', TN: 'TENNESSEE', TX: 'TEXAS', UT: 'UTAH',
  VT: 'VERMONT', VA: 'VIRGINIA', WA: 'WASHINGTON', WV: 'WEST VIRGINIA', WI: 'WISCONSIN', WY: 'WYOMING',
  PR: 'PUERTO RICO', GU: 'GUAM', VI: 'VIRGIN ISLANDS', AS: 'AMERICAN SAMOA', MP: 'NORTHERN MARIANA ISLANDS',
};

/** Words FAA charts shorten in airport names. */
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bINTERNATIONAL\b/g, 'INTL'],
  [/\bREGIONAL\b/g, 'RGNL'],
  [/\bMUNICIPAL\b/g, 'MUNI'],
  [/\bMEMORIAL\b/g, 'MEML'],
  [/\bCOUNTY\b/g, 'CO'],
  [/\bFIELD\b/g, 'FLD'],
  [/\bAIR FORCE BASE\b/g, 'AFB'],
  [/\s*\bAIRPORT\b/g, ''],
];

export function chartName(name: string): string {
  let n = name.toUpperCase();
  for (const [re, short] of ABBREVIATIONS) n = n.replace(re, short);
  return n.replace(/\s+/g, ' ').trim();
}

export function stateName(region: string): string {
  const [country, sub] = region.split('-');
  return country === 'US' ? (US_STATES[sub] ?? '') : '';
}

export function surfaceOf(s: string): SurfaceType {
  if (/CON|PEM|PCC/i.test(s)) return 'concrete';
  if (/TURF|GRASS|GRS|GRE/i.test(s)) return 'turf';
  if (/GRV|GRAV|DIRT|SAND|CLAY|SOIL/i.test(s)) return 'gravel';
  return 'asphalt';
}

/** "08L" as a charted number and letter; anything that isn't a runway number is left to the heading. */
function endFrom(ident: string, displaced: string, elevation: string): RunwayEnd {
  const m = /^0*(\d{1,2})([LRC]?)$/.exec(ident.trim().toUpperCase());
  return {
    ...defaultEnd(),
    designator: m ? m[1] : '',
    suffix: m ? (m[2] as Suffix) : 'auto',
    displaced: Number(displaced) || 0,
    elevation: elevation === '' ? undefined : Number(elevation),
  };
}

/** Frequency types as charted, in the order the frequency box lists them. */
const FREQ_NAMES: [RegExp, string][] = [
  [/^ATIS/, 'ATIS'],
  [/^(ASOS|AWOS)/, 'ASOS/AWOS'],
  [/^(CD|CLD|CLNC|DEL)/, 'CLNC DEL'],
  [/^GND/, 'GND CON'],
  [/^TWR/, 'TOWER'],
  [/^CTAF/, 'CTAF'],
  [/^UNIC/, 'UNICOM'],
  [/^(APP|A\/D)/, 'APP CON'],
  [/^DEP/, 'DEP CON'],
];

export function frequenciesFrom(records: Record<string, string>[]): Frequency[] {
  const byName = new Map<string, string[]>();
  for (const r of records) {
    const name = FREQ_NAMES.find(([re]) => re.test(r.type.toUpperCase()))?.[1];
    const mhz = Number(r.frequency_mhz);
    if (!name || !mhz) continue;
    const value = Number.isInteger(mhz) ? mhz.toFixed(1) : String(mhz);
    const list = byName.get(name) ?? [];
    if (!list.includes(value)) list.push(value);
    byName.set(name, list);
  }
  return FREQ_NAMES.map(([, name]) => name)
    .filter((name) => byName.has(name))
    .map((name) => ({ name, value: byName.get(name)!.join(' ') }));
}

export interface RealAirportImport {
  doc: AirportDoc;
  /** Runways placed from both ends' coordinates, and ones the data could not place. */
  placed: number;
  skipped: number;
}

/**
 * An airport document from OurAirports records: the airport's own position as
 * the drawing's origin, each runway between its ends' real coordinates, and
 * its frequencies. `magVar` comes from a nearby navaid, when there is one.
 */
export function docFromRealAirport(
  airport: RealAirport,
  runways: Record<string, string>[],
  frequencies: Record<string, string>[],
  magVar: number | null,
): RealAirportImport {
  const base = emptyDoc();
  const at = (lat: number, lon: number) => ({ x: lonToWorldX(lon, airport.lat, airport.lon), y: latToWorldY(lat, airport.lat) });
  const features: Runway[] = [];
  let skipped = 0;
  for (const r of runways) {
    if (/^H/i.test(r.le_ident) || /WATER/i.test(r.surface)) continue;
    const ends = [r.le_latitude_deg, r.le_longitude_deg, r.he_latitude_deg, r.he_longitude_deg].map((v) => (v === '' ? NaN : Number(v)));
    if (ends.some((v) => !Number.isFinite(v))) {
      skipped++;
      continue;
    }
    const rwy = newRunway(at(ends[0], ends[1]), at(ends[2], ends[3]), Number(r.width_ft) || 100);
    rwy.surface = surfaceOf(r.surface);
    rwy.closed = r.closed === '1';
    rwy.ends = [
      endFrom(r.le_ident, r.le_displaced_threshold_ft, r.le_elevation_ft),
      endFrom(r.he_ident, r.he_displaced_threshold_ft, r.he_elevation_ft),
    ];
    features.push(rwy);
  }
  const doc: AirportDoc = {
    ...base,
    meta: {
      ...base.meta,
      name: chartName(airport.name),
      ident: airport.ident,
      city: airport.city.toUpperCase(),
      state: stateName(airport.region),
      elevation: airport.elevation ?? base.meta.elevation,
      magVar: magVar ?? base.meta.magVar,
      refLat: airport.lat,
      refLon: airport.lon,
      frequencies: frequenciesFrom(frequencies),
      notes: 'From OurAirports data (public domain). Check it against official sources before relying on it.',
    },
    features,
  };
  return { doc, placed: features.length, skipped };
}

/** The magnetic variation of the nearest navaid that reports one within `maxNm`. */
export function nearbyVariation(p: LatLon, navaids: { lat: number; lon: number; magVar: number | null }[], maxNm = 150): number | null {
  let best: { d: number; v: number } | null = null;
  for (const n of navaids) {
    if (n.magVar == null) continue;
    const d = distanceNm(p, n);
    if (d <= maxNm && (!best || d < best.d)) best = { d, v: n.magVar };
  }
  return best ? Math.round(best.v * 10) / 10 : null;
}
