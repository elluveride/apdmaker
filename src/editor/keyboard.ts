import { useEffect } from 'react';
import { translateFeature } from '../model/featureOps';
import { useStore, type ToolId } from '../store/store';
import { isTyping } from './Canvas';
import { useDraft } from './draftStore';
import { escapeDraft, finishPath, popPathNode, renameSelection } from './tools';

export const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  h: 'hand',
  r: 'runway',
  t: 'taxiway',
  a: 'apron',
  b: 'building',
  l: 'label',
  s: 'symbol',
  o: 'hotspot',
};

function deleteSelection(): void {
  const s = useStore.getState();
  const { id, node } = s.selection;
  if (!id) return;
  const f = s.doc.features.find((x) => x.id === id);
  if (!f) return;
  if (node !== null && (f.kind === 'taxiway' || f.kind === 'area')) {
    const min = f.kind === 'area' ? 3 : 2;
    if (f.nodes.length > min) {
      s.updateFeature(id, (x: typeof f) => ({ ...x, nodes: x.nodes.filter((_, i) => i !== node) }));
      s.select(id, null);
      return;
    }
  }
  s.deleteFeature(id);
}

function nudge(dx: number, dy: number): void {
  const s = useStore.getState();
  const id = s.selection.id;
  if (!id) return;
  s.updateFeature(id, (f) => translateFeature(f, { x: dx, y: dy }), 'nudge');
}

export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        if (s.selection.id) s.duplicateFeature(s.selection.id);
        return;
      }
      if (mod || e.altKey) return;

      if (e.key === 'Escape') {
        if (escapeDraft()) return;
        if (s.showHelp) return s.setShowHelp(false);
        if (s.selection.id) return s.select(null);
        if (s.tool !== 'select') s.setTool('select');
        return;
      }
      if (e.key === 'F2' || (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'BUTTON')) {
        e.preventDefault();
        if (useDraft.getState().draft?.type === 'path') finishPath();
        else if (s.mode === 'edit') renameSelection();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (useDraft.getState().draft?.type === 'path' && popPathNode()) return;
        if (s.mode === 'edit') deleteSelection();
        return;
      }
      if (e.key.startsWith('Arrow') && s.selection.id && s.mode === 'edit') {
        e.preventDefault();
        const step = e.shiftKey ? 100 : 10;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d) nudge(d[0], d[1]);
        return;
      }
      if (e.key === '?') {
        s.setShowHelp(!s.showHelp);
        return;
      }
      if (key === 'f') {
        s.requestFit();
        return;
      }
      if (key === '1') return s.setStyle('chart');
      if (key === '2') return s.setStyle('surface');
      if (key === 'p') return s.setMode(s.mode === 'edit' ? 'view' : 'edit');
      if (s.mode === 'edit' && TOOL_KEYS[key]) {
        escapeDraft();
        s.setTool(TOOL_KEYS[key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

