import type { ReactNode } from 'react';
import { add, cornerNode, dirFromBearing, leftOf, mid, mul, reverseNodes, rightOf, smoothNode } from '../model/geometry';
import { derive } from '../model/derive';
import { newRunway, SYMBOL_NAMES } from '../model/defaults';
import { featureTitle, rotateFeature } from '../model/featureOps';
import { cleanTaxiwayName } from '../model/smooth';
import {
  defaultHoldDistance,
  formatBearing,
  landingDir,
  runwayLength,
  toTrue,
  type RunwayInfo,
} from '../model/runway';
import type {
  Area,
  AreaType,
  Feature,
  Hotspot,
  Label,
  MapSymbol,
  MarkingType,
  Runway,
  RunwayEnd,
  Suffix,
  SurfaceType,
  SymbolType,
  Taxiway,
  Vec,
} from '../model/types';
import { selectedFeature, useStore } from '../store/store';
import { Checklist } from './Checklist';
import { Field, NumberInput, Row, Section, Segmented, Select, TextInput, Toggle } from './fields';
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, EyeIcon, SmoothIcon, TrashIcon } from './icons';

type Update<F> = (fn: (f: F) => F, key?: string) => void;

function useUpdate<F extends Feature>(f: F): Update<F> {
  const updateFeature = useStore((s) => s.updateFeature);
  return (fn, key) => updateFeature<F>(f.id, fn, key && `${f.id}:${key}`);
}

export function Inspector() {
  const feature = useStore(selectedFeature);
  const doc = useStore((s) => s.doc);
  if (!feature) return <Checklist />;
  const derived = derive(doc);
  const title = featureTitle(feature, derived.infos);
  let body: ReactNode = null;
  switch (feature.kind) {
    case 'runway':
      body = <RunwayEditor r={feature} info={derived.infos.get(feature.id)} />;
      break;
    case 'taxiway':
      body = <TaxiwayEditor t={feature} />;
      break;
    case 'area':
      body = <AreaEditor a={feature} />;
      break;
    case 'label':
      body = <LabelEditor l={feature} />;
      break;
    case 'symbol':
      body = <SymbolEditor s={feature} />;
      break;
    case 'hotspot':
      body = <HotspotEditor h={feature} />;
      break;
  }
  return (
    <div className="inspector" key={feature.id}>
      <div className="inspector-head">
        <div className="kind">{kindName(feature)}</div>
        <h2>{feature.kind === 'runway' ? derived.infos.get(feature.id)?.names.join(' / ') : title.replace(/^[^·]*·\s*/, '')}</h2>
      </div>
      {body}
      <FeatureActions f={feature} />
    </div>
  );
}

function kindName(f: Feature): string {
  switch (f.kind) {
    case 'runway':
      return 'Runway';
    case 'taxiway':
      return 'Taxiway';
    case 'area':
      return f.areaType === 'apron' ? 'Apron / ramp' : f.areaType === 'building' ? 'Building' : 'Unpaved area';
    case 'label':
      return 'Label';
    case 'symbol':
      return 'Symbol';
    case 'hotspot':
      return 'Hot spot';
  }
}

