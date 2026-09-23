import { createElement } from 'react';
import { derive } from '../model/derive';
import type { AirportDoc } from '../model/types';
import { SheetSvg } from '../render/Sheet';
import { SurfaceLayer } from '../render/SurfaceLayer';
import { SURFACE } from '../render/palette';
import { isAirportDoc, normalizeDoc } from '../store/store';

const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&display=swap';

let fontCss: Promise<string> | null = null;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Inline the chart typeface so exported files look the same everywhere. Falls back to @import. */
export function embeddedFontCss(): Promise<string> {
  fontCss ??= (async () => {
    // A slow font host must never hold an export hostage.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 3500);
    const fetch = (url: string) => window.fetch(url, { signal: abort.signal });
    try {
      const css = await (await fetch(FONT_CSS_URL)).text();
      // Only the latin subset is needed for chart text.
      const blocks = css.split('}').filter((b) => b.includes('@font-face') && /U\+0000-00FF/.test(b));
      const inlined = await Promise.all(
        blocks.map(async (block) => {
          const url = block.match(/url\(([^)]+)\)/)?.[1];
          if (!url) return '';
          const buf = await (await fetch(url)).arrayBuffer();
          const b64 = toBase64(buf);
          return `${block.replace(url, `data:font/woff2;base64,${b64}`)}}`;
        }),
      );
      const out = inlined.join('\n');
      if (!out.trim()) throw new Error('no fonts');
      return out;
    } catch {
      return `@import url('${FONT_CSS_URL}');`;
    } finally {
      clearTimeout(timer);
    }
  })();
  return fontCss;
}

async function render(el: React.ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  return renderToStaticMarkup(el);
}

/** CDATA keeps the `&` in font URLs from breaking the SVG as XML. */
function withFonts(svg: string, css: string): string {
  return svg.replace(/<svg([^>]*)>/, `<svg$1><style><![CDATA[${css}]]></style>`);
}

export async function sheetSvgString(doc: AirportDoc): Promise<string> {
  const markup = await render(createElement(SheetSvg, { doc, derived: derive(doc) }));
  return withFonts(markup, await embeddedFontCss());
}

export async function surfaceSvgString(doc: AirportDoc, maxPx = 4000): Promise<{ svg: string; w: number; h: number }> {
  const derived = derive(doc);
  const b = derived.bounds;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const k = maxPx / Math.max(bw, bh);
  const w = Math.round(bw * k);
  const h = Math.round(bh * k);
  const el = createElement(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: `${b.minX} ${b.minY} ${bw} ${bh}`, width: w, height: h },
    createElement('rect', { x: b.minX, y: b.minY, width: bw, height: bh, fill: SURFACE.grass }),
    createElement(SurfaceLayer, { doc, derived, px: 1 / k }),
  );
  return { svg: withFonts(await render(el), await embeddedFontCss()), w, h };
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function svgToPng(svg: string, w: number, h: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

const slug = (doc: AirportDoc) => (doc.meta.ident || 'airport').toLowerCase().replace(/[^a-z0-9]+/g, '-');

export async function exportSheetSvg(doc: AirportDoc): Promise<void> {
  const svg = await sheetSvgString(doc);
  download(new Blob([svg], { type: 'image/svg+xml' }), `${slug(doc)}-airport-diagram.svg`);
}

export async function exportSheetPng(doc: AirportDoc, dpi = 300): Promise<void> {
  const svg = await sheetSvgString(doc);
  const { width, height } = derive(doc).sheet;
  const k = dpi / 72;
  const png = await svgToPng(svg, Math.round(width * k), Math.round(height * k));
  download(png, `${slug(doc)}-airport-diagram.png`);
}

export async function exportSurfacePng(doc: AirportDoc): Promise<void> {
  const { svg, w, h } = await surfaceSvgString(doc);
  download(await svgToPng(svg, w, h), `${slug(doc)}-surface.png`);
}

export function exportJson(doc: AirportDoc): void {
  download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${slug(doc)}.apd.json`);
}

export async function readDocFile(file: File): Promise<AirportDoc> {
  const parsed = JSON.parse(await file.text());
  if (!isAirportDoc(parsed)) throw new Error('That file is not an APD Maker airport (.apd.json).');
  return normalizeDoc(parsed);
}
