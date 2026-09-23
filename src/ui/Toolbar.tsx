import type { ReactNode } from 'react';
import { SYMBOL_NAMES } from '../model/defaults';
import type { SymbolType } from '../model/types';
import { escapeDraft } from '../editor/tools';
import { useStore, type ToolId } from '../store/store';
import {
  ApronIcon,
  BuildingIcon,
  HandIcon,
  HotspotIcon,
  LabelIcon,
  RunwayIcon,
  SelectIcon,
  SymbolIcon,
  TaxiwayIcon,
} from './icons';

interface ToolDef {
  id: ToolId;
  name: string;
  key: string;
  icon: ReactNode;
}

const GROUPS: ToolDef[][] = [
  [
    { id: 'select', name: 'Select', key: 'V', icon: <SelectIcon /> },
    { id: 'hand', name: 'Pan', key: 'H', icon: <HandIcon /> },
  ],
  [
    { id: 'runway', name: 'Runway', key: 'R', icon: <RunwayIcon /> },
    { id: 'taxiway', name: 'Taxiway', key: 'T', icon: <TaxiwayIcon /> },
    { id: 'apron', name: 'Apron', key: 'A', icon: <ApronIcon /> },
    { id: 'building', name: 'Building', key: 'B', icon: <BuildingIcon /> },
  ],
  [
    { id: 'label', name: 'Label', key: 'L', icon: <LabelIcon /> },
    { id: 'symbol', name: 'Symbol', key: 'S', icon: <SymbolIcon /> },
    { id: 'hotspot', name: 'Hot spot', key: 'O', icon: <HotspotIcon /> },
  ],
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  return (
    <nav className="toolbar" aria-label="Tools">
      {GROUPS.map((g, i) => (
        <div className="tool-group" key={i}>
          {g.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tool ${tool === t.id ? 'on' : ''}`}
              onClick={() => {
                escapeDraft();
                setTool(t.id);
              }}
              aria-pressed={tool === t.id}
              aria-label={`${t.name} (${t.key})`}
              data-tip={`${t.name} · ${t.key}`}
            >
              {t.icon}
              <span className="tool-name">{t.name}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Extra choices for tools that need them, floating over the canvas. */
export function ToolOptions() {
  const tool = useStore((s) => s.tool);
  const symbolType = useStore((s) => s.symbolType);
  const setSymbolType = useStore((s) => s.setSymbolType);
  if (tool !== 'symbol') return null;
  return (
    <div className="tool-options" role="radiogroup" aria-label="Symbol type">
      {(Object.keys(SYMBOL_NAMES) as SymbolType[]).map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={symbolType === k}
          className={symbolType === k ? 'on' : undefined}
          onClick={() => setSymbolType(k)}
        >
          {SYMBOL_NAMES[k]}
        </button>
      ))}
    </div>
  );
}
