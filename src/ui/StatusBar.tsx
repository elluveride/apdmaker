import { TOOL_HINTS } from '../editor/tools';
import { useDraft } from '../editor/draftStore';
import { formatDMS, worldToLatLon } from '../model/sheet';
import { useStore } from '../store/store';
import { FitIcon, GridIcon, MagnetIcon } from './icons';

export function StatusBar() {
  const tool = useStore((s) => s.tool);
  const mode = useStore((s) => s.mode);
  const snap = useStore((s) => s.snap);
  const grid = useStore((s) => s.grid);
  const scale = useStore((s) => s.camera.scale);
  const meta = useStore((s) => s.doc.meta);
  const cursor = useDraft((s) => s.cursor);
  const draft = useDraft((s) => s.draft);
  const s = useStore.getState;

  let hint = mode === 'view' ? 'Scroll to zoom · drag to pan · P returns to editing' : TOOL_HINTS[tool];
  if (draft?.type === 'path' && !draft.dragging) {
    hint =
      draft.target === 'taxiway'
        ? `${draft.nodes.length} point${draft.nodes.length === 1 ? '' : 's'} · click to continue, drag to curve · Enter or click the last point to finish · Esc to stop`
        : `${draft.nodes.length} points · click the first point to close the ramp`;
  } else if (draft?.type === 'runway' && draft.clickMode) {
    hint = 'Click where the other end of the runway should be';
  }

  let coords = '';
  if (cursor) {
    if (meta.refLat !== undefined && meta.refLon !== undefined) {
      const ll = worldToLatLon(cursor, meta.refLat, meta.refLon);
      coords = `${formatDMS(ll.lat, 'lat')}  ${formatDMS(ll.lon, 'lon')}`;
    } else {
      coords = `${Math.round(cursor.x).toLocaleString('en-US')} E  ${Math.round(-cursor.y).toLocaleString('en-US')} N ft`;
    }
  }

  return (
    <footer className="statusbar">
      <span className="hint">{hint}</span>
      <span className="coords mono">{coords}</span>
      <span className="zoom mono" title="Screen pixels per 100 feet">
        {(scale * 100).toFixed(scale * 100 < 10 ? 1 : 0)} px/100 ft
      </span>
      {mode === 'edit' && (
        <>
          <button type="button" className={`status-toggle ${snap ? 'on' : ''}`} onClick={() => s().toggleSnap()} aria-pressed={snap} title="Snap to runways, taxiways and points">
            <MagnetIcon size={15} /> Snap
          </button>
          <button type="button" className={`status-toggle ${grid ? 'on' : ''}`} onClick={() => s().toggleGrid()} aria-pressed={grid} title="Show the grid (and snap to it)">
            <GridIcon size={15} /> Grid
          </button>
        </>
      )}
      <button type="button" className="status-toggle" onClick={() => s().requestFit()} title="Zoom to fit (F)">
        <FitIcon size={15} /> Fit
      </button>
    </footer>
  );
}
