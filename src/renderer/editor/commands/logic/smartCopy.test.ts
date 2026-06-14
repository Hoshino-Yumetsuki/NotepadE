import { describe, it, expect } from 'vitest';
import { smartTrimSelection } from './smartCopy';

describe('smartTrimSelection', () => {
  it('trims trailing whitespace but keeps leading indent on the first content line', () => {
    expect(smartTrimSelection('  abc  ')).toBe('  abc');
  });

  it('leaves an all-whitespace selection untouched', () => {
    expect(smartTrimSelection('   ')).toBe('   ');
    expect(smartTrimSelection('\n\t ')).toBe('\n\t ');
  });

  it('drops whole leading blank lines but keeps indent on the first content line', () => {
    expect(smartTrimSelection('\n  abc')).toBe('  abc');
  });

  it('trims trailing line breaks', () => {
    expect(smartTrimSelection('abc\n\n')).toBe('abc');
  });

  it('returns an empty selection unchanged', () => {
    expect(smartTrimSelection('')).toBe('');
  });
});
