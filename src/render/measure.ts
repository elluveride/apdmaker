import { CHART_FONT } from './palette';

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

/** Approximate rendered width of a line of chart text, in the same units as `size`. */
export function textWidth(text: string, size: number, weight = 500): number {
  const key = `${weight}|${text}`;
  let perUnit = cache.get(key);
  if (perUnit === undefined) {
    if (ctx === undefined) {
      try {
        ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
      } catch {
        ctx = null;
      }
    }
    if (ctx) {
      ctx.font = `${weight} 100px ${CHART_FONT}`;
      perUnit = ctx.measureText(text).width / 100;
    } else {
      perUnit = text.length * 0.58;
    }
    cache.set(key, perUnit);
  }
  return perUnit * size;
}

/** Fonts load late; drop cached widths so boxes re-measure. */
export function clearTextCache(): void {
  cache.clear();
}
