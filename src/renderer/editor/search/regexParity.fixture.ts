/**
 * REGEX-PARITY FIXTURE (RENDERER, Lane D harness) — Verification Gate 3.
 *
 * A declarative `{ input, pattern, options, expected }` corpus that pins the
 * find/replace ENGINE's behavior (src/renderer/editor/search/searchEngine.ts)
 * against the UWP .NET Regex semantics it replicates. The fixture is consumed by
 * regexParity.test.ts, which drives each row through the real engine functions —
 * so a green run proves the engine, not the fixture's own arithmetic.
 *
 * Why a declarative table (not hand-written it() blocks):
 *   - Gate 3 demands a REGEX-PARITY FIXTURE incl. a RightToLeft reverse-search
 *     row (docs/plan/04 §VERIFICATION GATE 3; risk R5). A data table makes the
 *     coverage auditable at a glance and lets sign-off enumerate exactly which
 *     .NET constructs are matched 1:1 vs handled-by-shim vs documented-divergence.
 *   - DIVERGENCE #5 (docs/plan/11 item 5): find/replace uses JS RegExp; .NET-only
 *     constructs have no direct equivalent. Each such row is tagged `divergence`
 *     with a note so the gate proves the gap is *known and handled*, not silent.
 *
 * Coordinated with find-replace: the RTL reverse-search rows assert via
 * `findPrevious(text, pattern, REGEX, caret, wrap)` — the engine's RightToLeft
 * shim (forward-match-all + pick-last-before-caret). Confirmed engine SearchOptions
 * shape is { matchCase, wholeWord, useRegex }.
 */

import type { SearchOptions, MatchSpan } from './searchEngine';

/** The engine operation a row exercises. */
export type RegexParityOp = 'findNext' | 'findPrevious' | 'findAll' | 'replaceAll';

/**
 * Classification of how the row relates to .NET Regex:
 *   - 'parity'      : JS RegExp behaves identically to .NET here.
 *   - 'shim'        : .NET feature emulated by a Notepads shim (e.g. RightToLeft).
 *   - 'divergence'  : documented .NET-vs-JS flavor gap (sign-off item #5). The
 *                     `expected` encodes the rewrite's ACTUAL behavior, and the
 *                     `note` records the .NET delta for the sign-off ledger.
 */
export type RegexParityKind = 'parity' | 'shim' | 'divergence';

/** A single declarative parity case. */
export interface RegexParityCase {
  /** Stable, human-readable id (used in the test title). */
  id: string;
  kind: RegexParityKind;
  op: RegexParityOp;
  /** The shadow-buffer text the pattern runs against ('\n' line breaks). */
  input: string;
  /** The regex pattern (always run with useRegex: true). */
  pattern: string;
  /** Engine options. `useRegex` is forced true by the runner for regex rows. */
  options: SearchOptions;
  /** For findNext/findPrevious: the caret/from offset to search from. */
  caret?: number;
  /** For findNext/findPrevious: wrap-around when the first pass misses. */
  wrap?: boolean;
  /** For replaceAll: the replacement string (engine applies $-groups + \r\n\t fix). */
  replacement?: string;
  /**
   * Expected result, shape depends on `op`:
   *   - findNext / findPrevious : MatchSpan | null
   *   - findAll                 : MatchSpan[]
   *   - replaceAll              : { text, count }
   */
  expected: MatchSpan | null | MatchSpan[] | { text: string; count: number };
  /** Sign-off note for `divergence`/`shim` rows (the .NET delta being recorded). */
  note?: string;
}

const REGEX: SearchOptions = { matchCase: false, wholeWord: false, useRegex: true };
const REGEX_CASE: SearchOptions = { matchCase: true, wholeWord: false, useRegex: true };

/**
 * THE FIXTURE.
 *
 * Rows are grouped by concern. Every `expected` is computed by hand from the
 * documented engine contract, NOT by running the engine, so the test is a true
 * oracle. Offsets are half-open [from, to) into `input`.
 */
