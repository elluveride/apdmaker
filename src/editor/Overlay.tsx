import { add, pathD, pointAtLength, polylineD } from '../model/geometry';
import type { Derived } from '../model/derive';
import { runwayCorners } from '../model/runway';
import { newRunway } from '../model/defaults';
import type { Feature, PathNode, Vec } from '../model/types';
import { textWidth } from '../render/measure';
import { useStore } from '../store/store';
import { useDraft, type Draft } from './draftStore';
import { defaultRunwayWidth } from './tools';

const SEL = 'var(--select)';
const f = (n: number) => Math.round(n * 100) / 100;

interface Props {
  derived: Derived;
  px: number;
}

export function SelectionOverlay({ derived, px }: Props) {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const feature = selection.id ? doc.features.find((x) => x.id === selection.id) : undefined;
  if (!feature || feature.hidden) return null;
  const interactive = tool === 'select';
  return (
    <g className="overlay" pointerEvents={interactive ? undefined : 'none'}>
      <FeatureOutline f={feature} derived={derived} px={px} />
      {interactive && <FeatureHandles f={feature} derived={derived} px={px} selectedNode={selection.node} />}
    </g>
  );
}

function FeatureOutline({ f: feat, derived, px }: { f: Feature; derived: Derived; px: number }) {
  const common = {
    fill: 'none',
    stroke: SEL,
    strokeWidth: 1.5,
    vectorEffect: 'non-scaling-stroke' as const,
    pointerEvents: 'none' as const,
  };
  switch (feat.kind) {
    case 'runway':
      return (
        <g>
          <path d={polylineD(runwayCorners(feat), true)} {...common} />
          <line x1={feat.a.x} y1={feat.a.y} x2={feat.b.x} y2={feat.b.y} {...common} strokeDasharray="6 4" />
        </g>
      );
    case 'taxiway':
      return (
        <g>
          <path
            d={pathD(feat.nodes, feat.closed)}
            fill="none"
            stroke={SEL}
            strokeOpacity={0.18}
            strokeWidth={feat.width}
            strokeLinejoin="round"
            pointerEvents="none"
          />
          <path d={pathD(feat.nodes, feat.closed)} {...common} />
        </g>
      );
    case 'area':
      return <path d={pathD(feat.nodes, true)} {...common} />;
    case 'label': {
      const size = feat.size * derived.ts;
      const lines = feat.text.split('\n');
      const w = Math.max(...lines.map((l) => textWidth(l, size, 600))) + 6 * px;
      const h = size * 1.2 * lines.length + 6 * px;
      return (
        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          transform={`translate(${f(feat.p.x)} ${f(feat.p.y)}) rotate(${feat.rotation})`}
          {...common}
          strokeDasharray="4 3"
        />
      );
    }
    case 'symbol':
      return <circle cx={feat.p.x} cy={feat.p.y} r={Math.max(14 * px, 6 * derived.ts)} {...common} strokeDasharray="4 3" />;
    case 'hotspot':
      return <circle cx={feat.center.x} cy={feat.center.y} r={feat.radius} {...common} strokeDasharray="6 4" />;
  }
}

function Knob({ at, px, handle, r = 5, fill = '#fff', square = false }: { at: Vec; px: number; handle: string; r?: number; fill?: string; square?: boolean }) {
  const s = r * px;
  const shared = {
    'data-handle': handle,
    fill,
    stroke: SEL,
    strokeWidth: 1.5,
    vectorEffect: 'non-scaling-stroke' as const,
    className: 'knob',
  };
  // A larger invisible target makes handles easy to grab on touch screens.
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={s * 2.2} fill="transparent" data-handle={handle} className="knob" />
      {square ? (
        <rect x={at.x - s} y={at.y - s} width={s * 2} height={s * 2} {...shared} />
      ) : (
        <circle cx={at.x} cy={at.y} r={s} {...shared} />
      )}
    </g>
  );
}

function PathHandles({ id, nodes, px, selectedNode }: { id: string; nodes: PathNode[]; px: number; selectedNode: number | null }) {
  return (
    <g>
      {nodes.map((n, i) => (
        <g key={i}>
          {n.in && (
            <>
              <line x1={n.p.x} y1={n.p.y} x2={n.in.x} y2={n.in.y} stroke={SEL} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
              <Knob at={n.in} px={px} handle={`hin|${id}|${i}`} r={3.5} />
            </>
          )}
          {n.out && (
            <>
              <line x1={n.p.x} y1={n.p.y} x2={n.out.x} y2={n.out.y} stroke={SEL} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
              <Knob at={n.out} px={px} handle={`hout|${id}|${i}`} r={3.5} />
            </>
          )}
        </g>
      ))}
      {nodes.map((n, i) => (
        <Knob key={i} at={n.p} px={px} handle={`node|${id}|${i}`} r={4.5} square fill={selectedNode === i ? SEL : '#fff'} />
      ))}
    </g>
  );
}

