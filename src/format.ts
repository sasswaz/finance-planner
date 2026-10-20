import type { Settings, YM } from './types';

export interface Formatters {
  money: (n: number) => string;
  money2: (n: number) => string;
  compact: (n: number) => string;
  month: (ym: YM) => string;
  monthName: (m: number) => string;
  duration: (months: number) => string;
}

function currencyFormat(s: Settings, opts: Intl.NumberFormatOptions) {
  try {
    return new Intl.NumberFormat(s.locale, { style: 'currency', currency: s.currency, ...opts });
  } catch {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', ...opts });
  }
}

/** Avoids "-€0" for values that round to zero. */
const clean = (n: number, digits: number) => {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

export function makeFormatters(s: Settings): Formatters {
  const m0 = currencyFormat(s, { maximumFractionDigits: 0 });
  const m2 = currencyFormat(s, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const mc = currencyFormat(s, { notation: 'compact', maximumFractionDigits: 1 });
  let monthFmt: Intl.DateTimeFormat;
  let nameFmt: Intl.DateTimeFormat;
  try {
    monthFmt = new Intl.DateTimeFormat(s.locale, { month: 'short', year: 'numeric' });
    nameFmt = new Intl.DateTimeFormat(s.locale, { month: 'long' });
  } catch {
    monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });
    nameFmt = new Intl.DateTimeFormat('en-GB', { month: 'long' });
  }
  return {
    money: (n) => m0.format(clean(n, 0)),
    money2: (n) => m2.format(clean(n, 2)),
    compact: (n) => mc.format(clean(n, 0)),
    month: (ym) => monthFmt.format(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1)),
    monthName: (m) => nameFmt.format(new Date(2000, m - 1, 1)),
    duration: (months) => {
      if (!Number.isFinite(months)) return 'never';
      const y = Math.floor(Math.abs(months) / 12);
      const mo = Math.abs(months) % 12;
      const parts = [];
      if (y) parts.push(`${y} yr${y === 1 ? '' : 's'}`);
      if (mo || !y) parts.push(`${mo} mo`);
      return parts.join(' ');
    },
  };
}

export const CURRENCIES = ['EUR', 'BGN', 'USD', 'GBP', 'CHF', 'PLN', 'RON', 'CZK', 'HUF', 'SEK', 'NOK', 'DKK'];
export const LOCALES: { value: string; label: string }[] = [
  { value: 'en-GB', label: 'English (UK) – 1,234.56' },
  { value: 'en-US', label: 'English (US) – 1,234.56' },
  { value: 'bg-BG', label: 'Български – 1 234,56' },
  { value: 'de-DE', label: 'Deutsch – 1.234,56' },
  { value: 'fr-FR', label: 'Français – 1 234,56' },
];

/**
 * Reads a typed amount the way people write it: "1200", "1,200", "1 200", "€1,200.50",
 * "1.234,56", "1200,50 лв." or "2,5". A lone separator followed by groups of exactly three
 * digits is a thousands separator, unless it's the locale's decimal mark (so "1.200" is 1200
 * in bg-BG but 1.2 in en-GB) or `preferDecimal` is set (percentages, multiples). Returns null
 * when there's no number.
 */
export function parseAmount(raw: string, locale = 'en-GB', opts: { preferDecimal?: boolean } = {}): number | null {
  // Drop words with any dot attached first ("лв.", "kr."), so their dot isn't read as a separator.
  let s = raw
    .replace(/\p{L}[\p{L}.]*/gu, '')
    .replace(/\u2212/g, '-')
    .replace(/[\s\u00a0\u202f']/g, '')
    .replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return null;
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  let decimalMark = '.';
  try {
    decimalMark = new Intl.NumberFormat(locale).format(1.5).includes(',') ? ',' : '.';
  } catch {
    // Unknown locale: assume a decimal point.
  }
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both used: whichever comes last is the decimal mark.
    const dec = lastDot > lastComma ? '.' : ',';
    const parts = s.split(dec);
    const whole = parts.slice(0, -1).join('').replace(/[.,]/g, '');
    s = `${whole}.${parts.at(-1)}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    // Thousands grouping needs 1–3 leading digits (not "0") and groups of exactly three after it.
    const grouped = /^[1-9]\d{0,2}$/.test(parts[0]) && parts.slice(1).every((p) => p.length === 3);
    const thousands = parts.length > 2 || (grouped && sep !== decimalMark && !opts.preferDecimal);
    s = thousands ? parts.join('') : `${parts[0]}.${parts.slice(1).join('')}`;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}
