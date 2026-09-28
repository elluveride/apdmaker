import { describe, expect, it } from 'vitest';
import {
  docKey,
  entryFor,
  imageKey,
  LEGACY_DOC_KEY,
  LEGACY_IMAGE_KEY,
  openLibrary,
  readIndex,
  withEntry,
  writeDoc,
  type KeyValueStore,
} from '../../store/library';
import { emptyDoc } from '../defaults';
import type { AirportDoc } from '../types';

const isDoc = (x: unknown): x is AirportDoc => !!x && (x as AirportDoc).version === 1 && Array.isArray((x as AirportDoc).features);
const same = (d: AirportDoc) => d;

function memory(limit = Infinity): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > limit) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
}

const traced = (): AirportDoc => ({
  ...emptyDoc(),
  meta: { ...emptyDoc().meta, ident: 'KXYZ', name: 'TRACED FIELD', refLat: 33.4, refLon: -112 },
  reference: { src: 'data:image/jpeg;base64,AAAA', pxWidth: 10, pxHeight: 10, center: { x: 0, y: 0 }, ftPerPx: 5, rotation: 0, opacity: 0.6, visible: true },
});

describe('airport library', () => {
  it('moves the one airport the app kept before into the library, image and all', () => {
    const store = memory();
    const doc = traced();
    store.setItem(LEGACY_DOC_KEY, JSON.stringify({ ...doc, reference: { ...doc.reference, src: '' } }));
    store.setItem(LEGACY_IMAGE_KEY, doc.reference!.src);
    const { index, doc: opened } = openLibrary(store, isDoc, same, emptyDoc);
    expect(opened.meta.ident).toBe('KXYZ');
    expect(opened.reference?.src).toBe(doc.reference!.src);
    expect(index.airports).toHaveLength(1);
    expect(index.airports[0]).toMatchObject({ id: index.current, ident: 'KXYZ', lat: 33.4, lon: -112 });
    expect(store.data.has(LEGACY_DOC_KEY)).toBe(false);
    expect(store.data.has(LEGACY_IMAGE_KEY)).toBe(false);
    // Stored apart: the drawing without the picture, the picture on its own.
    expect(JSON.parse(store.getItem(docKey(index.current))!).reference.src).toBe('');
    expect(store.getItem(imageKey(index.current))).toBe(doc.reference!.src);
    // Opening again finds the same airport.
    const again = openLibrary(store, isDoc, same, emptyDoc);
    expect(again.index.current).toBe(index.current);
    expect(again.doc.reference?.src).toBe(doc.reference!.src);
  });

  it('starts from the fallback airport the first time', () => {
    const store = memory();
    const { index, doc } = openLibrary(store, isDoc, same, () => ({ ...emptyDoc(), meta: { ...emptyDoc().meta, ident: 'SMPL' } }));
    expect(doc.meta.ident).toBe('SMPL');
    expect(readIndex(store)?.airports.map((a) => a.ident)).toEqual(['SMPL']);
    expect(index.current).toBe(readIndex(store)?.current);
  });

  it('keeps the drawing when storage is too full for the picture', () => {
    const store = memory(2000);
    const doc = traced();
    const big = { ...doc, reference: { ...doc.reference!, src: 'x'.repeat(5000) } };
    const result = writeDoc(store, 'a1', big, null);
    expect(result.imageSaved).toBe(false);
    expect(isDoc(JSON.parse(store.getItem(docKey('a1'))!))).toBe(true);
    expect(store.getItem(imageKey('a1'))).toBeNull();
  });

  it('lists the most recently changed airport first', () => {
    const doc = traced();
    let index = { current: 'b', airports: [entryFor('a', doc, '1'), entryFor('b', doc, '2')] };
    index = withEntry(index, entryFor('b', doc, '3'));
    expect(index.airports.map((a) => `${a.id}${a.updated}`)).toEqual(['b3', 'a1']);
  });
});
