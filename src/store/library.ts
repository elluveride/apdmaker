/**
 * The airport library: every airport made here, kept in browser storage as an
 * index plus one document per airport. A reference image is stored under its
 * own key per airport, so a large picture never stops the drawing itself from
 * being saved.
 */
import { uid } from '../model/defaults';
import type { AirportDoc } from '../model/types';

/** What the library knows about an airport without loading it. */
export interface LibraryEntry {
  id: string;
  ident: string;
  name: string;
  city: string;
  /** Where it is, when its coordinates are set. */
  lat?: number;
  lon?: number;
  /** ISO time of the last change. */
  updated: string;
}

export interface LibraryIndex {
  current: string;
  airports: LibraryEntry[];
}

/** The part of Web Storage the library uses, so tests can pass a stand-in. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const INDEX_KEY = 'apdmaker.library.v1';
export const docKey = (id: string) => `apdmaker.airport.${id}`;
export const imageKey = (id: string) => `apdmaker.reference.${id}`;
/** Where the app kept its one airport before the library existed. */
export const LEGACY_DOC_KEY = 'apdmaker.doc.v1';
export const LEGACY_IMAGE_KEY = 'apdmaker.reference.v1';

export function entryFor(id: string, doc: AirportDoc, updated = new Date().toISOString()): LibraryEntry {
  const { ident, name, city, refLat, refLon } = doc.meta;
  return { id, ident, name, city, ...(refLat !== undefined && refLon !== undefined ? { lat: refLat, lon: refLon } : {}), updated };
}

/** The index with `entry` added or replaced, newest first. */
export function withEntry(index: LibraryIndex, entry: LibraryEntry): LibraryIndex {
  return { ...index, airports: [entry, ...index.airports.filter((a) => a.id !== entry.id)] };
}

export function withoutEntry(index: LibraryIndex, id: string): LibraryIndex {
  return { ...index, airports: index.airports.filter((a) => a.id !== id) };
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readIndex(store: KeyValueStore): LibraryIndex | null {
  const index = parse<LibraryIndex>(store.getItem(INDEX_KEY));
  return index && Array.isArray(index.airports) ? index : null;
}

/** An airport's document with its reference image put back, or null if it is gone or unreadable. */
export function readDoc(store: KeyValueStore, id: string, isDoc: (x: unknown) => x is AirportDoc): AirportDoc | null {
  const doc = parse<unknown>(store.getItem(docKey(id)));
  if (!isDoc(doc)) return null;
  if (!doc.reference) return doc;
  const src = store.getItem(imageKey(id));
  if (src) return { ...doc, reference: { ...doc.reference, src } };
  const { reference: _lost, ...rest } = doc;
  return rest;
}

/**
 * Save an airport. The drawing goes first and on its own, so it is saved even
 * when the reference image is too large for the space left. Returns false when
 * the image could not be kept.
 */
export function writeDoc(store: KeyValueStore, id: string, doc: AirportDoc, savedImage: string | null): { imageSaved: boolean; image: string | null } {
  const ref = doc.reference;
  store.setItem(docKey(id), JSON.stringify(ref ? { ...doc, reference: { ...ref, src: '' } } : doc));
  const src = ref?.src ?? null;
  if (src === savedImage) return { imageSaved: true, image: src };
  try {
    if (src) store.setItem(imageKey(id), src);
    else store.removeItem(imageKey(id));
    return { imageSaved: true, image: src };
  } catch {
    return { imageSaved: false, image: savedImage };
  }
}

export function writeIndex(store: KeyValueStore, index: LibraryIndex): void {
  store.setItem(INDEX_KEY, JSON.stringify(index));
}

export function removeDoc(store: KeyValueStore, id: string): void {
  store.removeItem(docKey(id));
  store.removeItem(imageKey(id));
}

/**
 * Open the library, creating it the first time: from the one airport the app
 * kept before the library existed, or from `fallback` (the sample) when there
 * is none. The old keys are removed only once the airport is safely stored in
 * its new place.
 */
export function openLibrary(
  store: KeyValueStore,
  isDoc: (x: unknown) => x is AirportDoc,
  normalize: (d: AirportDoc) => AirportDoc,
  fallback: () => AirportDoc,
): { index: LibraryIndex; doc: AirportDoc } {
  const index = readIndex(store);
  if (index) {
    const current = index.airports.find((a) => a.id === index.current) ?? index.airports[0];
    const doc = current && readDoc(store, current.id, isDoc);
    if (current && doc) return { index: { ...index, current: current.id }, doc: normalize(doc) };
  }

  const legacy = parse<unknown>(store.getItem(LEGACY_DOC_KEY));
  let doc: AirportDoc;
  if (isDoc(legacy)) {
    const legacyImage = store.getItem(LEGACY_IMAGE_KEY);
    doc = normalize(legacy);
    if (doc.reference) {
      if (legacyImage) doc = { ...doc, reference: { ...doc.reference, src: legacyImage } };
      else {
        const { reference: _lost, ...rest } = doc;
        doc = rest;
      }
    }
  } else doc = fallback();

  const id = uid();
  const created: LibraryIndex = withEntry({ current: id, airports: index?.airports ?? [] }, entryFor(id, doc));
  try {
    writeDoc(store, id, doc, null);
    writeIndex(store, created);
    store.removeItem(LEGACY_DOC_KEY);
    store.removeItem(LEGACY_IMAGE_KEY);
  } catch {
    /* storage unavailable or full: the app still works this session */
  }
  return { index: created, doc };
}
