import { create } from 'zustand';
import { emptyDoc, nextTaxiwayName, uid } from '../model/defaults';
import { MAX_SCALE, MIN_SCALE } from '../editor/camera';
import { readReferenceImage } from '../io/reference';
import { scaleDoc } from '../model/featureOps';
import { mid } from '../model/geometry';
import { runwayInfos, runwayLength, runwayTitle } from '../model/runway';
import { sampleDoc } from '../model/sample';
import {
  autoSmoothTaxiway,
  clampExitAngle,
  cleanTaxiwayName,
  HIGH_SPEED_RADIUS,
  runwayExits,
  type TurnStyle,
} from '../model/smooth';
import type { AirportDoc, AirportMeta, Feature, ID, ReferenceImage, SymbolType, Taxiway } from '../model/types';

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
  /** How auto-smooth rounds turns: as drawn, or at the FAA minimum radius. */
  smoothTurns: TurnStyle;
  /** Size of the editing canvas in screen pixels, for placing things in view. */
  viewSize: { w: number; h: number };

  /** Save the current doc as an undo step. */
  checkpoint: () => void;
  /** Change the doc without creating an undo step (mid-drag). */
  mutate: (fn: (d: AirportDoc) => AirportDoc) => void;
  /** Change the doc as one undo step; repeated keys within a second merge. */
  commit: (fn: (d: AirportDoc) => AirportDoc, key?: string) => void;
  undo: () => void;
  redo: () => void;
  loadDoc: (doc: AirportDoc) => void;
  /** A blank airport that keeps the reference image being traced, and the view on it. */
  startBlank: () => void;

  addFeature: (f: Feature) => void;
  updateFeature: <F extends Feature>(id: ID, fn: (f: F) => F, key?: string) => void;
  patchFeature: (id: ID, patch: Partial<Feature>, key?: string) => void;
  deleteFeature: (id: ID) => void;
  duplicateFeature: (id: ID) => void;
  reorder: (id: ID, dir: 1 | -1) => void;
  patchMeta: (patch: Partial<AirportMeta>, key?: string) => void;
  renameTaxiway: (id: ID, name: string) => void;
  autoSmooth: (id: ID) => void;
  /** Set the angle a taxiway leaves the runway at and smooth it to that angle; undefined keeps the drawn angle. */
  setExitAngle: (id: ID, angle: number | undefined) => void;
  setSmoothTurns: (turns: TurnStyle) => void;
  /** Read an image and put it under the drawing to trace over, filling the view. */
  importReference: (file: Blob) => Promise<void>;
  updateReference: (patch: Partial<ReferenceImage>, key?: string) => void;
  removeReference: () => void;
  /** Scale the reference image and everything drawn about runway `id` so it is `length` ft long. */
  scaleToRunway: (id: ID, length: number) => void;
  setViewSize: (size: { w: number; h: number }) => void;

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
const TURNS_KEY = 'apdmaker.smoothTurns';
const REFERENCE_KEY = 'apdmaker.reference.v1';
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

/** The autosaved doc keeps its reference image under a key of its own; put it back, or drop it if it is gone. */
function withSavedReference(doc: AirportDoc): AirportDoc {
  if (!doc.reference) return doc;
  const src = safeRead(REFERENCE_KEY);
  if (src) return { ...doc, reference: { ...doc.reference, src } };
  const { reference: _lost, ...rest } = doc;
  return rest;
}

function initialDoc(): AirportDoc {
  const raw = safeRead(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isAirportDoc(parsed)) return withSavedReference(normalizeDoc(parsed));
    } catch {
      /* fall through to the sample */
    }
  }
  return sampleDoc();
}

const pushPast = (past: AirportDoc[], doc: AirportDoc) => [...past, doc].slice(-HISTORY_LIMIT);

