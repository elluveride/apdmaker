import {
  add,
  bearing,
  cornerNode,
  dirFromBearing,
  dist,
  insertNode,
  moveHandle,
  mul,
  nearestOnPolyline,
  reverseNodes,
  smoothNode,
  sub,
} from '../model/geometry';
import { derive } from '../model/derive';
import {
  newArea,
  newHotspot,
  newLabel,
  newRunway,
  newSymbol,
  newTaxiway,
  nextHotspotLabel,
  nextTaxiwayName,
  rectNodes,
} from '../model/defaults';
import { replaceFeature, translateFeature } from '../model/featureOps';
import { formatNumber, headingNumber, runwayTitle, toMagnetic, toTrue } from '../model/runway';
import type { Feature, ID, PathNode, Runway, Vec } from '../model/types';
import { useStore, type ToolId } from '../store/store';
import { useDraft } from './draftStore';
import { gridStep, snapPoint, type SnapResult } from './snapping';

export interface PointerCtx {
  world: Vec;
  /** Canvas-relative screen position. */
  screen: Vec;
  target: Element | null;
  shift: boolean;
  alt: boolean;
  /** World units per screen pixel. */
  px: number;
}

type Handle =
  | { type: 'rwy'; id: ID; end: 0 | 1 }
  | { type: 'node' | 'hin' | 'hout'; id: ID; index: number }
  | { type: 'hsr' | 'hsl' | 'twl'; id: ID };

type Gesture =
  | { kind: 'move'; orig: Feature; start: Vec; startScreen: Vec; started: boolean }
  | { kind: 'handle'; h: Handle; orig: Feature; startScreen: Vec; started: boolean }
  | { kind: 'runway'; startScreen: Vec }
  | { kind: 'pen'; startScreen: Vec }
  | { kind: 'rect'; startScreen: Vec }
  | { kind: 'hotspot'; startScreen: Vec };

let gesture: Gesture | null = null;

const store = () => useStore.getState();
const draftStore = () => useDraft.getState();
const DRAG_PX = 3;

export const TOOL_HINTS: Record<ToolId, string> = {
  select: 'Click to select · drag to move · drag handles to reshape · double-click a path to add a point',
  hand: 'Drag to pan · scroll to zoom',
  runway: 'Drag from one threshold to the other · Shift locks the heading to the runway number',
  taxiway: 'Click for a corner, click-drag for a curve · Enter or click the last point to finish · Backspace removes a point',
  apron: 'Click points around the ramp, drag for curves · click the first point to close',
  building: 'Drag a rectangle · Shift for a square · reshape it afterwards with the select tool',
  label: 'Click to place a label, then type its text in the panel',
  symbol: 'Click to place the chosen symbol',
  hotspot: 'Drag from the center outward to size the hot spot circle',
};

function snapOpts(ctx: PointerCtx, exclude?: ID) {
  const s = store();
  return {
    radius: 10 * ctx.px,
    enabled: s.snap,
    exclude,
    grid: s.grid ? gridStep(1 / ctx.px) / 10 : null,
  };
}

function snapAt(ctx: PointerCtx, exclude?: ID): SnapResult {
  const { doc } = store();
  return snapPoint(ctx.world, doc, derive(doc), snapOpts(ctx, exclude));
}

/** Keep runway headings on whole magnetic degrees (or tens with Shift) and lengths on 10 ft. */
export function constrainRunwayEnd(fixed: Vec, p: Vec, magVar: number, shift: boolean): Vec {
  const L = dist(fixed, p);
  if (L < 1) return p;
  const step = shift ? 10 : 1;
  const mag = toMagnetic(bearing(fixed, p), magVar);
  const snapped = toTrue(Math.round(mag / step) * step, magVar);
  return add(fixed, mul(dirFromBearing(snapped), Math.round(L / 10) * 10));
}

function runwayReadout(a: Vec, b: Vec, screen: Vec, title?: string) {
  const { magVar, leadingZero } = store().doc.meta;
  const L = dist(a, b);
  const mag = toMagnetic(bearing(a, b), magVar);
  const n0 = formatNumber(headingNumber(mag), leadingZero);
  const n1 = formatNumber(headingNumber(mag + 180), leadingZero);
  draftStore().setReadout({
    text: `${title ?? `RWY ${n0}-${n1}`} · ${Math.round(L).toLocaleString('en-US')} ft · ${mag.toFixed(1).padStart(5, '0')}° mag`,
    at: screen,
  });
}

