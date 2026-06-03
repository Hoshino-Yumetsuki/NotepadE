/**
 * REGEX-PARITY GATE (RENDERER, Lane D harness) — Verification Gate 3.
 *
 * Drives every row of REGEX_PARITY_CASES (regexParity.fixture.ts) through the
 * REAL search engine functions (searchEngine.ts). A green run proves the engine
 * matches the documented .NET-vs-JS contract — NOT the fixture's own arithmetic,
 * because the runner calls findNext/findPrevious/findAllRegexMatches/replaceAll
 * directly and compares to the hand-computed `expected` oracle.
 *
 * Gate-3 requirements asserted here (docs/plan/04 §VERIFICATION GATE 3):
 *   - Regex-parity fixture passes, INCLUDING the RightToLeft reverse-search rows
 *     (RTL_REVERSE_CASES — risk R5 / divergence #5 shim).
 *   - Documented .NET-vs-JS flavor divergences (DOCUMENTED_DIVERGENCES) all pass,
 *     proving each gap is KNOWN AND HANDLED, not silent (sign-off ledger #5).
 *
 * Coordinated with find-replace: the fixture is the DoD contract; this test is
 * its assertion. The engine SearchOptions shape is { matchCase, wholeWord,
 * useRegex } and every regex row forces useRegex:true via the runner.
 */

import { describe, it, expect } from 'vitest';
import {
  REGEX_PARITY_CASES,
  RTL_REVERSE_CASES,
  DOCUMENTED_DIVERGENCES,
  type RegexParityCase,
} from './regexParity.fixture';
import {
  findNext,
  findPrevious,
  findAllRegexMatches,
  replaceAll,
  type MatchSpan,
  type ReplaceAllResult,
  type SearchOptions,
} from './searchEngine';

/** Force useRegex:true for every parity row (the fixture is regex-only). */
function regexOptions(o: SearchOptions): SearchOptions {
  return { ...o, useRegex: true };
}

/** Run one fixture row through the real engine and return the engine's result. */
function runCase(
  c: RegexParityCase,
): MatchSpan | null | MatchSpan[] | ReplaceAllResult {
  const opts = regexOptions(c.options);
  switch (c.op) {
    case 'findNext':
      return findNext(c.input, c.pattern, opts, c.caret ?? 0, c.wrap ?? false);
    case 'findPrevious':
      return findPrevious(c.input, c.pattern, opts, c.caret ?? 0, c.wrap ?? false);
    case 'findAll':
      return findAllRegexMatches(c.input, c.pattern, opts);
    case 'replaceAll':
      return replaceAll(c.input, c.pattern, opts, c.replacement ?? '');
  }
}

describe('regex-parity fixture (Gate 3)', () => {
  // Guard the corpus shape so coverage can't silently shrink.
  it('fixture is non-trivial and contains the required RTL + divergence rows', () => {
    expect(REGEX_PARITY_CASES.length).toBeGreaterThanOrEqual(20);
    // RTL reverse-search is a HARD Gate-3 requirement (risk R5).
    expect(RTL_REVERSE_CASES.length).toBeGreaterThan(0);
    expect(RTL_REVERSE_CASES.every((c) => c.op === 'findPrevious' && c.kind === 'shim')).toBe(true);
    // At least one row must end exactly at the caret (the <= boundary case).
    expect(
      RTL_REVERSE_CASES.some(
        (c) => c.caret != null && c.expected != null && !Array.isArray(c.expected) && 'to' in c.expected && c.expected.to === c.caret,
      ),
    ).toBe(true);
    // Documented flavor divergences must be enumerated for sign-off (#5).
    expect(DOCUMENTED_DIVERGENCES.length).toBeGreaterThan(0);
  });

  it('every row has a unique id', () => {
    const ids = REGEX_PARITY_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const c of REGEX_PARITY_CASES) {
    it(`[${c.kind}] ${c.id}`, () => {
      const actual = runCase(c);
      expect(actual).toEqual(c.expected);
    });
  }
});

/**
 * Explicit RTL reverse-search sub-suite. Even though these rows are also covered
 * by the loop above, calling them out makes the Gate-3 "RTL reverse-search row"
 * requirement auditable as its own named block in the test report (risk R5).
 */
describe('regex-parity: RightToLeft reverse-search shim (Gate 3 / R5)', () => {
  for (const c of RTL_REVERSE_CASES) {
    it(`${c.id} — ${c.note ?? ''}`, () => {
      const actual = findPrevious(
        c.input,
        c.pattern,
        regexOptions(c.options),
        c.caret ?? 0,
        c.wrap ?? false,
      );
      expect(actual).toEqual(c.expected);
    });
  }
});
