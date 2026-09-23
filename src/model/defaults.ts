import type {
  AirportDoc,
  AirportMeta,
  Area,
  AreaType,
  Feature,
  Hotspot,
  Label,
  MapSymbol,
  PathNode,
  Runway,
  RunwayEnd,
  SymbolType,
  Taxiway,
  Vec,
} from './types';

let counter = 0;
export const uid = (): string =>
  `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const defaultEnd = (): RunwayEnd => ({
  designator: '',
  suffix: 'auto',
  displaced: 0,
  marking: 'nonprecision',
  stopway: 0,
});

export const newRunway = (a: Vec, b: Vec, width = 150): Runway => ({
  id: uid(),
  kind: 'runway',
  a,
  b,
  width,
  surface: 'asphalt',
  ends: [defaultEnd(), defaultEnd()],
  closed: false,
});

/** FAA taxiway designators skip I, O and X. */
const TAXIWAY_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWYZ'.split('');

export function nextTaxiwayName(features: Feature[]): string {
  const used = new Set(features.filter((f) => f.kind === 'taxiway').map((f) => (f as Taxiway).name));
  const free = TAXIWAY_LETTERS.find((l) => !used.has(l));
  if (free) return free;
  for (let n = 1; ; n++) {
    const name = `A${n}`;
    if (!used.has(name)) return name;
  }
}

export const newTaxiway = (nodes: PathNode[], name: string, width = 50): Taxiway => ({
  id: uid(),
  kind: 'taxiway',
  name,
  width,
  nodes,
  showLabel: true,
  labelT: 0.5,
  edgeLines: false,
  closed: false,
});

export const newArea = (nodes: PathNode[], areaType: AreaType, name = ''): Area => ({
  id: uid(),
  kind: 'area',
  areaType,
  name,
  nodes,
  showLabel: name !== '',
});

export const rectNodes = (a: Vec, b: Vec): PathNode[] => [
  { p: { x: a.x, y: a.y } },
  { p: { x: b.x, y: a.y } },
  { p: { x: b.x, y: b.y } },
  { p: { x: a.x, y: b.y } },
];

export const newLabel = (p: Vec, text = 'LABEL'): Label => ({
  id: uid(),
  kind: 'label',
  p,
  text,
  size: 6,
  rotation: 0,
  boxed: false,
});

export const SYMBOL_NAMES: Record<SymbolType, string> = {
  tower: 'Control tower',
  beacon: 'Rotating beacon',
  windcone: 'Wind cone',
  helipad: 'Helipad',
};

export const newSymbol = (p: Vec, symbol: SymbolType): MapSymbol => ({
  id: uid(),
  kind: 'symbol',
  symbol,
  p,
  label: symbol === 'helipad' ? 'H1' : '',
});

export function nextHotspotLabel(features: Feature[]): string {
  const used = new Set(features.filter((f) => f.kind === 'hotspot').map((f) => (f as Hotspot).label));
  for (let n = 1; ; n++) if (!used.has(`HS ${n}`)) return `HS ${n}`;
}

export const newHotspot = (center: Vec, radius: number, label: string): Hotspot => ({
  id: uid(),
  kind: 'hotspot',
  center,
  radius,
  label,
  labelOffset: { x: radius * 1.2, y: -radius * 1.2 },
});

export const defaultMeta = (): AirportMeta => ({
  name: 'NEW AIRPORT',
  ident: 'KXXX',
  city: 'ANYTOWN',
  state: 'ARIZONA',
  elevation: 1000,
  magVar: 10,
  chartCode: 'AL-0000 (FAA)',
  effective: '',
  frequencies: [
    { name: 'ATIS', value: '' },
    { name: 'TOWER', value: '' },
    { name: 'GND CON', value: '' },
  ],
  leadingZero: false,
  showHoldLinesOnChart: false,
  notes: '',
});

export const emptyDoc = (): AirportDoc => ({ version: 1, meta: defaultMeta(), features: [] });
