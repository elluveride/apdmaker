import { closestOnSegment, dist, nearestOnPolyline } from '../model/geometry';
import type { Derived } from '../model/derive';
import type { AirportDoc, ID, Vec } from '../model/types';
import { runwayTitle } from '../model/runway';

export type SnapKind = 'endpoint' | 'node' | 'centerline' | 'path' | 'grid';

export interface SnapResult {
  p: Vec;
  kind: SnapKind | null;
  label?: string;
  featureId?: ID;
  nodeIndex?: number;
}

export interface SnapOptions {
  /** Snap radius in world units. */
  radius: number;
  enabled: boolean;
  exclude?: ID;
  /** Grid step in world units, or null for no grid snapping. */
  grid: number | null;
}

/** Nice grid step for the current zoom: roughly `targetPx` screen pixels apart. */
export function gridStep(pxPerFt: number, targetPx = 80): number {
  const raw = targetPx / pxPerFt;
  const exp = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * exp >= raw) return m * exp;
  return 10 * exp;
}

/**
 * Snap priority: anchor points first (runway ends, path nodes),
 * then lines (runway centerlines, taxiway centerlines, area edges), then the grid.
 */
export function snapPoint(p: Vec, doc: AirportDoc, derived: Derived, o: SnapOptions): SnapResult {
  if (!o.enabled) return { p, kind: null };

  let best: SnapResult | null = null;
  let bestD = o.radius;
  const consider = (q: Vec, r: Omit<SnapResult, 'p'>) => {
    const d = dist(p, q);
    if (d < bestD) {
      bestD = d;
      best = { ...r, p: q };
    }
  };

  for (const f of doc.features) {
    if (f.hidden || f.id === o.exclude) continue;
    if (f.kind === 'runway') {
      const title = runwayTitle(derived.infos.get(f.id));
      consider(f.a, { kind: 'endpoint', label: `${title} threshold`, featureId: f.id });
      consider(f.b, { kind: 'endpoint', label: `${title} threshold`, featureId: f.id });
    } else if (f.kind === 'taxiway' || f.kind === 'area') {
      const name = f.kind === 'taxiway' ? `Taxiway ${f.name}` : f.name || f.areaType;
      f.nodes.forEach((n, i) => consider(n.p, { kind: 'node', label: name, featureId: f.id, nodeIndex: i }));
    }
  }
  if (best) return best;

  for (const f of doc.features) {
    if (f.hidden || f.id === o.exclude) continue;
    if (f.kind === 'runway') {
      consider(closestOnSegment(p, f.a, f.b), {
        kind: 'centerline',
        label: `Runway ${runwayTitle(derived.infos.get(f.id))} centerline`,
        featureId: f.id,
      });
    } else if (f.kind === 'taxiway' || f.kind === 'area') {
      const poly = derived.polys.get(f.id);
      const hit = poly && nearestOnPolyline(poly, p);
      if (hit) {
        consider(hit.point, {
          kind: 'path',
          label: f.kind === 'taxiway' ? `Taxiway ${f.name} centerline` : `${f.name || f.areaType} edge`,
          featureId: f.id,
        });
      }
    }
  }
  if (best) return best;

  if (o.grid) {
    return {
      p: { x: Math.round(p.x / o.grid) * o.grid, y: Math.round(p.y / o.grid) * o.grid },
      kind: 'grid',
    };
  }
  return { p, kind: null };
}
