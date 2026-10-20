import type { Frequency, YM } from '../types';

export function toIndex(ym: YM): number {
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
}

export function fromIndex(i: number): YM {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export const addMonths = (ym: YM, n: number): YM => fromIndex(toIndex(ym) + n);

/** Months from `a` to `b` (positive when b is later). */
export const monthsBetween = (a: YM, b: YM): number => toIndex(b) - toIndex(a);

export const yearOf = (ym: YM): number => Number(ym.slice(0, 4));
export const monthOf = (ym: YM): number => Number(ym.slice(5, 7));

export function currentYM(now = new Date()): YM {
  return fromIndex(now.getFullYear() * 12 + now.getMonth());
}

export function isValidYM(v: unknown): v is YM {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** Whether a scheduled item (start, optional end, frequency) falls in `ym`. */
export function occursIn(item: { startMonth: YM; endMonth?: YM; frequency: Frequency }, ym: YM): boolean {
  // "YYYY-MM" strings sort chronologically, so range checks need no parsing.
  if (ym < item.startMonth || (item.endMonth && ym > item.endMonth)) return false;
  if (item.frequency === 'monthly') return true;
  const d = monthsBetween(item.startMonth, ym);
  switch (item.frequency) {
    case 'quarterly':
      return d % 3 === 0;
    case 'yearly':
      return d % 12 === 0;
    case 'once':
      return d === 0;
  }
}

/** Average monthly cost of a recurring item; one-off items count as 0. */
export function monthlyEquivalent(amount: number, frequency: Frequency): number {
  switch (frequency) {
    case 'monthly':
      return amount;
    case 'quarterly':
      return amount / 3;
    case 'yearly':
      return amount / 12;
    case 'once':
      return 0;
  }
}
