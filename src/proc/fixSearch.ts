/** Finding real fixes and navaids near an airport, for building procedures. */
import { procFixFromFaa, procFixFromNavaid } from '../model/procedure';
import type { ProcFix } from '../model/types';
import { allNavaids, fixesNear } from '../nav/data';
import { distanceNm, type LatLon } from '../nav/geo';

/** How far from the airport a procedure's fixes are looked for, NM. */
const NAVAID_RANGE = 250;
const FIX_RANGE = 180;

export interface FixOption {
  fix: ProcFix;
  distance: number;
}

/** Real navaids and US fixes near a point, nearest first. */
export async function nearbyFixes(near: LatLon): Promise<FixOption[]> {
  const [navaids, fixes] = await Promise.all([allNavaids().catch(() => []), fixesNear(near, FIX_RANGE).catch(() => [])]);
  const options: FixOption[] = [];
  for (const n of navaids) {
    const d = distanceNm(near, n);
    if (d <= NAVAID_RANGE) options.push({ fix: procFixFromNavaid(n), distance: d });
  }
  for (const f of fixes) {
    const d = distanceNm(near, f);
    if (d <= FIX_RANGE) options.push({ fix: procFixFromFaa(f), distance: d });
  }
  return options.sort((a, b) => a.distance - b.distance);
}

/** The real fix or navaid with this ident nearest the point, if any. */
export async function findFix(ident: string, near: LatLon): Promise<ProcFix | null> {
  const id = ident.trim().toUpperCase();
  return (await nearbyFixes(near)).find((o) => o.fix.ident === id)?.fix ?? null;
}
