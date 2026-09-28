/**
 * An airport's taxiways, aprons, buildings and runways from OpenStreetMap,
 * through the Overpass API. Browsers send the User-Agent and Referer that
 * Overpass asks clients for.
 */
import { improvement, osmFeatures, type Improvement, type OsmElement } from '../model/osmAirport';
import type { AirportDoc } from '../model/types';
import type { LatLon } from './geo';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

/** What an airport is made of, by OSM tag. */
const BODY = (scope: string, buildings: string) => `(
  way${scope}["aeroway"~"^(runway|taxiway|apron|terminal|hangar|helipad|control_tower)$"];
  relation${scope}["aeroway"="apron"];
  way${scope}${buildings};
  relation${scope}${buildings};
  node${scope}["aeroway"~"^(windsock|control_tower|helipad|beacon)$"];
  node${scope}["man_made"="tower"];
  node${scope}["airmark"="beacon"];
);
out geom qt;`;

/** Identifiers OSM may tag the airport with: ICAO, FAA (a US "K" code without its K) and IATA. */
export function identTags(ident: string, iata = ''): [string, string][] {
  const id = ident.trim().toUpperCase();
  const tags: [string, string][] = [];
  if (/^[A-Z0-9]{3,4}$/.test(id)) tags.push(['icao', id], ['faa', id]);
  if (/^K[A-Z0-9]{3}$/.test(id)) tags.push(['faa', id.slice(1)]);
  if (/^[A-Z]{3}$/.test(iata.trim().toUpperCase())) tags.push(['iata', iata.trim().toUpperCase()]);
  return tags;
}

/** Everything inside the airport's mapped boundary, found by its identifier. */
export function byIdentQuery(ident: string, iata = ''): string | null {
  const tags = identTags(ident, iata);
  if (!tags.length) return null;
  const find = tags.map(([k, v]) => `wr["aeroway"="aerodrome"]["${k}"="${v}"];`).join('\n  ');
  return `[out:json][timeout:60];
(
  ${find}
)->.ap;
.ap map_to_area->.a;
${BODY('(area.a)', '["building"]')}
.ap out tags center qt;`;
}

/** Everything within `radiusM` of a point, for an airport OSM has no boundary for. Only airport buildings, to leave the town out. */
export function aroundQuery(p: LatLon, radiusM: number): string {
  const r = Math.round(radiusM);
  return `[out:json][timeout:60];
${BODY(`(around:${r},${p.lat.toFixed(6)},${p.lon.toFixed(6)})`, '["building"~"^(hangar|terminal|control_tower|transportation|airport)$"]')}`;
}

const cache = new Map<string, Promise<OsmElement[]>>();

async function run(query: string): Promise<OsmElement[]> {
  let last = '';
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }) });
      if (res.ok) return ((await res.json()) as { elements: OsmElement[] }).elements;
      last = `${res.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`OpenStreetMap's Overpass service didn't answer (${last}). Try again in a minute.`);
}

function cached(query: string): Promise<OsmElement[]> {
  let p = cache.get(query);
  if (!p) {
    p = run(query);
    p.catch(() => cache.delete(query));
    cache.set(query, p);
  }
  return p;
}

export interface OsmAirport {
  elements: OsmElement[];
  /** Whether OSM knows the airport by its identifier (and so its boundary), or it was searched around a point. */
  foundBy: 'ident' | 'area';
}

/**
 * OSM's features for an airport: inside its boundary when OSM knows it by
 * `ident`, otherwise within `radiusM` of `near`.
 */
export async function loadOsmAirport(ident: string, near: LatLon, radiusM: number, iata = ''): Promise<OsmAirport> {
  const q = byIdentQuery(ident, iata);
  if (q) {
    const elements = await cached(q);
    const found = elements.some((e) => e.tags?.aeroway === 'aerodrome');
    if (found && elements.length > 1) return { elements: elements.filter((e) => e.tags?.aeroway !== 'aerodrome'), foundBy: 'ident' };
  }
  return { elements: await cached(aroundQuery(near, radiusM)), foundBy: 'area' };
}

/** How far out to look for an airport OSM has no boundary for: past everything drawn, within reason. */
export function searchRadiusM(doc: AirportDoc): number {
  const reach = Math.max(
    0,
    ...doc.features.flatMap((f) => (f.kind === 'runway' ? [f.a, f.b] : f.kind === 'taxiway' || f.kind === 'area' ? f.nodes.map((n) => n.p) : [])).map((p) => Math.hypot(p.x, p.y)),
  );
  return Math.min(6000, Math.max(2000, reach / 3.28084 + 800));
}

export interface OsmImprovement extends Improvement {
  foundBy: OsmAirport['foundBy'];
}

/** What OSM has for this airport that it lacks, lined up with what's drawn. The airport must be placed on the map. */
export async function osmImprovement(doc: AirportDoc, iata = ''): Promise<OsmImprovement> {
  const { refLat, refLon, ident, magVar } = doc.meta;
  if (refLat === undefined || refLon === undefined) throw new Error('Place the airport on the map first, so its real surroundings can be found.');
  const near = { lat: refLat, lon: refLon };
  const { elements, foundBy } = await loadOsmAirport(ident, near, searchRadiusM(doc), iata);
  return { ...improvement(doc, osmFeatures(elements, near, magVar)), foundBy };
}