function FeatureActions({ f }: { f: Feature }) {
  const reorder = useStore((st) => st.reorder);
  const patchFeature = useStore((st) => st.patchFeature);
  const duplicateFeature = useStore((st) => st.duplicateFeature);
  const deleteFeature = useStore((st) => st.deleteFeature);
  const s = { reorder, patchFeature, duplicateFeature, deleteFeature };
  return (
    <div className="actions">
      <button type="button" className="btn ghost" onClick={() => s.reorder(f.id, -1)} title="Send backward">
        <ArrowDownIcon size={16} /> Back
      </button>
      <button type="button" className="btn ghost" onClick={() => s.reorder(f.id, 1)} title="Bring forward">
        <ArrowUpIcon size={16} /> Front
      </button>
      <button type="button" className="btn ghost" onClick={() => s.patchFeature(f.id, { hidden: !f.hidden })} title="Hide or show">
        <EyeIcon size={16} off={f.hidden} /> {f.hidden ? 'Show' : 'Hide'}
      </button>
      <button type="button" className="btn ghost" onClick={() => s.duplicateFeature(f.id)} title="Duplicate (Ctrl+D)">
        <CopyIcon size={16} /> Duplicate
      </button>
      <button type="button" className="btn danger" onClick={() => s.deleteFeature(f.id)} title="Delete (Del)">
        <TrashIcon size={16} /> Delete
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Runway                                                              */
/* ------------------------------------------------------------------ */

const WIDTHS = [60, 75, 100, 150, 200];

function RunwayEditor({ r, info }: { r: Runway; info?: RunwayInfo }) {
  const update = useUpdate(r);
  const magVar = useStore((s) => s.doc.meta.magVar);
  const addFeature = useStore((s) => s.addFeature);
  const L = runwayLength(r);

  const setLength = (len: number | undefined) => {
    if (!len || len < 100) return;
    update((x) => ({ ...x, b: add(x.a, mul(landingDir(x, 0), len)) }), 'len');
  };
  const setHeading = (mag: number | undefined) => {
    if (mag === undefined) return;
    update((x) => {
      const c = mid(x.a, x.b);
      const d = dirFromBearing(toTrue(mag, magVar));
      const half = runwayLength(x) / 2;
      return { ...x, a: add(c, mul(d, -half)), b: add(c, mul(d, half)) };
    }, 'hdg');
  };
  const addParallel = () => {
    const off = mul(rightOf(landingDir(r, 0)), Math.max(700, r.width * 5));
    const p = newRunway(add(r.a, off), add(r.b, off), r.width);
    p.surface = r.surface;
    p.ends = [
      { ...r.ends[0], elevation: undefined },
      { ...r.ends[1], elevation: undefined },
    ];
    addFeature(p);
  };

  return (
    <>
      <div className="stats">
        <Stat label="Length" value={`${Math.round(L).toLocaleString('en-US')} ft`} />
        <Stat label="Width" value={`${r.width} ft`} />
        <Stat label="Mag hdg" value={info ? formatBearing(info.magHdg[0]) : '—'} />
        <Stat label="True hdg" value={info ? formatBearing(info.trueHdg[0]) : '—'} />
      </div>
      <Section title="Dimensions">
        <Field label="Length" htmlFor="rwy-len">
          <NumberInput id="rwy-len" value={L} onChange={setLength} step={50} min={100} digits={0} unit="ft" />
        </Field>
        <Field label="Width" htmlFor="rwy-width">
          <Segmented
            size="sm"
            value={WIDTHS.includes(r.width) ? r.width : -1}
            options={WIDTHS.map((w) => ({ value: w, label: String(w) }))}
            onChange={(w) => update((x) => ({ ...x, width: w }))}
            label="Runway width"
          />
          <NumberInput id="rwy-width" value={r.width} onChange={(w) => w && update((x) => ({ ...x, width: w }), 'w')} min={10} max={400} digits={0} unit="ft" />
        </Field>
        <Field
          label={`Heading (${info?.names[0] ?? 'end 1'})`}
          htmlFor="rwy-hdg"
          hint="Magnetic. The runway number follows it: heading ÷ 10, rounded."
        >
          <NumberInput id="rwy-hdg" value={info?.magHdg[0]} onChange={setHeading} step={1} min={0} max={360} digits={1} unit="° mag" />
        </Field>
        <Field label="Surface" htmlFor="rwy-surface">
          <Select<SurfaceType>
            id="rwy-surface"
            value={r.surface}
            options={[
              { value: 'asphalt', label: 'Asphalt' },
              { value: 'concrete', label: 'Concrete' },
              { value: 'turf', label: 'Turf' },
              { value: 'gravel', label: 'Gravel' },
            ]}
            onChange={(v) => update((x) => ({ ...x, surface: v }))}
          />
        </Field>
        <Toggle id="rwy-closed" checked={r.closed} onChange={(v) => update((x) => ({ ...x, closed: v }))} label="Closed runway (X marks)" />
      </Section>

      {([0, 1] as const).map((e) => (
        <RunwayEndEditor key={e} r={r} e={e} info={info} update={update} />
      ))}

      <Section title="Chart labels" defaultOpen={false}>
        <Field label="Length × width label" hint="Move it to the other side if it collides with a taxiway name.">
          <Segmented<'left' | 'right' | 'none'>
            size="sm"
            value={r.dimsSide ?? 'left'}
            options={[
              { value: 'left', label: sideName(leftOf(landingDir(r, 0))) },
              { value: 'right', label: sideName(rightOf(landingDir(r, 0))) },
              { value: 'none', label: 'Hidden' },
            ]}
            onChange={(v) => update((x) => ({ ...x, dimsSide: v }))}
            label="Dimensions label side"
          />
        </Field>
      </Section>

      <Section title="Hold-short lines" defaultOpen={false}>
        <Field
          label="Distance from centerline"
          htmlFor="rwy-hold"
          hint="Lines are placed automatically wherever a taxiway enters the runway. Empty uses the default for this width."
        >
          <NumberInput
            id="rwy-hold"
            value={r.holdDistance}
            placeholder={String(defaultHoldDistance(r))}
            onChange={(v) => update((x) => ({ ...x, holdDistance: v }), 'hold')}
            min={50}
            max={1000}
            digits={0}
            unit="ft"
            allowEmpty
          />
        </Field>
      </Section>

      <div className="btn-row">
        <button type="button" className="btn" onClick={addParallel}>
          Add parallel runway
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => update((x) => ({ ...x, a: x.b, b: x.a, ends: [x.ends[1], x.ends[0]] }))}
        >
          Swap ends
        </button>
      </div>
    </>
  );
}

function RunwayEndEditor({ r, e, info, update }: { r: Runway; e: 0 | 1; info?: RunwayInfo; update: Update<Runway> }) {
  const end = r.ends[e];
  const patch = (p: Partial<RunwayEnd>, key?: string) =>
    update(
      (x) => ({ ...x, ends: (e === 0 ? [{ ...x.ends[0], ...p }, x.ends[1]] : [x.ends[0], { ...x.ends[1], ...p }]) as Runway['ends'] }),
      key && `end${e}:${key}`,
    );
  const id = (k: string) => `end${e}-${k}`;
  return (
    <Section title={<>Runway {info?.names[e] ?? (e === 0 ? 'end 1' : 'end 2')}</>} defaultOpen={false}>
      <Field label="Markings" hint={markingHint(end.marking)}>
        <Segmented<MarkingType>
          size="sm"
          value={end.marking}
          options={[
            { value: 'visual', label: 'Visual' },
            { value: 'nonprecision', label: 'Non-precision' },
            { value: 'precision', label: 'Precision' },
          ]}
          onChange={(v) => patch({ marking: v })}
          label="Marking type"
        />
      </Field>
      <Row>
        <Field label="Displaced threshold" htmlFor={id('disp')}>
          <NumberInput id={id('disp')} value={end.displaced} onChange={(v) => patch({ displaced: v ?? 0 }, 'disp')} min={0} step={50} digits={0} unit="ft" />
        </Field>
        <Field label="Blast pad" htmlFor={id('stop')}>
          <NumberInput id={id('stop')} value={end.stopway} onChange={(v) => patch({ stopway: v ?? 0 }, 'stop')} min={0} step={50} digits={0} unit="ft" />
        </Field>
      </Row>
      <Field label="Threshold elevation" htmlFor={id('elev')}>
        <NumberInput
          id={id('elev')}
          value={end.elevation}
          onChange={(v) => patch({ elevation: v }, 'elev')}
          placeholder="Not charted"
          digits={0}
          unit="ft MSL"
          allowEmpty
        />
      </Field>
      <Row>
        <Field label="Number" htmlFor={id('num')}>
          <TextInput id={id('num')} value={end.designator} placeholder={info?.numbers[e] ?? 'auto'} onChange={(v) => patch({ designator: v.replace(/[^0-9]/g, '').slice(0, 2) }, 'num')} />
        </Field>
        <Field label="Letter" htmlFor={id('suffix')}>
          <Select<Suffix | 'auto'>
            id={id('suffix')}
            value={end.suffix}
            options={[
              { value: 'auto', label: `Auto${info?.suffixes[e] ? ` (${info.suffixes[e]})` : ''}` },
              { value: '', label: 'None' },
              { value: 'L', label: 'L' },
              { value: 'C', label: 'C' },
              { value: 'R', label: 'R' },
            ]}
            onChange={(v) => patch({ suffix: v })}
          />
        </Field>
      </Row>
    </Section>
  );
}

/** "North side", "Southeast side"... for a unit vector in screen space. */
function sideName(n: Vec): string {
  const ns = n.y < -0.38 ? 'North' : n.y > 0.38 ? 'South' : '';
  const ew = n.x > 0.38 ? 'east' : n.x < -0.38 ? 'west' : '';
  const name = ns ? ns + ew : ew.charAt(0).toUpperCase() + ew.slice(1);
  return `${name} side`;
}

function markingHint(m: MarkingType): string {
  switch (m) {
    case 'visual':
      return 'Number and centerline only.';
    case 'nonprecision':
      return 'Adds threshold bars and aiming point.';
    case 'precision':
      return 'Adds touchdown zone bars and side stripes.';
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

function NodeTools({ f, closed }: { f: Taxiway | Area; closed: boolean }) {
  const node = useStore((s) => s.selection.node);
  const autoSmooth = useStore((s) => s.autoSmooth);
  const select = useStore((s) => s.select);
  const update = useUpdate<Taxiway | Area>(f);
  const n = node !== null ? f.nodes[node] : undefined;
  const min = f.kind === 'area' ? 3 : 2;
  const setAll = (mode: 'smooth' | 'corner') =>
    update((x) => ({ ...x, nodes: x.nodes.map((nn, i) => (mode === 'corner' ? cornerNode(nn) : smoothNode(x.nodes, i, closed))) }));

  return (
    <Section title={`Shape · ${f.nodes.length} points`}>
      {f.kind === 'taxiway' && (
        <div className="smooth-box">
          <button type="button" className="btn primary wide" onClick={() => autoSmooth(f.id)}>
            <SmoothIcon size={18} /> Auto-smooth
          </button>
          <p className="field-hint">
            Keeps the first and last points and rebuilds the taxiway the way real ones are laid out: straight legs, squared
            to the runway or taxiway they meet, joined by turns at the FAA centerline radius for its width. A straight line
            when the path never strays far from one. Taxiways attached to it move with it.
          </p>
        </div>
      )}
      {n && node !== null ? (
        <div className="node-box">
          <div className="node-title">Point {node + 1}</div>
          <Row>
            <Field label="East" htmlFor="node-x">
              <NumberInput
                id="node-x"
                value={n.p.x}
                digits={0}
                unit="ft"
                onChange={(v) =>
                  v !== undefined &&
                  update((x) => {
                    const nodes = x.nodes.slice();
                    const d = { x: v - nodes[node].p.x, y: 0 };
                    const o = nodes[node];
                    nodes[node] = { ...o, p: add(o.p, d), in: o.in && add(o.in, d), out: o.out && add(o.out, d) };
                    return { ...x, nodes };
                  }, `nx${node}`)
                }
              />
            </Field>
            <Field label="South" htmlFor="node-y">
              <NumberInput
                id="node-y"
                value={n.p.y}
                digits={0}
                unit="ft"
                onChange={(v) =>
                  v !== undefined &&
                  update((x) => {
                    const nodes = x.nodes.slice();
                    const d = { x: 0, y: v - nodes[node].p.y };
                    const o = nodes[node];
                    nodes[node] = { ...o, p: add(o.p, d), in: o.in && add(o.in, d), out: o.out && add(o.out, d) };
                    return { ...x, nodes };
                  }, `ny${node}`)
                }
              />
            </Field>
          </Row>
          <Segmented
            size="sm"
            value={n.in || n.out ? 'curve' : 'corner'}
            options={[
              { value: 'corner', label: 'Corner' },
              { value: 'curve', label: 'Curve' },
            ]}
            onChange={(v) =>
              update((x) => {
                const nodes = x.nodes.slice();
                nodes[node] = v === 'corner' ? cornerNode(nodes[node]) : smoothNode(nodes, node, closed);
                return { ...x, nodes };
              })
            }
            label="Point type"
          />
          <button
            type="button"
            className="btn ghost"
            disabled={f.nodes.length <= min}
            onClick={() => {
              update((x) => ({ ...x, nodes: x.nodes.filter((_, i) => i !== node) }));
              select(f.id, null);
            }}
          >
            <TrashIcon size={16} /> Remove point
          </button>
        </div>
      ) : (
        <p className="muted small">Click a square handle to edit a point. Double-click the path to add one; double-click a point to switch corner ↔ curve. Alt-drag a curve handle to break its symmetry.</p>
      )}
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setAll('smooth')} title="Round every point, keeping them all">
          Curve through points
        </button>
        <button type="button" className="btn" onClick={() => setAll('corner')} title="Make every point a sharp corner">
          Sharp corners
        </button>
        {f.kind === 'taxiway' && (
          <button type="button" className="btn" onClick={() => update((x) => ({ ...x, nodes: reverseNodes(x.nodes) }))}>
            Reverse
          </button>
        )}
      </div>
    </Section>
  );
}

const TAXI_WIDTHS = [25, 35, 50, 75];

function TaxiwayEditor({ t }: { t: Taxiway }) {
  const update = useUpdate(t);
  const twins = useStore(
    (s) => s.doc.features.filter((f) => f.kind === 'taxiway' && f.id !== t.id && f.name === t.name && t.name !== '').length,
  );
  return (
    <>
      <Section title="Taxiway">
        <Row>
          <Field
            label="Name"
            htmlFor="tw-name"
            hint={
              twins > 0
                ? `${twins} other path${twins === 1 ? ' is' : 's are'} also named ${t.name}; fine if they're pieces of one taxiway.`
                : 'Or double-click the name on the chart, or press F2.'
            }
          >
            <TextInput id="tw-name" value={t.name} upper onChange={(v) => update((x) => ({ ...x, name: cleanTaxiwayName(v) }), 'name')} />
          </Field>
          <Field label="Width" htmlFor="tw-width">
            <NumberInput id="tw-width" value={t.width} onChange={(v) => v && update((x) => ({ ...x, width: v }), 'w')} min={10} max={200} digits={0} unit="ft" />
          </Field>
        </Row>
        <Segmented
          size="sm"
          value={TAXI_WIDTHS.includes(t.width) ? t.width : -1}
          options={TAXI_WIDTHS.map((w) => ({ value: w, label: `${w} ft` }))}
          onChange={(w) => update((x) => ({ ...x, width: w }))}
          label="Taxiway width"
        />
        <Toggle id="tw-label" checked={t.showLabel} onChange={(v) => update((x) => ({ ...x, showLabel: v }))} label="Show name on chart" />
        {t.showLabel && (
          <Field label="Name position" htmlFor="tw-label-t" hint="Or drag the diamond handle along the taxiway.">
            <input
              id="tw-label-t"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={t.labelT}
              onChange={(e) => update((x) => ({ ...x, labelT: Number(e.target.value) }), 'labelT')}
            />
          </Field>
        )}
        <Toggle id="tw-edge" checked={t.edgeLines} onChange={(v) => update((x) => ({ ...x, edgeLines: v }))} label="Yellow edge lines (surface view)" />
      </Section>
      <NodeTools f={t} closed={t.closed} />
    </>
  );
}

function AreaEditor({ a }: { a: Area }) {
  const update = useUpdate(a);
  return (
    <>
      <Section title="Area">
        <Field label="Type">
          <Segmented<AreaType>
            size="sm"
            value={a.areaType}
            options={[
              { value: 'apron', label: 'Apron' },
              { value: 'building', label: 'Building' },
              { value: 'unpaved', label: 'Unpaved' },
            ]}
            onChange={(v) => update((x) => ({ ...x, areaType: v }))}
            label="Area type"
          />
        </Field>
        <Field label="Name" htmlFor="area-name">
          <TextInput
            id="area-name"
            value={a.name}
            upper
            placeholder={a.areaType === 'building' ? 'e.g. TERMINAL' : 'e.g. EAST RAMP'}
            onChange={(v) => update((x) => ({ ...x, name: v, showLabel: v ? x.showLabel || !x.name : x.showLabel }), 'name')}
          />
        </Field>
        <Toggle id="area-label" checked={a.showLabel} onChange={(v) => update((x) => ({ ...x, showLabel: v }))} label="Show name on chart" />
        <Field label="Rotate">
          <div className="btn-row tight">
            {[-15, -5, 5, 15].map((d) => (
              <button key={d} type="button" className="btn" onClick={() => update((x) => rotateFeature(x, d) as Area, 'rot')}>
                {d > 0 ? `+${d}°` : `${d}°`}
              </button>
            ))}
          </div>
        </Field>
      </Section>
      <NodeTools f={a} closed />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Annotations                                                         */
/* ------------------------------------------------------------------ */

function LabelEditor({ l }: { l: Label }) {
  const update = useUpdate(l);
  const focusTick = useStore((s) => s.focusTick);
  return (
    <Section title="Label">
      <Field label="Text" htmlFor="label-text" hint="Chart labels are traditionally all caps. Enter for a new line.">
        <TextInput id="label-text" multiline rows={2} value={l.text} upper onChange={(v) => update((x) => ({ ...x, text: v }), 'text')} autoFocusTick={focusTick} />
      </Field>
      <Row>
        <Field label="Size" htmlFor="label-size">
          <NumberInput id="label-size" value={l.size} onChange={(v) => v && update((x) => ({ ...x, size: v }), 'size')} min={2} max={40} step={0.5} unit="pt" />
        </Field>
        <Field label="Rotation" htmlFor="label-rot">
          <NumberInput id="label-rot" value={l.rotation} onChange={(v) => update((x) => ({ ...x, rotation: v ?? 0 }), 'rot')} step={1} digits={0} unit="°" />
        </Field>
      </Row>
      <Toggle id="label-box" checked={l.boxed} onChange={(v) => update((x) => ({ ...x, boxed: v }))} label="Draw a box around it" />
    </Section>
  );
}

function SymbolEditor({ s }: { s: MapSymbol }) {
  const update = useUpdate(s);
  return (
    <Section title="Symbol">
      <Field label="Type" htmlFor="sym-type">
        <Select<SymbolType>
          id="sym-type"
          value={s.symbol}
          options={(Object.keys(SYMBOL_NAMES) as SymbolType[]).map((k) => ({ value: k, label: SYMBOL_NAMES[k] }))}
          onChange={(v) => update((x) => ({ ...x, symbol: v }))}
        />
      </Field>
      <Field label="Label" htmlFor="sym-label" hint={s.symbol === 'tower' ? 'Empty shows TWR.' : undefined}>
        <TextInput id="sym-label" value={s.label} upper onChange={(v) => update((x) => ({ ...x, label: v }), 'label')} />
      </Field>
    </Section>
  );
}

function HotspotEditor({ h }: { h: Hotspot }) {
  const update = useUpdate(h);
  return (
    <Section title="Hot spot">
      <p className="muted small">A location with a history of, or potential for, collisions or runway incursions. Charted as a circle with an HS callout.</p>
      <Row>
        <Field label="Callout" htmlFor="hs-label">
          <TextInput id="hs-label" value={h.label} upper onChange={(v) => update((x) => ({ ...x, label: v }), 'label')} />
        </Field>
        <Field label="Radius" htmlFor="hs-radius">
          <NumberInput id="hs-radius" value={h.radius} onChange={(v) => v && update((x) => ({ ...x, radius: v }), 'r')} min={50} step={25} digits={0} unit="ft" />
        </Field>
      </Row>
    </Section>
  );
}