/** Auto-smooth a taxiway in `doc` (the current document, or one with a setting just changed) and report what happened. */
function smoothTaxiway(get: () => State, doc: AirportDoc, id: ID) {
  const res = autoSmoothTaxiway(doc, id, get().smoothTurns);
  const before = doc.features.find((f) => f.id === id);
  if (!res || before?.kind !== 'taxiway') return;
  const label = `Taxiway ${before.name || '—'}`;
  const after = res.doc.features.find((f): f is Taxiway => f.id === id && f.kind === 'taxiway')!;
  const angle = before.exitAngle;
  const missed = angle !== undefined && runwayExits(res.doc, after).some((e) => Math.abs(e.angle - angle) > 1);
  const exit =
    angle === undefined
      ? ''
      : missed
        ? ` Couldn't make it a ${angle}° exit here: the runway or the leg after the exit is too short.`
        : ` Leaves the runway at ${angle}°.`;
  if (JSON.stringify(before.nodes) === JSON.stringify(res.nodes)) {
    if (doc !== get().doc) get().commit(() => doc);
    get().showToast(angle === undefined ? `${label} is already as smooth as it gets.` : `${label}:${exit}`);
    return;
  }
  get().commit(() => res.doc);
  get().select(id);
  // Moving an exit to a new angle moves it on purpose, so how far it moved isn't news.
  const within = res.exits ? '' : `, within ${Math.round(res.deviation)} ft of the old path`;
  const turns = res.radii.length;
  const lo = Math.min(...res.radii);
  const hi = Math.max(...res.radii);
  const radius = lo === hi ? `${lo} ft` : `${lo}–${hi} ft`;
  const shape = res.straight
    ? 'a straight line'
    : `${turns + 1} straight legs and ${turns === 1 ? 'a turn' : `${turns} turns`} (${radius} radius)${within}`;
  const squared = res.squared ? ` ${res.squared === 1 ? 'One end' : 'Both ends'} squared to what ${res.squared === 1 ? 'it meets' : 'they meet'}.` : '';
  const fast = res.leadOffs.find((l) => l.highSpeed);
  const full = HIGH_SPEED_RADIUS.toLocaleString('en-US');
  const short = fast && fast.radius < HIGH_SPEED_RADIUS - 1 ? `; its exit leg is too short for ${full} ft` : '';
  const curve = fast ? ` High-speed exit: curves off the runway centerline on a ${fast.radius.toLocaleString('en-US')} ft radius${short}.` : '';
  const moved = res.reattached
    ? ` ${res.reattached} connected taxiway end${res.reattached === 1 ? '' : 's'} moved with it.`
    : '';
  get().showToast(`${label}: ${res.before} points → ${shape}.${squared}${exit}${curve}${moved} Ctrl+Z undoes it.`);
}

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
  smoothTurns: safeRead(TURNS_KEY) === 'tight' ? 'tight' : 'drawn',
  viewSize: { w: 0, h: 0 },

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

  startBlank: () => {
    const { reference } = get().doc;
    if (!reference) {
      get().loadDoc(emptyDoc());
      get().showToast('Started a blank airport. Undo brings the old one back.');
      return;
    }
    get().commit(() => ({ ...emptyDoc(), reference }));
    set({ selection: { id: null, node: null } });
    get().showToast('Started a blank airport over the same reference image. Undo brings the old one back.');
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

  renameTaxiway: (id, raw) => {
    const name = cleanTaxiwayName(raw).trim();
    const t = get().doc.features.find((f) => f.id === id);
    if (!name || t?.kind !== 'taxiway' || (t.name === name && t.showLabel)) return;
    get().updateFeature(id, (f) => ({ ...f, name, showLabel: true }) as Feature);
  },

  setSmoothTurns: (smoothTurns) => {
    safeWrite(TURNS_KEY, smoothTurns);
    set({ smoothTurns });
  },

  autoSmooth: (id) => smoothTaxiway(get, get().doc, id),

  setExitAngle: (id, angle) => {
    const doc = get().doc;
    const t = doc.features.find((f) => f.id === id);
    if (t?.kind !== 'taxiway') return;
    const exitAngle = angle === undefined ? undefined : clampExitAngle(Math.round(angle));
    const next = { ...doc, features: doc.features.map((f) => (f.id === id ? { ...t, exitAngle } : f)) };
    if (exitAngle !== undefined) smoothTaxiway(get, next, id);
    else if (t.exitAngle !== undefined) get().commit(() => next);
  },

  importReference: async (file) => {
    try {
      const img = await readReferenceImage(file);
      const { camera, viewSize } = get();
      const w = viewSize.w || 1000;
      const h = viewSize.h || 700;
      const reference: ReferenceImage = {
        ...img,
        center: { x: camera.cx, y: camera.cy },
        ftPerPx: (0.9 * Math.min(w / img.pxWidth, h / img.pxHeight)) / camera.scale,
        rotation: 0,
        opacity: 0.6,
        visible: true,
      };
      get().commit((d) => ({ ...d, reference }));
      get().showToast(
        'Reference image added. Draw a runway along one in the picture, then type its real length in the runway’s Real length box to bring everything to scale.',
      );
    } catch (err) {
      get().showToast(err instanceof Error ? err.message : 'Could not use that image.');
    }
  },

  updateReference: (patch, key) => {
    if (!get().doc.reference) return;
    get().commit((d) => (d.reference ? { ...d, reference: { ...d.reference, ...patch } } : d), key && `ref:${key}`);
  },

  removeReference: () => {
    if (!get().doc.reference) return;
    get().commit(({ reference: _gone, ...d }) => d);
    get().showToast('Reference image removed. Ctrl+Z brings it back.');
  },

  scaleToRunway: (id, length) => {
    const { doc, camera } = get();
    const r = doc.features.find((f) => f.id === id);
    if (r?.kind !== 'runway' || !(length > 0)) return;
    const k = length / runwayLength(r);
    if (!Number.isFinite(k) || Math.abs(k - 1) < 1e-6) return;
    const c = mid(r.a, r.b);
    const title = runwayTitle(runwayInfos(doc).get(id));
    get().commit(() => {
      const scaled = scaleDoc(doc, c, k);
      const ref = scaled.reference;
      return ref ? { ...scaled, reference: { ...ref, scaledFrom: { runway: title, length } } } : scaled;
    });
    // Zoom with it, so the picture on screen doesn't jump.
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale / k));
    set({ camera: { cx: c.x + (camera.cx - c.x) * k, cy: c.y + (camera.cy - c.y) * k, scale } });
    const times = k >= 1 ? `${k.toPrecision(3)}×` : `1/${(1 / k).toPrecision(3)}`;
    get().showToast(
      `Runway ${title} is now ${length.toLocaleString('en-US')} ft: the reference image and everything drawn scaled by ${times}. Ctrl+Z undoes it.`,
    );
  },

  setViewSize: (viewSize) => set({ viewSize }),

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