export function defaultRunwayWidth(length: number): number {
  if (length >= 7000) return 150;
  if (length >= 4500) return 100;
  return 75;
}

function defaultTaxiwayWidth(): number {
  const runways = store().doc.features.filter((f): f is Runway => f.kind === 'runway');
  return runways.some((r) => r.width >= 150) ? 75 : 50;
}

function parseHandle(el: Element | null): Handle | null {
  const raw = el?.closest('[data-handle]')?.getAttribute('data-handle');
  if (!raw) return null;
  const [type, id, n] = raw.split('|');
  if (type === 'rwy') return { type, id, end: n === '1' ? 1 : 0 };
  if (type === 'node' || type === 'hin' || type === 'hout') return { type, id, index: Number(n) };
  if (type === 'hsr' || type === 'hsl' || type === 'twl') return { type, id };
  return null;
}

const featureIdAt = (el: Element | null): ID | null =>
  el?.closest('[data-id]')?.getAttribute('data-id') ?? null;

const findFeature = (id: ID) => store().doc.features.find((f) => f.id === id);

const movedEnough = (g: { startScreen: Vec }, ctx: PointerCtx) => dist(g.startScreen, ctx.screen) > DRAG_PX;

/* ------------------------------------------------------------------ */
/* Pointer entry points. Return 'pan' to let the canvas pan instead.   */
/* ------------------------------------------------------------------ */

export function pointerDown(ctx: PointerCtx): 'pan' | void {
  const s = store();
  switch (s.tool) {
    case 'hand':
      return 'pan';
    case 'select':
      return selectDown(ctx);
    case 'runway':
      return runwayDown(ctx);
    case 'taxiway':
    case 'apron':
      return penDown(ctx, s.tool);
    case 'building':
    case 'hotspot': {
      const p = snapAt(ctx).p;
      draftStore().setDraft(s.tool === 'building' ? { type: 'rect', a: p, b: p } : { type: 'hotspot', center: p, radius: 0 });
      gesture = { kind: s.tool === 'building' ? 'rect' : 'hotspot', startScreen: ctx.screen };
      return;
    }
    case 'label': {
      s.addFeature(newLabel(snapAt(ctx).p, 'LABEL'));
      s.setTool('select');
      // After the click's own focus handling, or the canvas steals focus back.
      setTimeout(() => store().requestFocusText(), 0);
      return;
    }
    case 'symbol':
      s.addFeature(newSymbol(snapAt(ctx).p, s.symbolType));
      return;
  }
}

export function pointerMove(ctx: PointerCtx): void {
  const s = store();
  const d = draftStore();
  d.setCursor(ctx.world);

  if (!gesture) {
    // Hover feedback: where would a click land?
    const draws = s.tool !== 'select' && s.tool !== 'hand';
    const draft = d.draft;
    if (draft?.type === 'path') {
      const snap = snapAt(ctx);
      const last = draft.nodes[draft.nodes.length - 1];
      const p = ctx.shift && last ? constrainAngle(last.p, snap.p, 15) : snap.p;
      d.setDraft({ ...draft, cursor: p });
      d.setSnap(snap.kind ? snap : null);
    } else if (draft?.type === 'runway' && draft.clickMode) {
      const b = runwayEndFor(draft.a, ctx);
      d.setDraft({ ...draft, b });
      runwayReadout(draft.a, b, ctx.screen);
    } else {
      const snap = draws ? snapAt(ctx) : null;
      d.setSnap(snap?.kind ? snap : null);
    }
    return;
  }

  switch (gesture.kind) {
    case 'move': {
      if (!gesture.started) {
        if (!movedEnough(gesture, ctx)) return;
        gesture.started = true;
        s.checkpoint();
      }
      const moved = translateFeature(gesture.orig, sub(ctx.world, gesture.start));
      s.mutate((doc) => replaceFeature(doc, moved));
      return;
    }
    case 'handle':
      return handleDrag(gesture, ctx);
    case 'runway': {
      const draft = d.draft;
      if (draft?.type !== 'runway') return;
      const b = runwayEndFor(draft.a, ctx);
      d.setDraft({ ...draft, b });
      runwayReadout(draft.a, b, ctx.screen);
      return;
    }
    case 'pen': {
      const draft = d.draft;
      if (draft?.type !== 'path' || !draft.dragging || !movedEnough(gesture, ctx)) return;
      const nodes = draft.nodes.slice();
      const last = nodes[nodes.length - 1];
      const out = ctx.shift ? constrainAngle(last.p, ctx.world, 15) : ctx.world;
      nodes[nodes.length - 1] = { p: last.p, out, in: sub(last.p, sub(out, last.p)), smooth: true };
      d.setDraft({ ...draft, nodes, cursor: out });
      return;
    }
    case 'rect': {
      const draft = d.draft;
      if (draft?.type !== 'rect') return;
      let b = snapAt(ctx).p;
      if (ctx.shift) {
        const side = Math.max(Math.abs(b.x - draft.a.x), Math.abs(b.y - draft.a.y));
        b = { x: draft.a.x + Math.sign(b.x - draft.a.x) * side, y: draft.a.y + Math.sign(b.y - draft.a.y) * side };
      }
      d.setDraft({ ...draft, b });
      d.setReadout({
        text: `${Math.round(Math.abs(b.x - draft.a.x))} × ${Math.round(Math.abs(b.y - draft.a.y))} ft`,
        at: ctx.screen,
      });
      return;
    }
    case 'hotspot': {
      const draft = d.draft;
      if (draft?.type !== 'hotspot') return;
      const radius = dist(draft.center, ctx.world);
      d.setDraft({ ...draft, radius });
      d.setReadout({ text: `radius ${Math.round(radius)} ft`, at: ctx.screen });
      return;
    }
  }
}

