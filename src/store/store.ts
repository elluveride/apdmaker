import { create } from 'zustand';
import { emptyDoc, nextTaxiwayName, uid } from '../model/defaults';
import { sampleDoc } from '../model/sample';
import type { AirportDoc, AirportMeta, Feature, ID, SymbolType } from '../model/types';

export type ToolId =
  | 'select'
  | 'hand'
  | 'runway'
  | 'taxiway'
  | 'apron'
  | 'building'
  | 'label'
  | 'symbol'
  | 'hotspot';

export type Mode = 'edit' | 'view';
export type RenderStyle = 'chart' | 'surface';
export type PanelTab = 'inspect' | 'layers' | 'airport';

/** World point at the center of the canvas, and screen pixels per foot. */
export interface Camera {
  cx: number;
  cy: number;
  scale: number;
}

export interface Selection {
  id: ID | null;
  /** Selected anchor within a path feature. */
  node: number | null;
}

interface State {
  doc: AirportDoc;
  past: AirportDoc[];
  future: AirportDoc[];
  lastKey: string | null;
  lastAt: number;
  selection: Selection;
  tool: ToolId;
  symbolType: SymbolType;
  mode: Mode;
  style: RenderStyle;
  snap: boolean;
  grid: boolean;
  camera: Camera;
  /** Bumped to ask canvases to zoom to fit. */
  fitRequest: number;
  panel: PanelTab;
  panelOpen: boolean;
  showHelp: boolean;
  showWelcome: boolean;
  /** Bumped to ask the inspector to focus the selected label's text. */
  focusTick: number;
  toast: { id: number; text: string } | null;
  /** Bumped when web fonts finish loading so text boxes re-measure. */
  fontEpoch: number;
  printing: boolean;

  /** Save the current doc as an undo step. */
  checkpoint: () => void;
  /** Change the doc without creating an undo step (mid-drag). */
  mutate: (fn: (d: AirportDoc) => AirportDoc) => void;
  /** Change the doc as one undo step; repeated keys within a second merge. */
  commit: (fn: (d: AirportDoc) => AirportDoc, key?: string) => void;
  undo: () => void;
  redo: () => void;
  loadDoc: (doc: AirportDoc) => void;

  addFeature: (f: Feature) => void;
  updateFeature: <F extends Feature>(id: ID, fn: (f: F) => F, key?: string) => void;
  patchFeature: (id: ID, patch: Partial<Feature>, key?: string) => void;
  deleteFeature: (id: ID) => void;
  duplicateFeature: (id: ID) => void;
  reorder: (id: ID, dir: 1 | -1) => void;
  patchMeta: (patch: Partial<AirportMeta>, key?: string) => void;

  select: (id: ID | null, node?: number | null) => void;
  setTool: (tool: ToolId) => void;
  setSymbolType: (s: SymbolType) => void;
  setMode: (m: Mode) => void;
  setStyle: (s: RenderStyle) => void;
  setCamera: (c: Camera) => void;
  requestFit: () => void;
  setPanel: (p: PanelTab) => void;
  setPanelOpen: (open: boolean) => void;
  toggleSnap: () => void;
  toggleGrid: () => void;
  setShowHelp: (v: boolean) => void;
  dismissWelcome: () => void;
  requestFocusText: () => void;
  showToast: (text: string) => void;
  bumpFonts: () => void;
  setPrinting: (v: boolean) => void;
}

const STORAGE_KEY = 'apdmaker.doc.v1';
const WELCOME_KEY = 'apdmaker.welcomed';
const HISTORY_LIMIT = 200;

function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the app still works, it just won't remember */
  }
}

export function isAirportDoc(x: unknown): x is AirportDoc {
  const d = x as AirportDoc;
  return !!d && d.version === 1 && typeof d.meta === 'object' && Array.isArray(d.features);
}

/** Fill in fields added after a doc was saved. */
export function normalizeDoc(d: AirportDoc): AirportDoc {
  return { ...d, meta: { ...emptyDoc().meta, ...d.meta } };
}

function initialDoc(): AirportDoc {
  const raw = safeRead(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isAirportDoc(parsed)) return normalizeDoc(parsed);
    } catch {
      /* fall through to the sample */
    }
  }
  return sampleDoc();
}

const pushPast = (past: AirportDoc[], doc: AirportDoc) => [...past, doc].slice(-HISTORY_LIMIT);

