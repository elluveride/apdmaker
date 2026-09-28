/**
 * Real-world data built by scripts/navdata.mjs and served next to the app in
 * navdata/: airports and navaids worldwide (OurAirports), US fixes (FAA NASR)
 * and FAA airport diagram links (d-TPP). Files load on first use and stay cached.
 */
import type { LatLon } from './geo';

export type AirportType = 'large' | 'medium' | 'small' | 'heliport' | 'seaplane';

export interface RealAirport extends LatLon {
  ident: string;
  type: AirportType;
  name: string;
  elevation: number | null;
  country: string;
  city: string;
  iata: string;
  /** ISO region, e.g. "US-AZ". */
  region: string;
}

export type NavaidType = 'VOR' | 'VOR-DME' | 'VORTAC' | 'TACAN' | 'DME' | 'NDB' | 'NDB-DME';

export interface Navaid extends LatLon {
  ident: string;
  type: NavaidType;
  name: string;
  freqKhz: number | null;
  /** Magnetic variation at the station, degrees east. */
  magVar: number | null;
  country: string;
}

export interface Fix extends LatLon {
  ident: string;
  state: string;
  /** NASR use code: WP waypoint, RP reporting point, CN computer navigation fix, and others. */
  use: string;
}

export interface NavMeta {
  built: string;
  nasr: { effective: string };
  dtpp: { cycle: string; from: string; to: string };
  airportTiles: string[];
  fixTiles: string[];
}

export interface Diagrams {
  cycle: string;
  base: string;
  apd: Record<string, string>;
}

type Row = (string | number | null)[];

const TYPES: Record<string, AirportType> = { L: 'large', M: 'medium', S: 'small', H: 'heliport', W: 'seaplane' };

export const airportFromRow = (r: Row): RealAirport => ({
  ident: r[0] as string,
  type: TYPES[r[1] as string],
  name: r[2] as string,
  lat: r[3] as number,
  lon: r[4] as number,
  elevation: r[5] as number | null,
  country: r[6] as string,
  city: r[7] as string,
  iata: r[8] as string,
  region: (r[9] as string) ?? '',
});

export const navaidFromRow = (r: Row): Navaid => ({
  ident: r[0] as string,
  type: r[1] as NavaidType,
  name: r[2] as string,
  lat: r[3] as number,
  lon: r[4] as number,
  freqKhz: r[5] as number | null,
  magVar: r[6] as number | null,
  country: r[7] as string,
});

export const fixFromRow = (r: Row): Fix => ({
  ident: r[0] as string,
  lat: r[1] as number,
  lon: r[2] as number,
  state: r[3] as string,
  use: r[4] as string,
});

/** A navaid's frequency as charted: MHz for VORs and TACAN-paired stations, kHz for NDBs. */
export function formatFrequency(n: Pick<Navaid, 'type' | 'freqKhz'>): string {
  if (n.freqKhz == null) return '';
  return n.type.startsWith('NDB') ? String(n.freqKhz) : (n.freqKhz / 1000).toFixed(n.freqKhz % 100 === 0 ? 1 : 2);
}

/** Tile keys (south-west corners, `size` degrees) covering a lat/lon box. */
export function tilesCovering(south: number, west: number, north: number, east: number, size: number): string[] {
  const keys: string[] = [];
  const lat0 = Math.floor(Math.max(-90, south) / size) * size;
  const lat1 = Math.floor(Math.min(89.999, north) / size) * size;
  const lon0 = Math.floor(west / size) * size;
  const lon1 = Math.floor((west + Math.min(359.999, east - west)) / size) * size;
  for (let lat = lat0; lat <= lat1; lat += size) {
    for (let lon = lon0; lon <= lon1; lon += size) {
      const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
      const key = `${lat}_${wrapped}`;
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

const cache = new Map<string, Promise<unknown>>();

function getJson<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(new URL(`navdata/${path}`, document.baseURI)).then((r) => {
      if (!r.ok) throw new Error(`Real-world data is not available here (${r.status}). Run npm run navdata, or use the published site.`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

export const navMeta = () => getJson<NavMeta>('meta.json');
export const loadDiagrams = () => getJson<Diagrams>('diagrams.json');

export async function majorAirports(): Promise<RealAirport[]> {
  return (await getJson<Row[]>('airports.json')).map(airportFromRow);
}

/** Small airports, heliports and seaplane bases in the 10-degree tiles that exist among `keys`. */
export async function minorAirports(keys: string[]): Promise<RealAirport[]> {
  const known = new Set((await navMeta()).airportTiles);
  const tiles = await Promise.all(keys.filter((k) => known.has(k)).map((k) => getJson<Row[]>(`airports/${k}.json`)));
  return tiles.flat().map(airportFromRow);
}

export async function allNavaids(): Promise<Navaid[]> {
  return (await getJson<Row[]>('navaids.json')).map(navaidFromRow);
}

/** US fixes in the 5-degree tiles that exist among `keys`. */
export async function fixesIn(keys: string[]): Promise<Fix[]> {
  const known = new Set((await navMeta()).fixTiles);
  const tiles = await Promise.all(keys.filter((k) => known.has(k)).map((k) => getJson<Row[]>(`fixes/${k}.json`)));
  return tiles.flat().map(fixFromRow);
}

/** Fixes within about `radiusNm` of a point. */
export function fixesNear(p: LatLon, radiusNm: number): Promise<Fix[]> {
  const dLat = radiusNm / 60;
  const dLon = dLat / Math.max(0.1, Math.cos((p.lat * Math.PI) / 180));
  return fixesIn(tilesCovering(p.lat - dLat, p.lon - dLon, p.lat + dLat, p.lon + dLon, 5));
}

/** The FAA airport diagram PDF for an airport, if the current d-TPP has one. */
export async function diagramUrl(...idents: string[]): Promise<string | null> {
  const d = await loadDiagrams();
  for (const id of idents) if (id && d.apd[id]) return d.base + d.apd[id];
  return null;
}
