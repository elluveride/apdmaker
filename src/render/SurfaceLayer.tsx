import type { ReactNode } from 'react';
import {
  add,
  boundsOf,
  leftOf,
  mul,
  pathD,
  pointAtLength,
  polylineD,
} from '../model/geometry';
import type { Vec } from '../model/types';
import type { Derived } from '../model/derive';
import { holdLineStripes } from '../model/holdShort';
import { landingDir, runwayCorners, runwayLength, threshold, type RunwayInfo } from '../model/runway';
import type { AirportDoc, Area, Hotspot, Label, MapSymbol, Runway, Taxiway } from '../model/types';
import { stopwayPoly } from './ChartLayer';
import { CHART_FONT, SURFACE } from './palette';

interface Props {
  doc: AirportDoc;
  derived: Derived;
  /** World units (feet) per screen pixel, so thin markings never vanish. */
  px: number;
}

const f = (n: number) => Math.round(n * 100) / 100;
const visible = <T extends { hidden?: boolean }>(xs: T[]) => xs.filter((x) => !x.hidden);

/** Threshold stripe count by runway width (FAA AC 150/5340-1). */
export function thresholdStripes(width: number): number {
  if (width < 75) return 4;
  if (width < 100) return 6;
  if (width < 150) return 8;
  if (width < 200) return 12;
  return 16;
}

type Frame = (u: number, v: number) => Vec;

function endFrame(r: Runway, e: 0 | 1): Frame {
  const t = threshold(r, e);
  const d = landingDir(r, e);
  const n = leftOf(d);
  return (u, v) => ({ x: t.x + d.x * u + n.x * v, y: t.y + d.y * u + n.y * v });
}

const quad = (P: Frame, u0: number, u1: number, v0: number, v1: number): string =>
  polylineD([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], true);

const tri = (P: Frame, pts: [number, number][]): string => polylineD(pts.map(([u, v]) => P(u, v)), true);

interface RunwayPaint {
  white: string;
  yellow: string;
  centerline: { a: Vec; b: Vec; width: number } | null;
  numbers: { at: Vec; rot: number; text: string }[];
}

/** Paint every runway marking as quads in world space. */
export function runwayMarkings(r: Runway, info: RunwayInfo): RunwayPaint {
  const L = runwayLength(r);
  const w = r.width;
  const half = w / 2;
  const paint: RunwayPaint = { white: '', yellow: '', centerline: null, numbers: [] };
  const hard = r.surface === 'asphalt' || r.surface === 'concrete';
  if (!hard || L < 200) return paint;

  const numberEnds: number[] = [0, 0];
  const precisionAny = r.ends.some((e) => e.marking === 'precision');
  const inner = w * 0.24;
  const aimW = w * 0.2;

  for (const e of [0, 1] as const) {
    const P = endFrame(r, e);
    const end = r.ends[e];
    const D = Math.max(0, Math.min(end.displaced, L * 0.6));
    const m = end.marking;

    if (D > 0) {
      paint.white += quad(P, D - 10, D, -half, half);
      for (let u = 40; u + 130 < D - 40; u += 200) {
        paint.white += quad(P, u, u + 90, -1.5, 1.5);
        paint.white += tri(P, [
          [u + 90, -7],
          [u + 125, 0],
          [u + 90, 7],
        ]);
      }
      const heads = Math.max(2, Math.round(w / 30));
      for (let k = 0; k < heads; k++) {
        const v = -half + (w * (k + 0.5)) / heads;
        paint.white += tri(P, [
          [D - 70, v - 6],
          [D - 40, v],
          [D - 70, v + 6],
        ]);
      }
    }

    let u = D + 20;
    if (m !== 'visual') {
      const count = thresholdStripes(w) / 2;
      for (let k = 0; k < count; k++) {
        const v0 = 5.75 + k * 11.5;
        paint.white += quad(P, u, u + 150, v0, v0 + 5.75);
        paint.white += quad(P, u, u + 150, -v0 - 5.75, -v0);
      }
      // AC 150/5340-1M fig. A-1: 40 ft from threshold bars to the designator.
      u += 150 + 40;
    }

    const suffix = info.suffixes[e];
    const rot = info.trueHdg[e];
    if (suffix) {
      paint.numbers.push({ at: P(u + 30, 0), rot, text: suffix });
      u += 60 + 20;
    }
    paint.numbers.push({ at: P(u + 30, 0), rot, text: info.numbers[e] });
    u += 60;
    numberEnds[e] = u;

    if (m !== 'visual' && L >= 4200) {
      paint.white += quad(P, D + 1020, D + 1170, inner, inner + aimW);
      paint.white += quad(P, D + 1020, D + 1170, -inner - aimW, -inner);
    }

    if (m === 'precision') {
      const groups: [number, number][] = [
        [500, 3],
        [1500, 2],
        [2000, 2],
        [2500, 1],
        [3000, 1],
      ];
      for (const [dist, count] of groups) {
        const u0 = D + dist;
        // TDZ markings within 900 ft of the runway midpoint are omitted.
        if (Math.abs(u0 + 37.5 - L / 2) < 900 || u0 + 75 > L / 2) continue;
        for (let k = 0; k < count; k++) {
          const v0 = inner + k * 11;
          paint.white += quad(P, u0, u0 + 75, v0, v0 + 6);
          paint.white += quad(P, u0, u0 + 75, -v0 - 6, -v0);
        }
      }
    }

    const S = end.stopway;
    for (let uk = -50; uk - half >= -S; uk -= 100) {
      const arm = (side: 1 | -1) =>
        tri(P, [
          [uk, 0],
          [uk - half, side * half],
          [uk - half - 3, side * half],
          [uk - 4, 0],
        ]);
      paint.yellow += arm(1) + arm(-1);
    }
  }

  const P0 = endFrame(r, 0);
  const c0 = numberEnds[0] + 40;
  const c1 = L - numberEnds[1] - 40;
  if (c1 - c0 > 120) {
    paint.centerline = {
      a: P0(c0, 0),
      b: P0(c1, 0),
      width: precisionAny ? 3 : r.ends.some((e) => e.marking === 'nonprecision') ? 1.5 : 1,
    };
  }

  if (precisionAny) {
    paint.white += quad(P0, 0, L, half - 4, half - 1);
    paint.white += quad(P0, 0, L, -half + 1, -half + 4);
  }

  if (r.closed) {
    for (const k of [0.15, 0.5, 0.85]) {
      const c = k * L;
      const s = Math.min(half * 0.9, 60);
      const barW = 5;
      paint.yellow += polylineD(
        [P0(c - s - barW, -s), P0(c - s + barW, -s), P0(c + s + barW, s), P0(c + s - barW, s)],
        true,
      );
      paint.yellow += polylineD(
        [P0(c - s - barW, s), P0(c - s + barW, s), P0(c + s + barW, -s), P0(c + s - barW, -s)],
        true,
      );
    }
  }
  return paint;
}

