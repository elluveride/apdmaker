import type { ReactElement } from 'react';
import { fixSymbol } from '../map/symbols';
import {
  fmtAlt,
  fmtHeading,
  isNavaidKind,
  procedureFixes,
  procedureText,
  procTitle,
  routeGeometry,
  transitionCode,
  type ProcSegment,
} from '../model/procedure';
import type { AirportDoc, AltLimits, ProcFix, Procedure, Runway } from '../model/types';
import type { LatLon } from '../nav/geo';
import { textWidth } from './measure';
import { CHART, CHART_FONT } from './palette';

/** A terminal procedures page, in points: 5.375 x 8.25 in. */
export const PROC_PAGE = { width: 387, height: 594 };

/** Distance from the airport stays near to scale inside about 3 NM and is compressed logarithmically beyond. */
const NEAR_DEG = 3 / 60;
/** How long a heading leg and open-ended radar vectors are drawn, as a share of the whole plan. */
const HEADING_SHARE = 0.16;
const VECTORS_SHARE = 0.2;
const ALT_SIZE = 5.4;

type Pt = { x: number; y: number };
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Side = 'right' | 'left' | 'below' | 'above';
const SIDES: Side[] = ['right', 'left', 'below', 'above'];

const f = (n: number) => Math.round(n * 100) / 100;

function wrapText(text: string, maxWidth: number, size: number, weight = 500): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, weight) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Where text that reads left to right along a line from `a` to `b` goes: its
 * baseline `offset` points above the line as the text reads (negative: below).
 */
function alongLine(a: Pt, b: Pt, t: number, offset: number) {
  let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  const r = (angle * Math.PI) / 180;
  const up = { x: Math.sin(r), y: -Math.cos(r) };
  return { x: a.x + (b.x - a.x) * t + up.x * offset, y: a.y + (b.y - a.y) * t + up.y * offset, angle, up };
}

/** Flat x/y in degrees, north up, with bearings from `origin` kept and distance from it compressed. */
function radialWarp(origin: LatLon) {
  const kx = Math.cos((origin.lat * Math.PI) / 180);
  return (p: LatLon): Pt => {
    const dx = (p.lon - origin.lon) * kx;
    const dy = p.lat - origin.lat;
    const r = Math.hypot(dx, dy);
    const k = r > 0 ? (NEAR_DEG * Math.log1p(r / NEAR_DEG)) / r : 1;
    return { x: dx * k, y: -dy * k };
  };
}

function centerOf(points: LatLon[]): LatLon {
  if (!points.length) return { lat: 0, lon: 0 };
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
}

