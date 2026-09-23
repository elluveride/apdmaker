import { useId, type ReactNode } from 'react';
import {
  add,
  boundsOf,
  dirFromBearing,
  dot,
  leftOf,
  mid,
  mul,
  norm,
  pathD,
  pointAtLength,
  polylineD,
  rightOf,
  sub,
  uprightAngle,
  wrap360,
  rad,
} from '../model/geometry';
import type { Vec } from '../model/types';
import type { Derived } from '../model/derive';
import { formatBearing, landingDir, runwayCorners, threshold, type RunwayInfo } from '../model/runway';
import type { AirportDoc, Area, Hotspot, Label, MapSymbol, Runway, Taxiway } from '../model/types';
import { holdLineStripes } from '../model/holdShort';
import { CHART, CHART_FONT, PT } from './palette';
import { textWidth } from './measure';

interface Props {
  doc: AirportDoc;
  derived: Derived;
}

const f = (n: number) => Math.round(n * 100) / 100;

export function ChartText(props: {
  at: Vec;
  size: number;
  rot?: number;
  anchor?: 'start' | 'middle' | 'end';
  weight?: number;
  fill?: string;
  children: ReactNode;
  id?: string;
  /** Marks special text, e.g. "name" for taxiway designators that can be renamed in place. */
  role?: string;
}) {
  const { at, size, rot = 0, anchor = 'middle', weight = 500, fill = CHART.ink, children, id, role } = props;
  return (
    <text
      transform={`translate(${f(at.x)} ${f(at.y)})${rot ? ` rotate(${f(rot)})` : ''}`}
      fontSize={f(size)}
      textAnchor={anchor}
      dominantBaseline="central"
      fontWeight={weight}
      fill={fill}
      data-id={id}
      data-role={role}
    >
      {children}
    </text>
  );
}

/** Stopway / blast pad rectangle beyond a threshold. */
export function stopwayPoly(r: Runway, e: 0 | 1): Vec[] | null {
  const len = r.ends[e].stopway;
  if (len <= 0) return null;
  const t = threshold(r, e);
  const out = mul(landingDir(r, e), -1);
  const n = leftOf(out);
  const h = r.width / 2;
  const far = add(t, mul(out, len));
  return [add(t, mul(n, h)), add(far, mul(n, h)), sub(far, mul(n, h)), sub(t, mul(n, h))];
}

const visible = <T extends { hidden?: boolean }>(xs: T[]) => xs.filter((x) => !x.hidden);

