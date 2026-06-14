import { describe, it, expect } from 'vitest';
import { formatCurrentCultureDateTime, formatLogTimestamp } from './datetime';

const FIXED = new Date(2024, 0, 5, 14, 7, 0); // 2024-01-05 14:07:00 local

describe('formatCurrentCultureDateTime', () => {
  it('produces the en-US culture short-date + medium-time string', () => {
    const s = formatCurrentCultureDateTime(FIXED, 'en-US');
    expect(s).toBe('1/5/24, 2:07:00 PM');
  });

  it('produces a different, locale-driven string for another culture', () => {
    const enUS = formatCurrentCultureDateTime(FIXED, 'en-US');
    const enGB = formatCurrentCultureDateTime(FIXED, 'en-GB');
    expect(enGB).not.toBe(enUS);
  });
});

describe('formatLogTimestamp', () => {
  it('formats as "h:mm tt M/dd/yyyy"', () => {
    expect(formatLogTimestamp(FIXED)).toBe('2:07 PM 1/05/2024');
  });

  it('uses 12 for midnight with AM', () => {
    expect(formatLogTimestamp(new Date(2024, 0, 5, 0, 9, 0))).toBe('12:09 AM 1/05/2024');
  });
});
