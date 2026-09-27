import { useRef, type RefObject } from 'react';
import { runwayLength } from '../model/runway';
import type { Runway } from '../model/types';
import { useStore } from '../store/store';
import { Field, NumberInput, Section, Toggle } from './fields';

/** A hidden picker for an image to trace over. */
export function ReferenceFileInput({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void useStore.getState().importReference(file);
      }}
    />
  );
}

const ft = (n: number) => Math.round(n).toLocaleString('en-US');

/** The Airport tab's controls for the picture being traced. */
export function ReferenceSection() {
  const image = useStore((s) => s.doc.reference);
  const updateReference = useStore((s) => s.updateReference);
  const removeReference = useStore((s) => s.removeReference);
  const inputRef = useRef<HTMLInputElement>(null);
  const choose = () => inputRef.current?.click();

  return (
    <Section title="Reference image">
      {!image ? (
        <>
          <p className="muted small">
            Trace over a satellite view, photo or scanned chart. Paste a screenshot, drop an image on the canvas, or
            choose one. Then draw a runway along one in the picture and type its real length to bring everything to
            scale.
          </p>
          <button type="button" className="btn" onClick={choose}>
            Choose image…
          </button>
        </>
      ) : (
        <>
          <p className="muted small">
            {image.scaledFrom
              ? `To scale: runway ${image.scaledFrom.runway} is ${ft(image.scaledFrom.length)} ft, so one image pixel is ${image.ftPerPx.toPrecision(3)} ft.`
              : 'Not to scale yet. Draw a runway along one in the picture, select it, and type its real length under Real length.'}
          </p>
          <Toggle id="ref-show" checked={image.visible} onChange={(v) => updateReference({ visible: v })} label="Show while editing" />
          <Field label="Opacity" htmlFor="ref-opacity">
            <input
              id="ref-opacity"
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={image.opacity}
              onChange={(e) => updateReference({ opacity: Number(e.target.value) }, 'opacity')}
            />
          </Field>
          <Field label="Rotation" htmlFor="ref-rot" hint="Turn the picture until true north is straight up, before you trace.">
            <NumberInput
              id="ref-rot"
              value={image.rotation}
              onChange={(v) => updateReference({ rotation: v ?? 0 }, 'rotation')}
              step={0.5}
              min={-180}
              max={180}
              digits={1}
              unit="° cw"
            />
          </Field>
          <div className="btn-row">
            <button type="button" className="btn" onClick={choose}>
              Replace…
            </button>
            <button type="button" className="btn" onClick={removeReference}>
              Remove
            </button>
          </div>
        </>
      )}
      <ReferenceFileInput inputRef={inputRef} />
    </Section>
  );
}

/**
 * Under a runway's Length, while tracing: its real length. Entering it scales
 * the reference image and everything drawn so this runway is that long.
 */
export function RealLengthField({ r }: { r: Runway }) {
  const tracing = useStore((s) => !!s.doc.reference);
  const scaleToRunway = useStore((s) => s.scaleToRunway);
  if (!tracing) return null;
  return (
    <div className="calibrate-box">
      <Field
        label="Real length"
        htmlFor="rwy-real"
        hint="Traced this runway over the reference image? Type how long it really is: the image and everything drawn scale to match. Length above stretches only this runway."
      >
        <NumberInput
          id="rwy-real"
          value={undefined}
          onChange={(v) => v && scaleToRunway(r.id, v)}
          min={100}
          max={30000}
          digits={0}
          unit="ft"
          placeholder={String(Math.round(runwayLength(r)))}
          allowEmpty
          lazy
        />
      </Field>
    </div>
  );
}