/** A UI element that stays the same size on screen regardless of zoom. */
function Screen({ at, px, children }: { at: Vec; px: number; children: ReactNode }) {
  return <g transform={`translate(${f(at.x)} ${f(at.y)}) scale(${px})`}>{children}</g>;
}

function Sign({ text, kind }: { text: string; kind: 'hold' | 'location' }) {
  const w = Math.max(18, text.length * 7.6 + 8);
  const h = 15;
  const bg = kind === 'hold' ? SURFACE.signRed : SURFACE.signBlack;
  const fg = kind === 'hold' ? '#ffffff' : SURFACE.yellow;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={1.5} fill={bg} stroke={kind === 'location' ? fg : '#ffffff'} strokeWidth={1.2} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600} fill={fg}>
        {text}
      </text>
    </g>
  );
}

export function SurfaceLayer({ doc, derived, px }: Props) {
  const runways = visible(doc.features.filter((x): x is Runway => x.kind === 'runway'));
  const taxiways = visible(doc.features.filter((x): x is Taxiway => x.kind === 'taxiway'));
  const areas = visible(doc.features.filter((x): x is Area => x.kind === 'area'));
  const aprons = areas.filter((a) => a.areaType === 'apron');
  const buildings = areas.filter((a) => a.areaType === 'building');
  const unpaved = areas.filter((a) => a.areaType === 'unpaved');
  const symbols = visible(doc.features.filter((x): x is MapSymbol => x.kind === 'symbol'));
  const hotspots = visible(doc.features.filter((x): x is Hotspot => x.kind === 'hotspot'));
  const labels = visible(doc.features.filter((x): x is Label => x.kind === 'label'));
  const mw = (ft: number, pixels: number) => Math.max(ft, pixels * px);
  const edged = taxiways.filter((t) => t.edgeLines);
  const showSigns = px < 4;
  const shadow = Math.max(8, 3 * px);

  const paints = runways.map((r) => {
    const info = derived.infos.get(r.id);
    return info ? { r, paint: runwayMarkings(r, info) } : null;
  });

  return (
    <g fontFamily={CHART_FONT} className="surface-layer">
      {unpaved.map((a) => (
        <path key={a.id} data-id={a.id} d={pathD(a.nodes, true)} fill={SURFACE.unpaved} />
      ))}
      {aprons.map((a) => (
        <path key={a.id} data-id={a.id} d={pathD(a.nodes, true)} fill={SURFACE.apron} />
      ))}
      <g fill="none" strokeLinejoin="round">
        {taxiways.map((t) => (
          <path key={t.id} data-id={t.id} d={pathD(t.nodes, t.closed)} stroke={SURFACE.taxiway} strokeWidth={t.width} />
        ))}
        {edged.map((t) => {
          const d = pathD(t.nodes, t.closed);
          return (
            <g key={t.id} data-id={t.id}>
              <path d={d} stroke={SURFACE.yellow} strokeWidth={t.width - 1} />
              <path d={d} stroke={SURFACE.taxiway} strokeWidth={t.width - 2} />
              <path d={d} stroke={SURFACE.yellow} strokeWidth={t.width - 3} />
            </g>
          );
        })}
        {edged.length > 0 &&
          taxiways.map((t) => (
            <path key={t.id} data-id={t.id} d={pathD(t.nodes, t.closed)} stroke={SURFACE.taxiway} strokeWidth={Math.max(0, t.width - 4)} />
          ))}
      </g>
      {runways.flatMap((r) =>
        ([0, 1] as const).map((e) => {
          const poly = stopwayPoly(r, e);
          return poly ? <path key={`${r.id}${e}`} data-id={r.id} d={polylineD(poly, true)} fill={SURFACE.asphalt} /> : null;
        }),
      )}

      {buildings.map((a) => (
        <g key={a.id}>
          <path d={pathD(a.nodes, true)} fill={SURFACE.shadow} transform={`translate(${shadow} ${shadow})`} />
          <path data-id={a.id} d={pathD(a.nodes, true)} fill={SURFACE.roof} stroke={SURFACE.roofEdge} strokeWidth={mw(1, 1)} />
        </g>
      ))}

      <g fill="none" stroke={SURFACE.yellow} strokeWidth={mw(0.5, 1)} strokeLinejoin="round">
        {taxiways.map((t) => (
          <path key={t.id} d={pathD(t.nodes, t.closed)} />
        ))}
      </g>

      {runways.map((r) => (
        <path
          key={r.id}
          data-id={r.id}
          d={polylineD(runwayCorners(r), true)}
          fill={
            r.surface === 'concrete'
              ? SURFACE.concrete
              : r.surface === 'turf'
                ? SURFACE.turf
                : r.surface === 'gravel'
                  ? SURFACE.gravel
                  : SURFACE.asphalt
          }
          stroke={r.surface === 'turf' || r.surface === 'gravel' ? SURFACE.white : 'none'}
          strokeWidth={mw(1, 1)}
          strokeDasharray={r.surface === 'turf' || r.surface === 'gravel' ? '20 180' : undefined}
        />
      ))}

      {paints.map((x) => {
        if (!x) return null;
        const { r, paint } = x;
        return (
          <g key={r.id} data-id={r.id}>
            {paint.white && <path d={paint.white} fill={SURFACE.white} />}
            {paint.centerline && (
              <line
                x1={f(paint.centerline.a.x)}
                y1={f(paint.centerline.a.y)}
                x2={f(paint.centerline.b.x)}
                y2={f(paint.centerline.b.y)}
                stroke={SURFACE.white}
                strokeWidth={mw(paint.centerline.width, 0.8)}
                strokeDasharray="120 80"
              />
            )}
            {paint.numbers.map((n, i) => (
              <text
                key={i}
                transform={`translate(${f(n.at.x)} ${f(n.at.y)}) rotate(${f(n.rot)})`}
                fontSize={84}
                fontWeight={500}
                textAnchor="middle"
                dominantBaseline="central"
                fill={SURFACE.white}
                letterSpacing={10}
              >
                {n.text}
              </text>
            ))}
            {paint.yellow && <path d={paint.yellow} fill={SURFACE.yellow} />}
          </g>
        );
      })}

      {derived.holds.map((h, i) => (
        <g key={i} stroke={SURFACE.yellow} strokeWidth={mw(1, 0.8)}>
          {holdLineStripes(h).map((s, k) => (
            <line
              key={k}
              x1={f(s.a.x)}
              y1={f(s.a.y)}
              x2={f(s.b.x)}
              y2={f(s.b.y)}
              strokeDasharray={s.dashed ? '3 3' : undefined}
            />
          ))}
        </g>
      ))}

      {showSigns &&
        derived.holds.map((h, i) => {
          const at = add(h.p, add(mul(leftOf(h.toward), h.taxiwayWidth / 2 + 14 * px + 4), mul(h.toward, -6 * px)));
          return (
            <Screen key={i} at={at} px={px}>
              <Sign text={h.sign} kind="hold" />
            </Screen>
          );
        })}

      {taxiways
        .filter((t) => t.showLabel && t.name && t.nodes.length > 1)
        .map((t) => {
          const poly = derived.polys.get(t.id);
          if (!poly) return null;
          const { point } = pointAtLength(poly, poly.length * t.labelT);
          return (
            <g key={t.id} data-id={t.id} data-role="name">
              <Screen at={point} px={px}>
                <Sign text={t.name} kind="location" />
              </Screen>
            </g>
          );
        })}

      {areas
        .filter((a) => a.showLabel && a.name)
        .map((a) => {
          const b = boundsOf(derived.polys.get(a.id)?.pts ?? []);
          if (!b) return null;
          return (
            <g key={a.id} data-id={a.id}>
              <Screen at={{ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }} px={px}>
                <HaloText size={12} fill="#2b2b2b" halo="rgba(255,255,255,0.85)">
                  {a.name}
                </HaloText>
              </Screen>
            </g>
          );
        })}

      {symbols.map((s) => (
        <SurfaceSymbol key={s.id} s={s} px={px} />
      ))}

      {hotspots.map((h) => (
        <g key={h.id} data-id={h.id}>
          <circle
            cx={h.center.x}
            cy={h.center.y}
            r={h.radius}
            fill="rgba(255, 140, 40, 0.12)"
            stroke="#ff9a3c"
            strokeWidth={2 * px}
            strokeDasharray={`${8 * px} ${5 * px}`}
          />
          <Screen at={add(h.center, h.labelOffset)} px={px}>
            <HaloText size={12} fill="#ffb066" halo="rgba(40,30,20,0.85)">
              {h.label}
            </HaloText>
          </Screen>
        </g>
      ))}

      {labels.map((l) => (
        <g key={l.id} data-id={l.id} transform={`translate(${f(l.p.x)} ${f(l.p.y)}) rotate(${l.rotation})`}>
          <Screen at={{ x: 0, y: 0 }} px={Math.max(px, (l.size * derived.ts) / 12)}>
            <HaloText size={12} fill="#ffffff" halo="rgba(20,30,15,0.8)">
              {l.text}
            </HaloText>
          </Screen>
        </g>
      ))}
    </g>
  );
}

