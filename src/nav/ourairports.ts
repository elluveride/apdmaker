/**
 * OurAirports' runway and frequency files, fetched straight from its site
 * (which allows it) the first time an airport is started from real data.
 */
import { csvRecords } from '../../scripts/navdata-lib.mjs';
import { IMPROVE_KINDS, withImprovement, type ImproveKind } from '../model/osmAirport';
import { docFromRealAirport, nearbyVariation, type RealAirportImport } from '../model/realAirport';
import { allNavaids, type RealAirport } from './data';
import { osmImprovement } from './osm';

const SOURCE = 'https://davidmegginson.github.io/ourairports-data';

type Grouped = Map<string, Record<string, string>[]>;
const files = new Map<string, Promise<Grouped>>();

function byAirport(name: string): Promise<Grouped> {
  let p = files.get(name);
  if (!p) {
    p = fetch(`${SOURCE}/${name}`)
      .then((r) => {
        if (!r.ok) throw new Error(`OurAirports' ${name} did not load (${r.status}).`);
        return r.text();
      })
      .then((text) => {
        const grouped: Grouped = new Map();
        for (const rec of csvRecords(text)) {
          const list = grouped.get(rec.airport_ident) ?? [];
          list.push(rec);
          grouped.set(rec.airport_ident, list);
        }
        return grouped;
      });
    p.catch(() => files.delete(name));
    files.set(name, p);
  }
  return p;
}

export interface FullImport extends RealAirportImport {
  /** What OpenStreetMap added, by kind, or why it couldn't. */
  osm: { added: Record<ImproveKind, number> } | { error: string };
}

/**
 * An airport document for a real airport: its runways where they are (from
 * OurAirports, or OpenStreetMap where OurAirports has no coordinates), its
 * taxiways, aprons, buildings and field symbols from OpenStreetMap, its
 * frequencies, and a nearby variation.
 */
export async function importRealAirport(airport: RealAirport): Promise<FullImport> {
  const [runways, frequencies, navaids] = await Promise.all([
    byAirport('runways.csv'),
    byAirport('airport-frequencies.csv'),
    allNavaids().catch(() => []),
  ]);
  const base = docFromRealAirport(airport, runways.get(airport.ident) ?? [], frequencies.get(airport.ident) ?? [], nearbyVariation(airport, navaids));
  try {
    const imp = await osmImprovement(base.doc, airport.iata);
    const added = Object.fromEntries(IMPROVE_KINDS.map((k) => [k, imp.add[k].length])) as Record<ImproveKind, number>;
    return { ...base, doc: withImprovement(base.doc, imp, IMPROVE_KINDS), osm: { added } };
  } catch (e) {
    return { ...base, osm: { error: e instanceof Error ? e.message : String(e) } };
  }
}
