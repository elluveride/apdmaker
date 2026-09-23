import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { derive } from '../model/derive';
import { padBox } from '../model/geometry';
import type { Vec } from '../model/types';
import { ChartLayer } from '../render/ChartLayer';
import { SurfaceLayer } from '../render/SurfaceLayer';
import { CHART, SURFACE } from '../render/palette';
import { useStore } from '../store/store';
import { cameraTransform, fitCamera, niceLength, screenToWorld, worldToScreen, zoomAt, type Size } from './camera';
import { useDraft } from './draftStore';
import { DraftOverlay, SelectionOverlay } from './Overlay';
import { gridStep } from './snapping';
import { cancelGesture, doubleClick, pointerDown, pointerMove, pointerUp, type PointerCtx } from './tools';

type Pan = { start: Vec; cx: number; cy: number };

let cameraReady = false;
type Pinch = { dist: number; mid: Vec; cam: { cx: number; cy: number; scale: number } };

export function EditorCanvas({ interactive = true }: { interactive?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const style = useStore((s) => s.style);
  const tool = useStore((s) => s.tool);
  const grid = useStore((s) => s.grid);
  const fitRequest = useStore((s) => s.fitRequest);
  const derived = useMemo(() => derive(doc), [doc]);

  const pan = useRef<Pan | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const pointers = useRef(new Map<number, Vec>());
  // Pointer capture retargets click events to the svg, so remember what was actually pressed.
  const downTarget = useRef<Element | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit when asked, and on the very first measurement; later mounts keep the camera.
  const fittedFor = useRef(cameraReady ? fitRequest : -1);
  useEffect(() => {
    if (size.w === 0 || size.h === 0 || fittedFor.current === fitRequest) return;
    fittedFor.current = fitRequest;
    cameraReady = true;
    const d = derive(useStore.getState().doc);
    // Runway numbers sit beyond the pavement, so leave room for them.
    useStore.getState().setCamera(fitCamera(padBox(d.bounds, d.ts * 14), size));
  }, [fitRequest, size]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Wheel needs a non-passive listener to stop the page from scrolling.
  const ready = size.w > 0;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const delta = e.deltaY * unit * (e.ctrlKey ? 8 : 1);
      const factor = Math.exp(-delta * 0.0015);
      const s = useStore.getState();
      s.setCamera(zoomAt(s.camera, sizeRef.current, at, factor));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [ready]);

  const localPoint = (e: { clientX: number; clientY: number }): Vec => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const ctxFor = (e: ReactPointerEvent | React.MouseEvent): PointerCtx => {
    const screen = localPoint(e);
    const cam = useStore.getState().camera;
    return {
      screen,
      world: screenToWorld(cam, sizeRef.current, screen),
      target: e.target as Element,
      shift: e.shiftKey,
      alt: e.altKey,
      px: 1 / cam.scale,
    };
  };

  const startPan = (screen: Vec) => {
    const cam = useStore.getState().camera;
    pan.current = { start: screen, cx: cam.cx, cy: cam.cy };
    setPanning(true);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const screen = localPoint(e);
    downTarget.current = e.target as Element;
    pointers.current.set(e.pointerId, screen);
    svgRef.current?.setPointerCapture(e.pointerId);

    if (pointers.current.size === 2) {
      // Second finger: switch to pinch-zoom and abandon whatever the first finger started.
      cancelGesture();
      pan.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        cam: { ...useStore.getState().camera },
      };
      return;
    }
    if (e.button === 2) return;
    if (!interactive || e.button === 1 || spaceHeld) {
      e.preventDefault();
      startPan(screen);
      return;
    }
    if (pointerDown(ctxFor(e)) === 'pan') startPan(screen);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const screen = localPoint(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, screen);

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const p = pinch.current;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let cam = zoomAt(p.cam, sizeRef.current, p.mid, dist / Math.max(1, p.dist));
      cam = { ...cam, cx: cam.cx - (mid.x - p.mid.x) / cam.scale, cy: cam.cy - (mid.y - p.mid.y) / cam.scale };
      useStore.getState().setCamera(cam);
      return;
    }
    if (pan.current) {
      const p = pan.current;
      const cam = useStore.getState().camera;
      useStore.getState().setCamera({
        ...cam,
        cx: p.cx - (screen.x - p.start.x) / cam.scale,
        cy: p.cy - (screen.y - p.start.y) / cam.scale,
      });
      return;
    }
    if (interactive) pointerMove(ctxFor(e));
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      return;
    }
    if (pan.current) {
      pan.current = null;
      setPanning(false);
      return;
    }
    if (interactive) pointerUp(ctxFor(e));
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (interactive) doubleClick({ ...ctxFor(e), target: downTarget.current });
  };

  const px = 1 / camera.scale;
  const cursor = panning
    ? 'grabbing'
    : spaceHeld || tool === 'hand' || !interactive
      ? 'grab'
      : tool === 'select'
        ? 'default'
        : 'crosshair';

  return (
    <div className="canvas-wrap" ref={wrapRef} style={{ cursor }}>
      {size.w > 0 && (
        <svg
          ref={svgRef}
          width={size.w}
          height={size.h}
          className={`canvas ${style}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => useDraft.getState().setCursor(null)}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
        >
          <rect width={size.w} height={size.h} fill={style === 'chart' ? CHART.paper : SURFACE.grass} />
          <g transform={cameraTransform(camera, size)}>
            {grid && interactive && <Grid camera={camera} size={size} surface={style === 'surface'} />}
            {style === 'chart' ? (
              <ChartLayer doc={doc} derived={derived} />
            ) : (
              <SurfaceLayer doc={doc} derived={derived} px={px} />
            )}
            {interactive && <SelectionOverlay derived={derived} px={px} />}
            {interactive && <DraftOverlay px={px} ts={derived.ts} />}
          </g>
          <ScaleBar scale={camera.scale} height={size.h} surface={style === 'surface'} />
          <NorthArrow width={size.w} magVar={doc.meta.magVar} surface={style === 'surface'} />
          {interactive && <ReadoutLayer size={size} />}
        </svg>
      )}
    </div>
  );
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function Grid({ camera, size, surface }: { camera: { cx: number; cy: number; scale: number }; size: Size; surface: boolean }) {
  const step = gridStep(camera.scale);
  const minor = step / 5;
  const tl = screenToWorld(camera, size, { x: 0, y: 0 });
  const br = screenToWorld(camera, size, { x: size.w, y: size.h });
  const lines = (s: number) => {
    let d = '';
    for (let x = Math.floor(tl.x / s) * s; x <= br.x; x += s) d += `M${x} ${tl.y}V${br.y}`;
    for (let y = Math.floor(tl.y / s) * s; y <= br.y; y += s) d += `M${tl.x} ${y}H${br.x}`;
    return d;
  };
  const color = surface ? 'rgba(255,255,255,0.08)' : 'var(--grid)';
  return (
    <g pointerEvents="none">
      <path d={lines(minor)} stroke={color} strokeOpacity={0.5} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={lines(step)} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={`M${tl.x} 0H${br.x}M0 ${tl.y}V${br.y}`} stroke={surface ? 'rgba(255,255,255,0.18)' : 'var(--grid-axis)'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

function ScaleBar({ scale, height, surface }: { scale: number; height: number; surface: boolean }) {
  const ft = niceLength(scale, 120);
  const w = ft * scale;
  const ink = surface ? '#fff' : '#222';
  const y = height - 22;
  return (
    <g transform={`translate(16 ${y})`} pointerEvents="none" className="scale-bar">
      <rect x={-6} y={-16} width={w + 70} height={26} rx={4} fill={surface ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.85)'} />
      <path d={`M0 -4V2H${w}V-4`} fill="none" stroke={ink} strokeWidth={1.5} />
      <text x={w + 8} y={0} fontSize={11} fill={ink} dominantBaseline="middle" className="mono">
        {ft.toLocaleString('en-US')} ft
      </text>
    </g>
  );
}

function NorthArrow({ width, magVar, surface }: { width: number; magVar: number; surface: boolean }) {
  const ink = surface ? '#fff' : '#222';
  return (
    <g transform={`translate(${width - 34} 40)`} pointerEvents="none">
      <circle r={20} fill={surface ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.85)'} />
      <path d="M0 -14 L5 6 L0 3 L-5 6 Z" fill={ink} />
      <g transform={`rotate(${magVar})`}>
        <path d="M0 -15 L0 9" stroke="var(--select)" strokeWidth={1.4} />
        <path d="M0 -15 L3 -9 L0 -10.5 Z" fill="var(--select)" />
      </g>
      <text y={-24} textAnchor="middle" fontSize={10} fontWeight={600} fill={ink} stroke={surface ? 'none' : '#fff'} strokeWidth={3} paintOrder="stroke">
        N
      </text>
    </g>
  );
}

function ReadoutLayer({ size }: { size: Size }) {
  const readout = useDraft((s) => s.readout);
  const snap = useDraft((s) => s.snap);
  const camera = useStore((s) => s.camera);
  if (readout) return <Pill at={{ x: readout.at.x + 16, y: readout.at.y + 20 }} text={readout.text} />;
  if (!snap?.label) return null;
  // Snap labels sit next to the snapped point.
  const at = worldToScreen(camera, size, snap.p);
  return <Pill at={{ x: at.x + 12, y: at.y - 16 }} text={snap.label} />;
}

function Pill({ at, text }: { at: Vec; text: string }) {
  const w = text.length * 6.6 + 16;
  return (
    <g transform={`translate(${at.x} ${at.y})`} pointerEvents="none">
      <rect x={0} y={-11} width={w} height={22} rx={11} fill="var(--select)" />
      <text x={8} y={0} dominantBaseline="middle" fontSize={11.5} fill="#fff" className="mono">
        {text}
      </text>
    </g>
  );
}
