import type { Box } from '../model/geometry';
import type { Vec } from '../model/types';
import type { Camera } from '../store/store';

export interface Size {
  w: number;
  h: number;
}

export const MIN_SCALE = 0.004;
export const MAX_SCALE = 25;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export const screenToWorld = (c: Camera, size: Size, s: Vec): Vec => ({
  x: (s.x - size.w / 2) / c.scale + c.cx,
  y: (s.y - size.h / 2) / c.scale + c.cy,
});

export const worldToScreen = (c: Camera, size: Size, p: Vec): Vec => ({
  x: (p.x - c.cx) * c.scale + size.w / 2,
  y: (p.y - c.cy) * c.scale + size.h / 2,
});

export const cameraTransform = (c: Camera, size: Size): string =>
  `translate(${size.w / 2} ${size.h / 2}) scale(${c.scale}) translate(${-c.cx} ${-c.cy})`;

/** Zoom by `factor` keeping the world point under `screen` fixed. */
export function zoomAt(c: Camera, size: Size, screen: Vec, factor: number): Camera {
  const scale = clampScale(c.scale * factor);
  const before = screenToWorld(c, size, screen);
  const next = { ...c, scale };
  const after = screenToWorld(next, size, screen);
  return { scale, cx: c.cx + before.x - after.x, cy: c.cy + before.y - after.y };
}

export function fitCamera(b: Box, size: Size, padding = 0.08): Camera {
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const scale = clampScale(Math.min(size.w / bw, size.h / bh) * (1 - padding * 2));
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale };
}

/** A round length for a scale bar about `targetPx` wide. */
export function niceLength(pxPerUnit: number, targetPx: number): number {
  const raw = targetPx / pxPerUnit;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const m = [1, 2, 5, 10].find((k) => k * exp >= raw) ?? 10;
  return m * exp;
}
