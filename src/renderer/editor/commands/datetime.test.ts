import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import {
  formatCurrentCultureDateTime,
  formatLogTimestamp,
  makeInsertDateTime,
  tryInsertLogEntry,
  logEntryGuard
} from './datetime';
import { runStateCommand, mountView } from './testUtils';

/**
 * Date/time parity (RENDERER, Lane B), honoring approved divergence #7:
 *   - F5 inserts the OS current-culture default datetime via Intl (locale-driven
 *     string, NOT a fixed glyph sequence).
 *   - `.LOG` auto-timestamp fires once per editor open (per-editor guard).
 */

const FIXED = new Date(2024, 0, 5, 14, 7, 0); // 2024-01-05 14:07:00 local

describe('formatCurrentCultureDateTime (F5, divergence #7)', () => {
  it('produces the en-US culture short-date + medium-time string', () => {
    const s = formatCurrentCultureDateTime(FIXED, 'en-US');
    // en-US dateStyle:short + timeStyle:medium → "1/5/24, 2:07:00 PM"
    expect(s).toBe('1/5/24, 2:07:00 PM');
  });

  it('produces a different, locale-driven string for another culture', () => {
    const enUS = formatCurrentCultureDateTime(FIXED, 'en-US');
    const enGB = formatCurrentCultureDateTime(FIXED, 'en-GB');
    // en-GB uses day/month order + 24h time → not equal to en-US output.
    expect(enGB).not.toBe(enUS);
  });
});

describe('makeInsertDateTime (F5)', () => {
  it('inserts the culture datetime at the caret and collapses after it', () => {
    const cmd = makeInsertDateTime(() => FIXED);
    const stamp = formatCurrentCultureDateTime(FIXED);
    const r = runStateCommand(cmd, 'X', EditorSelection.cursor(1));
    expect(r.doc).toBe('X' + stamp);
    expect(r.head).toBe(1 + stamp.length);
  });

  it('replaces an active selection with the datetime', () => {
    const cmd = makeInsertDateTime(() => FIXED);
    const stamp = formatCurrentCultureDateTime(FIXED);
    const r = runStateCommand(cmd, 'abc', EditorSelection.range(0, 3));
    expect(r.doc).toBe(stamp);
  });
});

describe('formatLogTimestamp (.LOG header, fixed culture-invariant format)', () => {
  it('formats as "h:mm tt M/dd/yyyy"', () => {
    expect(formatLogTimestamp(FIXED)).toBe('2:07 PM 1/05/2024');
  });

  it('uses 12 for midnight and AM/PM correctly', () => {
    expect(formatLogTimestamp(new Date(2024, 0, 5, 0, 9, 0))).toBe('12:09 AM 1/05/2024');
  });
});

describe('tryInsertLogEntry (.LOG once-per-open guard)', () => {
  it('appends a timestamp when the doc starts with ".LOG"', () => {
    const view = mountView('.LOG', EditorSelection.cursor(4), [logEntryGuard]);
    try {
      const did = tryInsertLogEntry(view, () => FIXED);
      expect(did).toBe(true);
      const stamp = formatLogTimestamp(FIXED);
      expect(view.state.doc.toString()).toBe('.LOG\n' + stamp + '\n');
    } finally {
      view.destroy();
    }
  });

  it('is a no-op when the doc does NOT start with ".LOG"', () => {
    const view = mountView('hello', EditorSelection.cursor(0), [logEntryGuard]);
    try {
      const did = tryInsertLogEntry(view, () => FIXED);
      expect(did).toBe(false);
      expect(view.state.doc.toString()).toBe('hello');
    } finally {
      view.destroy();
    }
  });

  it('fires at most once per editor (guard flips after first success)', () => {
    const view = mountView('.LOG', EditorSelection.cursor(4), [logEntryGuard]);
    try {
      expect(tryInsertLogEntry(view, () => FIXED)).toBe(true);
      const afterFirst = view.state.doc.toString();
      expect(tryInsertLogEntry(view, () => FIXED)).toBe(false);
      expect(view.state.doc.toString()).toBe(afterFirst);
    } finally {
      view.destroy();
    }
  });
});
