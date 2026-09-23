import { useId, type ReactElement } from 'react';
import type { Derived } from '../model/derive';
import { formatDMS, latToWorldY, lonToWorldX, worldToLatLon } from '../model/sheet';
import type { AirportDoc } from '../model/types';
import { niceLength } from '../editor/camera';
import { ChartLayer } from './ChartLayer';
import { CHART, CHART_FONT } from './palette';
import { textWidth } from './measure';

interface Props {
  doc: AirportDoc;
  derived: Derived;
  /** Rendered size in CSS pixels; the viewBox is always in points. */
  width?: number;
  height?: number;
}

const f = (n: number) => Math.round(n * 100) / 100;

function wrap(text: string, maxWidth: number, size: number): string[] {
  const out: string[] = [];
  for (const para of text.toUpperCase().split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, 500) > maxWidth && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

export function SheetSvg({ doc, derived, width, height }: Props) {
  const L = derived.sheet;
  const { meta } = doc;
  const clipId = `frame${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const fr = L.frame;
  const title = `${meta.name.toUpperCase()} (${meta.ident.toUpperCase()})`;
  const place = [meta.city, meta.state].filter(Boolean).join(', ').toUpperCase();

  const freqs = meta.frequencies.filter((q) => q.value.trim());
  const freqSize = 5.4;
  const freqLines = freqs.map((q) => `${q.name.toUpperCase()} ${q.value}`.trim());
  const freqW = Math.max(60, ...freqLines.map((s) => textWidth(s, freqSize, 500))) + 8;
  const freqH = freqLines.length * freqSize * 1.3 + 6;
  const noteSize = 4.4;
  const notes = meta.notes ? wrap(meta.notes, Math.max(freqW, 120) - 4, noteSize) : [];

  const varText = `VAR ${Math.abs(meta.magVar).toFixed(1)}° ${meta.magVar >= 0 ? 'E' : 'W'}`;
  const scaleFt = niceLength(L.scale, 70);
  const scaleW = scaleFt * L.scale;

  const toPage = (x: number, y: number) => ({ x: x * L.scale + L.offset.x, y: y * L.scale + L.offset.y });
  const toWorld = (px: number, py: number) => ({ x: (px - L.offset.x) / L.scale, y: (py - L.offset.y) / L.scale });

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${L.width} ${L.height}`}
      width={width ?? L.width}
      height={height ?? L.height}
      fontFamily={CHART_FONT}
      className="sheet-svg"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={fr.minX} y={fr.minY} width={fr.maxX - fr.minX} height={fr.maxY - fr.minY} />
        </clipPath>
      </defs>
      <rect width={L.width} height={L.height} fill={CHART.paper} />

      {/* Header */}
      <g fill={CHART.ink}>
        <text x={fr.minX} y={24} fontSize={5.6} fontWeight={500}>
          {meta.ident.toUpperCase()}
        </text>
        <text x={L.width / 2} y={25} fontSize={10.5} fontWeight={700} textAnchor="middle" letterSpacing={0.6}>
          AIRPORT DIAGRAM
        </text>
        <text x={fr.maxX} y={24} fontSize={5.6} fontWeight={500} textAnchor="end">
          {meta.chartCode}
        </text>
        <text x={fr.minX} y={fr.minY - 6} fontSize={7} fontWeight={700}>
          {place}
        </text>
        <text x={fr.maxX} y={fr.minY - 6} fontSize={7} fontWeight={700} textAnchor="end">
          {title}
        </text>
      </g>

      {/* Drawing */}
      <g clipPath={`url(#${clipId})`}>
        <g transform={`translate(${f(L.offset.x)} ${f(L.offset.y)}) scale(${L.scale})`}>
          <ChartLayer doc={doc} derived={derived} />
        </g>
      </g>

      {meta.refLat !== undefined && meta.refLon !== undefined && (
        <Graticule
          refLat={meta.refLat}
          refLon={meta.refLon}
          frame={fr}
          toPage={toPage}
          toWorld={toWorld}
        />
      )}

      <rect x={fr.minX} y={fr.minY} width={fr.maxX - fr.minX} height={fr.maxY - fr.minY} fill="none" stroke={CHART.ink} strokeWidth={0.9} />

      {/* Frequencies and notes */}
      {freqLines.length > 0 && (
        <g transform={`translate(${fr.minX + 7} ${fr.minY + 7})`}>
          <rect width={freqW} height={freqH} fill={CHART.paper} stroke={CHART.ink} strokeWidth={0.5} />
          {freqLines.map((line, i) => (
            <text key={i} x={4} y={3 + freqSize * 1.3 * (i + 0.75)} fontSize={freqSize} fontWeight={500} fill={CHART.ink}>
              {line}
            </text>
          ))}
          {notes.map((line, i) => (
            <text key={`n${i}`} x={0} y={freqH + 7 + i * noteSize * 1.25} fontSize={noteSize} fontWeight={500} fill={CHART.ink}>
              {line}
            </text>
          ))}
        </g>
      )}

      {/* Field elevation, north arrows */}
      <g transform={`translate(${fr.maxX - 18} ${fr.minY + 26})`}>
        <path d="M0 -15 L0 13" stroke={CHART.ink} strokeWidth={0.7} />
        <path d="M0 -17 L3 -9 L-3 -9 Z" fill={CHART.ink} />
        <g transform={`rotate(${meta.magVar})`}>
          <path d="M0 -15 L0 13" stroke={CHART.ink} strokeWidth={0.7} />
          <path d="M0 -17 L3 -9 L0 -10.5 Z" fill={CHART.ink} />
        </g>
        <text y={20} fontSize={4.6} textAnchor="middle" fontWeight={600} fill={CHART.ink}>
          {varText}
        </text>
      </g>
      <g transform={`translate(${fr.maxX - 58} ${fr.minY + 8})`}>
        <rect width={24} height={22} fill={CHART.paper} stroke={CHART.ink} strokeWidth={0.5} />
        <text x={12} y={6.5} fontSize={4.4} textAnchor="middle" fontWeight={600} fill={CHART.ink}>
          FIELD
        </text>
        <text x={12} y={11.5} fontSize={4.4} textAnchor="middle" fontWeight={600} fill={CHART.ink}>
          ELEV
        </text>
        <text x={12} y={18} fontSize={6} textAnchor="middle" fontWeight={700} fill={CHART.ink}>
          {Math.round(meta.elevation)}
        </text>
      </g>

      {/* Scale */}
      <g transform={`translate(${fr.minX + 10} ${fr.maxY - 24})`} fill={CHART.ink}>
        <path d={`M0 -2.5V0H${f(scaleW)}V-2.5M${f(scaleW / 2)} 0V-1.8`} fill="none" stroke={CHART.ink} strokeWidth={0.5} />
        <text x={0} y={5} fontSize={4} textAnchor="middle">
          0
        </text>
        <text x={f(scaleW)} y={5} fontSize={4} textAnchor="middle">
          {scaleFt.toLocaleString('en-US')}
        </text>
        <text x={f(scaleW + 6)} y={-0.5} fontSize={4.4} fontWeight={600}>
          FEET
        </text>
      </g>

      {/* Footer */}
      <g fill={CHART.ink}>
        <text x={fr.minX} y={fr.maxY + 13} fontSize={7.5} fontWeight={700} letterSpacing={0.4}>
          AIRPORT DIAGRAM
        </text>
        <text x={fr.maxX} y={fr.maxY + 12} fontSize={6.2} fontWeight={700} textAnchor="end">
          {place}
        </text>
        <text x={fr.maxX} y={fr.maxY + 20} fontSize={6.2} fontWeight={700} textAnchor="end">
          {title}
        </text>
        {meta.effective && (
          <>
            <text x={L.width / 2} y={L.height - 8} fontSize={5} textAnchor="middle" fontWeight={500}>
              {meta.effective.toUpperCase()}
            </text>
            <text
              transform={`translate(${fr.minX - 5} ${(fr.minY + fr.maxY) / 2}) rotate(-90)`}
              fontSize={4.6}
              textAnchor="middle"
              fontWeight={500}
            >
              {meta.effective.toUpperCase()}
            </text>
            <text
              transform={`translate(${fr.maxX + 5} ${(fr.minY + fr.maxY) / 2}) rotate(90)`}
              fontSize={4.6}
              textAnchor="middle"
              fontWeight={500}
            >
              {meta.effective.toUpperCase()}
            </text>
          </>
        )}
      </g>
    </svg>
  );
}

