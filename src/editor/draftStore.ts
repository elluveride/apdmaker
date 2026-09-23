import { create } from 'zustand';
import type { ID, PathNode, Vec } from '../model/types';
import type { SnapResult } from './snapping';

export type Draft =
  | { type: 'runway'; a: Vec; b: Vec; clickMode: boolean }
  | {
      type: 'path';
      target: 'taxiway' | 'apron';
      nodes: PathNode[];
      cursor: Vec | null;
      /** Extending an existing taxiway from one of its ends. */
      extendId?: ID;
      dragging: boolean;
    }
  | { type: 'rect'; a: Vec; b: Vec }
  | { type: 'hotspot'; center: Vec; radius: number };

export interface Readout {
  text: string;
  /** Screen position. */
  at: Vec;
}

interface DraftState {
  draft: Draft | null;
  snap: SnapResult | null;
  readout: Readout | null;
  cursor: Vec | null;
  /** Taxiway whose name is being edited in place on the canvas. */
  renaming: ID | null;
  setDraft: (d: Draft | null) => void;
  setSnap: (s: SnapResult | null) => void;
  setReadout: (r: Readout | null) => void;
  setCursor: (c: Vec | null) => void;
  setRenaming: (id: ID | null) => void;
}

/** Transient, per-gesture state that never enters the undo history. */
export const useDraft = create<DraftState>((set) => ({
  draft: null,
  snap: null,
  readout: null,
  cursor: null,
  renaming: null,
  setDraft: (draft) => set({ draft }),
  setSnap: (snap) => set({ snap }),
  setReadout: (readout) => set({ readout }),
  setCursor: (cursor) => set({ cursor }),
  setRenaming: (renaming) => set({ renaming }),
}));