export function ChartLayer({ doc, derived }: Props) {
  const ts = derived.ts;
  const stippleId = `stipple${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const edge = 0.45 * ts;

  const runways = visible(doc.features.filter((x): x is Runway => x.kind === 'runway'));
  const taxiways = visible(doc.features.filter((x): x is Taxiway => x.kind === 'taxiway'));
  const areas = visible(doc.features.filter((x): x is Area => x.kind === 'area'));
  const aprons = areas.filter((a) => a.areaType === 'apron');
  const buildings = areas.filter((a) => a.areaType === 'building');
  const unpaved = areas.filter((a) => a.areaType === 'unpaved');
  const symbols = visible(doc.features.filter((x): x is MapSymbol => x.kind === 'symbol'));
  const hotspots = visible(doc.features.filter((x): x is Hotspot => x.kind === 'hotspot'));
  const labels = visible(doc.features.filter((x): x is Label => x.kind === 'label'));
  const stopways = runways.flatMap((r) =>
    ([0, 1] as const).map((e) => ({ r, poly: stopwayPoly(r, e), e })).filter((s) => s.poly),
  );

  return (
    <g fontFamily={CHART_FONT} className="chart-layer">
      <defs>
        <pattern id={stippleId} patternUnits="userSpaceOnUse" width={2.4 * ts} height={2.4 * ts}>
          <rect width={2.4 * ts} height={2.4 * ts} fill={CHART.paper} />
          <circle cx={0.6 * ts} cy={0.6 * ts} r={0.42 * ts} fill={CHART.ink} />
          <circle cx={1.8 * ts} cy={1.8 * ts} r={0.42 * ts} fill={CHART.ink} />
        </pattern>
      </defs>

      {unpaved.map((a) => (
        <path
          key={a.id}
          data-id={a.id}
          d={pathD(a.nodes, true)}
          fill={`url(#${stippleId})`}
          fillOpacity={0.55}
          stroke={CHART.ink}
          strokeWidth={0.4 * ts}
          strokeDasharray={`${1.5 * ts} ${1.2 * ts}`}
        />
      ))}

      {/* Pavement casing, then fill: shapes merge into one outlined surface. */}
      <g fill={CHART.pavementEdge} stroke={CHART.pavementEdge} strokeLinejoin="round">
        {aprons.map((a) => (
          <path key={a.id} data-id={a.id} d={pathD(a.nodes, true)} strokeWidth={edge * 2} />
        ))}
        {taxiways.map((t) => (
          <path key={t.id} data-id={t.id} d={pathD(t.nodes, t.closed)} fill="none" strokeWidth={t.width + edge * 2} />
        ))}
        {stopways.map(({ r, poly, e }) => (
          <path key={`${r.id}${e}`} data-id={r.id} d={polylineD(poly!, true)} strokeWidth={edge * 2} />
        ))}
      </g>
      <g fill={CHART.pavement} stroke={CHART.pavement} strokeLinejoin="round">
        {aprons.map((a) => (
          <path key={a.id} data-id={a.id} d={pathD(a.nodes, true)} stroke="none" />
        ))}
        {taxiways.map((t) => (
          <path key={t.id} data-id={t.id} d={pathD(t.nodes, t.closed)} fill="none" strokeWidth={t.width} />
        ))}
        {stopways.map(({ r, poly, e }) => (
          <path key={`${r.id}${e}`} data-id={r.id} d={polylineD(poly!, true)} stroke="none" />
        ))}
      </g>

      {buildings.map((a) => (
        <path key={a.id} data-id={a.id} d={pathD(a.nodes, true)} fill={CHART.building} />
      ))}

      {runways.map((r) => (
        <ChartRunway key={r.id} r={r} ts={ts} stippleId={stippleId} />
      ))}

      {doc.meta.showHoldLinesOnChart &&
        derived.holds.map((h, i) => {
          const s = holdLineStripes(h);
          return (
            <g key={i} stroke={CHART.ink} strokeWidth={0.5 * ts}>
              {[s[0], s[3]].map((l, k) => (
                <line key={k} x1={f(l.a.x)} y1={f(l.a.y)} x2={f(l.b.x)} y2={f(l.b.y)} />
              ))}
            </g>
          );
        })}

      {runways.map((r) => {
        const info = derived.infos.get(r.id);
        return info ? <RunwayLabels key={r.id} r={r} info={info} ts={ts} /> : null;
      })}

      {taxiways
        .filter((t) => t.showLabel && t.name && t.nodes.length > 1)
        .map((t) => {
          const poly = derived.polys.get(t.id);
          if (!poly) return null;
          const { point } = pointAtLength(poly, poly.length * t.labelT);
          return (
            <ChartText key={t.id} id={t.id} role="name" at={point} size={PT.taxiway * ts} weight={600}>
              {t.name}
            </ChartText>
          );
        })}

      {areas
        .filter((a) => a.showLabel && a.name)
        .map((a) => {
          const b = boundsOf(derived.polys.get(a.id)?.pts ?? a.nodes.map((n) => n.p));
          if (!b) return null;
          const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
          return (
            <ChartText
              key={a.id}
              id={a.id}
              at={c}
              size={PT.area * ts}
              weight={600}
              fill={a.areaType === 'building' ? CHART.paper : CHART.ink}
            >
              {a.name}
            </ChartText>
          );
        })}

      {symbols.map((s) => (
        <ChartSymbol key={s.id} s={s} ts={ts} />
      ))}

      {hotspots.map((h) => (
        <ChartHotspot key={h.id} h={h} ts={ts} />
      ))}

      {labels.map((l) => (
        <ChartLabel key={l.id} l={l} ts={ts} />
      ))}
    </g>
  );
}