function spanOf(points: Pt[]): number {
  if (!points.length) return 0;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/** A heading flown or radar vectors: legs with no fix at their far end. */
const isOpenLeg = (s: ProcSegment) => s.kind === 'heading' || s.kind === 'vectors';

/**
 * A route's segments in warped space. Open legs are drawn along their heading
 * at a length that reads on the chart, and the leg after one starts where it ends.
 */
function drawnLegs(segments: ProcSegment[], warp: (p: LatLon) => Pt, magVar: number, span: number) {
  const moved = new Map<LatLon, Pt>();
  const at = (p: LatLon) => moved.get(p) ?? warp(p);
  return segments.map((s) => {
    const a = at(s.from);
    if (!isOpenLeg(s)) return { s, a, b: at(s.to) };
    const t = ((s.course + magVar) * Math.PI) / 180;
    const len = span * (s.kind === 'vectors' ? VECTORS_SHARE : HEADING_SHARE);
    const b = { x: a.x + Math.sin(t) * len, y: a.y - Math.cos(t) * len };
    moved.set(s.to, b);
    return { s, a, b };
  });
}

/** Roughly the box a line of centered, rotated text takes, from its baseline anchor. */
function textBox(t: ReturnType<typeof alongLine>, w: number, h: number): Box {
  const r = (t.angle * Math.PI) / 180;
  const bw = Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * h;
  const bh = Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * h;
  const cx = t.x + (t.up.x * h) / 2;
  const cy = t.y + (t.up.y * h) / 2;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** Whether the segment from `a` to `b` passes through the box (Liang–Barsky clipping). */
function crossesBox(a: Pt, b: Pt, r: Box): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function besideBox(p: Pt, side: Side, w: number, h: number, labelH: number): Box {
  const gap = 6.5;
  if (side === 'right') return { x: p.x + gap, y: p.y - labelH / 2, w, h };
  if (side === 'left') return { x: p.x - gap - w, y: p.y - labelH / 2, w, h };
  if (side === 'below') return { x: p.x - w / 2, y: p.y + gap, w, h };
  return { x: p.x - w / 2, y: p.y - gap - h, w, h };
}

/** Where a fix's label goes: the side of it clearest of lines, other labels and the plan's edge. */
function pickSide(p: Pt, w: number, h: number, labelH: number, lines: [Pt, Pt][], taken: Box[], bounds: Box): { side: Side; box: Box } {
  let best = { side: SIDES[0], box: besideBox(p, SIDES[0], w, h, labelH) };
  let bestCost = Infinity;
  for (const side of SIDES) {
    const box = besideBox(p, side, w, h, labelH);
    const cost =
      (inside(box, bounds) ? 0 : 100) + 30 * taken.filter((t) => overlaps(box, t)).length + 20 * lines.filter(([a, b]) => crossesBox(a, b, box)).length;
    if (cost < bestCost) {
      bestCost = cost;
      best = { side, box };
    }
  }
  return best;
}

interface AltRow {
  text: string;
  over: boolean;
  under: boolean;
}

/**
 * An altitude limit as SID and STAR charts draw it: a line under a minimum, over
 * a maximum, both for a mandatory altitude, and a window as two stacked limits.
 */
function altRows(alt?: AltLimits, speed?: number): AltRow[] {
  const rows: AltRow[] = [];
  const lo = alt?.atOrAbove;
  const hi = alt?.atOrBelow;
  if (lo !== undefined && hi !== undefined && lo === hi) rows.push({ text: fmtAlt(lo), over: true, under: true });
  else {
    if (hi !== undefined) rows.push({ text: fmtAlt(hi), over: true, under: false });
    if (lo !== undefined) rows.push({ text: fmtAlt(lo), over: false, under: true });
  }
  if (speed) rows.push({ text: `${speed}K`, over: false, under: false });
  return rows;
}

function AltBlock({ rows, x, y, anchor }: { rows: AltRow[]; x: number; y: number; anchor: 'start' | 'end' | 'middle' }) {
  const size = ALT_SIZE;
  return (
    <g fontSize={size} fontWeight={600} fill={CHART.ink}>
      {rows.map((r, i) => {
        const w = textWidth(r.text, size, 600);
        const top = y + i * (size + 2.4);
        const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
        return (
          <g key={i}>
            <text x={f(x)} y={f(top + size * 0.8)} textAnchor={anchor}>
              {r.text}
            </text>
            {r.over && <path d={`M${f(x0)} ${f(top - 0.4)}h${f(w)}`} stroke={CHART.ink} strokeWidth={0.45} />}
            {r.under && <path d={`M${f(x0)} ${f(top + size + 0.6)}h${f(w)}`} stroke={CHART.ink} strokeWidth={0.45} />}
          </g>
        );
      })}
    </g>
  );
}

interface Props {
  doc: AirportDoc;
  proc: Procedure;
  /** Rendered size (CSS pixels or a length); the viewBox is always in points. */
  width?: number | string;
  height?: number | string;
}

/** A SID or STAR as a terminal procedures page. */
export function ProcedureChart({ doc, proc, width, height }: Props) {
  const { width: W, height: H } = PROC_PAGE;
  const M = 14;
  const ink = CHART.ink;
  const { meta } = doc;
  const title = procTitle(proc);
  const code = proc.code.toUpperCase();
  const place = [meta.city, meta.state].filter(Boolean).join(', ').toUpperCase();
  const airportName = `${meta.name.toUpperCase()} (${meta.ident.toUpperCase()})`;

  // Frequencies this procedure's pilots need, in the order they use them.
  const wanted = proc.type === 'SID' ? ['ATIS', 'CLNC DEL', 'GND CON', 'TOWER', 'DEP CON'] : ['ATIS', 'APP CON', 'TOWER', 'GND CON'];
  const freqs = wanted
    .map((w) => meta.frequencies.find((q) => q.value.trim() && q.name.toUpperCase().includes(w.replace('TOWER', 'TOW').split(' ')[0])))
    .filter((q, i, all): q is NonNullable<typeof q> => !!q && all.indexOf(q) === i);

  // Route description.
  const textSize = 5.2;
  const paragraphs = procedureText(proc, doc).map((p) => wrapText(p.toUpperCase(), W - 2 * M - 10, textSize));
  const lineH = textSize * 1.35;
  const notesH = 16 + paragraphs.reduce((h, p) => h + p.length * lineH + 3, 0);
  const planTop = freqs.length ? 60 : 40;
  const planBottom = H - 34 - notesH - 6;
  const plan = { x0: M, y0: planTop, x1: W - M, y1: planBottom };

  // Where everything goes. Like real SID and STAR charts this is not to scale:
  // distance from the airport is compressed (bearings from it kept), so the
  // turns near the runway get room next to a transition a hundred miles long.
  const geos = proc.routes.map((r) => routeGeometry(proc, r, doc));
  const airport: LatLon | null = meta.refLat !== undefined && meta.refLon !== undefined ? { lat: meta.refLat, lon: meta.refLon } : null;
  const anchors: LatLon[] = [
    ...geos.flatMap((g) => [...g.points, ...g.segments.filter((s) => !isOpenLeg(s)).flatMap((s) => [s.from, s.to])]),
    ...(airport ? [airport] : []),
  ];
  const warp = radialWarp(airport ?? centerOf(anchors));
  const span = Math.max(0.01, spanOf(anchors.map(warp)));
  const legs = geos.map((g) => drawnLegs(g.segments, warp, meta.magVar, span));
  const warped = [...anchors.map(warp), ...legs.flat().flatMap((l) => [l.a, l.b])];
  const xs = warped.map((w) => w.x);
  const ys = warped.map((w) => w.y);
  const wx = warped.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const wy = warped.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  const spanX = Math.max(0.01, Math.max(...xs, 0) - Math.min(...xs, 0));
  const spanY = Math.max(0.01, Math.max(...ys, 0) - Math.min(...ys, 0));
  const pad = 46;
  const scale = Math.min((plan.x1 - plan.x0 - 2 * pad) / spanX, (plan.y1 - plan.y0 - 2 * pad) / spanY);
  const cx = (plan.x0 + plan.x1) / 2;
  const cy = (plan.y0 + plan.y1) / 2;
  const P = (w: Pt): Pt => ({ x: cx + (w.x - wx) * scale, y: cy + (w.y - wy) * scale });

  const fixes = procedureFixes(proc, doc);
  const limits = new Map<string, { alt?: AltLimits; speed?: number }>();
  for (const r of proc.routes) for (const l of r.legs) if (l.type === 'fix' && (l.alt || l.speed) && !limits.has(l.fix)) limits.set(l.fix, { alt: l.alt, speed: l.speed });

  // What labels keep clear of: the airport, every fix symbol, every line and its words.
  const lines: [Pt, Pt][] = [];
  const taken: Box[] = [];
  const airportAt = airport ? P(warp(airport)) : null;
  if (airportAt) {
    const nameW = textWidth(meta.name.toUpperCase(), 5.6, 700);
    taken.push({ x: airportAt.x - 16, y: airportAt.y - 16, w: 32, h: 32 }, { x: airportAt.x - nameW / 2, y: airportAt.y + 17, w: nameW, h: 8 });
  }
  for (const fx of fixes) {
    const p = P(warp(fx));
    taken.push({ x: p.x - 5, y: p.y - 5, w: 10, h: 10 });
  }

  // Every line first, so each label can pick the side of its line that's clear of the others.
  const planLegs = legs.map((route) => route.map((l) => ({ s: l.s, a: P(l.a), b: P(l.b) })).filter((l) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) >= 1));
  for (const route of planLegs) for (const l of route) lines.push([l.a, l.b]);
  const clearSide = (a: Pt, b: Pt, w: number, sides: [number, number]) => {
    const cost = (offset: number) => {
      const box = textBox(alongLine(a, b, 0.5, offset), w, 6);
      return lines.filter(([p, q]) => (p !== a || q !== b) && crossesBox(p, q, box)).length * 20 + taken.filter((t) => overlaps(box, t)).length * 30;
    };
    const t = alongLine(a, b, 0.5, cost(sides[1]) < cost(sides[0]) ? sides[1] : sides[0]);
    taken.push(textBox(t, w, 6));
    return t;
  };

  const routes: ReactElement[] = [];
  planLegs.forEach((route, gi) => {
    const g = geos[gi];
    const weight = g.route.kind === 'transition' ? 0.7 : 1.2;
    let longest: { a: Pt; b: Pt; len: number } | null = null;
    route.forEach(({ s, a, b }, si) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (s.kind !== 'vectors' && (!longest || len > longest.len)) longest = { a, b, len };
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const at = isOpenLeg(s) ? 1 : 0.58;
      const tip = { x: a.x + ux * len * at, y: a.y + uy * len * at };
      const head = `M${f(tip.x)} ${f(tip.y)} L${f(tip.x - ux * 4.2 + uy * 1.8)} ${f(tip.y - uy * 4.2 - ux * 1.8)} L${f(tip.x - ux * 4.2 - uy * 1.8)} ${f(tip.y - uy * 4.2 + ux * 1.8)} Z`;
      const label =
        s.kind === 'track'
          ? `${fmtHeading(s.course)} (${Math.round(s.distance)})`
          : s.kind === 'heading'
            ? `${fmtHeading(s.course)} HDG`
            : s.kind === 'vectors'
              ? `${fmtHeading(s.course)} · VECTORS`
              : '';
      const labelW = textWidth(label, 5, 600);
      const t = label && len > labelW + 8 ? clearSide(a, b, labelW, [2.4, -6.2]) : null;
      routes.push(
        <g key={`${gi}-${si}`}>
          <line x1={f(a.x)} y1={f(a.y)} x2={f(b.x)} y2={f(b.y)} stroke={ink} strokeWidth={weight} strokeDasharray={s.kind === 'vectors' ? '3 2' : undefined} />
          <path d={head} fill={ink} />
          {t && (
            <text x={f(t.x)} y={f(t.y)} fontSize={5} fontWeight={600} fill={ink} textAnchor="middle" transform={`rotate(${f(t.angle)} ${f(t.x)} ${f(t.y)})`}>
              {label}
            </text>
          )}
        </g>,
      );
    });
    if (g.route.kind === 'transition' && longest) {
      const { a, b } = longest;
      const name = `${g.route.name.toUpperCase()} TRANSITION (${transitionCode(proc, g.route)})`;
      const t = clearSide(a, b, textWidth(name, 4.4, 600), [-5.6, 2.4]);
      routes.push(
        <text key={`tn${gi}`} x={f(t.x)} y={f(t.y)} fontSize={4.4} fontWeight={600} fontStyle="italic" fill={ink} textAnchor="middle" transform={`rotate(${f(t.angle)} ${f(t.x)} ${f(t.y)})`}>
          {name}
        </text>,
      );
    }
  });

  const bounds: Box = { x: plan.x0 + 2, y: plan.y0 + 2, w: plan.x1 - plan.x0 - 4, h: plan.y1 - plan.y0 - 12 };
  const fixMarks = fixes.map((fx: ProcFix) => {
    const p = P(warp(fx));
    const navaid = isNavaidKind(fx.kind);
    const lim = limits.get(fx.ident);
    const boxLines = navaid ? [fx.name ?? '', `${fx.freq ?? ''} ${fx.ident}`.trim()].filter(Boolean) : [];
    const labelW = navaid ? Math.max(...boxLines.map((l) => textWidth(l, 5, 600))) + 6 : textWidth(fx.ident, 6.2, 700);
    const labelH = navaid ? boxLines.length * 6.2 + 3 : 6;
    const rows = altRows(lim?.alt, lim?.speed);
    const altW = Math.max(0, ...rows.map((r) => textWidth(r.text, ALT_SIZE, 600)));
    const w = Math.max(labelW, altW);
    const h = labelH + (rows.length ? 3 + rows.length * (ALT_SIZE + 2.4) : 0);
    const { side, box } = pickSide(p, w, h, labelH, lines, taken, bounds);
    taken.push(box);
    const anchor = side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle';
    const ax = anchor === 'start' ? box.x : anchor === 'end' ? box.x + box.w : box.x + box.w / 2;
    const lx = anchor === 'start' ? box.x : anchor === 'end' ? box.x + box.w - labelW : box.x + (box.w - labelW) / 2;
    const label = navaid ? (
      <g>
        <rect x={f(lx)} y={f(box.y)} width={f(labelW)} height={f(labelH)} fill={CHART.paper} stroke={ink} strokeWidth={0.5} />
        {boxLines.map((l, i) => (
          <text key={i} x={f(lx + 3)} y={f(box.y + 6.4 + i * 6.2)} fontSize={5} fontWeight={600} fill={ink}>
            {l}
          </text>
        ))}
      </g>
    ) : (
      <text x={f(lx)} y={f(box.y + 5.2)} fontSize={6.2} fontWeight={700} fill={ink}>
        {fx.ident}
      </text>
    );
    return (
      <g key={fx.ident}>
        <g transform={`translate(${f(p.x)} ${f(p.y)})`} dangerouslySetInnerHTML={{ __html: fixSymbol(fx.kind, navaid ? 4.6 : 3.6, ink) }} />
        {label}
        {rows.length > 0 && <AltBlock rows={rows} x={ax} y={box.y + labelH + 3} anchor={anchor} />}
      </g>
    );
  });

  // The airport, its runways enlarged into a symbol.
  let airportMark: ReactElement | null = null;
  if (airportAt) {
    const a = airportAt;
    const runways = doc.features.filter((x): x is Runway => x.kind === 'runway' && !x.hidden);
    const longest = Math.max(1, ...runways.map((r) => Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y)));
    const k = 22 / longest;
    airportMark = (
      <g>
        <circle cx={f(a.x)} cy={f(a.y)} r={15} fill={CHART.paper} stroke={ink} strokeWidth={0.4} strokeDasharray="1.2 1.2" />
        {runways.map((r) => (
          <line key={r.id} x1={f(a.x + r.a.x * k)} y1={f(a.y + r.a.y * k)} x2={f(a.x + r.b.x * k)} y2={f(a.y + r.b.y * k)} stroke={ink} strokeWidth={2.2} />
        ))}
        <text x={f(a.x)} y={f(a.y + 23)} fontSize={5.6} fontWeight={700} fill={ink} textAnchor="middle">
          {meta.name.toUpperCase()}
        </text>
      </g>
    );
  }

  const empty = !fixes.length && !planLegs.some((l) => l.length);

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} fontFamily={CHART_FONT} className="sheet-svg">
      <rect width={W} height={H} fill={CHART.paper} />
      <g fill={ink}>
        <text x={M} y={20} fontSize={5.6} fontWeight={500}>
          {meta.ident.toUpperCase()}
        </text>
        <text x={W / 2} y={21} fontSize={8.6} fontWeight={700} textAnchor="middle" letterSpacing={0.4}>
          {title} ({code})
        </text>
        <text x={W - M} y={20} fontSize={5.6} fontWeight={500} textAnchor="end">
          {proc.type}
        </text>
        <text x={M} y={31} fontSize={6} fontWeight={700}>
          {place}
        </text>
        <text x={W - M} y={31} fontSize={6} fontWeight={700} textAnchor="end">
          {airportName}
        </text>
      </g>

      {freqs.length > 0 && (
        <g>
          {freqs.map((q, i) => {
            const w = (W - 2 * M) / freqs.length;
            const x = M + i * w;
            return (
              <g key={q.name}>
                <rect x={f(x)} y={36} width={f(w)} height={18} fill="none" stroke={ink} strokeWidth={0.5} />
                <text x={f(x + w / 2)} y={43} fontSize={4.8} fontWeight={600} fill={ink} textAnchor="middle">
                  {q.name.toUpperCase()}
                </text>
                <text x={f(x + w / 2)} y={50.5} fontSize={5.4} fontWeight={500} fill={ink} textAnchor="middle">
                  {q.value}
                </text>
              </g>
            );
          })}
        </g>
      )}

      <rect x={plan.x0} y={plan.y0} width={plan.x1 - plan.x0} height={plan.y1 - plan.y0} fill="none" stroke={ink} strokeWidth={0.8} />
      <clipPath id={`plan-${proc.id}`}>
        <rect x={plan.x0} y={plan.y0} width={plan.x1 - plan.x0} height={plan.y1 - plan.y0} />
      </clipPath>
      <g clipPath={`url(#plan-${proc.id})`}>
        {airportMark}
        {routes}
        {fixMarks}
      </g>
      {empty && (
        <text x={W / 2} y={f((plan.y0 + plan.y1) / 2)} fontSize={7} fontWeight={500} fill="#888" textAnchor="middle">
          {airport ? 'Add fixes to a route to draw it here.' : 'Place the airport on the map, then add fixes.'}
        </text>
      )}
      <text x={plan.x1 - 4} y={plan.y1 - 4} fontSize={4.6} fontWeight={600} fill={ink} textAnchor="end">
        NOT TO SCALE
      </text>

      <g>
        <rect x={M} y={f(planBottom + 6)} width={W - 2 * M} height={f(notesH)} fill="none" stroke={ink} strokeWidth={0.5} />
        <text x={M + 5} y={f(planBottom + 15)} fontSize={5.6} fontWeight={700} fill={ink}>
          {proc.type === 'SID' ? 'DEPARTURE ROUTE DESCRIPTION' : 'ARRIVAL DESCRIPTION'}
        </text>
        {(() => {
          let y = planBottom + 15 + lineH + 3;
          return paragraphs.map((lines, pi) => {
            const g = (
              <g key={pi}>
                {lines.map((line, li) => (
                  <text key={li} x={M + 5} y={f(y + li * lineH)} fontSize={textSize} fontWeight={500} fill={ink}>
                    {line}
                  </text>
                ))}
              </g>
            );
            y += lines.length * lineH + 3;
            return g;
          });
        })()}
      </g>

      <g fill={ink}>
        <text x={M} y={H - 16} fontSize={9.4} fontWeight={700}>
          {title} ({code})
        </text>
        <text x={W - M} y={H - 20} fontSize={6} fontWeight={700} textAnchor="end">
          {place}
        </text>
        <text x={W - M} y={H - 12} fontSize={6} fontWeight={700} textAnchor="end">
          {airportName}
        </text>
      </g>
    </svg>
  );
}