export const REGEX_PARITY_CASES: RegexParityCase[] = [
  // --- Core forward matching (parity with .NET default) --------------------
  {
    id: 'forward/char-class+digit',
    kind: 'parity',
    op: 'findNext',
    input: 'a1 b2 c3 d4',
    pattern: '[a-z]\\d',
    options: REGEX,
    caret: 0,
    wrap: false,
    expected: { from: 0, to: 2 },
  },
  {
    id: 'forward/from-mid-doc',
    kind: 'parity',
    op: 'findNext',
    input: 'a1 b2 c3 d4',
    pattern: '[a-z]\\d',
    options: REGEX,
    caret: 1,
    wrap: false,
    expected: { from: 3, to: 5 },
  },
  {
    id: 'forward/no-match-no-wrap-returns-null',
    kind: 'parity',
    op: 'findNext',
    input: 'a1 b2 c3 d4',
    pattern: '[a-z]\\d',
    options: REGEX,
    caret: 11,
    wrap: false,
    expected: null,
  },
  {
    id: 'forward/wrap-to-doc-start',
    kind: 'parity',
    op: 'findNext',
    input: 'a1 b2 c3 d4',
    pattern: '[a-z]\\d',
    options: REGEX,
    caret: 11,
    wrap: true,
    expected: { from: 0, to: 2 },
  },

  // --- Case sensitivity (RegexOptions.IgnoreCase unless match-case) ---------
  {
    id: 'case/insensitive-default',
    kind: 'parity',
    op: 'findNext',
    input: 'ABC',
    pattern: 'abc',
    options: REGEX,
    caret: 0,
    wrap: false,
    expected: { from: 0, to: 3 },
  },
  {
    id: 'case/sensitive-no-match',
    kind: 'parity',
    op: 'findNext',
    input: 'ABC',
    pattern: 'abc',
    options: REGEX_CASE,
    caret: 0,
    wrap: false,
    expected: null,
  },

  // --- Multiline anchors (RegexOptions.Multiline is always set) ------------
  {
    id: 'multiline/caret-anchors-line-start',
    kind: 'parity',
    op: 'findNext',
    input: 'one\ntwo\nthree',
    pattern: '^t',
    options: REGEX,
    caret: 0,
    wrap: false,
    expected: { from: 4, to: 5 }, // start of 'two'
  },
  {
    id: 'multiline/dollar-anchors-line-end',
    kind: 'parity',
    op: 'findNext',
    input: 'aa\nbab\ncc',
    pattern: 'b$',
    options: REGEX,
    caret: 0,
    wrap: false,
    expected: { from: 5, to: 6 }, // the 'b' before the 2nd newline
  },
  {
    id: 'multiline/dot-does-not-cross-newline',
    kind: 'parity',
    op: 'findAll',
    input: 'ab\ncd',
    pattern: 'a.c',
    options: REGEX,
    expected: [], // '.' excludes '\n' (no dotall), matching .NET default
  },

  // --- findAll ordering + zero-width termination ---------------------------
  {
    id: 'findAll/ascending-order',
    kind: 'parity',
    op: 'findAll',
    input: 'a1 b2 c3',
    pattern: '[a-z]\\d',
    options: REGEX,
    expected: [
      { from: 0, to: 2 },
      { from: 3, to: 5 },
      { from: 6, to: 8 },
    ],
  },
  {
    id: 'findAll/zero-width-terminates',
    kind: 'parity',
    op: 'findAll',
    input: 'xx',
    pattern: 'a*',
    options: REGEX,
    // 'a*' matches empty at each boundary; first span is zero-width at 0.
    // We assert only the first span + that the array is finite (runner checks length>0).
    expected: [
      { from: 0, to: 0 },
      { from: 1, to: 1 },
      { from: 2, to: 2 },
    ],
  },

  // --- RIGHT-TO-LEFT REVERSE SEARCH (divergence #5 / risk R5) ---------------
  // .NET: new Regex(p, RightToLeft|Multiline).Match(content, startPos) returns
  // the RIGHTMOST match ending <= startPos. The engine emulates this with the
  // forward-match-all + pick-last-before-caret shim. THESE ROWS ARE THE GATE-3
  // RTL REVERSE-SEARCH REQUIREMENT.
  {
    id: 'rtl/rightmost-before-eof',
    kind: 'shim',
    op: 'findPrevious',
    input: 'a1 b2 c3 d4',
    pattern: '[a-z]\\d',
    options: REGEX,
    caret: 11, // EOF
    wrap: false,
    expected: { from: 9, to: 11 }, // 'd4' — rightmost
    note: '.NET RegexOptions.RightToLeft emulated via forward-match-all + pick-last-before-caret shim.',
  },
  {
    id: 'rtl/match-ending-exactly-at-caret-qualifies',
    kind: 'shim',
    op: 'findPrevious',
    input: 'a1 b2 c3 d4',
    pattern: '[a-z]\\d',
    options: REGEX,
    caret: 8, // end of 'c3' is exactly 8 → qualifies (<=)
    wrap: false,
    expected: { from: 6, to: 8 },
    note: 'RTL shim uses to <= caret (half-open), so a match ending exactly at the caret qualifies.',
  },
  {
    id: 'rtl/match-spanning-caret-excluded',
    kind: 'shim',
    op: 'findPrevious',
    input: 'a1 b2 c3 d4',
    pattern: '[a-z]\\d',
    options: REGEX,
    caret: 7, // mid 'c3' (ends at 8 > 7) → excluded; previous qualifying is 'b2'
    wrap: false,
    expected: { from: 3, to: 5 },
    note: 'A match whose end is past the caret is excluded by the RTL shim.',
  },
  {
    id: 'rtl/bof-no-wrap-returns-null',
    kind: 'shim',
    op: 'findPrevious',
    input: 'a1 b2 c3 d4',
    pattern: '[a-z]\\d',
    options: REGEX,
    caret: 0,
    wrap: false,
    expected: null,
    note: 'At BOF with wrap=false the RTL shim returns null (UWP stopAtBof).',
  },
  {
    id: 'rtl/wrap-yields-doc-final-match',
    kind: 'shim',
    op: 'findPrevious',
    input: 'a1 b2 c3 d4',
    pattern: '[a-z]\\d',
    options: REGEX,
    caret: 0,
    wrap: true,
    expected: { from: 9, to: 11 },
    note: 'UWP retries Match(content, content.Length) on wrap → rightmost (doc-final) match.',
  },
  {
    id: 'rtl/multiline-reverse-picks-last-line-start',
    kind: 'shim',
    op: 'findPrevious',
    input: 'tip\ntap\ntop',
    pattern: '^t',
    options: REGEX,
    caret: 11, // EOF; line starts at 0,4,8 — rightmost qualifying is 'top' at 8
    wrap: false,
    expected: { from: 8, to: 9 },
    note: 'RTL + Multiline: rightmost line-start anchor before caret.',
  },

  // --- replaceAll: $-group substitution + escape-sequence fix --------------
  {
    id: 'replaceAll/group-swap',
    kind: 'parity',
    op: 'replaceAll',
    input: 'john smith',
    pattern: '(\\w+) (\\w+)',
    options: REGEX,
    replacement: '$2 $1',
    expected: { text: 'smith john', count: 1 },
  },
  {
    id: 'replaceAll/escape-newline-expanded',
    kind: 'parity',
    op: 'replaceAll',
    input: 'a,b,c',
    pattern: ',',
    options: REGEX,
    replacement: '\\n',
    expected: { text: 'a\nb\nc', count: 2 },
    note: 'ApplyTabAndLineEndingFix: \\r \\n \\t expanded in regex replacement only.',
  },
  {
    id: 'replaceAll/escape-tab+cr',
    kind: 'parity',
    op: 'replaceAll',
    input: 'k=v',
    pattern: '=',
    options: REGEX,
    replacement: '\\t\\r',
    expected: { text: 'k\t\rv', count: 1 },
  },
  {
    id: 'replaceAll/count-multiple',
    kind: 'parity',
    op: 'replaceAll',
    input: 'a1 b2 c3',
    pattern: '[a-z]\\d',
    options: REGEX,
    replacement: 'X',
    expected: { text: 'X X X', count: 3 },
  },

  // --- DOCUMENTED .NET-VS-JS FLAVOR DIVERGENCES (sign-off item #5) ----------
  // These rows pin the rewrite's ACTUAL JS-RegExp behavior and RECORD the .NET
  // delta. They must pass (proving the construct is handled-or-known), and the
  // notes flow into REGEX-FLAVOR-GAPS.md for sign-off.
  {
    id: 'divergence/named-group-js-syntax',
    kind: 'divergence',
    op: 'replaceAll',
    input: 'john smith',
    pattern: '(?<first>\\w+) (?<last>\\w+)',
    options: REGEX,
    replacement: '$<last> $<first>',
    expected: { text: 'smith john', count: 1 },
    note: '.NET named groups use ${name} in replacement; JS RegExp uses $<name>. The engine passes the replacement to RegExp.replace verbatim, so JS syntax ($<name>) is the supported form — documented divergence.',
  },
  {
    id: 'divergence/backslash-z-anchor-not-supported',
    kind: 'divergence',
    op: 'findNext',
    input: 'end',
    pattern: 'end\\Z',
    options: REGEX,
    caret: 0,
    wrap: false,
    // \Z is invalid in JS RegExp → buildRegex throws → engine returns null.
    expected: null,
    note: '.NET \\Z / \\z (end-of-string anchors) are not valid JS RegExp; the pattern fails to compile and finds nothing. Use $ (with/without Multiline). Documented divergence — compileQuery surfaces the error to the UI.',
  },
  {
    id: 'divergence/balancing-groups-not-supported',
    kind: 'divergence',
    op: 'findNext',
    input: '((x))',
    pattern: '^(?<open>\\()+(?<-open>\\))+$',
    options: REGEX,
    caret: 0,
    wrap: false,
    // .NET balancing-group construct (?<-name>) is invalid in JS → no match.
    expected: null,
    note: '.NET balancing groups (?<-name>) have no JS RegExp equivalent; pattern fails to compile → no match. Documented divergence (sign-off #5).',
  },
  {
    id: 'divergence/inline-options-block',
    kind: 'divergence',
    op: 'findNext',
    input: 'HELLO',
    pattern: '(?i)hello',
    options: REGEX_CASE,
    caret: 0,
    wrap: false,
    // .NET supports inline (?i); JS RegExp does NOT (invalid in older engines /
    // not a flag toggle). With match-case on and inline (?i) unsupported, the
    // engine compiles it as a literal group attempt → no match. Documented.
    expected: null,
    note: '.NET inline option groups like (?i) are not JS RegExp flags; case is controlled by the match-case toggle (gmi vs gm). Documented divergence.',
  },
];

/**
 * Subsets for documentation/reporting. The sign-off ledger enumerates the
 * `divergence` rows; the gate enumerates `shim` (RTL) coverage.
 */
export const RTL_REVERSE_CASES = REGEX_PARITY_CASES.filter(
  (c) => c.kind === 'shim' && c.op === 'findPrevious',
);
export const DOCUMENTED_DIVERGENCES = REGEX_PARITY_CASES.filter((c) => c.kind === 'divergence');
