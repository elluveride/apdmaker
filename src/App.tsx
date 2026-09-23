import { EditorCanvas } from './editor/Canvas';
import { useDraft } from './editor/draftStore';
import { useKeyboard } from './editor/keyboard';
import { SelectionActions } from './editor/SelectionActions';
import { useStore, type PanelTab } from './store/store';
import { AirportPanel } from './ui/AirportPanel';
import { Inspector } from './ui/Inspector';
import { LayersPanel } from './ui/LayersPanel';
import { Help, Toast, Welcome } from './ui/Overlays';
import { StatusBar } from './ui/StatusBar';
import { Toolbar, ToolOptions } from './ui/Toolbar';
import { TopBar } from './ui/TopBar';
import { PrintRoot, Viewer } from './ui/Viewer';
import { RunwayIcon } from './ui/icons';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'inspect', label: 'Inspect' },
  { id: 'layers', label: 'Layers' },
  { id: 'airport', label: 'Airport' },
];

function Panel() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  return (
    <aside className="panel" aria-label="Properties">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={panel === t.id}
            className={panel === t.id ? 'on' : undefined}
            onClick={() => setPanel(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {panel === 'inspect' && <Inspector />}
        {panel === 'layers' && <LayersPanel />}
        {panel === 'airport' && <AirportPanel />}
      </div>
    </aside>
  );
}

function EmptyField() {
  const empty = useStore((s) => s.doc.features.length === 0);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const drawing = useDraft((s) => s.draft !== null);
  if (!empty || drawing) return null;
  return (
    <div className="empty-field">
      <strong>An empty field.</strong>
      {tool === 'runway' ? (
        <span>Drag across the canvas from one runway end to the other.</span>
      ) : (
        <>
          <span>Every airport starts with a runway.</span>
          <button type="button" className="btn primary" onClick={() => setTool('runway')}>
            <RunwayIcon size={16} /> Draw a runway
          </button>
        </>
      )}
    </div>
  );
}

export function App() {
  useKeyboard();
  const mode = useStore((s) => s.mode);
  const panelOpen = useStore((s) => s.panelOpen);
  // Re-render once web fonts arrive so measured text boxes update.
  useStore((s) => s.fontEpoch);

  return (
    <>
      <div className={`app mode-${mode}`}>
        <TopBar />
        <main className={`workspace ${mode === 'edit' && panelOpen ? 'with-panel' : ''}`}>
          {mode === 'edit' ? (
            <>
              <Toolbar />
              <div className="stage">
                <EditorCanvas />
                <ToolOptions />
                <SelectionActions />
                <EmptyField />
              </div>
              {panelOpen && <Panel />}
            </>
          ) : (
            <Viewer />
          )}
        </main>
        <StatusBar />
        <Welcome />
        <Help />
        <Toast />
      </div>
      <PrintRoot />
    </>
  );
}
