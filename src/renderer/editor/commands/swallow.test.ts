import { describe, it, expect } from 'vitest';
import { swallowKeymap } from './swallow';

/**
 * Swallowed keys parity. RichEditBox rich-format shortcuts (Ctrl+B/I/U and
 * variants) are neutralized: each binding is a no-op that returns true so CM6
 * consumes the key and nothing fires.
 */

describe('swallowKeymap', () => {
  it('binds the full UWP swallowed set', () => {
    const keys = swallowKeymap.map((b) => b.key);
    expect(keys).toEqual([
      'Mod-b',
      'Mod-i',
      'Mod-u',
      'Mod-Shift-b',
      'Mod-Shift-i',
      'Mod-Shift-u',
      'Mod-Shift-l'
    ]);
  });

  it('every binding is a no-op that returns true (consumes the key)', () => {
    // run() takes an EditorView; the swallow run ignores it entirely.
    const fakeView = {} as Parameters<NonNullable<(typeof swallowKeymap)[number]['run']>>[0];
    for (const binding of swallowKeymap) {
      expect(binding.run?.(fakeView)).toBe(true);
    }
  });

  it('every binding preventDefaults', () => {
    for (const binding of swallowKeymap) {
      expect(binding.preventDefault).toBe(true);
    }
  });
});
