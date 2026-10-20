import { useEffect, useId, useState, type ReactNode } from 'react';
import { currentYM } from '../engine/dates';
import type { Frequency, YM } from '../types';
import { parseAmount } from '../format';
import { usePlan } from '../store';

/**
 * A captioned form field. By default it's a <label> wrapping a single control, so clicking the
 * caption focuses it. Pass `group` when it holds a Segmented, a MonthInput or several controls:
 * a <label> would forward caption clicks to the first button inside (silently flipping it), so
 * this renders a named role="group" instead.
 */
export function Field({ label, hint, group, children }: { label: string; hint?: ReactNode; group?: boolean; children: ReactNode }) {
  const id = useId();
  if (group) {
    return (
      <div className="field" role="group" aria-labelledby={id}>
        <span id={id} className="field-label">
          {label}
        </span>
        {children}
        {hint && <span className="field-hint">{hint}</span>}
      </div>
    );
  }
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      className="input"
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function groupNumber(n: number, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  } catch {
    return String(n);
  }
}

/**
 * The value as it's shown while editing: the locale's decimal mark ("1,125" in de-DE) and no
 * grouping, so it reads back to the same number. Falls back to String(n) if it wouldn't.
 */
function editNumber(n: number, locale: string, preferDecimal: boolean) {
  try {
    const s = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 6 }).format(n);
    const back = parseAmount(s, locale, { preferDecimal });
    if (back !== null && Math.abs(back - n) <= 1e-6 * Math.max(1, Math.abs(n))) return s;
  } catch {
    // Unknown locale: fall through.
  }
  return String(n);
}

/** Number input that tolerates half-typed values ("", "12,") without fighting the user. */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  ariaLabel,
  width,
  decimal = true,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  ariaLabel?: string;
  width?: number;
  /**
   * Read a lone separator as the decimal mark ("1.125" or "1,125" is 1.125), right for rates,
   * months and multiples. Money passes false so "1,200" is read as thousands grouping.
   */
  decimal?: boolean;
}) {
  const { plan } = usePlan();
  const locale = plan.settings.locale;
  const parse = (raw: string) => parseAmount(raw, locale, { preferDecimal: decimal });
  const toText = (n: number) => editNumber(n, locale, decimal);
  const [text, setText] = useState(() => toText(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (parse(text) !== value) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const display = focused ? text : groupNumber(value, locale);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

  const commit = (raw: string) => {
    setText(raw);
    const n = parse(raw);
    if (n !== null) onChange(clamp(n));
  };

  return (
    <span className="input-affix" style={width ? { width } : undefined}>
      <input
        className="input num"
        type="text"
        inputMode="decimal"
        value={display}
        aria-label={ariaLabel}
        style={suffix ? { paddingRight: 16 + suffix.length * 7 } : undefined}
        onChange={(e) => commit(e.target.value)}
        onFocus={() => {
          setText(toText(value));
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          setText(toText(value));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const n = Math.round((value + (e.key === 'ArrowUp' ? step : -step)) * 100) / 100;
            commit(toText(clamp(n)));
          }
        }}
      />
      {suffix && <span className="affix">{suffix}</span>}
    </span>
  );
}

export function MoneyInput(props: Omit<Parameters<typeof NumberInput>[0], 'suffix' | 'step' | 'decimal'>) {
  const { plan } = usePlan();
  return <NumberInput step={10} min={0} {...props} decimal={false} suffix={plan.settings.currency} />;
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[] | readonly T[];
  ariaLabel?: string;
}) {
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
  return (
    <select
      className="input select"
      value={String(value)}
      aria-label={ariaLabel}
      onChange={(e) => {
        const picked = opts.find((o) => String(o.value) === e.target.value);
        if (picked) onChange(picked.value);
      }}
    >
      {opts.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const YEARS_BACK = 15;
const YEARS_AHEAD = 45;

/**
 * Month + year pickers. Native <input type="month"> isn't supported in Safari or
 * Firefox, so this is built from two selects that work everywhere.
 */
export function MonthInput({
  value,
  onChange,
  optional,
  emptyLabel = 'No end',
  ariaLabel,
  invalid,
}: {
  value: YM | undefined;
  onChange: (v: YM | undefined) => void;
  optional?: boolean;
  emptyLabel?: string;
  ariaLabel?: string;
  /** Marks the value as wrong, e.g. an end month before the start. */
  invalid?: boolean;
}) {
  const { fmt } = usePlan();
  const id = useId();
  const now = currentYM();
  const thisYear = Number(now.slice(0, 4));
  const thisMonth = Number(now.slice(5, 7));
  const y = value ? Number(value.slice(0, 4)) : thisYear;
  const m = value ? Number(value.slice(5, 7)) : 0;
  const years = [];
  for (let i = Math.min(thisYear - YEARS_BACK, y); i <= Math.max(thisYear + YEARS_AHEAD, y); i++) years.push(i);
  const set = (yy: number, mm: number) => onChange(`${yy}-${String(mm).padStart(2, '0')}`);

  return (
    <span
      className={`month-input${invalid ? ' invalid' : ''}`}
      // Unnamed, the wrapper is just layout: callers put it inside a named Field group.
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
      title={invalid ? 'Ends before it starts' : undefined}
      id={id}
    >
      <select
        className="input select"
        aria-label={ariaLabel ? `${ariaLabel} month` : 'Month'}
        aria-invalid={invalid || undefined}
        value={m}
        onChange={(e) => {
          const mm = Number(e.target.value);
          if (mm === 0) onChange(undefined);
          // From the empty state, pick the next time that month comes round, never one already past.
          else if (!value) set(mm >= thisMonth ? thisYear : thisYear + 1, mm);
          else set(y, mm);
        }}
      >
        {optional && <option value={0}>{emptyLabel}</option>}
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {fmt.monthName(i + 1).slice(0, 3)}
          </option>
        ))}
      </select>
      {value && (
        <select
          className="input select"
          aria-label={ariaLabel ? `${ariaLabel} year` : 'Year'}
          aria-invalid={invalid || undefined}
          value={y}
          onChange={(e) => set(Number(e.target.value), m)}
        >
          {years.map((yy) => (
            <option key={yy} value={yy}>
              {yy}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

export const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'once', label: 'One-off' },
];

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DeleteButton({ onClick, label = 'Delete' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="icon-btn danger" onClick={onClick} aria-label={label} title={label}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}
