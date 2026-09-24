import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="field-control">{children}</div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

const fmt = (v: number | undefined, digits: number) =>
  v === undefined || !Number.isFinite(v) ? '' : String(Math.round(v * 10 ** digits) / 10 ** digits);

/** A number box that tolerates half-typed input and only reports parseable numbers. */
export function NumberInput(props: {
  id: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  unit?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  /** Report only when editing ends (blur or Enter), for values that are costly to apply. */
  lazy?: boolean;
}) {
  const { id, value, onChange, step = 1, min, max, digits = 1, unit, placeholder, allowEmpty, lazy } = props;
  const [text, setText] = useState(fmt(value, digits));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value, digits));
  }, [value, digits]);

  const report = (raw: string) => {
    if (raw.trim() === '') {
      if (allowEmpty) onChange(undefined);
      return;
    }
    let n = Number(raw);
    if (!Number.isFinite(n)) return;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    onChange(n);
  };

  return (
    <div className="num">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={text}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          if (lazy && text !== fmt(value, digits)) report(text);
          setText(fmt(value, digits));
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (!lazy) report(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

export function TextInput(props: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  upper?: boolean;
  multiline?: boolean;
  autoFocusTick?: number;
  rows?: number;
}) {
  const { id, value, onChange, placeholder, upper, multiline, autoFocusTick, rows = 3 } = props;
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocusTick && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [autoFocusTick]);
  const change = (v: string) => onChange(upper ? v.toUpperCase() : v);
  return multiline ? (
    <textarea
      id={id}
      ref={ref}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => change(e.target.value)}
      className={upper ? 'upper' : undefined}
    />
  ) : (
    <input
      id={id}
      ref={ref}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => change(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={upper ? 'upper' : undefined}
    />
  );
}

export function Select<T extends string>(props: {
  id: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const name = useId();
  return (
    <div className={`segmented ${props.size ?? 'md'}`} role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={o.value === props.value ? 'on' : undefined}
          title={o.title}
          name={name}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, aside, defaultOpen = true }: { title: ReactNode; children: ReactNode; aside?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header>
        <button type="button" className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="chev" aria-hidden="true">
            ▸
          </span>
          {title}
        </button>
        {aside}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="row">{children}</div>;
}