function ChartRunway({ r, ts, stippleId }: { r: Runway; ts: number; stippleId: string }) {
  const corners = runwayCorners(r);
  const d = polylineD(corners, true);
  const hard = r.surface === 'asphalt' || r.surface === 'concrete';
  const dir = norm(sub(r.b, r.a));
  const n = leftOf(dir);
  const len = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);

  if (r.closed) {
    const xs = [0.12, 0.5, 0.88].map((k) => add(r.a, mul(dir, len * k)));
    const s = Math.min(r.width * 0.45, 3 * ts);
    return (
      <g data-id={r.id}>
        <path data-id={r.id} d={d} fill={CHART.paper} stroke={CHART.ink} strokeWidth={0.6 * ts} />
        {xs.map((c, i) => (
          <path
            key={i}
            d={`M${f(c.x - s)} ${f(c.y - s)}L${f(c.x + s)} ${f(c.y + s)}M${f(c.x - s)} ${f(c.y + s)}L${f(c.x + s)} ${f(c.y - s)}`}
            stroke={CHART.ink}
            strokeWidth={0.6 * ts}
          />
        ))}
      </g>
    );
  }

  return (
    <g>
      <path
        data-id={r.id}
        d={d}
        fill={hard ? CHART.ink : `url(#${stippleId})`}
        stroke={CHART.ink}
        strokeWidth={hard ? 0 : 0.5 * ts}
      />
      {([0, 1] as const).map((e) => {
        const D = r.ends[e].displaced;
        if (D <= 0 || !hard) return null;
        const t = threshold(r, e);
        const ld = landingDir(r, e);
        const p = add(t, mul(ld, Math.min(D, len)));
        const h = r.width / 2;
        const a1 = add(p, mul(n, h * 0.92));
        const a2 = sub(p, mul(n, h * 0.92));
        return (
          <g key={e} stroke={CHART.paper} data-id={r.id}>
            <line x1={f(a1.x)} y1={f(a1.y)} x2={f(a2.x)} y2={f(a2.y)} strokeWidth={0.7 * ts} />
            <line
              x1={f(t.x)}
              y1={f(t.y)}
              x2={f(p.x)}
              y2={f(p.y)}
              strokeWidth={0.4 * ts}
              strokeDasharray={`${1.6 * ts} ${1.2 * ts}`}
            />
          </g>
        );
      })}
    </g>
  );
}

function RunwayLabels({ r, info, ts }: { r: Runway; info: RunwayInfo; ts: number }) {
  const w = r.width;
  const d0 = landingDir(r, 0);
  const center = mid(r.a, r.b);
  const side = r.dimsSide ?? 'left';
  const dimsAt = add(center, mul(side === 'right' ? rightOf(d0) : leftOf(d0), w / 2 + 4.5 * ts));
  const dimsText = `${Math.round(info.length)} X ${Math.round(w)}`;

  return (
    <g data-id={r.id}>
      {([0, 1] as const).map((e) => {
        const t = threshold(r, e);
        const d = landingDir(r, e);
        const end = r.ends[e];
        const numberAt = sub(t, mul(d, end.stopway + 7.5 * ts));
        const alpha = uprightAngle(d);
        const readsAlong = dot({ x: Math.cos(rad(alpha)), y: Math.sin(rad(alpha)) }, d) > 0;
        const hdg = formatBearing(info.magHdg[e]);
        const hdgText = readsAlong ? `${hdg} →` : `← ${hdg}`;
        const along = add(t, mul(d, 16 * ts));
        return (
          <g key={e}>
            <ChartText at={numberAt} size={PT.runwayNumber * ts} rot={wrap360(info.trueHdg[e] + 180)} weight={600} id={r.id}>
              {info.names[e]}
            </ChartText>
            {!r.closed && (
              <ChartText at={add(along, mul(rightOf(d), w / 2 + 4 * ts))} size={PT.runwayHeading * ts} rot={alpha} id={r.id}>
                {hdgText}
              </ChartText>
            )}
            {end.elevation !== undefined && (
              <ChartText at={add(along, mul(leftOf(d), w / 2 + 4 * ts))} size={PT.runwayElev * ts} rot={alpha} id={r.id}>
                {`ELEV ${Math.round(end.elevation)}`}
              </ChartText>
            )}
          </g>
        );
      })}
      {side !== 'none' && (
        <ChartText at={dimsAt} size={PT.runwayDims * ts} rot={uprightAngle(d0)} weight={500} id={r.id}>
          {r.closed ? `CLOSED ${dimsText}` : dimsText}
        </ChartText>
      )}
    </g>
  );
}

function star(c: Vec, r: number): string {
  const pts: Vec[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.42;
    pts.push(add(c, mul(dirFromBearing(i * 36), rr)));
  }
  return polylineD(pts, true);
}