function HaloText({ size, fill, halo, children }: { size: number; fill: string; halo: string; children: string }) {
  const lines = children.split('\n');
  return (
    <text
      fontSize={size}
      fontWeight={600}
      textAnchor="middle"
      dominantBaseline="central"
      fill={fill}
      stroke={halo}
      strokeWidth={3}
      paintOrder="stroke"
      strokeLinejoin="round"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={0} y={(i - (lines.length - 1) / 2) * size * 1.2}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function SurfaceSymbol({ s, px }: { s: MapSymbol; px: number }) {
  const p = s.p;
  switch (s.symbol) {
    case 'helipad': {
      const h = 30;
      return (
        <g data-id={s.id}>
          <rect x={p.x - h} y={p.y - h} width={2 * h} height={2 * h} fill={SURFACE.concrete} stroke={SURFACE.white} strokeWidth={Math.max(1.5, px)} data-id={s.id} />
          <text x={p.x} y={p.y} fontSize={40} fontWeight={600} textAnchor="middle" dominantBaseline="central" fill={SURFACE.white} data-id={s.id}>
            H
          </text>
        </g>
      );
    }
    case 'windcone':
      return (
        <g data-id={s.id}>
          <circle cx={p.x} cy={p.y} r={50} fill="none" stroke={SURFACE.white} strokeWidth={Math.max(3, px)} strokeDasharray="18 8" />
          <Screen at={p} px={px}>
            <circle r={9} fill="transparent" data-id={s.id} />
            <line x1={0} y1={-6} x2={0} y2={8} stroke="#333" strokeWidth={1.5} />
            <path d="M0 -6 L14 -3 L14 1 L0 2 Z" fill="#ff7a1a" stroke="#6b2d00" strokeWidth={0.8} />
          </Screen>
        </g>
      );
    case 'beacon':
      return (
        <g data-id={s.id}>
          <Screen at={p} px={px}>
            <circle r={8} fill="#1d3b22" stroke="#fff" strokeWidth={1.2} data-id={s.id} />
            <circle r={3.5} fill="#8df29a" />
          </Screen>
        </g>
      );
    case 'tower':
      return (
        <g data-id={s.id}>
          <Screen at={p} px={px}>
            <circle r={9} fill="#243447" stroke="#fff" strokeWidth={1.2} data-id={s.id} />
            <path d="M-3 5 L-2 -2 L2 -2 L3 5 Z M-4 -2 L4 -2 L3 -5 L-3 -5 Z" fill="#fff" />
            <text x={13} y={0} fontSize={11} fontWeight={600} dominantBaseline="central" fill="#fff" stroke="rgba(20,30,15,0.8)" strokeWidth={3} paintOrder="stroke">
              {s.label || 'TWR'}
            </text>
          </Screen>
        </g>
      );
  }
}
