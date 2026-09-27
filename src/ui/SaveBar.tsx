import { useEffect, useRef, useState } from 'react';
import { exportJson, exportSheetJpg } from '../io/files';
import type { SaveOutcome } from '../io/save';
import { useStore } from '../store/store';
import { ImageIcon, SaveIcon } from './icons';

/** Run an export and say how it went: saved, turned down (silently), or handed over to save by hand. */
export async function runExport(fn: () => Promise<SaveOutcome>): Promise<void> {
  const { showToast, setHandOff } = useStore.getState();
  try {
    const { filename, saved, byHand } = await fn();
    if (byHand) setHandOff({ filename, blob: byHand });
    else if (saved) showToast(`Saved ${filename}.`);
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'That did not save.');
  }
}

/** Save and export, pinned to the bottom of the sidebar on every tab. */
export function SaveBar() {
  const [busy, setBusy] = useState<'json' | 'jpg' | null>(null);
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

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * A file this frame can't save, shown so the viewer can: an image to save
 * from its context menu, or text to copy into a file.
 */
export function HandOff() {
  const handOff = useStore((s) => s.handOff);
  const setHandOff = useStore((s) => s.setHandOff);
  const showToast = useStore((s) => s.showToast);
  const [content, setContent] = useState<{ image?: string; text?: string } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setContent(null);
    if (!handOff) return;
    let live = true;
    const { blob } = handOff;
    const load = blob.type.startsWith('image/') ? readAsDataUrl(blob).then((image) => ({ image })) : blob.text().then((text) => ({ text }));
    void load.then((c) => live && setContent(c));
    return () => {
      live = false;
    };
  }, [handOff]);

  if (!handOff) return null;
  const close = () => setHandOff(null);
  const isImage = handOff.blob.type.startsWith('image/');

  // Copy from the selected text first: it works inside the click, even in a sandboxed frame. The
  // clipboard API can wait on a permission prompt a frame never shows, so it only gets a moment.
  const copy = async () => {
    const text = content?.text ?? '';
    textRef.current?.focus();
    textRef.current?.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    if (!copied && navigator.clipboard) {
      const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500));
      copied = await Promise.race([navigator.clipboard.writeText(text).then(() => true, () => false), timeout]);
    }
    showToast(copied ? `Copied. Paste it into a new file named ${handOff.filename}.` : 'Press Ctrl+C (⌘C on a Mac) to copy the selected text.');
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="handoff-title" onClick={close}>
      <div className="modal handoff" onClick={(e) => e.stopPropagation()}>
        <h1 id="handoff-title">Save {handOff.filename}</h1>
        <p className="muted">
          {isImage
            ? 'This page can’t save files by itself here. Right-click the chart and choose Save image as… (on a phone or tablet, press and hold it).'
            : `This page can’t save files by itself here. Copy the airport file and paste it into a new file named ${handOff.filename}; File → Open airport file… loads it again.`}
        </p>
        {!content ? (
          <p className="muted small">Preparing…</p>
        ) : isImage ? (
          <img className="handoff-image" src={content.image} alt={`Airport diagram, ${handOff.filename}`} />
        ) : (
          <textarea ref={textRef} className="handoff-text" readOnly value={content.text} onFocus={(e) => e.currentTarget.select()} />
        )}
        <div className="modal-actions">
          {!isImage && (
            <button type="button" className="btn" disabled={!content} onClick={copy}>
              Copy
            </button>
          )}
          <button type="button" className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
