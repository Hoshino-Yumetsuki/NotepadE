/**
 * Pure find/replace search engine (RENDERER, Lane B) — framework-free.
 *
 * Operates on a plain string (the '\n' shadow buffer) with explicit caret
 * offsets so it is directly unit-/fixture-testable WITHOUT CodeMirror or
 * Electron. The CM6 integration layer (findController.ts) translates the
 * {from,to} spans returned here into editor transactions.
 *
 * Behavioral parity is taken from the UWP source
 * (Controls/TextEditor/TextEditorCore.FindAndReplace.cs +
 *  Extensions/StringExtensions.cs). Key facts replicated:
 *
 *  - Literal next/prev use IndexOf / LastIndexOf with Ordinal (match-case) or
 *    OrdinalIgnoreCase comparison; wrap-around when not stopping at EOF/BOF.
 *  - Whole-word boundaries use char.IsLetterOrDigit on the neighbouring chars
 *    (NOT regex \b — \b counts '_' as a word char, .NET's IsLetterOrDigit does
 *    not). Whole-word is LITERAL-only; whole-word & regex are mutually exclusive
 *    in the UI (FindAndReplaceControl: MatchWholeWordToggle.IsEnabled =
 *    !UseRegexToggle.IsChecked).
 *  - Regex uses RegexOptions.Multiline (+IgnoreCase unless match-case). The UWP
 *    buffer is normalised so the regex sees '\n' line breaks; our shadow buffer
 *    is already '\n', so no conversion is needed.
 *  - Escape sequences in the REGEX replacement string ("\\r","\\n","\\t") are
 *    expanded to CR/LF/TAB before substitution (ApplyTabAndLineEndingFix). This
 *    is applied ONLY in regex mode; literal replacement is verbatim.
 *
 * DIVERGENCE #5 (sign-off, docs/plan/11 item 5 + R5): .NET
 * RegexOptions.RightToLeft (used for regex find-previous) has NO JS RegExp
 * equivalent. It is implemented here as the forward-match-all + pick-last-match-
 * before-cursor SHIM (see findPreviousRegex). Remaining .NET-vs-JS flavor gaps
 * are documented in ./REGEX-FLAVOR-GAPS.md.
 */

/** User-facing search options (mirrors UWP SearchContext minus the text). */
export interface SearchOptions {
  /** Ordinal vs OrdinalIgnoreCase / regex IgnoreCase flag. */
  matchCase: boolean;
  /** Literal whole-word boundary match. Mutually exclusive with useRegex. */
  wholeWord: boolean;
  /** Treat the query as a regular expression. Mutually exclusive with wholeWord. */
  useRegex: boolean;
}

/** A match span as half-open [from, to) offsets into the source string. */
export interface MatchSpan {
  from: number;
  to: number;
}

/** Result of compiling a query — surfaces regex errors like UWP's regexError. */
export type CompileResult =
  | { ok: true }
  | { ok: false; error: string };

const EMPTY_OPTIONS_GUARD = '';

/** True for a Unicode letter or digit — the .NET char.IsLetterOrDigit analogue. */
function isLetterOrDigit(ch: string): boolean {
  // \p{L} (letters) + \p{N} (numbers). Excludes '_' exactly like .NET.
  return /[\p{L}\p{N}]/u.test(ch);
}

/** Whole-word boundary test around a literal match at [pos, pos+len). */
function isWholeWordMatch(text: string, pos: number, len: number): boolean {
  const startBoundary = pos <= 0 || !isLetterOrDigit(text[pos - 1]);
  const endPos = pos + len;
  const endBoundary = endPos >= text.length || !isLetterOrDigit(text[endPos]);
  return startBoundary && endBoundary;
}

/** Build the JS regex flags equivalent to the UWP RegexOptions for find. */
function regexFlags(matchCase: boolean): string {
  // Multiline is always set in UWP regex search/replace. No 's' (dotall): .NET's
  // default '.' does not match '\n', matching JS default. No 'u': stay close to
  // .NET UTF-16 semantics and tolerate patterns that 'u' would reject.
  return matchCase ? 'gm' : 'gmi';
}

