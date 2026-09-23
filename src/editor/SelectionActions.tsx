import { useStore } from '../store/store';
import { useDraft } from './draftStore';

/** Quick actions for the selected taxiway, floating over the canvas so they work by touch too. */
export function SelectionActions() {
  const tool = useStore((s) => s.tool);
  const selected = useStore((s) => (s.selection.id ? s.doc.features.find((f) => f.id === s.selection.id) : undefined));
  const busy = useDraft((s) => s.draft !== null || s.renaming !== null);
  if (tool !== 'select' || busy || selected?.kind !== 'taxiway') return null;
  return (
    <div className="tool-options selection-actions" role="toolbar" aria-label="Taxiway actions">
      <span className="sel-name">Taxiway {selected.name || '—'}</span>
      <button type="button" onClick={() => useDraft.getState().setRenaming(selected.id)} title="Rename (F2)">
        Rename
      </button>
      <button
        type="button"
        onClick={() => useStore.getState().autoSmooth(selected.id)}
        title="Keep the first and last points; redraw the smoothest curve between them"
      >
        Auto-smooth
      </button>
    </div>
  );
}
