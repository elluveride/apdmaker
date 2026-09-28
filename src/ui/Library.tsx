import { useRef, useState } from 'react';
import { readDocFile } from '../io/files';
import { emptyDoc } from '../model/defaults';
import { sampleDoc } from '../model/sample';
import { useStore } from '../store/store';

/** "5 min ago", "yesterday", or a date. */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Every airport made here: open one, start another, copy or delete. */
export function Library() {
  const show = useStore((s) => s.showLibrary);
  const library = useStore((s) => s.library);
  const current = useStore((s) => s.airportId);
  const [confirming, setConfirming] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!show) return null;
  const s = useStore.getState;
  const close = () => {
    setConfirming(null);
    s().setShowLibrary(false);
  };
  const open = (id: string) => {
    s().openAirport(id);
    close();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="library-title" onClick={close}>
      <div className="modal library" onClick={(e) => e.stopPropagation()}>
        <h1 id="library-title">My airports</h1>
        <p className="muted">
          Everything here is kept in this browser. Save an airport file (.json) to keep a copy anywhere else.
        </p>
        <div className="btn-row library-actions">
          <button type="button" className="btn primary" onClick={() => { s().addAirport(emptyDoc(), 'Started a new airport.'); close(); }}>
            New blank airport
          </button>
          <button type="button" className="btn" onClick={() => { s().setMode('map'); close(); }}>
            From a real airport…
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Open a file…
          </button>
          <button type="button" className="btn" onClick={() => { s().addAirport(sampleDoc(), 'Added a copy of the sample airport.'); close(); }}>
            Sample
          </button>
        </div>
        <ul className="library-list">
          {library.map((a) => (
            <li key={a.id} className={a.id === current ? 'current' : undefined}>
              <button type="button" className="library-open" onClick={() => open(a.id)} title={a.id === current ? 'Open now' : 'Open'}>
                <span className="library-ident mono">{a.ident || '—'}</span>
                <span className="library-name">
                  <strong>{a.name || 'Untitled airport'}</strong>
                  <span className="muted small">
                    {[a.city, a.lat !== undefined ? 'on the map' : 'no location yet', ago(a.updated)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {a.id === current && <span className="library-badge">Open</span>}
              </button>
              <span className="library-row-actions">
                <button type="button" className="btn tight" onClick={() => s().duplicateAirport(a.id)}>
                  Copy
                </button>
                {confirming === a.id ? (
                  <button type="button" className="btn tight danger" onClick={() => { s().deleteAirport(a.id); setConfirming(null); }}>
                    Delete for good
                  </button>
                ) : (
                  <button type="button" className="btn tight" onClick={() => setConfirming(a.id)}>
                    Delete
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={close}>
            Done
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              s().addAirport(await readDocFile(file), `Opened ${file.name} as a new airport.`);
              close();
            } catch (err) {
              s().showToast(err instanceof Error ? err.message : 'Could not open that file.');
            }
          }}
        />
      </div>
    </div>
  );
}
