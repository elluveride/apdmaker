import { add, nodesCentroid, rotateAround, rotateNode, scaleAround, scaleNode, translateNode } from './geometry';
import { runwayTitle, type RunwayInfo } from './runway';
import type { AirportDoc, Feature, ID, Vec } from './types';
import { SYMBOL_NAMES } from './defaults';

export function translateFeature(f: Feature, d: Vec): Feature {
  switch (f.kind) {
    case 'runway':
      return { ...f, a: add(f.a, d), b: add(f.b, d) };
    case 'taxiway':
    case 'area':
      return { ...f, nodes: f.nodes.map((n) => translateNode(n, d)) };
    case 'label':
    case 'symbol':
      return { ...f, p: add(f.p, d) };
    case 'hotspot':
      return { ...f, center: add(f.center, d) };
  }
}

export function featureCenter(f: Feature): Vec {
  switch (f.kind) {
    case 'runway':
      return { x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 };
    case 'taxiway':
    case 'area':
      return nodesCentroid(f.nodes);
    case 'label':
    case 'symbol':
      return f.p;
    case 'hotspot':
      return f.center;
  }
}

/** Rotate clockwise about the feature's center. */
export function rotateFeature(f: Feature, degrees: number): Feature {
  const c = featureCenter(f);
  switch (f.kind) {
    case 'runway':
      return { ...f, a: rotateAround(f.a, c, degrees), b: rotateAround(f.b, c, degrees) };
    case 'taxiway':
    case 'area':
      return { ...f, nodes: f.nodes.map((n) => rotateNode(n, c, degrees)) };
    case 'label':
      return { ...f, rotation: f.rotation + degrees };
    default:
      return f;
  }
}

/**
 * Where a feature sits, k times as far from `c`. Only what was drawn scales;
 * real sizes like widths and hold distances keep their feet.
 */
export function scaleFeature(f: Feature, c: Vec, k: number): Feature {
  switch (f.kind) {
    case 'runway':
      return { ...f, a: scaleAround(f.a, c, k), b: scaleAround(f.b, c, k) };
    case 'taxiway':
    case 'area':
      return { ...f, nodes: f.nodes.map((n) => scaleNode(n, c, k)) };
    case 'label':
    case 'symbol':
      return { ...f, p: scaleAround(f.p, c, k) };
    case 'hotspot':
      return {
        ...f,
        center: scaleAround(f.center, c, k),
        radius: f.radius * k,
        labelOffset: { x: f.labelOffset.x * k, y: f.labelOffset.y * k },
      };
  }
}

/** The whole drawing and the reference image under it, k times the size about `c`. */
export function scaleDoc(doc: AirportDoc, c: Vec, k: number): AirportDoc {
  const ref = doc.reference;
  return {
    ...doc,
    features: doc.features.map((f) => scaleFeature(f, c, k)),
    reference: ref && { ...ref, center: scaleAround(ref.center, c, k), ftPerPx: ref.ftPerPx * k },
  };
}

export function featureTitle(f: Feature, infos: Map<ID, RunwayInfo>): string {
  switch (f.kind) {
    case 'runway':
      return `Runway ${runwayTitle(infos.get(f.id))}`;
    case 'taxiway':
      return `Taxiway ${f.name || '—'}`;
    case 'area': {
      const type = f.areaType === 'apron' ? 'Apron' : f.areaType === 'building' ? 'Building' : 'Unpaved area';
      return f.name ? `${type} · ${f.name}` : type;
    }
    case 'label':
      return `Label · ${f.text.split('\n')[0] || '—'}`;
    case 'symbol':
      return f.label ? `${SYMBOL_NAMES[f.symbol]} · ${f.label}` : SYMBOL_NAMES[f.symbol];
    case 'hotspot':
      return `Hot spot · ${f.label}`;
  }
}

export const replaceFeature = <T extends { features: Feature[] }>(doc: T, f: Feature): T => ({
  ...doc,
  features: doc.features.map((x) => (x.id === f.id ? f : x)),
});
