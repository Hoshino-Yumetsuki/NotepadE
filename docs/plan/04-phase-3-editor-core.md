# Phase 3 — Editor Core: Commands, Find/Replace, Encoding/EOL

**Objective:** Full editor behavior parity. This is the deepest phase; gated by the golden-image + keyboard + encoding + regex harnesses simultaneously.

**Editor choice (final): CodeMirror 6.** Rationale: plain-string doc + transaction/StateField model makes the `\r`-shadow buffer and deterministic undo grouping tractable; gutters/line-highlighter/zoom-as-font-size simpler than re-skinning Monaco; lighter bundle fits the "blazingly fast & lightweight" ethos. Editor choice does NOT solve regex `RightToLeft` (EC-2) or encoding (EC-3) — both require Node-side engines regardless.

## Workstreams

### 3.B1 — Editor commands (Lane B)

Implement every command from the appendix as CM6 commands/transactions with exact bindings:

- Duplicate line/selection (Ctrl+D), Join lines w/ single space (Ctrl+J), Move lines (Alt+↑/↓), Move words (Alt+←/→), indent/outdent (Tab/Shift+Tab) with tab-as-spaces `-1`(real tab, default)/2/4/8, auto-indent on Enter/Shift+Enter (copy leading whitespace).
- Insert datetime F5 (**CurrentCulture default format — corrected vs bundle, NOT a fixed string**).
- `.LOG` auto-timestamp once-per-open (`"h:mm tt M/dd/yyyy"`, guard flag).
- Web search Ctrl+E (URL-or-search-engine: Bing/Google/DuckDuckGo/custom).
- RTL/LTR Ctrl+R/Ctrl+L (CM6 `EditorView.contentDirection`).
- Zoom 10–500% as font-size (Ctrl+ +/−/0, Ctrl+wheel).
- Word-wrap toggle Alt+Z.
- **Smart Copy = whitespace-trim-on-copy** (default off — **corrected vs bundle, NOT paragraph expansion; cut never trims**).
- Ctrl+Z/Ctrl+Shift+Z undo/redo. Swallow Ctrl+B/I/U and the other RichEditBox defaults (no-op handlers) so no rich formatting leaks.

### 3.B2 — Find/Replace (Lane B)

Find bar UI (Fluent), match-case/whole-word/regex (whole-word & regex mutually exclusive in UI), F3/Shift+F3 next/prev with wrap-around, Ctrl+F/Ctrl+H/Ctrl+Shift+F, Ctrl+G go-to-line, Enter/Shift+Enter in-bar next/prev, replace-one/replace-all (replace-all = 1 undo step, iterative = N), escape-sequence handling in regex replacement (`\r \n \t`). Regex reverse-search shim from 0.F.

### 3.A — Encoding/EOL full engine (Lane A)

Productionize the 0.E ladder. Read/write/convert across UTF-8 ±BOM, UTF-16 LE/BE ±BOM, GB18030, Shift-JIS, Big5, 40+ ANSI codepages (port `EncodingUtility.ANSIEncodings` table). EOL detect (CRLF-first, then CR, then LF, default CRLF) and convert. Status-bar reopen-with / save-with encoding commands. Authoritative labels never re-derived in renderer.

**Main↔renderer authority contract:** MAIN reads bytes, decodes, and sends authoritative `{decodedText, encodingName, eol}`. Renderer normalizes to a `\r` shadow buffer for editing ONLY and NEVER re-derives encoding/EOL (re-deriving off the normalized buffer always reports CR and corrupts round-trips).

### 3.D — Harness (Lane D)

Encoding round-trip corpus (~150 files incl. empty, .LOG, mixed EOL, and a LARGE file ABOVE the old 1,024,000-byte boundary to prove it opens/edits/saves — the old cap is dropped). Regex-parity fixture incl. RTL reverse case. Keyboard table fixture from appendix. Editor-surface golden images.

## File size limit — DIVERGENCE (user-approved)

**The UWP 1,024,000-byte (`1000*1024`) hard cap is DROPPED.** Per user decision, the limit was a UWP architectural/performance artifact (RichEditBox + sandbox), not product intent; the rewrite handling larger files than the original is explicitly acceptable. This is an intentional "more capable than 1:1" divergence (same category as the write-restriction divergence #2).

Behavior in the rewrite:

- No artificial 1 MB block on open. Large files open normally.
- Apply a pragmatic safeguard instead of a hard cap: for very large files, lean on CM6 large-document handling (and consider deferring optional decorations like the line highlighter / heavy gutters past a size threshold) so the editor stays responsive — but never refuse the file the way UWP did.
- Keep the `ignoreFileSizeLimit` concept only as an internal flag for session recovery if any soft guard is added; it must never reproduce the old hard refusal.

Acceptance: opening a file larger than 1,024,000 bytes SUCCEEDS and is editable/savable (byte round-trip still 0% mismatch). Do NOT assert the old cap.

## Dependencies

Phase 2 (tabs host editors), 0.D/0.E/0.F spikes.

## VERIFICATION GATE 3 (composite — all must pass)

- [ ] **Keyboard conformance: 100%** of appendix bindings (zero tolerance).
- [ ] **Encoding round-trip: 0% byte mismatch** on open→save→sha256 across the 150-file corpus; auto-detection ≤2% label miss vs UWP UTF.Unknown (documented).
- [ ] **Regex-parity fixture** passes, including RTL reverse-search row; flavor divergences documented for sign-off.
- [ ] **Golden-image:** editor surface ≤0.1% per theme.
- [ ] **No file-size cap (divergence):** a file ABOVE the old 1,024,000-byte boundary opens, edits, and saves with 0% byte round-trip mismatch; the old hard refusal is NOT reproduced.
