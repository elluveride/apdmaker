import { add, dirFromBearing, mul, rightOf } from './geometry';
import {
  defaultEnd,
  newArea,
  newHotspot,
  newLabel,
  newRunway,
  newSymbol,
  newTaxiway,
  rectNodes,
} from './defaults';
import type { AirportDoc, PathNode, Vec } from './types';

const P = (x: number, y: number): PathNode => ({ p: { x, y } });

/** A fictional airport that exercises most features. Not a real field. */
export function sampleDoc(): AirportDoc {
  const north = newRunway({ x: -5000, y: -700 }, { x: 5000, y: -700 }, 150);
  north.ends = [
    { ...defaultEnd(), marking: 'precision', elevation: 1128, stopway: 300 },
    { ...defaultEnd(), marking: 'precision', elevation: 1112, displaced: 900 },
  ];
  north.surface = 'concrete';
  north.dimsSide = 'right';

  const south = newRunway({ x: -3750, y: 700 }, { x: 3750, y: 700 }, 150);
  south.ends = [
    { ...defaultEnd(), marking: 'nonprecision', elevation: 1125 },
    { ...defaultEnd(), marking: 'precision', elevation: 1117 },
  ];

  // Crosswind runway: true 040.5 = magnetic 030 with 10.5 E variation.
  const xwDir = dirFromBearing(40.5);
  const xwA: Vec = { x: -4200, y: 2600 };
  const xwB = add(xwA, mul(xwDir, 3800));
  const crosswind = newRunway(xwA, xwB, 75);
  crosswind.ends = [
    { ...defaultEnd(), marking: 'visual' },
    { ...defaultEnd(), marking: 'visual' },
  ];
  crosswind.dimsSide = 'right';

  const alpha = newTaxiway(
    [
      P(-5000, -700),
      { p: { x: -4750, y: -1100 }, in: { x: -5000, y: -1060 } },
      { p: { x: 4750, y: -1100 }, out: { x: 5000, y: -1060 } },
      P(5000, -700),
    ],
    'A',
    75,
  );
  alpha.labelT = 0.3;

  const a1 = newTaxiway([P(-2400, -1100), P(-2400, -700)], 'A1', 75);
  const a2 = newTaxiway(
    [
      { p: { x: -600, y: -700 }, out: { x: 0, y: -700 } },
      { p: { x: 700, y: -1100 }, in: { x: 250, y: -1100 } },
    ],
    'A2',
    75,
  );
  const a3 = newTaxiway([P(2600, -1100), P(2600, -700)], 'A3', 75);

  const bravo = newTaxiway(
    [{ p: xwB }, { p: { x: -1200, y: 0 }, in: { x: -1500, y: 0 } }, P(3600, 0)],
    'B',
    75,
  );
  bravo.labelT = 0.6;
  bravo.edgeLines = true;
  const charlie = newTaxiway([P(-3000, -700), P(-3000, 700)], 'C', 75);
  const delta = newTaxiway([P(3000, -1100), P(3000, 700)], 'D', 75);
  const b1 = newTaxiway(
    [
      { p: { x: -1200, y: 0 }, out: { x: -1500, y: 0 } },
      { p: { x: -1900, y: 700 }, in: { x: -1900, y: 300 } },
    ],
    'B1',
    75,
  );

  // Parallel taxiway to the crosswind runway, offset to its southeast.
  const off = mul(rightOf(xwDir), 400);
  const eStart = add(xwA, off);
  const eEnd = add(eStart, mul(xwDir, (eStart.y - 700) / -xwDir.y));
  const echo = newTaxiway(
    [
      { p: xwA },
      { p: eStart, in: add(xwA, mul(off, 0.8)), out: add(eStart, mul(xwDir, 250)), smooth: true },
      { p: eEnd },
    ],
    'E',
    50,
  );

  const apron = newArea(rectNodes({ x: -2700, y: -2000 }, { x: 2300, y: -1135 }), 'apron');
  const terminal = newArea(
    [
      P(-1900, -2000),
      P(-100, -2000),
      P(-100, -2350),
      { p: { x: -1000, y: -2500 }, in: { x: -400, y: -2500 }, out: { x: -1600, y: -2500 }, smooth: true },
      P(-1900, -2350),
    ],
    'building',
    'TERMINAL',
  );
  const hangar1 = newArea(rectNodes({ x: 800, y: -2300 }, { x: 1400, y: -2000 }), 'building');
  const hangar2 = newArea(rectNodes({ x: 1600, y: -2300 }, { x: 2200, y: -2000 }), 'building');

  const gaRamp = newArea(rectNodes({ x: 3200, y: -2000 }, { x: 4400, y: -1135 }), 'apron');

  const fbo = newLabel({ x: 3800, y: -1560 }, 'GENERAL\nAVIATION\nPARKING');
  fbo.size = 5;
  const hangars = newLabel({ x: 1500, y: -2450 }, 'HANGARS');
  hangars.size = 5;
  const note = newLabel({ x: 1800, y: 2500 }, 'SAMPLE AIRPORT\nNOT FOR NAVIGATION');
  note.size = 7;
  note.boxed = true;

  const tower = newSymbol({ x: 250, y: -2700 }, 'tower');
  tower.label = 'TWR';
  const beacon = newSymbol({ x: -2500, y: -2250 }, 'beacon');
  const windcone = newSymbol({ x: -2200, y: 250 }, 'windcone');
  const heli = newSymbol({ x: 3800, y: -2350 }, 'helipad');

  const hs1 = newHotspot({ x: -2560, y: 700 }, 380, 'HS 1');
  hs1.labelOffset = { x: 650, y: 650 };

  return {
    version: 1,
    meta: {
      name: 'CACTUS FLATS RGNL',
      ident: 'KXCF',
      city: 'CACTUS FLATS',
      state: 'ARIZONA',
      elevation: 1135,
      magVar: 10.5,
      chartCode: 'AL-9999 (FAA)',
      effective: 'SAMPLE — NOT FOR NAVIGATION',
      frequencies: [
        { name: 'ATIS', value: '127.25' },
        { name: 'CACTUS TOWER', value: '118.3 257.8' },
        { name: 'GND CON', value: '121.7' },
        { name: 'CLNC DEL', value: '124.35' },
      ],
      refLat: 33.4375,
      refLon: -112.0125,
      leadingZero: false,
      showHoldLinesOnChart: false,
      notes: 'READBACK OF ALL RUNWAY HOLDING INSTRUCTIONS IS REQUIRED.',
    },
    features: [
      apron,
      gaRamp,
      terminal,
      hangar1,
      hangar2,
      alpha,
      a1,
      a2,
      a3,
      bravo,
      b1,
      charlie,
      delta,
      echo,
      north,
      south,
      crosswind,
      fbo,
      hangars,
      note,
      tower,
      beacon,
      windcone,
      heli,
      hs1,
    ],
  };
}
