import { useEffect } from 'react';
import { emptyDoc } from '../model/defaults';
import { useStore } from '../store/store';
import { RunwayIcon, TaxiwayIcon } from './icons';

export function Welcome() {
  const show = useStore((s) => s.showWelcome);
  const dismiss = useStore((s) => s.dismissWelcome);
  const loadDoc = useStore((s) => s.loadDoc);
  const setTool = useStore((s) => s.setTool);
  if (!show) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="modal welcome">
        <div className="welcome-art" aria-hidden="true">
          <svg viewBox="0 0 320 120" width="100%" height="120">
            <rect width="320" height="120" fill="#fff" />
            <path d="M40 92 C 90 92, 110 40, 170 40 S 250 52, 290 30" stroke="#bdbdbd" strokeWidth="14" fill="none" />
            <path d="M24 70 L 296 70" stroke="#111" strokeWidth="12" />
            <text x="12" y="74" fontSize="11" fontFamily="Jost, sans-serif" fontWeight="600" transform="rotate(-90 12 70)" textAnchor="middle">
              9
            </text>
            <text x="309" y="74" fontSize="11" fontFamily="Jost, sans-serif" fontWeight="600" transform="rotate(90 309 70)" textAnchor="middle">
              27
            </text>
            <text x="120" y="54" fontSize="10" fontFamily="Jost, sans-serif" fontWeight="600">
              A
            </text>
            <circle cx="170" cy="40" r="4" fill="#fff" stroke="var(--select)" strokeWidth="2" />
            <path d="M150 40 L190 40" stroke="var(--select)" strokeWidth="1.2" />
            <circle cx="150" cy="40" r="2.5" fill="var(--select)" />
            <circle cx="190" cy="40" r="2.5" fill="var(--select)" />
          </svg>
        </div>
        <h1 id="welcome-title">Draw airport diagrams the way the FAA charts them.</h1>
        <p className="lede">You're looking at a sample airport. Poke at it, or start from an empty field.</p>
        <ul className="welcome-points">
          <li>
            <RunwayIcon size={18} />
            <span>
              <strong>Runways are one line.</strong> Drag threshold to threshold; numbers, L/R letters and markings follow the
              magnetic heading.
            </span>
          </li>
          <li>
            <TaxiwayIcon size={18} />
            <span>
              <strong>Taxiways are bezier paths.</strong> Click for corners, drag for curves. Hold-short lines appear where they
              meet a runway.
            </span>
          </li>
          <li>
            <span className="welcome-badge">View</span>
            <span>
              <strong>See the result.</strong> The FAA chart sheet, or the surface view with painted markings and signs.
            </span>
          </li>
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={dismiss}>
            Explore the sample
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              loadDoc(emptyDoc());
              setTool('runway');
              dismiss();
            }}
          >
            Start a blank airport
          </button>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['V', 'Select and edit'],
  ['H / Space-drag', 'Pan'],
  ['R', 'Runway'],
  ['T', 'Taxiway (bezier pen)'],
  ['A', 'Apron / ramp'],
  ['B', 'Building'],
  ['L', 'Label'],
  ['S', 'Symbol'],
  ['O', 'Hot spot'],
  ['Scroll / pinch', 'Zoom'],
  ['F', 'Zoom to fit'],
  ['1 / 2', 'FAA chart / surface style'],
  ['P', 'Toggle edit and view'],
  ['Enter', 'Finish a path, or rename the selected taxiway'],
  ['F2 / double-click a name', 'Rename a taxiway in place'],
  ['Backspace', 'Remove last point / delete selection'],
  ['Esc', 'Finish, deselect, back to Select'],
  ['Shift', 'Runway: heading in tens · pen: 15° angles · building: square'],
  ['Alt-drag handle', 'Break a curve into a corner'],
  ['Double-click path', 'Add a point'],
  ['Double-click point', 'Corner ↔ curve'],
  ['Arrows', 'Nudge 10 ft (Shift: 100 ft)'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Ctrl+D', 'Duplicate'],
];

export function Help() {
  const show = useStore((s) => s.showHelp);
  const setShowHelp = useStore((s) => s.setShowHelp);
  if (!show) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={() => setShowHelp(false)}>
      <div className="modal help" onClick={(e) => e.stopPropagation()}>
        <h1 id="help-title">Shortcuts</h1>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={() => setShowHelp(false)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.setState({ toast: null }), 3600);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      {toast.text}
    </div>
  );
}
