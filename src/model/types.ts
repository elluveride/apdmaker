/**
 * World coordinates are in feet. +x is east, +y is south (SVG convention),
 * so true north is straight up the screen.
 */
export interface Vec {
  x: number;
  y: number;
}

export type ID = string;

export type SurfaceType = 'asphalt' | 'concrete' | 'turf' | 'gravel';
export type MarkingType = 'visual' | 'nonprecision' | 'precision';
export type Suffix = '' | 'L' | 'C' | 'R';

export interface RunwayEnd {
  /** Manual designator number, e.g. "8". Empty = computed from magnetic heading. */
  designator: string;
  /** Parallel-runway letter. `auto` assigns L/C/R from geometry. */
  suffix: Suffix | 'auto';
  /** Displaced threshold distance in feet. */
  displaced: number;
  marking: MarkingType;
  /** Threshold elevation, ft MSL. Undefined = not charted. */
  elevation?: number;
  /** Blast pad / stopway length beyond the threshold, ft. */
  stopway: number;
}

export interface Runway {
  id: ID;
  kind: 'runway';
  /** Threshold of ends[0]. Aircraft landing on ends[0] travel a -> b. */
  a: Vec;
  /** Threshold of ends[1]. */
  b: Vec;
  width: number;
  surface: SurfaceType;
  ends: [RunwayEnd, RunwayEnd];
  closed: boolean;
  /** Runway holding position distance from centerline, ft. Undefined = auto. */
  holdDistance?: number;
  /** Which side of the runway carries the "LENGTH X WIDTH" label, relative to landing on ends[0]. */
  dimsSide?: 'left' | 'right' | 'none';
  hidden?: boolean;
}

/** A bezier anchor. Handles are absolute world positions. */
export interface PathNode {
  p: Vec;
  in?: Vec;
  out?: Vec;
  /** Smooth nodes keep their handles collinear while editing. */
  smooth?: boolean;
}

export interface Taxiway {
  id: ID;
  kind: 'taxiway';
  name: string;
  width: number;
  nodes: PathNode[];
  showLabel: boolean;
  /** Label position along the path, 0..1 of its length. */
  labelT: number;
  /** Double yellow edge lines in the surface view. */
  edgeLines: boolean;
  closed: boolean;
  hidden?: boolean;
}

export type AreaType = 'apron' | 'building' | 'unpaved';

export interface Area {
  id: ID;
  kind: 'area';
  areaType: AreaType;
  name: string;
  nodes: PathNode[];
  showLabel: boolean;
  hidden?: boolean;
}

export interface Label {
  id: ID;
  kind: 'label';
  p: Vec;
  text: string;
  /** Chart size in points. */
  size: number;
  /** Degrees clockwise. */
  rotation: number;
  boxed: boolean;
  hidden?: boolean;
}

export type SymbolType = 'tower' | 'beacon' | 'windcone' | 'helipad';

export interface MapSymbol {
  id: ID;
  kind: 'symbol';
  symbol: SymbolType;
  p: Vec;
  label: string;
  hidden?: boolean;
}

export interface Hotspot {
  id: ID;
  kind: 'hotspot';
  center: Vec;
  radius: number;
  label: string;
  /** Where the "HS 1" callout sits, relative to the center. */
  labelOffset: Vec;
  hidden?: boolean;
}

export type Feature = Runway | Taxiway | Area | Label | MapSymbol | Hotspot;
export type FeatureKind = Feature['kind'];

export interface Frequency {
  name: string;
  value: string;
}

export interface AirportMeta {
  name: string;
  ident: string;
  city: string;
  state: string;
  /** Field elevation, ft MSL. */
  elevation: number;
  /** Magnetic variation in degrees, east positive. */
  magVar: number;
  chartCode: string;
  effective: string;
  frequencies: Frequency[];
  /** Latitude/longitude of the world origin, for chart graticule ticks. */
  refLat?: number;
  refLon?: number;
  /** "09" instead of "9". US charts omit the leading zero. */
  leadingZero: boolean;
  /** Chart text scale in feet per point. Undefined = fit to sheet. */
  textScale?: number;
  showHoldLinesOnChart: boolean;
  notes: string;
}

export interface AirportDoc {
  version: 1;
  meta: AirportMeta;
  features: Feature[];
}
