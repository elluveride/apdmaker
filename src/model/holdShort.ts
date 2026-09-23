import { dist, dot, flatten, leftOf, lerp, mul, norm, sub, add } from './geometry';
import { holdDistance, runwayLength, toRunwayFrame, type RunwayInfo } from './runway';
import type { AirportDoc, ID, Runway, Taxiway, Vec } from './types';

export interface HoldLine {
  runwayId: ID;
  taxiwayId: ID;
  /** Center of the marking, on the taxiway centerline. */
  p: Vec;
  /** Unit vector along the taxiway, pointing toward the runway. */
  toward: Vec;
  taxiwayWidth: number;
  /** Holding position sign inscription: left runway end first, e.g. "8-26". */
  sign: string;
}

interface Sample {
  p: Vec;
  u: number;
  absV: number;
}

function densify(pts: Vec[], step: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push(lerp(a, b, k / n));
  }
  if (pts.length > 0) out.push(pts[pts.length - 1]);
  return out;
}

function signFor(r: Runway, info: RunwayInfo, p: Vec, toward: Vec): string {
  const left = leftOf(toward);
  const aIsLeft = dot(sub(r.a, p), left) >= dot(sub(r.b, p), left);
  return aIsLeft ? `${info.names[0]}-${info.names[1]}` : `${info.names[1]}-${info.names[0]}`;
}

/**
 * Where a taxiway enters a runway's holding area, drop a hold line.
 * A run of samples inside |v| < hold distance only counts if the taxiway
 * actually reaches the runway pavement during that run.
 */
export function holdLinesFor(r: Runway, info: RunwayInfo, t: Taxiway): HoldLine[] {
  if (t.nodes.length < 2 || r.closed) return [];
  const H = holdDistance(r);
  const L = runwayLength(r);
  const margin = r.width / 2 + t.width / 2;
  const samples: Sample[] = densify(flatten(t.nodes, t.closed, 20).pts, 8).map((p) => {
    const { u, v } = toRunwayFrame(r, p);
    return { p, u, absV: Math.abs(v) };
  });
  const inZone = (s: Sample) => s.absV < H && s.u > -margin && s.u < L + margin;

  const lines: HoldLine[] = [];
  const add_ = (a: Sample, b: Sample, entering: boolean) => {
    // Only side entries (crossing |v| = H) get markings, not runs past the runway ends.
    if ((a.absV - H) * (b.absV - H) > 0) return;
    const k = (a.absV - H) / (a.absV - b.absV);
    const p = lerp(a.p, b.p, Number.isFinite(k) ? k : 0);
    const along = norm(sub(b.p, a.p));
    const toward = entering ? along : mul(along, -1);
    lines.push({
      runwayId: r.id,
      taxiwayId: t.id,
      p,
      toward,
      taxiwayWidth: t.width,
      sign: signFor(r, info, p, toward),
    });
  };

  let i = 0;
  while (i < samples.length) {
    if (!inZone(samples[i])) {
      i++;
      continue;
    }
    const start = i;
    let minV = Infinity;
    while (i < samples.length && inZone(samples[i])) {
      minV = Math.min(minV, samples[i].absV);
      i++;
    }
    const end = i - 1;
    if (minV > r.width / 2) continue;
    if (start > 0) add_(samples[start - 1], samples[start], true);
    if (end < samples.length - 1) add_(samples[end], samples[end + 1], false);
  }
  return lines;
}

export function computeHoldLines(doc: AirportDoc, infos: Map<ID, RunwayInfo>): HoldLine[] {
  const runways = doc.features.filter((f): f is Runway => f.kind === 'runway' && !f.hidden);
  const taxiways = doc.features.filter((f): f is Taxiway => f.kind === 'taxiway' && !f.hidden);
  const out: HoldLine[] = [];
  for (const t of taxiways) {
    for (const r of runways) {
      const info = infos.get(r.id);
      if (info) out.push(...holdLinesFor(r, info, t));
    }
  }
  return out;
}

/** The four painted lines of a holding position marking, solid pair on the holding side. */
export function holdLineStripes(h: HoldLine): { a: Vec; b: Vec; dashed: boolean }[] {
  const across = leftOf(h.toward);
  const half = h.taxiwayWidth / 2;
  const offsets = [-3, -1, 1, 3]; // ft along the taxiway; negative = holding side
  return offsets.map((o, i) => {
    const c = add(h.p, mul(h.toward, o));
    return { a: add(c, mul(across, half)), b: sub(c, mul(across, half)), dashed: i >= 2 };
  });
}