/*
 * Autosave, debounced. A reference image is kept under its own key and only
 * rewritten when it changes, so a large picture never stops the drawing
 * itself from being saved.
 */
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savedReferenceSrc = safeRead(REFERENCE_KEY) ?? '';
let warnedReferenceTooBig = false;

function saveDoc(doc: AirportDoc) {
  const ref = doc.reference;
  safeWrite(STORAGE_KEY, JSON.stringify(ref ? { ...doc, reference: { ...ref, src: '' } } : doc));
  const src = ref?.src ?? '';
  if (src === savedReferenceSrc) return;
  try {
    if (src) localStorage.setItem(REFERENCE_KEY, src);
    else localStorage.removeItem(REFERENCE_KEY);
    savedReferenceSrc = src;
  } catch {
    if (warnedReferenceTooBig) return;
    warnedReferenceTooBig = true;
    useStore
      .getState()
      .showToast(
        'The reference image is too large to keep after a reload. Save the airport file (.json) to keep it.',
      );
  }
}

useStore.subscribe((s, prev) => {
  if (s.doc === prev.doc) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDoc(s.doc), 400);
});

export const selectedFeature = (s: State): Feature | undefined =>
  s.selection.id ? s.doc.features.find((f) => f.id === s.selection.id) : undefined;