export function ChartSymbol({ s, ts }: { s: MapSymbol; ts: number }) {
  const p = s.p;
  const k = ts;
  const label = s.symbol === 'tower' ? s.label || 'TWR' : s.label;
  let glyph: ReactNode;
  switch (s.symbol) {
    case 'tower':
      glyph = <rect x={p.x - 1.4 * k} y={p.y - 1.4 * k} width={2.8 * k} height={2.8 * k} fill={CHART.ink} />;
      break;
    case 'beacon':
      glyph = (
        <g>
          <circle cx={p.x} cy={p.y} r={4 * k} fill={CHART.paper} stroke={CHART.ink} strokeWidth={0.5 * k} />
          <path d={star(p, 3.2 * k)} fill={CHART.ink} />
        </g>
      );
      break;
    case 'windcone': {
      const cone = `M${f(p.x)} ${f(p.y - 3 * k)}L${f(p.x + 5 * k)} ${f(p.y - 2.2 * k)}L${f(p.x + 5 * k)} ${f(p.y - 0.8 * k)}L${f(p.x)} ${f(p.y)}Z`;
      glyph = (
        <g stroke={CHART.ink} strokeWidth={0.5 * k}>
          <line x1={p.x} y1={p.y - 3.4 * k} x2={p.x} y2={p.y + 3 * k} />
          <path d={cone} fill={CHART.paper} />
        </g>
      );
      break;
    }
    case 'helipad':
      glyph = (
        <g>
          <circle cx={p.x} cy={p.y} r={4.2 * k} fill={CHART.paper} stroke={CHART.ink} strokeWidth={0.6 * k} />
          <ChartText at={p} size={5.6 * k} weight={700}>
            H
          </ChartText>
        </g>
      );
      break;
  }
  return (
    <g data-id={s.id}>
      <circle cx={p.x} cy={p.y} r={5 * k} fill="transparent" data-id={s.id} />
      {glyph}
      {label && (
        <ChartText at={{ x: p.x + 5.5 * k, y: p.y }} size={PT.symbol * k} anchor="start" weight={600} id={s.id}>
          {label}
        </ChartText>
      )}
    </g>
  );
}

export function ChartHotspot({ h, ts }: { h: Hotspot; ts: number }) {
  const labelAt = add(h.center, h.labelOffset);
  const dir = norm(h.labelOffset);
  const from = add(h.center, mul(dir, h.radius));
  const size = PT.hotspot * ts;
  const w = textWidth(h.label, size, 600) + 2.4 * ts;
  const hgt = size * 1.5;
  // Leader stops at the box edge nearest the circle.
  const to = { x: labelAt.x - Math.sign(h.labelOffset.x) * (w / 2), y: labelAt.y };
  const showLeader = Math.hypot(h.labelOffset.x, h.labelOffset.y) > h.radius + w / 2;
  return (
    <g data-id={h.id}>
      <circle
        cx={h.center.x}
        cy={h.center.y}
        r={h.radius}
        fill="none"
        stroke="transparent"
        strokeWidth={6 * ts}
        pointerEvents="stroke"
        data-id={h.id}
      />
      <circle cx={h.center.x} cy={h.center.y} r={h.radius} fill="none" stroke={CHART.hotspot} strokeWidth={0.9 * ts} />
      {showLeader && (
        <line x1={f(from.x)} y1={f(from.y)} x2={f(to.x)} y2={f(to.y)} stroke={CHART.hotspot} strokeWidth={0.5 * ts} />
      )}
      <rect
        data-id={h.id}
        x={labelAt.x - w / 2}
        y={labelAt.y - hgt / 2}
        width={w}
        height={hgt}
        fill={CHART.paper}
        stroke={CHART.hotspot}
        strokeWidth={0.6 * ts}
      />
      <ChartText at={labelAt} size={size} weight={600} fill={CHART.hotspot} id={h.id}>
        {h.label}
      </ChartText>
    </g>
  );
}

export function ChartLabel({ l, ts }: { l: Label; ts: number }) {
  const size = l.size * ts;
  const lines = l.text.split('\n');
  const lh = size * 1.2;
  const width = Math.max(...lines.map((s) => textWidth(s, size, 600)));
  const height = lh * lines.length;
  return (
    <g transform={`translate(${f(l.p.x)} ${f(l.p.y)}) rotate(${f(l.rotation)})`} data-id={l.id}>
      {l.boxed && (
        <rect
          x={-width / 2 - 2 * ts}
          y={-height / 2 - 1.2 * ts}
          width={width + 4 * ts}
          height={height + 2.4 * ts}
          fill={CHART.paper}
          stroke={CHART.ink}
          strokeWidth={0.5 * ts}
          data-id={l.id}
        />
      )}
      {!l.boxed && <rect x={-width / 2} y={-height / 2} width={width} height={height} fill="transparent" data-id={l.id} />}
      {lines.map((line, i) => (
        <text
          key={i}
          y={f(-height / 2 + lh * (i + 0.5))}
          fontSize={f(size)}
          fontWeight={600}
          textAnchor="middle"
          dominantBaseline="central"
          fill={CHART.ink}
          data-id={l.id}
        >
          {line}
        </text>
      ))}
    </g>
  );
}
