import { useEffect, useRef, useState } from 'react';
import { emptyDoc } from '../model/defaults';
import { sampleDoc } from '../model/sample';
import { exportJson, exportSheetPng, exportSheetSvg, exportSurfacePng, readDocFile } from '../io/files';
import { useStore } from '../store/store';
import { Segmented } from './fields';
import { BrandMark, HelpIcon, MenuIcon, PanelIcon, RedoIcon, UndoIcon } from './icons';

export function TopBar() {
  const doc = useStore((s) => s.doc);
  const mode = useStore((s) => s.mode);
  const style = useStore((s) => s.style);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const panelOpen = useStore((s) => s.panelOpen);
  const s = useStore.getState;

  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <span className="brand-name">APD Maker</span>
      </div>
      <button type="button" className="airport-chip" onClick={() => s().setPanel('airport')} title="Airport details">
        <span className="chip-name">{doc.meta.name || 'Untitled airport'}</span>
        <span className="chip-ident mono">{doc.meta.ident}</span>
      </button>

      <div className="topbar-center">
        <Segmented
          value={mode}
          options={[
            { value: 'edit', label: 'Edit', title: 'Draw and edit (P toggles)' },
            { value: 'view', label: 'View', title: 'See the finished result (P toggles)' },
          ]}
          onChange={(m) => s().setMode(m)}
          label="Mode"
        />
        <Segmented
          value={style}
          options={[
            {
              value: 'chart',
              label: (
                <>
                  <span className="wide-only">FAA chart</span>
                  <span className="narrow-only">Chart</span>
                </>
              ),
              title: 'Airport diagram style (1)',
            },
            { value: 'surface', label: 'Surface', title: 'Pavement and markings (2)' },
          ]}
          onChange={(v) => s().setStyle(v)}
          label="Drawing style"
        />
      </div>

      <div className="topbar-right">
        <button type="button" className="icon-btn" disabled={!canUndo} onClick={() => s().undo()} title="Undo (Ctrl+Z)" aria-label="Undo">
          <UndoIcon />
        </button>
        <button type="button" className="icon-btn redo-btn" disabled={!canRedo} onClick={() => s().redo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <RedoIcon />
        </button>
        <FileMenu />
        <button type="button" className="icon-btn help-btn" onClick={() => s().setShowHelp(true)} title="Shortcuts (?)" aria-label="Help">
          <HelpIcon />
        </button>
        {mode === 'edit' && (
          <button
            type="button"
            className={`icon-btn panel-toggle ${panelOpen ? 'on' : ''}`}
            onClick={() => s().setPanelOpen(!panelOpen)}
            title="Show or hide the panel"
            aria-label="Toggle panel"
          >
            <PanelIcon />
          </button>
        )}
      </div>
    </header>
  );
}

function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = useStore.getState;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const run = (fn: () => unknown) => async () => {
    setOpen(false);
    try {
      await fn();
    } catch (err) {
      s().showToast(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="btn menu-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <MenuIcon size={18} /> <span>File</span>
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <button role="menuitem" type="button" onClick={run(() => { s().loadDoc(emptyDoc()); s().showToast('Started a blank airport. Undo brings the old one back.'); })}>
            New blank airport
          </button>
          <button role="menuitem" type="button" onClick={run(() => { s().loadDoc(sampleDoc()); s().showToast('Loaded the sample airport.'); })}>
            Load sample airport
          </button>
          <button role="menuitem" type="button" onClick={() => { setOpen(false); fileRef.current?.click(); }}>
            Open airport file…
          </button>
          <button role="menuitem" type="button" onClick={run(() => exportJson(s().doc))}>
            Save airport file (.apd.json)
          </button>
          <hr />
          <button role="menuitem" type="button" onClick={run(() => exportSheetSvg(s().doc))}>
            Export chart · SVG
          </button>
          <button role="menuitem" type="button" onClick={run(() => exportSheetPng(s().doc))}>
            Export chart · PNG 300 dpi
          </button>
          <button role="menuitem" type="button" onClick={run(() => exportSurfacePng(s().doc))}>
            Export surface view · PNG
          </button>
          <button role="menuitem" type="button" onClick={run(() => s().setPrinting(true))}>
            Print chart…
          </button>
        </div>
      )}
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
            s().loadDoc(await readDocFile(file));
            s().showToast(`Opened ${file.name}.`);
          } catch (err) {
            s().showToast(err instanceof Error ? err.message : 'Could not open that file.');
          }
        }}
      />
    </div>
  );
}
