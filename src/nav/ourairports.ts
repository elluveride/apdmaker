/**
 * OurAirports' runway and frequency files, fetched straight from its site
 * (which allows it) the first time an airport is started from real data.
 */
import { csvRecords } from '../../scripts/navdata-lib.mjs';
import { docFromRealAirport, nearbyVariation, type RealAirportImport } from '../model/realAirport';
import { allNavaids, type RealAirport } from './data';

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

/** An airport document for a real airport: its runways where they are, its frequencies and a nearby variation. */
export async function importRealAirport(airport: RealAirport): Promise<RealAirportImport> {
  const [runways, frequencies, navaids] = await Promise.all([
    byAirport('runways.csv'),
    byAirport('airport-frequencies.csv'),
    allNavaids().catch(() => []),
  ]);
  return docFromRealAirport(
    airport,
    runways.get(airport.ident) ?? [],
    frequencies.get(airport.ident) ?? [],
    nearbyVariation(airport, navaids),
  );
}
