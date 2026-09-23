import type { ReactNode } from 'react';
import type { AirportDoc } from '../model/types';
import { useStore, type ToolId } from '../store/store';
import { ApronIcon, CheckIcon, HotspotIcon, LabelIcon, RunwayIcon, TaxiwayIcon } from './icons';

interface Step {
  title: string;
  detail: string;
  done: (d: AirportDoc) => boolean;
  icon: ReactNode;
  tool?: ToolId;
  action?: 'airport' | 'view';
}

const has = (d: AirportDoc, kind: string) => d.features.some((f) => f.kind === kind);

/** Each step adds one layer of detail, from a bare runway to a finished chart. */
const STEPS: Step[] = [
  {
    title: 'Draw a runway',
    detail: 'Drag from threshold to threshold. Numbers come from the magnetic heading.',
    done: (d) => has(d, 'runway'),
    icon: <RunwayIcon size={18} />,
    tool: 'runway',
  },
  {
    title: 'Connect taxiways',
    detail: 'Click for corners, drag for curves. Hold-short lines appear on their own.',
    done: (d) => has(d, 'taxiway'),
    icon: <TaxiwayIcon size={18} />,
    tool: 'taxiway',
  },
  {
    title: 'Add ramps and buildings',
    detail: 'Outline aprons with the pen, drag rectangles for buildings.',
    done: (d) => has(d, 'area'),
    icon: <ApronIcon size={18} />,
    tool: 'apron',
  },
  {
    title: 'Name the airport',
    detail: 'Identifier, city, field elevation, variation and frequencies.',
    done: (d) => d.meta.name !== 'NEW AIRPORT' && d.meta.frequencies.some((f) => f.value.trim() !== ''),
    icon: <LabelIcon size={18} />,
    action: 'airport',
  },
  {
    title: 'Refine the details',
    detail: 'Precision markings, displaced thresholds, blast pads, hot spots, tower, beacon.',
    done: (d) =>
      has(d, 'hotspot') ||
      d.features.some((f) => f.kind === 'runway' && f.ends.some((e) => e.displaced > 0 || e.stopway > 0 || e.marking === 'precision')),
    icon: <HotspotIcon size={18} />,
    tool: 'hotspot',
  },
];

export function Checklist() {
  const doc = useStore((s) => s.doc);
  const setTool = useStore((s) => s.setTool);
  const setPanel = useStore((s) => s.setPanel);
  const setMode = useStore((s) => s.setMode);
  const done = STEPS.map((s) => s.done(doc));
  const next = done.indexOf(false);

  return (
    <div className="checklist">
      <div className="inspector-head">
        <div className="kind">Nothing selected</div>
        <h2>Build it up in layers</h2>
      </div>
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.title} className={`${done[i] ? 'done' : ''} ${i === next ? 'next' : ''}`}>
            <span className="step-icon">{done[i] ? <CheckIcon size={16} /> : s.icon}</span>
            <div>
              <strong>{s.title}</strong>
              <p>{s.detail}</p>
            </div>
            <button
              type="button"
              className="btn small"
              onClick={() => (s.tool ? setTool(s.tool) : setPanel('airport'))}
            >
              {s.tool ? 'Use tool' : 'Open'}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="btn primary wide" onClick={() => setMode('view')}>
        Preview the finished chart
      </button>
      <p className="muted small">Select anything on the canvas to edit it here. Press ? for shortcuts.</p>
    </div>
  );
}
