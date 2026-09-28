/** Great-circle navigation on a spherical earth: good to well under 0.5% at procedure distances. */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Earth radius in nautical miles. */
const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
export const wrap360 = (d: number) => ((d % 360) + 360) % 360;

export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true course from `a` to `b`, degrees. */
export function trueCourse(a: LatLon, b: LatLon): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return wrap360(deg(Math.atan2(y, x)));
}

/** The point `distNm` from `p` along true course `course`. */
export function destination(p: LatLon, course: number, distNm: number): LatLon {
  const d = distNm / R_NM;
  const c = rad(course);
  const lat1 = rad(p.lat);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(c));
  const lon2 = rad(p.lon) + Math.atan2(Math.sin(c) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

/** A fix defined by a radial (magnetic, as charted) and DME distance from a navaid. */
export function radialDme(navaid: LatLon, radialMag: number, distNm: number, magVar: number): LatLon {
  return destination(navaid, wrap360(radialMag + magVar), distNm);
}

/** Degrees as a charted coordinate, e.g. N33°26.25' W112°00.75'. */
export function formatLatLon({ lat, lon }: LatLon): string {
  const part = (v: number, pos: string, neg: string, width: number) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = (a - d) * 60;
    return `${v >= 0 ? pos : neg}${String(d).padStart(width, '0')}°${m.toFixed(2).padStart(5, '0')}'`;
  };
  return `${part(lat, 'N', 'S', 2)} ${part(lon, 'E', 'W', 3)}`;
}