export const useStore = create<State>((set, get) => ({
  doc: initialDoc(),
  past: [],
  future: [],
  lastKey: null,
  lastAt: 0,
  selection: { id: null, node: null },
  tool: 'select',
  symbolType: 'tower',
  mode: 'edit',
  style: 'chart',
  snap: true,
  grid: true,
  camera: { cx: 0, cy: 0, scale: 0.08 },
  fitRequest: 0,
  panel: 'inspect',
  panelOpen: typeof window === 'undefined' || window.innerWidth > 760,
  showHelp: false,
  showWelcome: safeRead(WELCOME_KEY) !== '1',
  focusTick: 0,
  toast: null,
  fontEpoch: 0,
  printing: false,

  checkpoint: () =>
    set((s) => ({ past: pushPast(s.past, s.doc), future: [], lastKey: null })),

  mutate: (fn) => set((s) => ({ doc: fn(s.doc) })),

  commit: (fn, key) =>
    set((s) => {
      const now = Date.now();
      const merge = key !== undefined && key === s.lastKey && now - s.lastAt < 1000;
      return {
        doc: fn(s.doc),
        past: merge ? s.past : pushPast(s.past, s.doc),
        future: [],
        lastKey: key ?? null,
        lastAt: now,
      };
    }),

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return {};
      return {
        doc: prev,
        past: s.past.slice(0, -1),
        future: [s.doc, ...s.future],
        lastKey: null,
        selection: keepSelection(prev, s.selection),
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return {};
      return {
        doc: next,
        past: pushPast(s.past, s.doc),
        future: s.future.slice(1),
        lastKey: null,
        selection: keepSelection(next, s.selection),
      };
    }),

  loadDoc: (doc) => {
    get().commit(() => doc);
    set({ selection: { id: null, node: null }, fitRequest: get().fitRequest + 1 });
  },

  addFeature: (f) => {
    get().commit((d) => ({ ...d, features: [...d.features, f] }));
    set({ selection: { id: f.id, node: null } });
  },

  updateFeature: (id, fn, key) =>
    get().commit(
      (d) => ({
        ...d,
        features: d.features.map((f) => (f.id === id ? fn(f as never) : f)),
      }),
      key,
    ),

  patchFeature: (id, patch, key) =>
    get().updateFeature(id, (f) => ({ ...f, ...patch }) as Feature, key),

  deleteFeature: (id) => {
    get().commit((d) => ({ ...d, features: d.features.filter((f) => f.id !== id) }));
    if (get().selection.id === id) set({ selection: { id: null, node: null } });
  },

  duplicateFeature: (id) => {
    const src = get().doc.features.find((f) => f.id === id);
    if (!src) return;
    const copy = offsetFeature(structuredClone(src), 200);
    copy.id = uid();
    if (copy.kind === 'taxiway') copy.name = nextTaxiwayName(get().doc.features);
    get().addFeature(copy);
  },

  reorder: (id, dir) =>
    get().commit((d) => {
      const i = d.features.findIndex((f) => f.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.features.length) return d;
      const features = d.features.slice();
      [features[i], features[j]] = [features[j], features[i]];
      return { ...d, features };
    }),

  patchMeta: (patch, key) => get().commit((d) => ({ ...d, meta: { ...d.meta, ...patch } }), key),

  select: (id, node = null) => set({ selection: { id, node } }),
  setTool: (tool) => set({ tool }),
  setSymbolType: (symbolType) => set({ symbolType }),
  setMode: (mode) => set({ mode }),
  setStyle: (style) => set({ style }),
  setCamera: (camera) => set({ camera }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  setPanel: (panel) => set({ panel, panelOpen: true }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  toggleSnap: () => set((s) => ({ snap: !s.snap })),
  toggleGrid: () => set((s) => ({ grid: !s.grid })),
  setShowHelp: (showHelp) => set({ showHelp }),
  dismissWelcome: () => {
    safeWrite(WELCOME_KEY, '1');
    set({ showWelcome: false });
  },
  requestFocusText: () => set((s) => ({ focusTick: s.focusTick + 1, panel: 'inspect', panelOpen: true })),
  showToast: (text) => set({ toast: { id: Date.now(), text } }),
  bumpFonts: () => set((s) => ({ fontEpoch: s.fontEpoch + 1 })),
  setPrinting: (printing) => set({ printing }),
}));

function keepSelection(doc: AirportDoc, sel: Selection): Selection {
  return doc.features.some((f) => f.id === sel.id) ? sel : { id: null, node: null };
}

function offsetFeature(f: Feature, d: number): Feature {
  const move = (p: { x: number; y: number }) => ({ x: p.x + d, y: p.y + d });
  switch (f.kind) {
    case 'runway':
      return { ...f, a: move(f.a), b: move(f.b) };
    case 'taxiway':
    case 'area':
      return {
        ...f,
        nodes: f.nodes.map((n) => ({ ...n, p: move(n.p), in: n.in && move(n.in), out: n.out && move(n.out) })),
      };
    case 'label':
    case 'symbol':
      return { ...f, p: move(f.p) };
    case 'hotspot':
      return { ...f, center: move(f.center) };
  }
}

/* Autosave, debounced. */
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.doc === prev.doc) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => safeWrite(STORAGE_KEY, JSON.stringify(s.doc)), 400);
});

export const selectedFeature = (s: State): Feature | undefined =>
  s.selection.id ? s.doc.features.find((f) => f.id === s.selection.id) : undefined;
