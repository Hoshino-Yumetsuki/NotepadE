import { describe, it, expect } from 'vitest';
import { buildWebSearchQuery } from './webSearch';

describe('buildWebSearchQuery', () => {
  it('trims whitespace from the selection', () => {
    expect(buildWebSearchQuery('  query  ')).toBe('query');
  });

  it('returns null for all-whitespace input', () => {
    expect(buildWebSearchQuery('     ')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(buildWebSearchQuery('')).toBeNull();
  });

  it('caps the query at 2000 characters', () => {
    const big = 'a'.repeat(2500);
    const result = buildWebSearchQuery(big);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2000);
  });

  it('passes through short queries unchanged', () => {
    expect(buildWebSearchQuery('hello world')).toBe('hello world');
  });
});
