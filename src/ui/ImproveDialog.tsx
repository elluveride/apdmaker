import { useEffect, useMemo, useState } from 'react';
import { derive } from '../model/derive';
import { countAdded, IMPROVE_KINDS, rotationOf, scaleOf, withImprovement, type ImproveKind } from '../model/osmAirport';
import type { AirportDoc, Feature, SymbolType } from '../model/types';
import { osmImprovement, type OsmImprovement } from '../nav/osm';
import { SheetSvg } from '../render/Sheet';
import { useStore } from '../store/store';

const LABELS: Record<ImproveKind, [string, string]> = {
  taxiways: ['taxiway', 'taxiways'],
  aprons: ['apron', 'aprons'],
  buildings: ['building', 'buildings'],
  runways: ['runway', 'runways'],
  symbols: ['tower, beacon, wind cone or helipad', 'towers, beacons, wind cones or helipads'],
};
const SYMBOLS: Record<SymbolType, [string, string]> = {
  tower: ['tower', 'towers'],
  beacon: ['beacon', 'beacons'],
  windcone: ['wind cone', 'wind cones'],
  helipad: ['helipad', 'helipads'],
};

/** "409 taxiways"; symbols by what they are, "1 tower and 6 wind cones". */
function plural(k: ImproveKind, features: Feature[]): string {
  const n = features.length;
  if (k !== 'symbols') return `${n.toLocaleString('en-US')} ${LABELS[k][n === 1 ? 0 : 1]}`;
  const by = new Map<SymbolType, number>();
  for (const f of features) if (f.kind === 'symbol') by.set(f.symbol, (by.get(f.symbol) ?? 0) + 1);
  const parts = [...by].map(([t, c]) => `${c} ${SYMBOLS[t][c === 1 ? 0 : 1]}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '';
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; imp: OsmImprovement };

/** How the real data was lined up with the drawing, in words. */
function fitText(imp: OsmImprovement, doc: AirportDoc): string {
  const { fit } = imp;
  const n = `${fit.runways} runway${fit.runways === 1 ? '' : 's'}`;
  if (fit.kind === 'georeferenced') return `Your ${n} already sit where the real ones are (within ${Math.round(fit.error)} ft), so everything goes where it really is.`;
  if (fit.kind === 'fitted') {
    const T = fit.transform;
    const turned = Math.abs(rotationOf(T)) >= 0.05 ? `turned ${Math.abs(rotationOf(T)).toFixed(1)}°` : '';
    const scaled = scaleOf(T) !== 1 ? `scaled ×${scaleOf(T).toFixed(3)}` : '';
    const how = [turned, scaled, `shifted ${Math.round(Math.hypot(T.tx, T.ty))} ft`].filter(Boolean).join(', ');
    return `Lined up with your ${n}: the real data is ${how}, so it lands on your drawing (within ${Math.round(fit.error)} ft of your centerlines).`;
  }
  const hasRunways = doc.features.some((f) => f.kind === 'runway');
  return hasRunways
    ? "None of your runways match the real ones here, so everything goes where it really is. If that's off, draw one real runway first and it will be lined up with it."
    : 'Everything goes where it really is, by the airport’s position.';
}

/**
 * Add what OpenStreetMap has for this airport and it lacks: taxiways,
 * aprons, buildings, runways and field symbols. Nothing already drawn moves.
 */
export function ImproveDialog() {
  const show = useStore((s) => s.showImprove);
  const doc = useStore((s) => s.doc);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [kinds, setKinds] = useState<Set<ImproveKind>>(new Set());
  const [attempt, setAttempt] = useState(0);
  const s = useStore.getState;

  useEffect(() => {
    if (!show) return;
    let live = true;
    setLoad({ status: 'loading' });
    osmImprovement(s().doc)
      .then((imp) => {
        if (!live) return;
        setLoad({ status: 'ready', imp });
        setKinds(new Set(IMPROVE_KINDS.filter((k) => imp.add[k].length > 0)));
      })
      .catch((e) => live && setLoad({ status: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [show, attempt, s]);

  const preview = useMemo(() => {
    if (load.status !== 'ready') return null;
    const next = withImprovement(doc, load.imp, kinds);
    return { doc: next, derived: derive(next) };
  }, [load, doc, kinds]);

  if (!show) return null;
  const close = () => s().setShowImprove(false);
  const apply = () => {
    if (load.status !== 'ready') return;
    const added = IMPROVE_KINDS.filter((k) => kinds.has(k) && load.imp.add[k].length > 0).map((k) => plural(k, load.imp.add[k]));
    s().commit((d) => withImprovement(d, load.imp, kinds));
    s().requestFit();
    const list = added.length > 1 ? `${added.slice(0, -1).join(', ')} and ${added.at(-1)}` : added[0];
    s().showToast(`Added ${list} from OpenStreetMap. Nothing you had was changed; Ctrl+Z takes it all back.`);
    close();
  };
  const unplaced = doc.meta.refLat === undefined || doc.meta.refLon === undefined;
  const total = load.status === 'ready' ? countAdded(load.imp, kinds) : 0;
  const page = preview?.derived.sheet;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="improve-title" onClick={close}>
      <div className="modal improve" onClick={(e) => e.stopPropagation()}>
        <h1 id="improve-title">Add real detail</h1>
        <p className="muted">
          Taxiways, aprons, buildings and more for {doc.meta.ident || 'this airport'}, from OpenStreetMap. Only what’s missing is added:
          nothing you’ve drawn is moved, reshaped or renamed.
        </p>

        {unplaced ? (
          <>
            <p className="improve-note">Place the airport on the map first, so its real surroundings can be found.</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={() => { close(); s().setMode('map'); }}>
                Go to the map
              </button>
            </div>
          </>
        ) : load.status === 'loading' ? (
          <p className="improve-note" aria-live="polite">
            Asking OpenStreetMap about {doc.meta.ident || 'this airport'}…
          </p>
        ) : load.status === 'error' ? (
          <>
            <p className="improve-note error">{load.message}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={close}>
                Close
              </button>
              <button type="button" className="btn primary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          </>
        ) : (
          <div className="improve-body">
            <div>
              <ul className="improve-kinds">
                {IMPROVE_KINDS.map((k) => {
                  const n = load.imp.add[k].length;
                  const have = load.imp.have[k];
                  return (
                    <li key={k}>
                      <label className={n ? undefined : 'muted'}>
                        <input
                          type="checkbox"
                          checked={kinds.has(k) && n > 0}
                          disabled={!n}
                          onChange={(e) => {
                            const next = new Set(kinds);
                            if (e.target.checked) next.add(k);
                            else next.delete(k);
                            setKinds(next);
                          }}
                        />
                        <span>{n ? plural(k, load.imp.add[k]) : `No new ${LABELS[k][1]}`}</span>
                        {have > 0 && <span className="muted small"> · {have} already drawn</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="muted small">{fitText(load.imp, doc)}</p>
              {load.imp.foundBy === 'area' && (
                <p className="muted small">OpenStreetMap doesn’t tag an airport boundary with {doc.meta.ident || 'this identifier'}, so this is what’s mapped around it.</p>
              )}
              <p className="muted small">
                OpenStreetMap is mapped by volunteers; check it against the real diagram. It’s credited in the chart notes, as its licence asks.
              </p>
            </div>
            {preview && page && (
              <div className="improve-preview" aria-label="The chart with these added">
                <SheetSvg doc={preview.doc} derived={preview.derived} width={200} height={(page.height / page.width) * 200} />
              </div>
            )}
          </div>
        )}

        {!unplaced && load.status === 'ready' && (
          <div className="modal-actions">
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="button" className="btn primary" disabled={!total} onClick={apply}>
              {total ? `Add ${total.toLocaleString('en-US')}` : 'Nothing to add'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
