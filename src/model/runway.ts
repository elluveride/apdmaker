import { add, bearing, dist, dot, leftOf, mid, mul, norm, sub, wrap360 } from './geometry';
import type { AirportDoc, ID, Runway, Suffix, Vec } from './types';

export const runwayLength = (r: Runway): number => dist(r.a, r.b);

/** Unit vector of the landing direction for an end (end 0 lands a -> b). */
export const landingDir = (r: Runway, end: 0 | 1): Vec =>
  end === 0 ? norm(sub(r.b, r.a)) : norm(sub(r.a, r.b));

export const threshold = (r: Runway, end: 0 | 1): Vec => (end === 0 ? r.a : r.b);

export const trueHeading = (r: Runway, end: 0 | 1): number =>
  end === 0 ? bearing(r.a, r.b) : bearing(r.b, r.a);

/** Magnetic = true - east variation. */
export const toMagnetic = (trueDeg: number, magVar: number): number => wrap360(trueDeg - magVar);
export const toTrue = (magDeg: number, magVar: number): number => wrap360(magDeg + magVar);

/** Runway number from a magnetic heading: nearest ten degrees, 36 instead of 0. */
export function headingNumber(magDeg: number): number {
  const n = Math.round(wrap360(magDeg) / 10) % 36;
  return n === 0 ? 36 : n;
}

export const formatNumber = (n: number, leadingZero: boolean): string =>
  leadingZero && n < 10 ? `0${n}` : String(n);

export const formatBearing = (d: number): string => `${wrap360(d).toFixed(1).padStart(5, '0')}°`;

export function defaultHoldDistance(r: Runway): number {
  if (r.width <= 75) return 125;
  if (r.width <= 100) return 200;
  return 250;
}

export const holdDistance = (r: Runway): number => r.holdDistance ?? defaultHoldDistance(r);

export interface RunwayInfo {
  id: ID;
  numbers: [string, string];
  suffixes: [Suffix, Suffix];
  /** Full end designators, e.g. ["8L", "26R"]. */
  names: [string, string];
  trueHdg: [number, number];
  magHdg: [number, number];
  length: number;
}

export const runwayTitle = (info: RunwayInfo | undefined): string =>
  info ? `${info.names[0]}-${info.names[1]}` : 'Runway';

const mirrorSuffix = (s: Suffix): Suffix => (s === 'L' ? 'R' : s === 'R' ? 'L' : s);

function rankSuffixes(count: number): Suffix[] {
  if (count === 2) return ['L', 'R'];
  if (count === 3) return ['L', 'C', 'R'];
  return Array.from({ length: count }, (_, i) => (i === 0 ? 'L' : i === count - 1 ? 'R' : 'C'));
}

/**
 * Derive designators for every runway, including automatic L/C/R letters
 * for parallel runways that share the same numbers.
 */
export function runwayInfos(doc: AirportDoc): Map<ID, RunwayInfo> {
  const { magVar, leadingZero } = doc.meta;
  const runways = doc.features.filter((f): f is Runway => f.kind === 'runway');
  const infos = new Map<ID, RunwayInfo>();

  for (const r of runways) {
    const trueHdg: [number, number] = [trueHeading(r, 0), trueHeading(r, 1)];
    const magHdg: [number, number] = [toMagnetic(trueHdg[0], magVar), toMagnetic(trueHdg[1], magVar)];
    const numbers = [0, 1].map((e) => {
      const manual = r.ends[e].designator.trim();
      return manual !== '' ? manual : formatNumber(headingNumber(magHdg[e]), leadingZero);
    }) as [string, string];
    infos.set(r.id, {
      id: r.id,
      numbers,
      suffixes: ['', ''],
      names: numbers,
      trueHdg,
      magHdg,
      length: runwayLength(r),
    });
  }

  // Group runways that share the same pair of numbers.
  const groups = new Map<string, Runway[]>();
  for (const r of runways) {
    const info = infos.get(r.id)!;
    const key = info.numbers.slice().sort().join('/');
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  for (const group of groups.values()) {
    const first = infos.get(group[0].id)!;
    const refNumber = first.numbers.slice().sort()[0];
    const refEnd = (r: Runway): 0 | 1 => (infos.get(r.id)!.numbers[0] === refNumber ? 0 : 1);
    const refDir = landingDir(group[0], refEnd(group[0]));
    const left = leftOf(refDir);
    const ranked = group
      .slice()
      .sort((p, q) => dot(mid(q.a, q.b), left) - dot(mid(p.a, p.b), left));
    const auto = rankSuffixes(ranked.length);

    ranked.forEach((r, rank) => {
      const info = infos.get(r.id)!;
      const e = refEnd(r);
      const o = (1 - e) as 0 | 1;
      const computed: [Suffix, Suffix] = ['', ''];
      computed[e] = group.length > 1 ? auto[rank] : '';
      computed[o] = mirrorSuffix(computed[e]);
      const manual = r.ends.map((end) => end.suffix);
      const resolved: [Suffix, Suffix] = [computed[0], computed[1]];
      for (const i of [0, 1] as const) {
        const m = manual[i];
        const other = manual[1 - i];
        if (m !== 'auto') resolved[i] = m;
        else if (other !== 'auto') resolved[i] = mirrorSuffix(other);
      }
      info.suffixes = resolved;
      info.names = [info.numbers[0] + resolved[0], info.numbers[1] + resolved[1]];
    });
  }

  return infos;
}

/** The four corners of a runway rectangle, optionally extended past each end. */
export function runwayCorners(r: Runway, extendA = 0, extendB = 0, width = r.width): Vec[] {
  const d = norm(sub(r.b, r.a));
  const n = leftOf(d);
  const half = width / 2;
  const a = sub(r.a, mul(d, extendA));
  const b = add(r.b, mul(d, extendB));
  return [add(a, mul(n, half)), add(b, mul(n, half)), sub(b, mul(n, half)), sub(a, mul(n, half))];
}

/** Local runway coordinates: u along a -> b from `a`, v to the left of that. */
export function toRunwayFrame(r: Runway, p: Vec): { u: number; v: number } {
  const d = norm(sub(r.b, r.a));
  const rel = sub(p, r.a);
  return { u: dot(rel, d), v: dot(rel, leftOf(d)) };
}
