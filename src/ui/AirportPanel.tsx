import { derive } from '../model/derive';
import { sheetLayout } from '../model/sheet';
import { emptyDoc } from '../model/defaults';
import { sampleDoc } from '../model/sample';
import type { Frequency } from '../model/types';
import { useStore } from '../store/store';
import { Field, NumberInput, Row, Section, Segmented, TextInput, Toggle } from './fields';
import { PlusIcon, TrashIcon } from './icons';

export function AirportPanel() {
  const meta = useStore((s) => s.doc.meta);
  const doc = useStore((s) => s.doc);
  const patchMeta = useStore((s) => s.patchMeta);
  const loadDoc = useStore((s) => s.loadDoc);
  const showToast = useStore((s) => s.showToast);
  const autoScale = sheetLayout({ ...doc, meta: { ...meta, textScale: undefined } }, derive(doc).bounds).textScale;

  const setFreq = (i: number, patch: Partial<Frequency>) =>
    patchMeta({ frequencies: meta.frequencies.map((f, k) => (k === i ? { ...f, ...patch } : f)) }, `freq${i}`);

  return (
    <div className="inspector">
      <div className="inspector-head">
        <div className="kind">Airport</div>
        <h2>
          {meta.name} ({meta.ident})
        </h2>
      </div>

      <Section title="Identity">
        <Field label="Airport name" htmlFor="ap-name">
          <TextInput id="ap-name" value={meta.name} upper onChange={(v) => patchMeta({ name: v }, 'name')} />
        </Field>
        <Row>
          <Field label="Identifier" htmlFor="ap-ident">
            <TextInput id="ap-ident" value={meta.ident} upper onChange={(v) => patchMeta({ ident: v.slice(0, 5) }, 'ident')} />
          </Field>
          <Field label="Field elevation" htmlFor="ap-elev">
            <NumberInput id="ap-elev" value={meta.elevation} onChange={(v) => patchMeta({ elevation: v ?? 0 }, 'elev')} digits={0} unit="ft" />
          </Field>
        </Row>
        <Row>
          <Field label="City" htmlFor="ap-city">
            <TextInput id="ap-city" value={meta.city} upper onChange={(v) => patchMeta({ city: v }, 'city')} />
          </Field>
          <Field label="State" htmlFor="ap-state">
            <TextInput id="ap-state" value={meta.state} upper onChange={(v) => patchMeta({ state: v }, 'state')} />
          </Field>
        </Row>
      </Section>

      <Section title="Magnetic variation">
        <Row>
          <Field label="Variation" htmlFor="ap-var">
            <NumberInput
              id="ap-var"
              value={Math.abs(meta.magVar)}
              onChange={(v) => patchMeta({ magVar: (v ?? 0) * (meta.magVar < 0 ? -1 : 1) }, 'var')}
              min={0}
              max={60}
              step={0.1}
              unit="°"
            />
          </Field>
          <Field label="Direction">
            <Segmented
              size="sm"
              value={meta.magVar < 0 ? 'W' : 'E'}
              options={[
                { value: 'E', label: 'East' },
                { value: 'W', label: 'West' },
              ]}
              onChange={(d) => patchMeta({ magVar: Math.abs(meta.magVar) * (d === 'W' ? -1 : 1) })}
              label="Variation direction"
            />
          </Field>
        </Row>
        <p className="muted small">Runway numbers are magnetic: changing variation renumbers runways whose heading crosses a boundary. Magnetic = true − east variation.</p>
        <Toggle id="ap-zero" checked={meta.leadingZero} onChange={(v) => patchMeta({ leadingZero: v })} label='Leading zero ("09" instead of "9")' />
      </Section>

      <Section title="Frequencies">
        <div className="freqs">
          {meta.frequencies.map((f, i) => (
            <div className="freq-row" key={i}>
              <TextInput id={`freq-name-${i}`} value={f.name} upper placeholder="TOWER" onChange={(v) => setFreq(i, { name: v })} />
              <TextInput id={`freq-val-${i}`} value={f.value} placeholder="118.3" onChange={(v) => setFreq(i, { value: v })} />
              <button
                type="button"
                className="icon-btn"
                aria-label="Remove frequency"
                onClick={() => patchMeta({ frequencies: meta.frequencies.filter((_, k) => k !== i) })}
              >
                <TrashIcon size={16} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn ghost"
          onClick={() => patchMeta({ frequencies: [...meta.frequencies, { name: '', value: '' }] })}
        >
          <PlusIcon size={16} /> Add frequency
        </button>
      </Section>

      <Section title="Chart sheet" defaultOpen={false}>
        <Field label="Chart code" htmlFor="ap-code">
          <TextInput id="ap-code" value={meta.chartCode} upper onChange={(v) => patchMeta({ chartCode: v }, 'code')} />
        </Field>
        <Field label="Effective dates" htmlFor="ap-eff" hint='Printed in the margins, e.g. "SW-4, 01 OCT 2026 TO 29 OCT 2026".'>
          <TextInput id="ap-eff" value={meta.effective} upper onChange={(v) => patchMeta({ effective: v }, 'eff')} />
        </Field>
        <Field label="Notes" htmlFor="ap-notes" hint="Printed under the frequency box.">
          <TextInput id="ap-notes" multiline value={meta.notes} upper onChange={(v) => patchMeta({ notes: v }, 'notes')} />
        </Field>
        <Field
          label="Text scale"
          htmlFor="ap-ts"
          hint={`Feet per chart point. Empty fits the airport to the sheet (now ${autoScale}).`}
        >
          <NumberInput
            id="ap-ts"
            value={meta.textScale}
            placeholder={String(autoScale)}
            onChange={(v) => patchMeta({ textScale: v && v > 0 ? v : undefined }, 'ts')}
            min={0.5}
            step={1}
            unit="ft/pt"
            allowEmpty
          />
        </Field>
        <Toggle
          id="ap-holds"
          checked={meta.showHoldLinesOnChart}
          onChange={(v) => patchMeta({ showHoldLinesOnChart: v })}
          label="Chart hold-short lines"
        />
      </Section>

      <Section title="Coordinates" defaultOpen={false}>
        <p className="muted small">Latitude and longitude of the drawing's origin (the crosshair on the grid). Enables coordinate ticks on the chart border.</p>
        <Row>
          <Field label="Latitude" htmlFor="ap-lat">
            <NumberInput id="ap-lat" value={meta.refLat} onChange={(v) => patchMeta({ refLat: v }, 'lat')} min={-85} max={85} step={0.0001} digits={5} unit="°N" allowEmpty />
          </Field>
          <Field label="Longitude" htmlFor="ap-lon">
            <NumberInput id="ap-lon" value={meta.refLon} onChange={(v) => patchMeta({ refLon: v }, 'lon')} min={-180} max={180} step={0.0001} digits={5} unit="°E" allowEmpty />
          </Field>
        </Row>
      </Section>

      <Section title="Start over" defaultOpen={false}>
        <p className="muted small">Both can be undone with Ctrl+Z.</p>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              loadDoc(emptyDoc());
              showToast('Started a blank airport. Undo brings the old one back.');
            }}
          >
            Blank airport
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              loadDoc(sampleDoc());
              showToast('Loaded the sample airport.');
            }}
          >
            Load sample
          </button>
        </div>
      </Section>
    </div>
  );
}