function FeatureHandles({ f: feat, derived, px, selectedNode }: { f: Feature; derived: Derived; px: number; selectedNode: number | null }) {
  switch (feat.kind) {
    case 'runway':
      return (
        <g>
          <Knob at={feat.a} px={px} handle={`rwy|${feat.id}|0`} r={6} />
          <Knob at={feat.b} px={px} handle={`rwy|${feat.id}|1`} r={6} />
        </g>
      );
    case 'taxiway': {
      const poly = derived.polys.get(feat.id);
      const label = poly && poly.length > 0 ? pointAtLength(poly, poly.length * feat.labelT).point : null;
      return (
        <g>
          <PathHandles id={feat.id} nodes={feat.nodes} px={px} selectedNode={selectedNode} />
          {label && feat.showLabel && (
            <g data-handle={`twl|${feat.id}`} className="knob">
              <circle cx={label.x} cy={label.y} r={12 * px} fill="transparent" />
              <rect
                x={label.x - 4 * px}
                y={label.y - 4 * px}
                width={8 * px}
                height={8 * px}
                transform={`rotate(45 ${label.x} ${label.y})`}
                fill="#fff"
                stroke={SEL}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </g>
      );
    }
    case 'area':
      return <PathHandles id={feat.id} nodes={feat.nodes} px={px} selectedNode={selectedNode} />;
    case 'hotspot':
      return (
        <g>
          <Knob at={{ x: feat.center.x + feat.radius, y: feat.center.y }} px={px} handle={`hsr|${feat.id}`} r={5} />
          <Knob at={add(feat.center, feat.labelOffset)} px={px} handle={`hsl|${feat.id}`} r={4} square />
        </g>
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Drafts                                                              */
/* ------------------------------------------------------------------ */

export function DraftOverlay({ px, ts }: { px: number; ts: number }) {
  const draft = useDraft((s) => s.draft);
  const snap = useDraft((s) => s.snap);
  return (
    <g pointerEvents="none">
      {draft && <DraftShape d={draft} px={px} ts={ts} />}
      {snap && (
        <g>
          <circle cx={snap.p.x} cy={snap.p.y} r={6 * px} fill="none" stroke={SEL} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <circle cx={snap.p.x} cy={snap.p.y} r={1.8 * px} fill={SEL} />
        </g>
      )}
    </g>
  );
}

function DraftShape({ d, px }: { d: Draft; px: number; ts: number }) {
  const thin = { stroke: SEL, strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' as const };
  switch (d.type) {
    case 'runway': {
      const r = newRunway(d.a, d.b, defaultRunwayWidth(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)));
      return (
        <g>
          <path d={polylineD(runwayCorners(r), true)} fill="var(--select)" fillOpacity={0.25} {...thin} />
          <line x1={d.a.x} y1={d.a.y} x2={d.b.x} y2={d.b.y} {...thin} fill="none" strokeDasharray="8 5" />
          <circle cx={d.a.x} cy={d.a.y} r={4 * px} fill={SEL} />
          <circle cx={d.b.x} cy={d.b.y} r={4 * px} fill={SEL} />
        </g>
      );
    }
    case 'path': {
      const nodes = d.nodes;
      const last = nodes[nodes.length - 1];
      const closed = d.target === 'apron';
      const rubber =
        d.cursor && last && !d.dragging
          ? pathD([last, { p: d.cursor }], false)
          : '';
      const width = d.target === 'taxiway' ? 50 : 0;
      const body = pathD(nodes, false);
      return (
        <g>
          {d.target === 'taxiway' && nodes.length > 1 && (
            <path d={body} fill="none" stroke="var(--select)" strokeOpacity={0.22} strokeWidth={width} strokeLinejoin="round" />
          )}
          {closed && nodes.length > 1 && (
            <path d={pathD(d.cursor && !d.dragging ? [...nodes, { p: d.cursor }] : nodes, true)} fill="var(--select)" fillOpacity={0.15} stroke="none" />
          )}
          <path d={body} {...thin} fill="none" strokeWidth={2} />
          {rubber && <path d={rubber} {...thin} fill="none" strokeDasharray="6 4" />}
          {last?.in && <line x1={last.p.x} y1={last.p.y} x2={last.in.x} y2={last.in.y} {...thin} strokeWidth={1} />}
          {last?.out && <line x1={last.p.x} y1={last.p.y} x2={last.out.x} y2={last.out.y} {...thin} strokeWidth={1} />}
          {last?.in && <circle cx={last.in.x} cy={last.in.y} r={3 * px} {...thin} fill="#fff" />}
          {last?.out && <circle cx={last.out.x} cy={last.out.y} r={3 * px} {...thin} fill="#fff" />}
          {nodes.map((n, i) => (
            <rect
              key={i}
              x={n.p.x - 4 * px}
              y={n.p.y - 4 * px}
              width={8 * px}
              height={8 * px}
              {...thin}
              fill={i === 0 && closed && nodes.length >= 3 ? SEL : '#fff'}
            />
          ))}
        </g>
      );
    }
    case 'rect':
      return (
        <rect
          x={Math.min(d.a.x, d.b.x)}
          y={Math.min(d.a.y, d.b.y)}
          width={Math.abs(d.b.x - d.a.x)}
          height={Math.abs(d.b.y - d.a.y)}
          {...thin}
          fill="var(--select)"
          fillOpacity={0.2}
        />
      );
    case 'hotspot':
      return <circle cx={d.center.x} cy={d.center.y} r={d.radius} {...thin} strokeDasharray="6 4" fill="var(--select)" fillOpacity={0.08} />;
  }
}