export function pointerUp(ctx: PointerCtx): void {
  const s = store();
  const d = draftStore();
  const g = gesture;
  gesture = null;
  d.setReadout(null);
  if (!g) return;

  switch (g.kind) {
    case 'runway': {
      const draft = d.draft;
      if (draft?.type !== 'runway') return;
      if (!movedEnough(g, ctx)) {
        d.setDraft({ ...draft, clickMode: true });
        return;
      }
      commitRunway(draft.a, draft.b, ctx.px);
      return;
    }
    case 'pen': {
      const draft = d.draft;
      if (draft?.type === 'path') d.setDraft({ ...draft, dragging: false });
      return;
    }
    case 'rect': {
      const draft = d.draft;
      d.setDraft(null);
      if (draft?.type !== 'rect') return;
      const w = Math.abs(draft.b.x - draft.a.x);
      const h = Math.abs(draft.b.y - draft.a.y);
      if (w < 10 || h < 10 || w / ctx.px < 4 || h / ctx.px < 4) return;
      s.addFeature(newArea(rectNodes(draft.a, draft.b), 'building'));
      return;
    }
    case 'hotspot': {
      const draft = d.draft;
      d.setDraft(null);
      if (draft?.type !== 'hotspot') return;
      const radius = Math.max(draft.radius, 20 * ctx.px, 100);
      s.addFeature(newHotspot(draft.center, radius, nextHotspotLabel(s.doc.features)));
      return;
    }
    case 'move':
    case 'handle':
      d.setSnap(null);
      return;
  }
}

export function doubleClick(ctx: PointerCtx): void {
  const s = store();
  if (s.tool !== 'select') return;
  const h = parseHandle(ctx.target);
  if (h?.type === 'node') {
    toggleSmooth(h.id, h.index);
    return;
  }
  if (h?.type === 'twl') {
    draftStore().setRenaming(h.id);
    return;
  }
  const id = featureIdAt(ctx.target);
  const f = id ? findFeature(id) : undefined;
  if (!f) return;
  if (f.kind === 'taxiway' && ctx.target?.closest('[data-role="name"]')) {
    s.select(f.id);
    draftStore().setRenaming(f.id);
    return;
  }
  if (f.kind === 'taxiway' || f.kind === 'area') {
    const closed = f.kind === 'area' || f.closed;
    const poly = derive(s.doc).polys.get(f.id);
    const hit = poly && nearestOnPolyline(poly, ctx.world);
    if (!hit || hit.dist > Math.max(20 * ctx.px, f.kind === 'taxiway' ? f.width : 0)) return;
    const t = Math.min(0.98, Math.max(0.02, hit.t));
    s.updateFeature(f.id, (x: typeof f) => ({ ...x, nodes: insertNode(x.nodes, closed, hit.segIndex, t) }));
    s.select(f.id, hit.segIndex + 1);
  } else if (f.kind === 'label') {
    s.requestFocusText();
  }
}

/* ------------------------------------------------------------------ */
/* Select tool                                                         */
/* ------------------------------------------------------------------ */

