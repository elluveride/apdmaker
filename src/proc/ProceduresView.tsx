import { useEffect, useMemo, useState } from 'react';
import { exportProcedureJpg } from '../io/files';
import {
  fixInUse,
  isNavaidKind,
  NAVAID_LABEL,
  newProcedure,
  newRoute,
  procTitle,
  runwayEnds,
  withFix,
  withoutFix,
  withoutProcedure,
  withProcedure,
} from '../model/procedure';
import type { AirportDoc, AltLimits, ProcFix, ProcLeg, ProcRoute, Procedure } from '../model/types';
import { formatLatLon, radialDme, type LatLon } from '../nav/geo';
import { ProcedureChart } from '../render/ProcedureChart';
import { useStore } from '../store/store';
import { Field, NumberInput, Section, Segmented, TextInput, Toggle } from '../ui/fields';
import { runExport } from '../ui/SaveBar';
import { findFix, nearbyFixes, type FixOption } from './fixSearch';

const where = (doc: AirportDoc): LatLon | null =>
  doc.meta.refLat !== undefined && doc.meta.refLon !== undefined ? { lat: doc.meta.refLat, lon: doc.meta.refLon } : null;

/** Build SIDs and STARs for the open airport and see their charts as you go. */
export function ProceduresView() {
  const doc = useStore((s) => s.doc);
  const procs = doc.procedures ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(procs[0]?.id ?? null);
  const proc = procs.find((p) => p.id === selectedId) ?? procs[0] ?? null;
  const s = useStore.getState;
  const airport = where(doc);

  const add = (type: Procedure['type']) => {
    const p = newProcedure(type, s().doc);
    s().commit((d) => withProcedure(d, p));
    setSelectedId(p.id);
  };

  return (
    <div className="procedures-view">
      <aside className="proc-list">
        {!airport && (
          <div className="proc-warning">
            <strong>{doc.meta.ident || 'This airport'} isn’t on the map yet.</strong> Routes need to know where its runways are.
            <button type="button" className="btn tight primary" onClick={() => s().setMode('map')}>
              Place it on the map
            </button>
          </div>
        )}
        {(['SID', 'STAR'] as const).map((type) => (
          <div key={type} className="proc-group">
            <h3>{type === 'SID' ? 'Departures (SIDs)' : 'Arrivals (STARs)'}</h3>
            <ul>
              {procs
                .filter((p) => p.type === type)
                .map((p) => (
                  <li key={p.id}>
                    <button type="button" className={p.id === proc?.id ? 'on' : undefined} onClick={() => setSelectedId(p.id)}>
                      <strong>{procTitle(p)}</strong>
                      <span className="mono">{p.code}</span>
                    </button>
                  </li>
                ))}
            </ul>
            <button type="button" className="btn tight" onClick={() => add(type)}>
              + New {type}
            </button>
          </div>
        ))}
        <p className="muted small">
          Fixes come from real data near the airport: US fixes and waypoints (FAA) and navaids worldwide (OurAirports), or
          your own custom fixes.
        </p>
      </aside>

      <div className="proc-stage">
        {proc ? (
          <>
            <div className="proc-page">
              <ProcedureChart doc={doc} proc={proc} width="100%" height="100%" />
            </div>
            <div className="viewer-controls proc-controls">
              <button type="button" className="btn" onClick={() => runExport(() => exportProcedureJpg(s().doc, proc))}>
                Export .jpg
              </button>
            </div>
          </>
        ) : (
          <div className="proc-empty">
            <h2>No SIDs or STARs yet</h2>
            <p className="muted">Start a departure or an arrival for {doc.meta.ident || 'this airport'}.</p>
            <div className="btn-row">
              <button type="button" className="btn primary" onClick={() => add('SID')}>
                New SID
              </button>
              <button type="button" className="btn" onClick={() => add('STAR')}>
                New STAR
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="panel proc-editor" aria-label="Procedure">
        {proc ? <ProcedureEditor key={proc.id} proc={proc} onDeleted={() => setSelectedId(null)} /> : null}
      </aside>
    </div>
  );
}

function ProcedureEditor({ proc, onDeleted }: { proc: Procedure; onDeleted: () => void }) {
  const doc = useStore((s) => s.doc);
  const s = useStore.getState;
  const airport = where(doc);
  const runwayNames = useMemo(() => [...runwayEnds(doc).keys()].sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b)), [doc]);
  const [options, setOptions] = useState<FixOption[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!airport) return;
    let live = true;
    void nearbyFixes(airport)
      .then((o) => live && setOptions(o))
      .catch(() => live && setOptions([]));
    return () => {
      live = false;
    };
  }, [airport?.lat, airport?.lon]);

  /** Change this procedure as one undo step; the same key within a second merges. */
  const edit = (fn: (p: Procedure) => Procedure, key?: string) =>
    s().commit((d) => {
      const current = (d.procedures ?? []).find((p) => p.id === proc.id);
      return current ? withProcedure(d, fn(current)) : d;
    }, key && `proc:${proc.id}:${key}`);
  const editRoute = (id: string, fn: (r: ProcRoute) => ProcRoute, key?: string) =>
    edit((p) => ({ ...p, routes: p.routes.map((r) => (r.id === id ? fn(r) : r)) }), key && `${id}:${key}`);

  /** Point a leg at a fix, copying a real one into the airport the first time it is used. */
  const setLegFix = async (routeId: string, index: number, raw: string) => {
    const ident = raw.trim().toUpperCase();
    const known = (s().doc.fixes ?? []).find((f) => f.ident === ident);
    const real = !known && ident && airport ? await findFix(ident, airport) : null;
    s().commit((d) => {
      const withReal = real ? withFix(d, real) : d;
      const current = (withReal.procedures ?? []).find((p) => p.id === proc.id);
      if (!current) return withReal;
      return withProcedure(withReal, {
        ...current,
        routes: current.routes.map((r) =>
          r.id === routeId ? { ...r, legs: r.legs.map((l, i) => (i === index && l.type === 'fix' ? { ...l, fix: ident } : l)) } : r,
        ),
      });
    });
    if (ident && !known && !real) s().showToast(`${ident} isn’t a fix or navaid near ${s().doc.meta.ident}. Add it as a custom fix below.`);
  };

  const fixes = doc.fixes ?? [];
  const byIdent = new Map(fixes.map((f) => [f.ident, f]));

  return (
    <div className="inspector">
      <div className="inspector-head">
        <div className="kind">{proc.type === 'SID' ? 'Standard instrument departure' : 'Standard terminal arrival'}</div>
        <h2>{procTitle(proc)}</h2>
      </div>

      <Section title="Procedure">
        <Field label="Name" htmlFor="proc-name" hint={`Charted as “${procTitle(proc)}”.`}>
          <TextInput id="proc-name" value={proc.name} upper onChange={(v) => edit((p) => ({ ...p, name: v }), 'name')} />
        </Field>
        <Field label="Computer code" htmlFor="proc-code">
          <TextInput id="proc-code" value={proc.code} upper onChange={(v) => edit((p) => ({ ...p, code: v.replace(/[^A-Z0-9]/gi, '').slice(0, 7) }), 'code')} />
        </Field>
        <Toggle id="proc-rnav" checked={proc.rnav} onChange={(v) => edit((p) => ({ ...p, rnav: v }))} label="RNAV procedure" />
        {proc.type === 'SID' && (
          <>
            <Field label="Maintain" htmlFor="proc-maintain" hint="The altitude to climb to, e.g. 7000.">
              <TextInput id="proc-maintain" value={proc.maintain ?? ''} upper onChange={(v) => edit((p) => ({ ...p, maintain: v }), 'maintain')} />
            </Field>
            <Field label="Expect" htmlFor="proc-expect" hint="e.g. FL230 10 minutes after departure.">
              <TextInput id="proc-expect" value={proc.expect ?? ''} onChange={(v) => edit((p) => ({ ...p, expect: v }), 'expect')} />
            </Field>
          </>
        )}
      </Section>

      <Section title="Routes">
        <datalist id="proc-fix-options">
          {fixes.map((f) => (
            <option key={`d${f.ident}`} value={f.ident}>
              {`${f.ident} · ${f.source === 'custom' ? 'custom' : NAVAID_LABEL[f.kind]}`}
            </option>
          ))}
          {options.slice(0, 1500).map((o) => (
            <option key={`${o.fix.ident}${o.fix.lat}`} value={o.fix.ident}>
              {`${o.fix.ident} · ${o.fix.name ?? NAVAID_LABEL[o.fix.kind]} · ${Math.round(o.distance)} NM`}
            </option>
          ))}
        </datalist>
        {proc.routes.map((r) => (
          <RouteCard
            key={r.id}
            proc={proc}
            route={r}
            runwayNames={runwayNames}
            fixes={byIdent}
            onChange={(fn, key) => editRoute(r.id, fn, key)}
            onRemove={() => edit((p) => ({ ...p, routes: p.routes.filter((x) => x.id !== r.id) }))}
            onFix={(i, ident) => void setLegFix(r.id, i, ident)}
          />
        ))}
        <div className="btn-row">
          <button type="button" className="btn tight" onClick={() => edit((p) => ({ ...p, routes: [...p.routes, newRoute('runway', runwayNames[0] ?? '')] }))}>
            + Runway
          </button>
          <button type="button" className="btn tight" onClick={() => edit((p) => ({ ...p, routes: [...p.routes, newRoute('common')] }))}>
            + Common route
          </button>
          <button type="button" className="btn tight" onClick={() => edit((p) => ({ ...p, routes: [...p.routes, newRoute('transition')] }))}>
            + Transition
          </button>
        </div>
      </Section>

      <Section title={`Fixes (${fixes.length})`} defaultOpen={false}>
        <ul className="proc-fixes">
          {fixes.map((f) => (
            <li key={f.ident}>
              <span className="mono">{f.ident}</span>
              <span className="muted small">
                {f.source === 'custom' ? 'Custom ' : ''}
                {NAVAID_LABEL[f.kind]}
                {f.freq ? ` ${f.freq}` : ''} · {formatLatLon(f)}
              </span>
              {!fixInUse(doc, f.ident) && (
                <button type="button" className="btn tight" onClick={() => s().commit((d) => withoutFix(d, f.ident))}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <CustomFix
          airport={airport}
          navaids={[...fixes.filter((f) => isNavaidKind(f.kind)), ...options.map((o) => o.fix).filter((f) => isNavaidKind(f.kind))]}
          magVar={doc.meta.magVar}
        />
      </Section>

      <Section title="Notes">
        <textarea
          className="proc-notes"
          value={proc.notes}
          placeholder="Anything else the chart should say, e.g. RADAR REQUIRED."
          onChange={(e) => edit((p) => ({ ...p, notes: e.target.value }), 'notes')}
        />
      </Section>

      <div className="proc-danger">
        {confirmDelete ? (
          <button type="button" className="btn danger" onClick={() => { s().commit((d) => withoutProcedure(d, proc.id)); onDeleted(); }}>
            Delete {proc.code} for good
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirmDelete(true)}>
            Delete this {proc.type}
          </button>
        )}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<ProcRoute['kind'], string> = { runway: 'Runway', common: 'Common', transition: 'Transition' };

function RouteCard({
  proc,
  route,
  runwayNames,
  fixes,
  onChange,
  onRemove,
  onFix,
}: {
  proc: Procedure;
  route: ProcRoute;
  runwayNames: string[];
  fixes: Map<string, ProcFix>;
  onChange: (fn: (r: ProcRoute) => ProcRoute, key?: string) => void;
  onRemove: () => void;
  onFix: (index: number, ident: string) => void;
}) {
  const setLeg = (i: number, leg: ProcLeg, key?: string) => onChange((r) => ({ ...r, legs: r.legs.map((l, k) => (k === i ? leg : l)) }), key && `leg${i}:${key}`);
  const move = (i: number, by: -1 | 1) =>
    onChange((r) => {
      const legs = r.legs.slice();
      const j = i + by;
      if (j < 0 || j >= legs.length) return r;
      [legs[i], legs[j]] = [legs[j], legs[i]];
      return { ...r, legs };
    });
  const hint =
    route.kind === 'runway'
      ? proc.type === 'SID'
        ? 'From takeoff: usually a heading to an altitude, then fixes.'
        : 'To the runway: fixes, then a heading for radar vectors.'
      : route.kind === 'common'
        ? 'The part every runway shares.'
        : proc.type === 'SID'
          ? 'From the end of the common route out to the en-route fix.'
          : 'From the en-route fix in to the common route.';

  return (
    <div className="route-card">
      <div className="route-head">
        <Segmented<ProcRoute['kind']>
          size="sm"
          value={route.kind}
          options={(['runway', 'common', 'transition'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          onChange={(kind) => onChange((r) => ({ ...r, kind, name: kind === 'runway' ? runwayNames[0] ?? '' : kind === 'common' ? '' : r.name }))}
          label="Route kind"
        />
        <button type="button" className="icon-btn" onClick={onRemove} aria-label="Remove this route" title="Remove this route">
          ×
        </button>
      </div>
      {route.kind === 'runway' && (
        <select className="route-name" value={route.name} onChange={(e) => onChange((r) => ({ ...r, name: e.target.value }))} aria-label="Runway">
          {!runwayNames.includes(route.name) && <option value={route.name}>{route.name || 'Pick a runway'}</option>}
          {runwayNames.map((n) => (
            <option key={n} value={n}>
              Runway {n}
            </option>
          ))}
        </select>
      )}
      {route.kind === 'transition' && (
        <input className="route-name" value={route.name} placeholder="Transition name, e.g. Blythe" onChange={(e) => onChange((r) => ({ ...r, name: e.target.value }), 'name')} />
      )}
      <p className="muted small route-hint">{hint}</p>
      <ol className="legs">
        {route.legs.map((leg, i) => (
          <li key={i} className="leg">
            <div className="leg-main">
              {leg.type === 'fix' ? (
                <FixInput value={leg.fix} known={fixes.get(leg.fix)} onCommit={(v) => onFix(i, v)} />
              ) : (
                <span className="leg-heading">
                  Heading
                  <NumberInput id={`h${route.id}${i}`} value={leg.heading} onChange={(v) => v !== undefined && setLeg(i, { ...leg, heading: ((Math.round(v) % 360) + 360) % 360 || 360 }, 'hdg')} min={1} max={360} digits={0} unit="°" />
                  until
                  <NumberInput id={`u${route.id}${i}`} value={leg.untilAlt} onChange={(v) => setLeg(i, { ...leg, untilAlt: v }, 'until')} min={0} max={60000} step={100} digits={0} unit="ft" placeholder="vectors" allowEmpty />
                </span>
              )}
              <span className="leg-tools">
                <button type="button" className="icon-btn" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}>
                  ↑
                </button>
                <button type="button" className="icon-btn" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === route.legs.length - 1}>
                  ↓
                </button>
                <button type="button" className="icon-btn" onClick={() => onChange((r) => ({ ...r, legs: r.legs.filter((_, k) => k !== i) }))} aria-label="Remove leg">
                  ×
                </button>
              </span>
            </div>
            {leg.type === 'fix' && <Limits alt={leg.alt} speed={leg.speed} onChange={(alt, speed) => setLeg(i, { ...leg, alt, speed }, 'limits')} id={`${route.id}${i}`} />}
          </li>
        ))}
      </ol>
      <div className="btn-row">
        <button type="button" className="btn tight" onClick={() => onChange((r) => ({ ...r, legs: [...r.legs, { type: 'fix', fix: '' }] }))}>
          + Fix
        </button>
        <button type="button" className="btn tight" onClick={() => onChange((r) => ({ ...r, legs: [...r.legs, { type: 'heading', heading: 360 }] }))}>
          + Heading
        </button>
      </div>
    </div>
  );
}

/** A fix's ident, looked up when you finish typing it. */
function FixInput({ value, known, onCommit }: { value: string; known?: ProcFix; onCommit: (ident: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text.trim().toUpperCase() !== value) onCommit(text);
  };
  return (
    <span className="fix-input">
      <input
        list="proc-fix-options"
        value={text}
        placeholder="Fix or navaid"
        aria-label="Fix or navaid"
        onChange={(e) => setText(e.target.value.toUpperCase())}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className={`fix-kind small ${value && !known ? 'missing' : ''}`}>
        {!value ? '' : known ? `${known.name ? `${known.name} ` : ''}${NAVAID_LABEL[known.kind]}` : 'not found'}
      </span>
    </span>
  );
}

function Limits({ alt, speed, onChange, id }: { alt?: AltLimits; speed?: number; onChange: (alt: AltLimits | undefined, speed: number | undefined) => void; id: string }) {
  const set = (patch: Partial<AltLimits>) => {
    const next = { ...alt, ...patch };
    const clean = next.atOrAbove === undefined && next.atOrBelow === undefined ? undefined : next;
    onChange(clean, speed);
  };
  return (
    <div className="leg-limits">
      <label>
        At or above
        <NumberInput id={`a${id}`} value={alt?.atOrAbove} onChange={(v) => set({ atOrAbove: v })} min={0} max={60000} step={100} digits={0} allowEmpty />
      </label>
      <label>
        At or below
        <NumberInput id={`b${id}`} value={alt?.atOrBelow} onChange={(v) => set({ atOrBelow: v })} min={0} max={60000} step={100} digits={0} allowEmpty />
      </label>
      <label>
        Speed
        <NumberInput id={`s${id}`} value={speed} onChange={(v) => onChange(alt, v)} min={0} max={500} step={10} digits={0} unit="K" allowEmpty />
      </label>
    </div>
  );
}

/** A fix of your own: by coordinates, or by radial and distance from a navaid. */
function CustomFix({ airport, navaids, magVar }: { airport: LatLon | null; navaids: ProcFix[]; magVar: number }) {
  const [ident, setIdent] = useState('');
  const [how, setHow] = useState<'radial' | 'latlon'>('radial');
  const [lat, setLat] = useState<number | undefined>(airport?.lat);
  const [lon, setLon] = useState<number | undefined>(airport?.lon);
  const [from, setFrom] = useState('');
  const [radial, setRadial] = useState<number | undefined>();
  const [dme, setDme] = useState<number | undefined>();
  const s = useStore.getState;
  const navaid = navaids.find((n) => n.ident === from.trim().toUpperCase());
  const at: LatLon | null =
    how === 'latlon'
      ? lat !== undefined && lon !== undefined
        ? { lat, lon }
        : null
      : navaid && radial !== undefined && dme !== undefined
        ? radialDme(navaid, radial, dme, magVar)
        : null;
  const name = ident.trim().toUpperCase();
  const add = () => {
    if (!name || !at) return;
    s().commit((d) => withFix(d, { ident: name, lat: at.lat, lon: at.lon, kind: 'waypoint', source: 'custom' }));
    s().showToast(`Added ${name} at ${formatLatLon(at)}. Type ${name} in a route to fly to it.`);
    setIdent('');
  };
  return (
    <div className="custom-fix">
      <h4>Add a custom fix</h4>
      <Field label="Name" htmlFor="cf-ident" hint="Five letters, like real waypoints.">
        <TextInput id="cf-ident" value={ident} upper onChange={(v) => setIdent(v.replace(/[^A-Z0-9]/gi, '').slice(0, 5))} />
      </Field>
      <Segmented<'radial' | 'latlon'>
        size="sm"
        value={how}
        options={[
          { value: 'radial', label: 'Radial / DME' },
          { value: 'latlon', label: 'Lat / Lon' },
        ]}
        onChange={setHow}
        label="How to place it"
      />
      {how === 'radial' ? (
        <div className="leg-limits">
          <label>
            From navaid
            <input list="proc-fix-options" value={from} onChange={(e) => setFrom(e.target.value.toUpperCase())} placeholder="e.g. PXR" />
          </label>
          <label>
            Radial
            <NumberInput id="cf-radial" value={radial} onChange={setRadial} min={0} max={360} digits={0} unit="°" allowEmpty />
          </label>
          <label>
            DME
            <NumberInput id="cf-dme" value={dme} onChange={setDme} min={0} max={300} step={0.5} digits={1} unit="NM" allowEmpty />
          </label>
        </div>
      ) : (
        <div className="leg-limits">
          <label>
            Latitude
            <NumberInput id="cf-lat" value={lat} onChange={setLat} min={-90} max={90} step={0.001} digits={5} unit="°N" allowEmpty />
          </label>
          <label>
            Longitude
            <NumberInput id="cf-lon" value={lon} onChange={setLon} min={-180} max={180} step={0.001} digits={5} unit="°E" allowEmpty />
          </label>
        </div>
      )}
      <p className="muted small">
        {how === 'radial' && from && !navaid ? `${from} isn’t a navaid near here. ` : ''}
        {at ? `Goes at ${formatLatLon(at)}.` : how === 'radial' ? 'Radials are magnetic, using the airport’s variation.' : ''}
      </p>
      <button type="button" className="btn tight primary" disabled={!name || !at} onClick={add}>
        Add {name || 'fix'}
      </button>
    </div>
  );
}

