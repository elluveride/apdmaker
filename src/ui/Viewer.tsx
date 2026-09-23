import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { EditorCanvas } from '../editor/Canvas';
import { embeddedFontCss, exportSheetPng, exportSheetSvg, exportSurfacePng } from '../io/files';
import { derive } from '../model/derive';
import { SheetSvg } from '../render/Sheet';
import { useStore } from '../store/store';
import { DownloadIcon, FitIcon, MinusIcon, PlusIcon, PrintIcon } from './icons';

async function attempt(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    useStore.getState().showToast(err instanceof Error ? err.message : 'Export failed.');
  }
}

export function Viewer() {
  const style = useStore((s) => s.style);
  // Warm the font cache so an export click is fast enough to keep its download gesture.
  useEffect(() => void embeddedFontCss(), []);
  return style === 'chart' ? <SheetViewer /> : <SurfaceViewer />;
}

function SurfaceViewer() {
  const doc = useStore((s) => s.doc);
  return (
    <div className="viewer surface-viewer">
      <EditorCanvas interactive={false} />
      <div className="viewer-controls">
        <button type="button" className="btn" onClick={() => useStore.getState().requestFit()}>
          <FitIcon size={16} /> Fit
        </button>
        <button type="button" className="btn" onClick={() => attempt(() => exportSurfacePng(doc))}>
          <DownloadIcon size={16} /> PNG
        </button>
      </div>
    </div>
  );
}

interface View {
  z: number;
  x: number;
  y: number;
}

function SheetViewer() {
  const doc = useStore((s) => s.doc);
  const fitRequest = useStore((s) => s.fitRequest);
  const derived = useMemo(() => derive(doc), [doc]);
  const page = derived.sheet;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ z: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = () => {
    if (!size.w) return;
    const z = Math.min((size.w - 48) / page.width, (size.h - 48) / page.height);
    setView({ z, x: (size.w - page.width * z) / 2, y: (size.h - page.height * z) / 2 });
  };

  // Refit when the viewport, the page shape or a fit request changes.
  useEffect(fit, [size.w, size.h, page.width, page.height, fitRequest]);

  const zoomBy = (factor: number, at = { x: size.w / 2, y: size.h / 2 }) => {
    const v = viewRef.current;
    const z = Math.min(12, Math.max(0.2, v.z * factor));
    const k = z / v.z;
    setView({ z, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k });
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1) * (e.ctrlKey ? 8 : 1);
      zoomBy(Math.exp(-delta * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onDown = (e: ReactPointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, x: view.x, y: view.y };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.x + e.clientX - d.sx, y: d.y + e.clientY - d.sy }));
  };
  const onUp = () => (drag.current = null);

  return (
    <div className="viewer sheet-viewer">
      <div className="desk" ref={wrapRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {size.w > 0 && (
          <div className="page" style={{ left: view.x, top: view.y, width: page.width * view.z, height: page.height * view.z }}>
            <SheetSvg doc={doc} derived={derived} width={page.width * view.z} height={page.height * view.z} />
          </div>
        )}
      </div>
      <div className="viewer-controls">
        <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
          <MinusIcon size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={fit} aria-label="Fit page">
          <FitIcon size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          <PlusIcon size={18} />
        </button>
        <span className="divider" />
        <button type="button" className="btn" onClick={() => attempt(() => exportSheetSvg(doc))}>
          <DownloadIcon size={16} /> SVG
        </button>
        <button type="button" className="btn" onClick={() => attempt(() => exportSheetPng(doc))}>
          <DownloadIcon size={16} /> PNG
        </button>
        <button type="button" className="btn" onClick={() => useStore.getState().setPrinting(true)}>
          <PrintIcon size={16} /> Print
        </button>
      </div>
    </div>
  );
}

/** The chart alone, laid out for the printer. Mounted only while printing. */
export function PrintRoot() {
  const printing = useStore((s) => s.printing);
  const doc = useStore((s) => s.doc);
  useEffect(() => {
    if (!printing) return;
    const done = () => useStore.getState().setPrinting(false);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => {
      window.print();
      // Some browsers never fire afterprint; print() blocks until the dialog closes anyway.
      setTimeout(done, 500);
    }, 60);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);
  if (!printing) return null;
  const derived = derive(doc);
  const inch = (pt: number) => `${pt / 72}in`;
  return (
    <div className="print-root">
      <style>{`@page { size: ${inch(derived.sheet.width)} ${inch(derived.sheet.height)}; margin: 0; }
        .print-root svg { width: ${inch(derived.sheet.width)}; height: ${inch(derived.sheet.height)}; }`}</style>
      <SheetSvg doc={doc} derived={derived} />
    </div>
  );
}