function selectDown(ctx: PointerCtx): 'pan' | void {
  const s = store();
  const h = parseHandle(ctx.target);
  if (h) {
    const orig = findFeature(h.id);
    if (!orig) return;
    if (h.type === 'node') s.select(h.id, h.index);
    gesture = { kind: 'handle', h, orig, startScreen: ctx.screen, started: false };
    return;
  }
  const id = featureIdAt(ctx.target);
  const f = id ? findFeature(id) : undefined;
  if (f) {
    if (s.selection.id !== f.id) s.select(f.id);
    else if (s.selection.node !== null) s.select(f.id, null);
    gesture = { kind: 'move', orig: f, start: ctx.world, startScreen: ctx.screen, started: false };
    return;
  }
  s.select(null);
  return 'pan';
}

function handleDrag(g: Extract<Gesture, { kind: 'handle' }>, ctx: PointerCtx) {
  const s = store();
  if (!g.started) {
    if (!movedEnough(g, ctx)) return;
    g.started = true;
    s.checkpoint();
  }
  const d = draftStore();
  const { h, orig } = g;
  let next: Feature | null = null;

  if (h.type === 'rwy' && orig.kind === 'runway') {
    const fixed = h.end === 0 ? orig.b : orig.a;
    const snap = snapAt(ctx, orig.id);
    const p =
      snap.kind === 'endpoint' || snap.kind === 'node' || !s.snap
        ? snap.p
        : constrainRunwayEnd(fixed, snap.p, s.doc.meta.magVar, ctx.shift);
    d.setSnap(snap.kind && snap.kind !== 'grid' ? snap : null);
    next = h.end === 0 ? { ...orig, a: p } : { ...orig, b: p };
    const info = derive(s.doc).infos.get(orig.id);
    runwayReadout(next.a, next.b, ctx.screen, `RWY ${runwayTitle(info)}`);
  } else if ((h.type === 'node' || h.type === 'hin' || h.type === 'hout') && (orig.kind === 'taxiway' || orig.kind === 'area')) {
    const nodes = orig.nodes.slice();
    const n = nodes[h.index];
    if (!n) return;
    if (h.type === 'node') {
      const snap = snapAt(ctx, orig.id);
      d.setSnap(snap.kind && snap.kind !== 'grid' ? snap : null);
      const delta = sub(snap.p, n.p);
      nodes[h.index] = { ...n, p: snap.p, in: n.in && add(n.in, delta), out: n.out && add(n.out, delta) };
    } else {
      nodes[h.index] = moveHandle(n, h.type === 'hin' ? 'in' : 'out', ctx.world, ctx.alt);
    }
    next = { ...orig, nodes };
  } else if (h.type === 'hsr' && orig.kind === 'hotspot') {
    next = { ...orig, radius: Math.max(50, dist(orig.center, ctx.world)) };
  } else if (h.type === 'hsl' && orig.kind === 'hotspot') {
    next = { ...orig, labelOffset: sub(ctx.world, orig.center) };
  } else if (h.type === 'twl' && orig.kind === 'taxiway') {
    const poly = derive(s.doc).polys.get(orig.id);
    const hit = poly && nearestOnPolyline(poly, ctx.world);
    if (hit && poly.length > 0) next = { ...orig, labelT: Math.min(1, Math.max(0, hit.s / poly.length)) };
  }
  if (next) {
    const f = next;
    s.mutate((doc) => replaceFeature(doc, f));
  }
}

export function toggleSmooth(id: ID, index: number): void {
  const s = store();
  const f = findFeature(id);
  if (!f || (f.kind !== 'taxiway' && f.kind !== 'area')) return;
  const closed = f.kind === 'area' || f.closed;
  const nodes = f.nodes.slice();
  const n = nodes[index];
  nodes[index] = n.smooth || n.in || n.out ? cornerNode(n) : smoothNode(nodes, index, closed);
  s.updateFeature(id, (x: typeof f) => ({ ...x, nodes }));
  s.select(id, index);
}

/* ------------------------------------------------------------------ */
/* Runway tool                                                         */
/* ------------------------------------------------------------------ */

function runwayEndFor(a: Vec, ctx: PointerCtx): Vec {
  const s = store();
  const snap = snapAt(ctx);
  draftStore().setSnap(snap.kind && snap.kind !== 'grid' ? snap : null);
  if (snap.kind === 'endpoint' || snap.kind === 'node' || !s.snap) return snap.p;
  return constrainRunwayEnd(a, snap.p, s.doc.meta.magVar, ctx.shift);
}

function runwayDown(ctx: PointerCtx) {
  const d = draftStore();
  const draft = d.draft;
  if (draft?.type === 'runway' && draft.clickMode) {
    commitRunway(draft.a, runwayEndFor(draft.a, ctx), ctx.px);
    return;
  }
  const a = snapAt(ctx).p;
  d.setDraft({ type: 'runway', a, b: a, clickMode: false });
  gesture = { kind: 'runway', startScreen: ctx.screen };
}