/**
 * Validate / compile a query. For literal queries this always succeeds (the
 * query is treated verbatim). For regex queries it attempts to construct the
 * RegExp and reports the engine error message on failure.
 */
export function compileQuery(query: string, options: SearchOptions): CompileResult {
  if (query.length === 0) return { ok: true };
  if (!options.useRegex) return { ok: true };
  try {
    // eslint-disable-next-line no-new
    new RegExp(query, regexFlags(options.matchCase));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Build a fresh global RegExp for a regex query (caller owns lastIndex). */
function buildRegex(query: string, options: SearchOptions): RegExp {
  return new RegExp(query, regexFlags(options.matchCase));
}

/**
 * Collect every forward match of a regex query over `text`. This is the
 * primitive the RightToLeft shim is built on (and is also used for replace-all
 * match counting). Guards against zero-width matches looping forever.
 */
export function findAllRegexMatches(text: string, query: string, options: SearchOptions): MatchSpan[] {
  const out: MatchSpan[] = [];
  if (query.length === 0) return out;
  let re: RegExp;
  try {
    re = buildRegex(query, options);
  } catch {
    return out;
  }
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ from: m.index, to: m.index + m[0].length });
    // Advance past zero-width matches to avoid an infinite loop.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/**
 * Find the next match at or after `from`. Mirrors UWP TryFindNextAndSelect:
 * search begins at the current selection END; if nothing is found and `wrap` is
 * true (UWP `!stopAtEof`), search again from 0. Returns null when not found.
 */
export function findNext(
  text: string,
  query: string,
  options: SearchOptions,
  from: number,
  wrap: boolean,
): MatchSpan | null {
  if (query.length === 0) return null;
  const start = clamp(from, 0, text.length);

  if (options.useRegex) {
    const hit = regexMatchFrom(text, query, options, start);
    if (hit) return hit;
    return wrap ? regexMatchFrom(text, query, options, 0) : null;
  }

  const hit = literalIndexOf(text, query, options, start);
  if (hit) return hit;
  return wrap ? literalIndexOf(text, query, options, 0) : null;
}

/**
 * Find the previous match before the caret. Mirrors UWP TryFindPreviousAndSelect:
 * the caret is the current selection START. Literal search uses LastIndexOf from
 * `start - 1`; regex uses the RightToLeft shim. When `wrap` is true (UWP
 * `!stopAtBof`) and nothing is found, search again from the document end.
 */
export function findPrevious(
  text: string,
  query: string,
  options: SearchOptions,
  start: number,
  wrap: boolean,
): MatchSpan | null {
  if (query.length === 0) return null;
  const caret = clamp(start, 0, text.length);

  if (options.useRegex) {
    return findPreviousRegex(text, query, options, caret, wrap);
  }

  // UWP: searchIndex = StartPosition - 1; if < 0 → (stopAtBof ? fail : len-1).
  let searchIndex = caret - 1;
  if (searchIndex < 0) {
    if (!wrap) return null;
    searchIndex = text.length - 1;
  }
  const hit = literalLastIndexOf(text, query, options, searchIndex);
  if (hit) return hit;
  // UWP unconditionally retries from len-1 when the first pass misses.
  return literalLastIndexOf(text, query, options, text.length - 1);
}

/**
 * DIVERGENCE #5 SHIM — regex find-previous.
 *
 * .NET: `new Regex(pattern, RightToLeft|Multiline|...).Match(content, startPos)`
 * returns the RIGHTMOST match whose end (exclusive) is <= startPos. JS RegExp
 * cannot express RightToLeft, so we forward-match ALL occurrences and pick the
 * last one ending at or before the caret. When none qualify and `wrap` is true,
 * UWP retries Match(content, content.Length) which (since every match ends <=
 * length) yields the rightmost match overall — i.e. the last match in the doc.
 */
function findPreviousRegex(
  text: string,
  query: string,
  options: SearchOptions,
  caret: number,
  wrap: boolean,
): MatchSpan | null {
  const all = findAllRegexMatches(text, query, options);
  if (all.length === 0) return null;

  let best: MatchSpan | null = null;
  for (const span of all) {
    if (span.to <= caret) best = span; // keep the last (rightmost) qualifying match
    else break; // matches are in ascending order; once past the caret, stop
  }
  if (best) return best;
  return wrap ? all[all.length - 1] : null;
}

function regexMatchFrom(
  text: string,
  query: string,
  options: SearchOptions,
  from: number,
): MatchSpan | null {
  let re: RegExp;
  try {
    re = buildRegex(query, options);
  } catch {
    return null;
  }
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? { from: m.index, to: m.index + m[0].length } : null;
}

function literalIndexOf(
  text: string,
  query: string,
  options: SearchOptions,
  from: number,
): MatchSpan | null {
  const hay = options.matchCase ? text : text.toLowerCase();
  const needle = options.matchCase ? query : query.toLowerCase();
  let pos = from;
  while (pos <= text.length) {
    const idx = hay.indexOf(needle, pos);
    if (idx === -1) return null;
    if (!options.wholeWord || isWholeWordMatch(text, idx, query.length)) {
      return { from: idx, to: idx + query.length };
    }
    pos = idx + 1;
  }
  return null;
}

function literalLastIndexOf(
  text: string,
  query: string,
  options: SearchOptions,
  from: number,
): MatchSpan | null {
  const hay = options.matchCase ? text : text.toLowerCase();
  const needle = options.matchCase ? query : query.toLowerCase();
  let pos = from;
  while (pos >= 0) {
    const idx = hay.lastIndexOf(needle, pos);
    if (idx === -1) return null;
    if (!options.wholeWord || isWholeWordMatch(text, idx, query.length)) {
      return { from: idx, to: idx + query.length };
    }
    pos = idx - 1;
  }
  return null;
}

/**
 * Expand the escape sequences UWP's ApplyTabAndLineEndingFix handles in a REGEX
 * replacement string. Order matches the source: \r, then \n, then \t.
 */
export function applyEscapeSequenceFix(replacement: string): string {
  return replacement.replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

/** Result of a replace-all pass over the whole document. */
export interface ReplaceAllResult {
  /** The new full document text. */
  text: string;
  /** Number of occurrences replaced. */
  count: number;
}

/**
 * Replace every occurrence in `text`, returning the new full document and a
 * count. The CM6 layer dispatches the result as ONE transaction = ONE undo step
 * (UWP TryFindAndReplaceAll does a single SetText). Regex mode uses one global
 * RegExp.replace pass after expanding replacement escape sequences; literal mode
 * iterates IndexOf/rebuild verbatim (no escape fix, no '$' substitution) exactly
 * like the UWP literal path.
 */
export function replaceAll(
  text: string,
  query: string,
  options: SearchOptions,
  replacement: string,
): ReplaceAllResult {
  if (query.length === 0) return { text, count: 0 };

  if (options.useRegex) {
    let re: RegExp;
    try {
      re = buildRegex(query, options);
    } catch {
      return { text, count: 0 };
    }
    const matches = findAllRegexMatches(text, query, options);
    if (matches.length === 0) return { text, count: 0 };
    const expanded = applyEscapeSequenceFix(replacement);
    return { text: text.replace(re, expanded), count: matches.length };
  }

  // Literal: verbatim replacement, advancing past each insertion so the
  // replacement text is never re-scanned (UWP advances pos by replaceTextLength).
  const hay = options.matchCase ? text : text.toLowerCase();
  const needle = options.matchCase ? query : query.toLowerCase();
  let result = '';
  let cursor = 0;
  let count = 0;
  let pos = 0;
  while (pos <= text.length) {
    const idx = hay.indexOf(needle, pos);
    if (idx === -1) break;
    if (!options.wholeWord || isWholeWordMatch(text, idx, query.length)) {
      result += text.slice(cursor, idx) + replacement;
      cursor = idx + query.length;
      pos = idx + query.length;
      count++;
    } else {
      pos = idx + 1;
    }
  }
  if (count === 0) return { text, count: 0 };
  result += text.slice(cursor);
  return { text: result, count };
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

// Keep an explicit no-op reference so tree-shakers retain the guard constant the
// UI uses to detect "no options selected" without importing internals.
void EMPTY_OPTIONS_GUARD;
