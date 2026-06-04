# Regex flavor gaps — .NET `System.Text.RegularExpressions` vs JS `RegExp`

**Status:** APPROVED divergence (sign-off item #5; risk R5). Find/replace in
notepads-next uses the JavaScript `RegExp` engine. The UWP original used .NET
`Regex` with `RegexOptions.Multiline` (+`IgnoreCase` unless match-case, and
`RightToLeft` for find-previous). The two engines agree on the overwhelming
majority of patterns used in a text editor, but a handful of .NET-only constructs
have no JS equivalent. Per the approved sign-off, these are **documented known
gaps, not blockers.**

Every gap below is pinned by a row in `regexParity.fixture.ts` (consumed by the
Gate-3 regex-parity test), so the behavior is _verified and known_, never silent.

## Engine configuration (parity baseline)

| .NET                                          | JS RegExp                                         | Notes                                                  |
| --------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `RegexOptions.Multiline` (always on)          | `m` flag (always on)                              | `^`/`$` anchor at line boundaries.                     |
| `RegexOptions.IgnoreCase` (unless match-case) | `i` flag (unless match-case)                      | Drives the match-case toggle: flags are `gmi` vs `gm`. |
| `.` excludes `\n` by default                  | `.` excludes `\n` by default (no `s`/dotall flag) | Identical: `a.c` does not cross a line break.          |
| `RegexOptions.RightToLeft` (find-previous)    | _no equivalent_                                   | Emulated by a shim — see below.                        |

The shadow buffer is already `\n`-normalized, so both engines see the same line
breaks; no `\r` conversion is needed before matching.

## DIVERGENCE #5 shim — `RightToLeft` reverse search

.NET find-previous uses `new Regex(p, RightToLeft | Multiline | ...).Match(content, startPos)`,
which returns the **rightmost** match whose end (exclusive) is `<= startPos`. JS
`RegExp` cannot search right-to-left, so the engine emulates it:

> **forward-match-all + pick-last-match-ending-at-or-before-the-caret**
> (`findPreviousRegex` in `searchEngine.ts`).

On wrap (UWP retries `Match(content, content.Length)`), the shim returns the
rightmost match in the whole document. This is verified by the `rtl/*` rows in the
parity fixture, including the multiline line-start case.

## Documented `divergence` rows (replacement & pattern syntax)

| Construct                   | .NET              | JS RegExp (this engine)                                                                     | Fixture row                                   |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Named-group **replacement** | `${name}`         | `$<name>`                                                                                   | `divergence/named-group-js-syntax`            |
| End-of-string anchors       | `\Z`, `\z`        | _invalid_ → pattern fails to compile; `compileQuery` surfaces the error. Use `$`.           | `divergence/backslash-z-anchor-not-supported` |
| Balancing groups            | `(?<-name>)`      | _no equivalent_ → fails to compile → no match.                                              | `divergence/balancing-groups-not-supported`   |
| Inline option groups        | `(?i)`, `(?m)`, … | _not a flag toggle_ → case is controlled by the match-case toggle (`gmi`/`gm`), not inline. | `divergence/inline-options-block`             |

### Behavior contract for unsupported patterns

When a pattern uses a .NET-only construct that JS rejects, `new RegExp(...)`
throws. The engine handles this deterministically:

- **`compileQuery`** returns `{ ok: false, error }` so the find bar can surface
  the engine's error message (mirrors UWP's `regexError` red-text affordance).
- **`findNext` / `findPrevious` / `findAllRegexMatches` / `replaceAll`** catch the
  throw and return "no match" (`null` / `[]` / `{ text, count: 0 }`) — never an
  exception bubbling into the UI.

### Replacement-string escapes (parity, not a gap)

In **regex** replacement only, the engine expands `\r`, `\n`, `\t` to CR/LF/TAB
before substitution (UWP `ApplyTabAndLineEndingFix`, order: `\r` → `\n` → `\t`).
`$1`/`$<name>` group substitution is handled natively by `String.replace`.
**Literal** replacement is verbatim — no escape expansion and no `$` substitution,
exactly like the UWP literal path.

## Acceptance (Gate 3)

The regex-parity fixture passes — including the RTL reverse-search rows — and the
`divergence`-tagged rows pin the rewrite's actual JS-RegExp behavior. The gaps
above are accepted sign-off items, not blockers.