function commitRunway(a: Vec, b: Vec, px: number) {
  const d = draftStore();
  d.setDraft(null);
  d.setReadout(null);
  d.setSnap(null);
  const L = dist(a, b);
  if (L < 100 || L / px < 8) return;
  store().addFeature(newRunway(a, b, defaultRunwayWidth(L)));
}

/* ------------------------------------------------------------------ */
/* Pen tool (taxiways and aprons)                                      */
/* ------------------------------------------------------------------ */

function constrainAngle(from: Vec, to: Vec, stepDeg: number): Vec {
  const L = dist(from, to);
  const b = Math.round(bearing(from, to) / stepDeg) * stepDeg;
  return add(from, mul(dirFromBearing(b), L));
}

function penDown(ctx: PointerCtx, target: 'taxiway' | 'apron') {
  const s = store();
  const d = draftStore();
  const draft = d.draft?.type === 'path' ? d.draft : null;
  const snap = snapAt(ctx);
  gesture = { kind: 'pen', startScreen: ctx.screen };

  if (!draft) {
    const f = snap.featureId ? findFeature(snap.featureId) : undefined;
    const extending =
      target === 'taxiway' &&
      f?.kind === 'taxiway' &&
      s.selection.id === f.id &&
      snap.kind === 'node' &&
      (snap.nodeIndex === 0 || snap.nodeIndex === f.nodes.length - 1);
    if (extending && f?.kind === 'taxiway') {
      const nodes = snap.nodeIndex === 0 ? reverseNodes(f.nodes) : f.nodes.slice();
      d.setDraft({ type: 'path', target, nodes, cursor: snap.p, extendId: f.id, dragging: false });
      return;
    }
    d.setDraft({ type: 'path', target, nodes: [{ p: snap.p }], cursor: snap.p, dragging: true });
    return;
  }

  const nodes = draft.nodes;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const near = (p: Vec) => dist(p, ctx.world) / ctx.px < 9;
  if (target === 'apron' && nodes.length >= 3 && near(first.p)) {
    finishPath();
    return;
  }
  if (near(last.p) && nodes.length >= (target === 'apron' ? 3 : 2)) {
    finishPath();
    return;
  }
  const p = ctx.shift ? constrainAngle(last.p, snap.p, 15) : snap.p;
  d.setDraft({ ...draft, nodes: [...nodes, { p }], cursor: p, dragging: true });
}

export function finishPath(): void {
  const s = store();
  const d = draftStore();
  const draft = d.draft;
  if (draft?.type !== 'path') return;
  d.setDraft(null);
  d.setSnap(null);
  const nodes: PathNode[] = draft.nodes;
  if (draft.target === 'taxiway') {
    if (nodes.length < 2) return;
    if (draft.extendId) {
      s.updateFeature(draft.extendId, (t: Feature) => ({ ...t, nodes }) as Feature);
      s.select(draft.extendId);
    } else {
      s.addFeature(newTaxiway(nodes, nextTaxiwayName(s.doc.features), defaultTaxiwayWidth()));
    }
  } else {
    if (nodes.length < 3) return;
    s.addFeature(newArea(nodes, 'apron'));
  }
}

export function popPathNode(): boolean {
  const d = draftStore();
  const draft = d.draft;
  if (draft?.type !== 'path') return false;
  if (draft.nodes.length <= 1) {
    d.setDraft(null);
    return true;
  }
  d.setDraft({ ...draft, nodes: draft.nodes.slice(0, -1) });
  return true;
}

/** Escape: finish a usable path, otherwise drop the draft. Returns true if a draft existed. */
export function escapeDraft(): boolean {
  const d = draftStore();
  const draft = d.draft;
  gesture = null;
  if (!draft) return false;
  if (draft.type === 'path' && draft.nodes.length >= (draft.target === 'apron' ? 3 : 2)) finishPath();
  else d.setDraft(null);
  d.setReadout(null);
  d.setSnap(null);
  return true;
}

export function cancelGesture(): void {
  gesture = null;
}

/** F2 / Enter: rename a selected taxiway in place, or edit a selected label's text. */
export function renameSelection(): void {
  const s = store();
  const f = s.selection.id ? findFeature(s.selection.id) : undefined;
  if (f?.kind === 'taxiway') draftStore().setRenaming(f.id);
  else if (f?.kind === 'label') s.requestFocusText();
}
