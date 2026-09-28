/**
 * Pure helpers for scripts/navdata.mjs: parsing the source files and packing
 * them into the compact JSON the app loads. No I/O here, so they can be tested.
 */

/** Parse CSV text into rows of strings. Handles quoted fields, "" escapes and line breaks inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV text as objects keyed by the header row. */
export function csvRecords(text) {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const DAY = 86400000;
/** AIRAC cycle 2601 took effect on 22 January 2026; every cycle lasts 28 days. */
const AIRAC_EPOCH = Date.UTC(2026, 0, 22);

/** The AIRAC cycle in effect on `date`: its effective date and its YYNN identifier. */
export function airacCycle(date) {
  const n = Math.floor((date.getTime() - AIRAC_EPOCH) / (28 * DAY));
  const effective = new Date(AIRAC_EPOCH + n * 28 * DAY);
  const year = effective.getUTCFullYear();
  // The year's first cycle is the first one on or after 1 January.
  const k = Math.ceil((Date.UTC(year, 0, 1) - AIRAC_EPOCH) / (28 * DAY));
  const number = n - k + 1;
  return { effective, ident: `${String(year % 100).padStart(2, '0')}${String(number).padStart(2, '0')}` };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The FAA NASR subscription's fix file for the cycle that took effect on `effective`. */
export function nasrFixUrl(effective) {
  const d = String(effective.getUTCDate()).padStart(2, '0');
  return `https://nfdc.faa.gov/webContent/28DaySub/extra/${d}_${MONTHS[effective.getUTCMonth()]}_${effective.getUTCFullYear()}_FIX_CSV.zip`;
}

/** Tile key for a position: the south-west corner of its `size`-degree square. */
export function tileKey(lat, lon, size) {
  return `${Math.floor(lat / size) * size}_${Math.floor(lon / size) * size}`;
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const num = (s) => (s === '' || s == null ? null : Number(s));

const AIRPORT_TYPES = {
  large_airport: 'L',
  medium_airport: 'M',
  small_airport: 'S',
  heliport: 'H',
  seaplane_base: 'W',
};

/**
 * OurAirports airports as compact rows [ident, type, name, lat, lon, elevation,
 * country, municipality, iata, region], split into the always-loaded large and medium
 * airports and 10-degree tiles of the rest. Closed fields and balloonports are left out.
 */
export function packAirports(records) {
  const major = [];
  const tiles = {};
  for (const r of records) {
    const type = AIRPORT_TYPES[r.type];
    const lat = num(r.latitude_deg);
    const lon = num(r.longitude_deg);
    if (!type || lat == null || lon == null) continue;
    const row = [r.ident, type, r.name, round(lat, 5), round(lon, 5), num(r.elevation_ft), r.iso_country, r.municipality, r.iata_code || '', r.iso_region || ''];
    if (type === 'L' || type === 'M') major.push(row);
    else (tiles[tileKey(lat, lon, 10)] ??= []).push(row);
  }
  return { major, tiles };
}

const NAVAID_TYPES = new Set(['VOR', 'VOR-DME', 'VORTAC', 'TACAN', 'DME', 'NDB', 'NDB-DME']);

/** OurAirports navaids as rows [ident, type, name, lat, lon, frequency kHz, magnetic variation (east +), country]. */
export function packNavaids(records) {
  const rows = [];
  for (const r of records) {
    const lat = num(r.latitude_deg);
    const lon = num(r.longitude_deg);
    if (!NAVAID_TYPES.has(r.type) || lat == null || lon == null) continue;
    const variation = num(r.magnetic_variation_deg) ?? num(r.slaved_variation_deg);
    rows.push([r.ident, r.type, r.name, round(lat, 5), round(lon, 5), num(r.frequency_khz), variation == null ? null : round(variation, 1), r.iso_country]);
  }
  return rows;
}

/** FAA NASR FIX_BASE records as 5-degree tiles of rows [ident, lat, lon, state, use]. */
export function packFixes(records) {
  const tiles = {};
  for (const r of records) {
    const lat = num(r.LAT_DECIMAL);
    const lon = num(r.LONG_DECIMAL);
    if (lat == null || lon == null || !r.FIX_ID) continue;
    (tiles[tileKey(lat, lon, 5)] ??= []).push([r.FIX_ID.trim(), round(lat, 5), round(lon, 5), r.STATE_CODE.trim(), r.FIX_USE_CODE.trim()]);
  }
  return tiles;
}

/**
 * Airport diagram PDFs from the d-TPP metafile, keyed by both the ICAO and the
 * FAA identifier, plus the cycle they belong to.
 */
export function packDiagrams(xml) {
  const head = /<digital_tpp[^>]*cycle="(\d+)"[^>]*from_edate="([^"]*)"[^>]*to_edate="([^"]*)"/.exec(xml);
  const apd = {};
  const airport = /<airport_name\b[^>]*apt_ident="([^"]*)"[^>]*icao_ident="([^"]*)"[^>]*>([\s\S]*?)<\/airport_name>/g;
  for (let m; (m = airport.exec(xml)); ) {
    const [, faa, icao, body] = m;
    const pdf = /<chart_code>APD<\/chart_code>[\s\S]*?<pdf_name>([^<]+)<\/pdf_name>/.exec(body)?.[1];
    if (!pdf) continue;
    if (icao) apd[icao] ??= pdf;
    if (faa) apd[faa] ??= pdf;
  }
  return { cycle: head?.[1] ?? '', from: head?.[2].trim() ?? '', to: head?.[3].trim() ?? '', apd };
}
