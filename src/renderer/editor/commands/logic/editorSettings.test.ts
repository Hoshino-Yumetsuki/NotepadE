import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EDITOR_SETTINGS,
  normalizeTabAsSpaces,
  indentString
} from './editorSettings';

describe('DEFAULT_EDITOR_SETTINGS', () => {
  it('has real tab as default', () => {
    expect(DEFAULT_EDITOR_SETTINGS.tabAsSpaces).toBe(-1);
  });

  it('has smartCopy off by default', () => {
    expect(DEFAULT_EDITOR_SETTINGS.smartCopy).toBe(false);
  });

  it('has bing as default search engine', () => {
    expect(DEFAULT_EDITOR_SETTINGS.searchEngine).toBe('bing');
  });

  it('has 14px default font size', () => {
    expect(DEFAULT_EDITOR_SETTINGS.fontSize).toBe(14);
  });
});

describe('normalizeTabAsSpaces', () => {
  it('accepts 2, 4, 8', () => {
    expect(normalizeTabAsSpaces(2)).toBe(2);
    expect(normalizeTabAsSpaces(4)).toBe(4);
    expect(normalizeTabAsSpaces(8)).toBe(8);
  });

  it('normalizes any other value to -1', () => {
    expect(normalizeTabAsSpaces(3)).toBe(-1);
    expect(normalizeTabAsSpaces(0)).toBe(-1);
    expect(normalizeTabAsSpaces(16)).toBe(-1);
  });
});

describe('indentString', () => {
  it('returns a tab for -1', () => {
    expect(indentString(-1)).toBe('\t');
  });

  it('returns 2 spaces for 2', () => {
    expect(indentString(2)).toBe('  ');
  });

  it('returns 4 spaces for 4', () => {
    expect(indentString(4)).toBe('    ');
  });
});