interface GraticuleProps {
  refLat: number;
  refLon: number;
  frame: { minX: number; minY: number; maxX: number; maxY: number };
  toPage: (x: number, y: number) => { x: number; y: number };
  toWorld: (px: number, py: number) => { x: number; y: number };
}

/** Coordinate ticks every 6 seconds, labelled every 30 seconds or minute (FAA airport diagram convention). */
function Graticule({ refLat, refLon, frame, toPage, toWorld }: GraticuleProps) {
  const topLeft = worldToLatLon(toWorld(frame.minX, frame.minY), refLat, refLon);
  const bottomRight = worldToLatLon(toWorld(frame.maxX, frame.maxY), refLat, refLon);
  const latSpan = (topLeft.lat - bottomRight.lat) * 3600;
  const lonSpan = (bottomRight.lon - topLeft.lon) * 3600;
  const labelEvery = (span: number) => (span > 150 ? 60 : 30);

  const ticks: ReactElement[] = [];
  const latStep = labelEvery(latSpan);
  for (let s = Math.ceil((bottomRight.lat * 3600) / 6) * 6; s <= topLeft.lat * 3600; s += 6) {
    const y = toPage(0, latToWorldY(s / 3600, refLat)).y;
    const major = s % latStep === 0;
    const len = major ? 6 : 2.5;
    ticks.push(
      <path key={`la${s}`} d={`M${frame.minX} ${f(y)}h${len}M${frame.maxX} ${f(y)}h${-len}`} stroke={CHART.ink} strokeWidth={0.45} />,
    );
    // The top band holds the frequency box; keep latitude labels out of it.
    if (major && y > frame.minY + 60) {
      ticks.push(
        <text key={`lt${s}`} x={frame.minX + 8} y={f(y)} fontSize={4.2} fontWeight={500} dominantBaseline="central" fill={CHART.ink}>
          {formatDMS(s / 3600, 'lat')}
        </text>,
      );
    }
  }
  const lonStep = labelEvery(lonSpan);
  for (let s = Math.ceil((topLeft.lon * 3600) / 6) * 6; s <= bottomRight.lon * 3600; s += 6) {
    const x = toPage(lonToWorldX(s / 3600, refLat, refLon), 0).x;
    const major = s % lonStep === 0;
    const len = major ? 6 : 2.5;
    ticks.push(
      <path key={`lo${s}`} d={`M${f(x)} ${frame.minY}v${len}M${f(x)} ${frame.maxY}v${-len}`} stroke={CHART.ink} strokeWidth={0.45} />,
    );
    if (major) {
      ticks.push(
        <text key={`lx${s}`} x={f(x)} y={frame.maxY - 9} fontSize={4.2} fontWeight={500} textAnchor="middle" fill={CHART.ink}>
          {formatDMS(s / 3600, 'lon')}
        </text>,
      );
    }
  }
  return <g>{ticks}</g>;
}
