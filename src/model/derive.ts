import { flatten, type Box, type Polyline } from './geometry';
import { computeHoldLines, type HoldLine } from './holdShort';
import { runwayInfos, type RunwayInfo } from './runway';
import { geometryBounds, sheetLayout, type SheetLayout } from './sheet';
import type { AirportDoc, ID } from './types';

/** Everything computed from the document, cached per immutable doc. */
export interface Derived {
  infos: Map<ID, RunwayInfo>;
  holds: HoldLine[];
  polys: Map<ID, Polyline>;
  bounds: Box;
  sheet: SheetLayout;
  /** Feet per chart point. */
  ts: number;
}

const cache = new WeakMap<AirportDoc, Derived>();

export function derive(doc: AirportDoc): Derived {
  const hit = cache.get(doc);
  if (hit) return hit;
  const infos = runwayInfos(doc);
  const polys = new Map<ID, Polyline>();
  for (const f of doc.features) {
    if (f.kind === 'taxiway') polys.set(f.id, flatten(f.nodes, f.closed));
    if (f.kind === 'area') polys.set(f.id, flatten(f.nodes, true));
  }
  const bounds = geometryBounds(doc);
  const sheet = sheetLayout(doc, bounds);
  const d: Derived = {
    infos,
    holds: computeHoldLines(doc, infos),
    polys,
    bounds,
    sheet,
    ts: sheet.textScale,
  };
  cache.set(doc, d);
  return d;
}
