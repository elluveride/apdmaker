import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { derive } from '../model/derive';
import { NAVAID_LABEL, procFixFromFaa, procFixFromNavaid, procTitle, routeGeometry } from '../model/procedure';
import type { AirportDoc } from '../model/types';
import {
  allNavaids,
  diagramUrl,
  fixesIn,
  formatFrequency,
  majorAirports,
  minorAirports,
  tilesCovering,
  type AirportType,
  type Fix,
  type Navaid,
  type RealAirport,
} from '../nav/data';
import { formatLatLon } from '../nav/geo';
import { importRealAirport } from '../nav/ourairports';
import { SheetSvg } from '../render/Sheet';
import { useStore } from '../store/store';
import { fixSymbol } from './symbols';

/** Base map tiles. OpenStreetMap's by default; set VITE_MAP_TILES to use another server. */
const TILES = import.meta.env.VITE_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
  '<a href="https://www.openstreetmap.org/fixthemap">Report a map issue</a> · ' +
  'Airports and navaids <a href="https://ourairports.com/data/">OurAirports</a> · Fixes FAA NASR';

type Picked =
  | { kind: 'real'; airport: RealAirport }
  | { kind: 'mine'; id: string }
  | { kind: 'navaid'; navaid: Navaid }
  | { kind: 'fix'; fix: Fix };

/** How each kind of airport is drawn, and from which zoom. */
const AIRPORTS: Record<AirportType, { r: number; color: string; minZoom: number; label: string }> = {
  large: { r: 6, color: '#1b3a8a', minZoom: 0, label: 'Large airport' },
  medium: { r: 4.5, color: '#2f5fb3', minZoom: 5, label: 'Medium airport' },
  small: { r: 3.5, color: '#5b7fc7', minZoom: 8, label: 'Small airport' },
  seaplane: { r: 3.5, color: '#1a9aa0', minZoom: 8, label: 'Seaplane base' },
  heliport: { r: 3, color: '#8a4fb0', minZoom: 10, label: 'Heliport' },
};
const NAVAID_ZOOM = 6;
const FIX_ZOOM = 9;
/** Beyond this many fixes in view, zoom in to see them all. */
const FIX_CAP = 1500;
const SID_INK = '#1d4ed8';
const STAR_INK = '#15803d';

