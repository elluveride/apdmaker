import { useRef, useState } from 'react';
import { derive } from '../model/derive';
import { pointAtLength } from '../model/geometry';
import { cleanTaxiwayName } from '../model/smooth';
import { useStore } from '../store/store';
import { worldToScreen, type Size } from './camera';
import { useDraft } from './draftStore';

/** Edits a taxiway's name right where it's charted. Enter or clicking away saves; Esc cancels. */
export function RenameBox({ size }: { size: Size }) {
  const id = useDraft((s) => s.renaming);
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const t = id ? doc.features.find((f) => f.id === id) : undefined;
  if (!t || t.kind !== 'taxiway') return null;
  const poly = derive(doc).polys.get(t.id);
  if (!poly || poly.length === 0) return null;
  const at = worldToScreen(camera, size, pointAtLength(poly, poly.length * t.labelT).point);
  return <NameInput key={t.id} id={t.id} initial={t.name} x={at.x} y={at.y} />;
}

function NameInput({ id, initial, x, y }: { id: string; initial: string; x: number; y: number }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) useStore.getState().renameTaxiway(id, value);
    useDraft.getState().setRenaming(null);
  };
  return (
    <input
      className="rename-box"
      aria-label="Taxiway name"
      style={{ left: x, top: y, width: `${Math.max(3, value.length + 2)}ch` }}
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
