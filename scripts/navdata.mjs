#!/usr/bin/env node
/**
 * Builds the real-world data the map and the SID/STAR builder use, into
 * public/navdata (served next to the app):
 *
 *   meta.json            sources, cycles and when this was built
 *   airports.json        large and medium airports, worldwide (OurAirports)
 *   airports/<tile>.json small airports, heliports and seaplane bases, by 10-degree tile
 *   navaids.json         VOR, VORTAC, VOR-DME, TACAN, DME and NDB, worldwide (OurAirports)
 *   fixes/<tile>.json    US fixes and waypoints (FAA NASR), by 5-degree tile
 *   diagrams.json        FAA airport diagram PDFs by airport (FAA d-TPP)
 *
 * OurAirports data is public domain, and FAA data is a US government work.
 * The FAA files change every 28 days, so the deploy workflow reruns this weekly.
 *
 *   node scripts/navdata.mjs [--cache <dir>]   reuse downloads kept in <dir>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { airacCycle, csvRecords, nasrFixUrl, packAirports, packDiagrams, packFixes, packNavaids } from './navdata-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'navdata');
const cacheArg = process.argv.indexOf('--cache');
const cache = cacheArg > 0 ? process.argv[cacheArg + 1] : join(root, 'node_modules', '.cache', 'navdata');
mkdirSync(cache, { recursive: true });

const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data';

/** Download `url` into the cache as `name` (curl follows the environment's proxy), unless it is already there. */
function fetchFile(url, name) {
  const file = join(cache, name);
  if (!existsSync(file)) {
    console.log(`  downloading ${url}`);
    execFileSync('curl', ['-sSfL', '--retry', '3', '-o', file, url]);
  }
  return file;
}

/** Try each candidate URL in turn, newest first, and return the first that downloads. */
function fetchFirst(candidates) {
  for (const { url, name, ...rest } of candidates) {
    try {
      return { file: fetchFile(url, name), url, ...rest };
    } catch {
      console.log(`  not available: ${url}`);
    }
  }
  throw new Error(`None of these could be downloaded:\n${candidates.map((c) => c.url).join('\n')}`);
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}

const now = new Date();
const current = airacCycle(now);
const previous = airacCycle(new Date(current.effective.getTime() - 86400000));

console.log('OurAirports airports and navaids');
const airports = packAirports(csvRecords(readFileSync(fetchFile(`${OURAIRPORTS}/airports.csv`, 'airports.csv'), 'utf8')));
const navaids = packNavaids(csvRecords(readFileSync(fetchFile(`${OURAIRPORTS}/navaids.csv`, 'navaids.csv'), 'utf8')));

console.log(`FAA NASR fixes, cycle ${current.ident}`);
const nasr = fetchFirst(
  [current, previous].map((c) => ({ url: nasrFixUrl(c.effective), name: `fix-${c.ident}.zip`, effective: c.effective })),
);
const fixCsv = execFileSync('unzip', ['-p', nasr.file, 'FIX_BASE.csv'], { maxBuffer: 1 << 28 }).toString('latin1');
const fixes = packFixes(csvRecords(fixCsv));

console.log(`FAA d-TPP airport diagrams, cycle ${current.ident}`);
const dtpp = fetchFirst(
  [current, previous].map((c) => ({ url: `https://aeronav.faa.gov/d-tpp/${c.ident}/xml_data/d-tpp_Metafile.xml`, name: `dtpp-${c.ident}.xml` })),
);
const diagrams = packDiagrams(readFileSync(dtpp.file, 'utf8'));

rmSync(out, { recursive: true, force: true });
writeJson(join(out, 'airports.json'), airports.major);
for (const [key, rows] of Object.entries(airports.tiles)) writeJson(join(out, 'airports', `${key}.json`), rows);
writeJson(join(out, 'navaids.json'), navaids);
for (const [key, rows] of Object.entries(fixes)) writeJson(join(out, 'fixes', `${key}.json`), rows);
writeJson(join(out, 'diagrams.json'), { ...diagrams, base: `https://aeronav.faa.gov/d-tpp/${diagrams.cycle}/` });
writeJson(join(out, 'meta.json'), {
  built: now.toISOString(),
  ourairports: OURAIRPORTS,
  nasr: { effective: nasr.effective.toISOString().slice(0, 10), url: nasr.url },
  dtpp: { cycle: diagrams.cycle, from: diagrams.from, to: diagrams.to },
  airportTiles: Object.keys(airports.tiles),
  fixTiles: Object.keys(fixes),
});

const fixCount = Object.values(fixes).reduce((n, rows) => n + rows.length, 0);
const minorCount = Object.values(airports.tiles).reduce((n, rows) => n + rows.length, 0);
console.log(
  `Wrote ${airports.major.length} large and medium airports, ${minorCount} others in ${Object.keys(airports.tiles).length} tiles, ` +
    `${navaids.length} navaids, ${fixCount} fixes in ${Object.keys(fixes).length} tiles, ` +
    `${Object.keys(diagrams.apd).length} diagram links (d-TPP ${diagrams.cycle}) to ${out}`,
);
