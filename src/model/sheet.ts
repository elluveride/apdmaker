import { boundsOf, flatten, padBox, type Box } from './geometry';
import { runwayCorners } from './runway';
import type { AirportDoc, Vec } from './types';

/** TPP airport diagram page, 5.375 x 8.25 in, in points. */
export const PAGE_SHORT = 387;
export const PAGE_LONG = 594;

export const MARGIN = 14;
export const HEADER = 40;
export const FOOTER = 34;

/** Inset of the drawing from the frame, leaving room for the frequency box, compass and scale. */
const INSET = { top: 64, right: 22, bottom: 40, left: 22 };

export interface SheetLayout {
  width: number;
  height: number;
  landscape: boolean;
  frame: Box;
  /** page = world * scale + offset */
  scale: number;
  offset: Vec;
  /** Feet per chart point; chart text and line weights are sized with this. */
  textScale: number;
}

const DEFAULT_BOUNDS: Box = { minX: -2500, minY: -1500, maxX: 2500, maxY: 1500 };

/** Extent of everything that isn't text, so labels can't feed back into the fit. */
export function geometryBounds(doc: AirportDoc): Box {
  const pts: Vec[] = [];
  for (const f of doc.features) {
    if (f.hidden) continue;
    switch (f.kind) {
      case 'runway':
        pts.push(...runwayCorners(f, f.ends[0].stopway, f.ends[1].stopway));
        break;
      case 'taxiway':
      case 'area':
        pts.push(...flatten(f.nodes, f.kind === 'area', 100).pts);
        break;
      case 'symbol':
        pts.push(f.p);
        break;
      case 'hotspot':
        pts.push({ x: f.center.x - f.radius, y: f.center.y - f.radius });
        pts.push({ x: f.center.x + f.radius, y: f.center.y + f.radius });
        break;
      case 'label':
        break;
    }
  }
  const b = boundsOf(pts);
  if (!b) return DEFAULT_BOUNDS;
  // Keep a sensible minimum so a lone short runway doesn't fill the page.
  const minSpan = 3000;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const hw = Math.max(minSpan, b.maxX - b.minX) / 2;
  const hh = Math.max(minSpan * 0.6, b.maxY - b.minY) / 2;
  return padBox({ minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh }, 150);
}

const NICE_STEPS = [1, 1.1, 1.2, 1.25, 1.4, 1.5, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9];

/** Round up to a short list of steps x 10^n so chart text doesn't jitter while editing. */
export function niceCeil(v: number): number {
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  const step = NICE_STEPS.find((s) => s * base >= v - 1e-9);
  return (step ?? 10) * base;
}

export function sheetLayout(doc: AirportDoc, bounds = geometryBounds(doc)): SheetLayout {
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const landscape = bw / bh > 1.2;
  const width = landscape ? PAGE_LONG : PAGE_SHORT;
  const height = landscape ? PAGE_SHORT : PAGE_LONG;
  const frame: Box = {
    minX: MARGIN,
    minY: MARGIN + HEADER,
    maxX: width - MARGIN,
    maxY: height - MARGIN - FOOTER,
  };
  const availW = frame.maxX - frame.minX - INSET.left - INSET.right;
  const availH = frame.maxY - frame.minY - INSET.top - INSET.bottom;
  const fit = Math.min(availW / bw, availH / bh);
  const textScale = doc.meta.textScale ?? niceCeil(1 / fit);
  const scale = 1 / textScale;
  const cx = frame.minX + INSET.left + availW / 2;
  const cy = frame.minY + INSET.top + availH / 2;
  const wcx = (bounds.minX + bounds.maxX) / 2;
  const wcy = (bounds.minY + bounds.maxY) / 2;
  return {
    width,
    height,
    landscape,
    frame,
    scale,
    offset: { x: cx - wcx * scale, y: cy - wcy * scale },
    textScale,
  };
}

/* ------------------------------------------------------------------ */
/* Geographic reference                                                */
/* ------------------------------------------------------------------ */

/** Feet per degree of latitude (1 nm = 6076.12 ft, 60 nm per degree). */
export const FT_PER_DEG_LAT = 364567;

export function worldToLatLon(p: Vec, refLat: number, refLon: number): { lat: number; lon: number } {
  const ftPerDegLon = FT_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180);
  return { lat: refLat - p.y / FT_PER_DEG_LAT, lon: refLon + p.x / ftPerDegLon };
}

export function latToWorldY(lat: number, refLat: number): number {
  return (refLat - lat) * FT_PER_DEG_LAT;
}

export function lonToWorldX(lon: number, refLat: number, refLon: number): number {
  return (lon - refLon) * FT_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180);
}

/** 33.4375, 'lat' -> 33°26'15"N */
export function formatDMS(value: number, axis: 'lat' | 'lon'): string {
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  let total = Math.round(Math.abs(value) * 3600);
  const d = Math.floor(total / 3600);
  total -= d * 3600;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const sec = s === 0 ? '' : `${String(s).padStart(2, '0')}"`;
  return `${d}°${String(m).padStart(2, '0')}'${sec}${hemi}`;
}
