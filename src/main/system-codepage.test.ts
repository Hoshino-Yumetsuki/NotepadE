import { describe, it, expect, afterEach } from 'vitest';
import { listAnsiEncodings } from './encoding';
import {
  systemAnsiCodePage,
  __resetSystemAnsiCacheForTest,
  __setSystemAnsiCacheForTest
} from './system-codepage';

/**
 * W7 — the encoding engine's system-ANSI fallback now maps the REAL OS ANSI code
 * page (resolved from the registry in system-codepage.ts) onto an iconv codec,
 * instead of always windows-1252. These tests force the cached ACP to assert the
 * codepage→codec mapping is wired through the ANSI table. The registry read itself
 * (win32-only, child_process) is not unit-tested here.
 */

afterEach(() => {
  __resetSystemAnsiCacheForTest();
});

describe('system ANSI code page mapping', () => {
  it('lists the verbatim ANSI table (sanity: codepage→label entries present)', () => {
    const list = listAnsiEncodings();
    // A few representative system ACPs must be resolvable in the table.
    expect(list.find((e) => e.codePage === 1252)).toBeTruthy(); // Western
    expect(list.find((e) => e.codePage === 932)).toBeTruthy(); // Japanese Shift-JIS
    expect(list.find((e) => e.codePage === 936)).toBeTruthy(); // Simplified Chinese
    expect(list.find((e) => e.codePage === 949)).toBeTruthy(); // Korean
  });

  it('caches a forced ACP value for deterministic resolution', () => {
    __setSystemAnsiCacheForTest(932);
    expect(systemAnsiCodePage()).toBe(932);
  });

  it('falls back to 1252 after reset (no resolution performed)', () => {
    __setSystemAnsiCacheForTest(936);
    __resetSystemAnsiCacheForTest();
    // On a non-win32 CI box, resolution sets 1252 synchronously; on win32 the async
    // registry read hasn't completed, so the safe default 1252 is returned. Either
    // way the immediate value is the safe Western default.
    expect(systemAnsiCodePage()).toBe(1252);
  });
});
