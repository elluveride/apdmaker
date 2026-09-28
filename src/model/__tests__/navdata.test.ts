import { describe, expect, it } from 'vitest';
import {
  airacCycle,
  csvRecords,
  nasrFixUrl,
  packAirports,
  packDiagrams,
  packFixes,
  parseCsv,
  tileKey,
} from '../../../scripts/navdata-lib.mjs';

describe('navdata build helpers', () => {
  it('parses quoted CSV fields, doubled quotes and line breaks inside quotes', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', '3'],
    ]);
    expect(csvRecords('﻿id,name\n7,Cactus\n')).toEqual([{ id: '7', name: 'Cactus' }]);
  });

  it('names AIRAC cycles and the NASR fix file for them', () => {
    const c = airacCycle(new Date(Date.UTC(2026, 8, 28)));
    expect(c.ident).toBe('2609');
    expect(c.effective.toISOString().slice(0, 10)).toBe('2026-09-03');
    expect(airacCycle(new Date(Date.UTC(2025, 0, 23))).ident).toBe('2501');
    expect(airacCycle(new Date(Date.UTC(2026, 0, 21))).ident).toBe('2513');
    expect(nasrFixUrl(c.effective)).toBe('https://nfdc.faa.gov/webContent/28DaySub/extra/03_Sep_2026_FIX_CSV.zip');
  });

  it('files airports and fixes under the tile their south-west corner is in', () => {
    expect(tileKey(33.4, -112.0, 10)).toBe('30_-120');
    expect(tileKey(-0.1, 0.1, 5)).toBe('-5_0');
    const airports = packAirports([
      { ident: 'KPHX', type: 'large_airport', name: 'Phoenix Sky Harbor', latitude_deg: '33.43429', longitude_deg: '-112.01159', elevation_ft: '1135', iso_country: 'US', municipality: 'Phoenix', iata_code: 'PHX', iso_region: 'US-AZ' },
      { ident: 'AZ01', type: 'small_airport', name: 'Ranch', latitude_deg: '34.1', longitude_deg: '-111.2', elevation_ft: '', iso_country: 'US', municipality: '', iata_code: '' },
      { ident: 'OLD', type: 'closed', name: 'Gone', latitude_deg: '1', longitude_deg: '1', elevation_ft: '', iso_country: 'US', municipality: '', iata_code: '' },
    ]);
    expect(airports.major).toEqual([['KPHX', 'L', 'Phoenix Sky Harbor', 33.43429, -112.01159, 1135, 'US', 'Phoenix', 'PHX', 'US-AZ']]);
    expect(Object.keys(airports.tiles)).toEqual(['30_-120']);
    const fixes = packFixes([{ FIX_ID: 'BLH  ', LAT_DECIMAL: '33.6', LONG_DECIMAL: '-114.7', STATE_CODE: 'CA', FIX_USE_CODE: 'WP ' }]);
    expect(fixes).toEqual({ '30_-115': [['BLH', 33.6, -114.7, 'CA', 'WP']] });
  });

  it('finds each airport diagram in the d-TPP metafile under both identifiers', () => {
    const xml = `<digital_tpp cycle="2609" from_edate="0901Z  09/03/26" to_edate="0901Z  10/01/26">
      <airport_name ID="PHOENIX SKY HARBOR INTL" military="N" apt_ident="PHX" icao_ident="KPHX" alnum="1">
        <record><chart_code>MIN</chart_code><pdf_name>SW4TO.PDF</pdf_name></record>
        <record><chart_code>APD</chart_code><pdf_name>00322AD.PDF</pdf_name></record>
      </airport_name>
      <airport_name ID="NO DIAGRAM" military="N" apt_ident="XYZ" icao_ident="" alnum="2">
        <record><chart_code>IAP</chart_code><pdf_name>1.PDF</pdf_name></record>
      </airport_name></digital_tpp>`;
    expect(packDiagrams(xml)).toEqual({ cycle: '2609', from: '0901Z  09/03/26', to: '0901Z  10/01/26', apd: { KPHX: '00322AD.PDF', PHX: '00322AD.PDF' } });
  });
});
