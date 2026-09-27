import { useEffect, useState } from 'react';
import { exportJson, exportSheetJpg } from '../io/files';
import { canSaveFiles, type SaveOutcome } from '../io/save';
import { EMBEDDED } from '../env';
import { useStore } from '../store/store';
import { ImageIcon, SaveIcon } from './icons';

/** Whether files can be saved here. Inside claude.ai this is known only once the viewer answers. */
export function useCanSave(): boolean {
  const [ok, setOk] = useState(!EMBEDDED);
  useEffect(() => {
    let live = true;
    void canSaveFiles().then((v) => live && setOk(v));
    return () => {
      live = false;
    };
  }, []);
  return ok;
}

/** Run an export and say how it went. A save the viewer turned down says nothing. */
export async function runExport(fn: () => Promise<SaveOutcome>): Promise<void> {
  const { showToast } = useStore.getState();
  try {
    const { filename, saved } = await fn();
    if (saved) showToast(`Saved ${filename}.`);
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'That did not save.');
  }
}

/** Save and export, pinned to the bottom of the sidebar on every tab. */
export function SaveBar() {
  const canSave = useCanSave();
  const [busy, setBusy] = useState<'json' | 'jpg' | null>(null);
  if (!canSave) return null;

  const run = (which: 'json' | 'jpg', fn: () => Promise<SaveOutcome>) => async () => {
    setBusy(which);
    await runExport(fn);
    setBusy(null);
  };
  const doc = () => useStore.getState().doc;

  return (
    <div className="save-bar">
      <button type="button" className="btn" disabled={busy !== null} onClick={run('json', () => exportJson(doc()))} title="The airport file, to open again later">
        <SaveIcon size={16} /> {busy === 'json' ? 'Saving…' : 'Save .json'}
      </button>
      <button type="button" className="btn" disabled={busy !== null} onClick={run('jpg', () => exportSheetJpg(doc()))} title="The chart sheet as a 300 dpi JPEG">
        <ImageIcon size={16} /> {busy === 'jpg' ? 'Exporting…' : 'Export .jpg'}
      </button>
    </div>
  );
}
