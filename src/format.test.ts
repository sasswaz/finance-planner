import { describe, expect, it } from 'vitest';
import { parseAmount } from './format';

describe('parseAmount', () => {
  it.each([
    ['1200', 1200],
    ['1,200', 1200],
    ['2,500', 2500],
    ['1,200,000', 1_200_000],
    ['1 200', 1200],
    ['€1,200', 1200],
    ['1,200.50', 1200.5],
    ['1.234,56', 1234.56],
    ['2,5', 2.5],
    ['1.5', 1.5],
    ['1.200', 1.2],
    ['-3', -3],
    ['12.', 12],
    ['0', 0],
  ])('en-GB: %s → %s', (raw, expected) => {
    expect(parseAmount(raw, 'en-GB')).toBe(expected);
  });

  it.each([
    ['1.200', 1200],
    ['1 234,56', 1234.56],
    ['2,5', 2.5],
    ['1234.5', 1234.5],
  ])('bg-BG: %s → %s', (raw, expected) => {
    expect(parseAmount(raw, 'bg-BG')).toBe(expected);
  });

  it('returns null when there is no number', () => {
    expect(parseAmount('', 'en-GB')).toBeNull();
    expect(parseAmount('abc', 'en-GB')).toBeNull();
    expect(parseAmount('-', 'en-GB')).toBeNull();
  });

  it.each([
    ['0,500', 'en-GB', 0.5],
    ['0.125', 'bg-BG', 0.125],
    ['1200,50 лв.', 'bg-BG', 1200.5],
    ['843,21 лв.', 'bg-BG', 843.21],
    ['1.200 kr.', 'en-GB', 1.2],
    ['−1200', 'en-GB', -1200],
    ['1,125', 'de-DE', 1.125],
  ])('reads %s in %s as %s', (raw, locale, expected) => {
    expect(parseAmount(raw, locale)).toBe(expected);
  });

  it('prefers a decimal reading for percentages and multiples', () => {
    expect(parseAmount('3.125', 'de-DE')).toBe(3125);
    expect(parseAmount('3.125', 'de-DE', { preferDecimal: true })).toBe(3.125);
    expect(parseAmount('1,250', 'en-GB', { preferDecimal: true })).toBe(1.25);
    expect(parseAmount('1,250,000', 'en-GB', { preferDecimal: true })).toBe(1_250_000);
  });
});