const FIX_USES: Record<string, string> = {
  WP: 'Waypoint',
  RP: 'Reporting point',
  CN: 'Computer navigation fix',
  MR: 'Military reporting point',
  MW: 'Military waypoint',
  NRS: 'NRS waypoint',
  VFR: 'VFR waypoint',
  RADAR: 'Radar fix',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function symbolIcon(svg: string, label: string, size: number, className: string): L.DivIcon {
  return L.divIcon({
    className: `map-sym ${className}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<svg width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}">${svg}</svg>${label ? `<span>${esc(label)}</span>` : ''}`,
  });
}

const mineIcon = (ident: string) =>
  L.divIcon({ className: 'map-mine', iconSize: [16, 16], iconAnchor: [8, 8], html: `<i></i><span>${esc(ident || '?')}</span>` });

/** Real airports, navaids, fixes, your own airports and their SIDs and STARs, on a map. */
export function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<Record<'procs' | 'real' | 'navaids' | 'fixes' | 'mine', L.LayerGroup> | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [show, setShow] = useState({ airports: true, navaids: true, fixes: true, mine: true, procs: true });
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(placing);
  placingRef.current = placing;
  const [moved, setMoved] = useState(0);
  const library = useStore((s) => s.library);
  const doc = useStore((s) => s.doc);
  const airportId = useStore((s) => s.airportId);
  const placed = doc.meta.refLat !== undefined && doc.meta.refLon !== undefined;

  useEffect(() => {
    const map = L.map(el.current!, { preferCanvas: true, worldCopyJump: true, zoomControl: false });
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    layers.current = {
      procs: L.layerGroup().addTo(map),
      real: L.layerGroup().addTo(map),
      navaids: L.layerGroup().addTo(map),
      fixes: L.layerGroup().addTo(map),
      mine: L.layerGroup().addTo(map),
    };
    const { doc: d, library: lib } = useStore.getState();
    if (d.meta.refLat !== undefined && d.meta.refLon !== undefined) map.setView([d.meta.refLat, d.meta.refLon], 10);
    else {
      const spots = lib.filter((a) => a.lat !== undefined && a.lon !== undefined).map((a) => L.latLng(a.lat!, a.lon!));
      if (spots.length) map.fitBounds(L.latLngBounds(spots).pad(0.4), { maxZoom: 10 });
      else map.setView([39.5, -98.35], 4);
    }
    map.on('moveend', () => setMoved((n) => n + 1));
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!placingRef.current) return;
      const lon = ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180;
      const s = useStore.getState();
      s.patchMeta({ refLat: Math.round(e.latlng.lat * 1e5) / 1e5, refLon: Math.round(lon * 1e5) / 1e5 });
      s.showToast(`${s.doc.meta.ident || 'Your airport'} is on the map at ${formatLatLon({ lat: e.latlng.lat, lon })}. Its chart gets coordinate ticks from here.`);
      setPlacing(false);
    });
    mapRef.current = map;
    // Leaflet measures its box once the layout has settled.
    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Real airports, navaids and fixes in view, loaded by zoom and tile.
  useEffect(() => {
    const map = mapRef.current;
    const g = layers.current;
    if (!map || !g) return;
    let cancelled = false;
    const bounds = map.getBounds().pad(0.15);
    const zoom = map.getZoom();
    const box = [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()] as const;
    const inView = (p: { lat: number; lon: number }) => bounds.contains([p.lat, p.lon]);

    (async () => {
      try {
        const [major, minor, navaids, fixes] = await Promise.all([
          show.airports ? majorAirports() : Promise.resolve([]),
          show.airports && zoom >= 8 ? minorAirports(tilesCovering(...box, 10)) : Promise.resolve([]),
          show.navaids && zoom >= NAVAID_ZOOM ? allNavaids() : Promise.resolve([]),
          show.fixes && zoom >= FIX_ZOOM ? fixesIn(tilesCovering(...box, 5)) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        g.real.clearLayers();
        for (const a of [...major, ...minor]) {
          const style = AIRPORTS[a.type];
          if (zoom < style.minZoom || !inView(a)) continue;
          L.circleMarker([a.lat, a.lon], { radius: style.r, color: '#fff', weight: 1, fillColor: style.color, fillOpacity: 0.9 })
            .bindTooltip(esc(`${a.ident} · ${a.name}`), { direction: 'top', offset: [0, -4] })
            .on('click', () => setPicked({ kind: 'real', airport: a }))
            .addTo(g.real);
        }
        g.navaids.clearLayers();
        for (const n of navaids) {
          if (!inView(n)) continue;
          const kind = procFixFromNavaid(n).kind;
          L.marker([n.lat, n.lon], { icon: symbolIcon(fixSymbol(kind, 7, '#0b4f6c'), zoom >= 8 ? n.ident : '', 20, 'navaid') })
            .bindTooltip(esc(`${n.ident} · ${n.name} ${n.type} ${formatFrequency(n)}`), { direction: 'top', offset: [0, -8] })
            .on('click', () => setPicked({ kind: 'navaid', navaid: n }))
            .addTo(g.navaids);
        }
        g.fixes.clearLayers();
        const visible = fixes.filter(inView);
        for (const f of visible.slice(0, FIX_CAP)) {
          const kind = procFixFromFaa(f).kind;
          L.marker([f.lat, f.lon], { icon: symbolIcon(fixSymbol(kind, 4, '#444'), zoom >= 10 ? f.ident : '', 12, 'fix') })
            .bindTooltip(esc(f.ident), { direction: 'top', offset: [0, -5] })
            .on('click', () => setPicked({ kind: 'fix', fix: f }))
            .addTo(g.fixes);
        }
        setNote(
          visible.length > FIX_CAP
            ? `Showing ${FIX_CAP} of ${visible.length} fixes here. Zoom in to see them all.`
            : zoom < FIX_ZOOM && show.fixes
              ? 'Zoom in to see US fixes and waypoints.'
              : '',
        );
      } catch (err) {
        if (!cancelled) setNote(err instanceof Error ? err.message : 'Real-world data did not load.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moved, show.airports, show.navaids, show.fixes]);

  // Your airports, and the routes of their SIDs and STARs.
  const mine = useMemo(() => {
    const s = useStore.getState();
    return library
      .map((entry) => ({ entry, doc: entry.id === airportId ? doc : s.airportDoc(entry.id) }))
      .filter((m): m is { entry: typeof m.entry; doc: AirportDoc } => !!m.doc && m.doc.meta.refLat !== undefined && m.doc.meta.refLon !== undefined);
  }, [library, doc, airportId]);

  useEffect(() => {
    const g = layers.current;
    if (!g) return;
    g.mine.clearLayers();
    g.procs.clearLayers();
    for (const { entry, doc: d } of mine) {
      if (show.mine) {
        L.marker([d.meta.refLat!, d.meta.refLon!], { icon: mineIcon(d.meta.ident), zIndexOffset: 1000 })
          .bindTooltip(esc(`${d.meta.ident} · ${d.meta.name} (yours)`), { direction: 'top', offset: [0, -8] })
          .on('click', () => setPicked({ kind: 'mine', id: entry.id }))
          .addTo(g.mine);
      }
      if (!show.procs) continue;
      // Each fix once per airport, however many routes fly over it.
      const marked = new Set<string>();
      for (const p of d.procedures ?? []) {
        const ink = p.type === 'SID' ? SID_INK : STAR_INK;
        for (const r of p.routes) {
          const geo = routeGeometry(p, r, d);
          const where = r.kind === 'runway' ? `RWY ${r.name}` : r.kind === 'transition' ? `${r.name.toUpperCase()} TRANSITION` : 'common route';
          for (const s of geo.segments) {
            L.polyline(
              [
                [s.from.lat, s.from.lon],
                [s.to.lat, s.to.lon],
              ],
              { color: ink, weight: 2.5, opacity: 0.85, dashArray: s.kind === 'track' ? undefined : '6 5' },
            )
              .bindTooltip(esc(`${d.meta.ident} ${procTitle(p)} · ${where}`), { sticky: true })
              .addTo(g.procs);
          }
          for (const pt of geo.points) {
            if (!pt.fix || marked.has(pt.fix.ident)) continue;
            marked.add(pt.fix.ident);
            L.marker([pt.lat, pt.lon], { icon: symbolIcon(fixSymbol(pt.fix.kind, 5, ink), pt.fix.ident, 14, 'proc-fix') }).addTo(g.procs);
          }
        }
      }
    }
  }, [mine, show.mine, show.procs]);

  const toggle = (key: keyof typeof show) => setShow((s) => ({ ...s, [key]: !s[key] }));
  const flyTo = (lat: number, lon: number, zoom = 11) => mapRef.current?.flyTo([lat, lon], Math.max(zoom, mapRef.current.getZoom()));

  return (
    <div className={`map-view${placing ? ' placing' : ''}`}>
      <div className="map-canvas" ref={el} />
      <MapSearch onPick={(p, lat, lon) => { setPicked(p); flyTo(lat, lon); }} />
      <div className="map-layers" role="group" aria-label="Map layers">
        {(
          [
            ['mine', 'My airports'],
            ['procs', 'My SIDs & STARs'],
            ['airports', 'Airports'],
            ['navaids', 'Navaids'],
            ['fixes', 'US fixes'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input type="checkbox" checked={show[key]} onChange={() => toggle(key)} /> {label}
          </label>
        ))}
      </div>
      {(!placed || placing) && (
        <div className="map-banner">
          {placing ? (
            <>
              Click where {doc.meta.ident || 'your airport'} is.{' '}
              <button type="button" className="btn tight" onClick={() => setPlacing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {doc.meta.ident || 'This airport'} isn’t on the map yet.{' '}
              <button type="button" className="btn tight primary" onClick={() => setPlacing(true)}>
                Place it
              </button>
            </>
          )}
        </div>
      )}
      {note && <div className="map-note">{note}</div>}
      <aside className="map-panel" aria-label="Details">
        {picked ? (
          <Details picked={picked} onPlace={() => setPlacing(true)} onClose={() => setPicked(null)} />
        ) : (
          <div className="map-intro">
            <h2>Map</h2>
            <p className="muted">
              Your airports and their SIDs and STARs, over real airports and navaids worldwide and US fixes and waypoints.
              Click anything for details. Pick a real airport to start a chart of it from real data.
            </p>
            <ul className="map-legend">
              <li><i className="lg mine" /> Your airports</li>
              <li><i className="lg sid" /> Your SIDs <i className="lg star" /> STARs</li>
              {(['large', 'medium', 'small', 'heliport'] as const).map((t) => (
                <li key={t}><i className="lg dot" style={{ background: AIRPORTS[t].color }} /> {AIRPORTS[t].label}{AIRPORTS[t].minZoom ? ` (zoom ${AIRPORTS[t].minZoom}+)` : ''}</li>
              ))}
              <li><i className="lg" dangerouslySetInnerHTML={{ __html: `<svg width="14" height="14" viewBox="-7 -7 14 14">${fixSymbol('vortac', 5, '#0b4f6c')}</svg>` }} /> Navaids (zoom {NAVAID_ZOOM}+)</li>
              <li><i className="lg" dangerouslySetInnerHTML={{ __html: `<svg width="14" height="14" viewBox="-7 -7 14 14">${fixSymbol('waypoint', 5, '#444')}</svg>` }} /> US fixes (zoom {FIX_ZOOM}+)</li>
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

/** Find a large or medium airport, a navaid, or one of yours. */
function MapSearch({ onPick }: { onPick: (p: Picked, lat: number, lon: number) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ key: string; label: string; sub: string; pick: Picked; lat: number; lon: number }[]>([]);
  const library = useStore((s) => s.library);

  useEffect(() => {
    const text = q.trim().toUpperCase();
    if (text.length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    void Promise.all([majorAirports().catch(() => []), allNavaids().catch(() => [])]).then(([airports, navaids]) => {
      if (!live) return;
      const mine = library
        .filter((a) => a.lat !== undefined && (a.ident.toUpperCase().includes(text) || a.name.toUpperCase().includes(text)))
        .map((a) => ({ key: `m${a.id}`, label: `${a.ident} · ${a.name}`, sub: 'Yours', pick: { kind: 'mine', id: a.id } as Picked, lat: a.lat!, lon: a.lon! }));
      const exact = (s: string) => s.toUpperCase() === text;
      const real = airports
        .filter((a) => exact(a.ident) || exact(a.iata) || a.name.toUpperCase().includes(text))
        .sort((a, b) => Number(exact(b.ident) || exact(b.iata)) - Number(exact(a.ident) || exact(a.iata)))
        .slice(0, 6)
        .map((a) => ({ key: `a${a.ident}`, label: `${a.ident} · ${a.name}`, sub: [a.city, a.country].filter(Boolean).join(', '), pick: { kind: 'real', airport: a } as Picked, lat: a.lat, lon: a.lon }));
      const navs = navaids
        .filter((n) => exact(n.ident) || n.name.toUpperCase().includes(text))
        .slice(0, 4)
        .map((n) => ({ key: `n${n.ident}${n.lat}`, label: `${n.ident} · ${n.name}`, sub: `${n.type} ${formatFrequency(n)} · ${n.country}`, pick: { kind: 'navaid', navaid: n } as Picked, lat: n.lat, lon: n.lon }));
      setHits([...mine, ...real, ...navs].slice(0, 10));
    });
    return () => {
      live = false;
    };
  }, [q, library]);

  return (
    <div className="map-search">
      <input
        type="search"
        value={q}
        placeholder="Find an airport or navaid"
        aria-label="Find an airport or navaid"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) {
            onPick(hits[0].pick, hits[0].lat, hits[0].lon);
            setQ('');
          }
        }}
      />
      {hits.length > 0 && (
        <ul>
          {hits.map((h) => (
            <li key={h.key}>
              <button type="button" onClick={() => { onPick(h.pick, h.lat, h.lon); setQ(''); }}>
                <strong>{h.label}</strong>
                <span>{h.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Details({ picked, onPlace, onClose }: { picked: Picked; onPlace: () => void; onClose: () => void }) {
  return (
    <div className="map-details">
      <button type="button" className="icon-btn map-close" onClick={onClose} aria-label="Close details">
        ×
      </button>
      {picked.kind === 'real' && <RealAirportDetails airport={picked.airport} />}
      {picked.kind === 'mine' && <MyAirportDetails id={picked.id} onPlace={onPlace} />}
      {picked.kind === 'navaid' && (
        <>
          <div className="kind">{picked.navaid.type}</div>
          <h2>
            {picked.navaid.name} <span className="mono">{picked.navaid.ident}</span>
          </h2>
          <dl className="map-facts">
            <dt>Frequency</dt>
            <dd className="mono">{formatFrequency(picked.navaid) || '—'}</dd>
            <dt>Variation</dt>
            <dd>{picked.navaid.magVar == null ? '—' : `${Math.abs(picked.navaid.magVar)}° ${picked.navaid.magVar >= 0 ? 'E' : 'W'}`}</dd>
            <dt>Position</dt>
            <dd className="mono">{formatLatLon(picked.navaid)}</dd>
            <dt>Country</dt>
            <dd>{picked.navaid.country}</dd>
          </dl>
          <p className="muted small">Use it in a SID or STAR from the Procedures view: type {picked.navaid.ident} as a fix.</p>
        </>
      )}
      {picked.kind === 'fix' && (
        <>
          <div className="kind">{FIX_USES[picked.fix.use] ?? 'Fix'} · {NAVAID_LABEL[procFixFromFaa(picked.fix).kind]} symbol</div>
          <h2 className="mono">{picked.fix.ident}</h2>
          <dl className="map-facts">
            <dt>Position</dt>
            <dd className="mono">{formatLatLon(picked.fix)}</dd>
            <dt>State</dt>
            <dd>{picked.fix.state || '—'}</dd>
          </dl>
          <p className="muted small">Use it in a SID or STAR from the Procedures view: type {picked.fix.ident} as a fix.</p>
        </>
      )}
    </div>
  );
}

function RealAirportDetails({ airport: a }: { airport: RealAirport }) {
  const [diagram, setDiagram] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setDiagram(undefined);
    diagramUrl(a.ident)
      .then((url) => live && setDiagram(url))
      .catch(() => live && setDiagram(null));
    return () => {
      live = false;
    };
  }, [a]);

  const create = async () => {
    setBusy(true);
    const s = useStore.getState();
    try {
      const { doc, osm } = await importRealAirport(a);
      const count = (kind: string) => doc.features.filter((f) => f.kind === kind).length;
      const n = (k: number, one: string, many: string) => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`;
      const variation = doc.meta.magVar ? ` Variation ${Math.abs(doc.meta.magVar)}° ${doc.meta.magVar >= 0 ? 'E' : 'W'} from the nearest VOR; check it.` : ' Set its magnetic variation in the Airport tab.';
      const detail =
        'error' in osm
          ? `${n(count('runway'), 'runway', 'runways')} and frequencies from OurAirports. Taxiways and buildings from OpenStreetMap didn’t load (${osm.error.replace(/\.$/, '')}); try Airport → Add real detail later.`
          : `${n(count('runway'), 'runway', 'runways')}, ${n(count('taxiway'), 'taxiway', 'taxiways')}, ${n(doc.features.filter((f) => f.kind === 'area' && f.areaType === 'apron').length, 'apron', 'aprons')}, ${n(doc.features.filter((f) => f.kind === 'area' && f.areaType === 'building').length, 'building', 'buildings')} and frequencies from OurAirports and OpenStreetMap.`;
      s.addAirport(doc, `Started ${a.ident}: ${detail}${variation}`);
      s.setMode('edit');
    } catch (err) {
      s.showToast(err instanceof Error ? err.message : 'Could not load that airport’s data.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="kind">{AIRPORTS[a.type].label}</div>
      <h2>
        {a.name} <span className="mono">{a.ident}</span>
      </h2>
      <dl className="map-facts">
        {a.iata && (
          <>
            <dt>IATA</dt>
            <dd className="mono">{a.iata}</dd>
          </>
        )}
        <dt>Place</dt>
        <dd>{[a.city, a.region.replace(/^[A-Z]+-/, ''), a.country].filter(Boolean).join(', ')}</dd>
        <dt>Elevation</dt>
        <dd>{a.elevation == null ? '—' : `${a.elevation.toLocaleString('en-US')} ft`}</dd>
        <dt>Position</dt>
        <dd className="mono">{formatLatLon(a)}</dd>
      </dl>
      <div className="map-actions">
        {diagram && (
          <a className="btn" href={diagram} target="_blank" rel="noreferrer">
            FAA airport diagram (PDF) ↗
          </a>
        )}
        <button type="button" className="btn primary" disabled={busy} onClick={create}>
          {busy ? 'Loading its runways…' : 'Start a chart from this airport'}
        </button>
      </div>
      <p className="muted small">
        {diagram === null && a.country === 'US' ? 'No FAA airport diagram in the current cycle. ' : ''}
        Starting a chart places its runways where they really are and fills in its frequencies, from OurAirports data. It
        becomes one of your airports.
      </p>
    </>
  );
}

function MyAirportDetails({ id, onPlace }: { id: string; onPlace: () => void }) {
  const current = useStore((s) => s.airportId);
  const live = useStore((s) => s.doc);
  const doc = id === current ? live : useStore.getState().airportDoc(id);
  const derived = useMemo(() => (doc ? derive(doc) : null), [doc]);
  if (!doc || !derived) return <p className="muted">That airport could not be read.</p>;
  const s = useStore.getState;
  const go = (mode: 'edit' | 'view' | 'procedures') => {
    s().openAirport(id);
    s().setMode(mode);
  };
  const page = derived.sheet;
  const w = 268;
  const procs = doc.procedures ?? [];
  return (
    <>
      <div className="kind">Your airport</div>
      <h2>
        {doc.meta.name} <span className="mono">{doc.meta.ident}</span>
      </h2>
      <button type="button" className="map-chart" onClick={() => go('view')} title="View the chart">
        <SheetSvg doc={doc} derived={derived} width={w} height={(page.height / page.width) * w} />
      </button>
      <div className="map-actions">
        <button type="button" className="btn primary" onClick={() => go('edit')}>
          Open
        </button>
        <button type="button" className="btn" onClick={() => go('procedures')}>
          SIDs & STARs ({procs.length})
        </button>
        {id === current && (
          <button type="button" className="btn" onClick={onPlace}>
            Move on map
          </button>
        )}
        {doc.meta.refLat !== undefined && (
          <button type="button" className="btn" onClick={() => { s().openAirport(id); s().setMode('edit'); s().setShowImprove(true); }}>
            Add real detail…
          </button>
        )}
      </div>
      {procs.length > 0 && (
        <ul className="map-procs">
          {procs.map((p) => (
            <li key={p.id}>
              <i className={`lg ${p.type === 'SID' ? 'sid' : 'star'}`} /> {procTitle(p)} <span className="mono muted">{p.code}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
