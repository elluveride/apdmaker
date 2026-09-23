import { useRef, useState } from 'react';
import { derive } from '../model/derive';
import { cleanTaxiwayName } from '../model/smooth';
import { featureTitle } from '../model/featureOps';
import type { Feature, FeatureKind } from '../model/types';
import { useStore } from '../store/store';
import { ApronIcon, BuildingIcon, EyeIcon, HotspotIcon, LabelIcon, RunwayIcon, SymbolIcon, TaxiwayIcon } from './icons';

const GROUPS: { title: string; match: (f: Feature) => boolean }[] = [
  { title: 'Runways', match: (f) => f.kind === 'runway' },
  { title: 'Taxiways', match: (f) => f.kind === 'taxiway' },
  { title: 'Aprons & areas', match: (f) => f.kind === 'area' },
  { title: 'Symbols', match: (f) => f.kind === 'symbol' },
  { title: 'Hot spots', match: (f) => f.kind === 'hotspot' },
  { title: 'Labels', match: (f) => f.kind === 'label' },
];

function KindIcon({ f }: { f: Feature }) {
  const kind: FeatureKind = f.kind;
  switch (kind) {
    case 'runway':
      return <RunwayIcon size={16} />;
    case 'taxiway':
      return <TaxiwayIcon size={16} />;
    case 'area':
      return f.kind === 'area' && f.areaType === 'building' ? <BuildingIcon size={16} /> : <ApronIcon size={16} />;
    case 'symbol':
      return <SymbolIcon size={16} />;
    case 'hotspot':
      return <HotspotIcon size={16} />;
    case 'label':
      return <LabelIcon size={16} />;
  }
}

function RenameField({ id, initial, onDone }: { id: string; initial: string; onDone: () => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) useStore.getState().renameTaxiway(id, value);
    onDone();
  };
  return (
    <input
      className="layer-rename"
      aria-label="Taxiway name"
      value={value}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(cleanTaxiwayName(e.target.value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}

export function LayersPanel() {
  const [editing, setEditing] = useState<string | null>(null);
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const patchFeature = useStore((s) => s.patchFeature);
  const infos = derive(doc).infos;

  if (doc.features.length === 0) {
    return <p className="muted small pad">Nothing drawn yet. Start with the runway tool (R).</p>;
  }

  return (
    <div className="layers">
      {GROUPS.map((g) => {
        // Topmost first, like most design tools.
        const items = doc.features.filter(g.match).reverse();
        if (items.length === 0) return null;
        return (
          <div key={g.title} className="layer-group">
            <h3>
              {g.title} <span className="count">{items.length}</span>
            </h3>
            <ul>
              {items.map((f) => (
                <li key={f.id} className={`${selection.id === f.id ? 'selected' : ''} ${f.hidden ? 'hidden' : ''}`}>
                  {editing === f.id && f.kind === 'taxiway' ? (
                    <RenameField id={f.id} initial={f.name} onDone={() => setEditing(null)} />
                  ) : (
                    <button
                      type="button"
                      className="layer-main"
                      onClick={() => select(f.id)}
                      onDoubleClick={() => f.kind === 'taxiway' && setEditing(f.id)}
                      title={f.kind === 'taxiway' ? 'Double-click to rename' : undefined}
                    >
                      <KindIcon f={f} />
                      <span>{featureTitle(f, infos)}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => patchFeature(f.id, { hidden: !f.hidden })}
                    title={f.hidden ? 'Show' : 'Hide'}
                    aria-label={f.hidden ? 'Show' : 'Hide'}
                  >
                    <EyeIcon size={16} off={f.hidden} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
