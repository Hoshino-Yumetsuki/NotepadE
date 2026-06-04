# Phase 0 — Blockers & Spikes

**No implementation merges to `main` until all Gate 0 checks are green.**

**Objective:** De-risk the five load-bearing unknowns and produce the falsifiable acceptance contract before any walking-skeleton code.

## Workstreams (all parallel)

### 0.A — BrowserWindow config decision (Lane C+A)

Lock: `titleBarStyle:'hidden'` + `titleBarOverlay` (Win) for Snap Layouts; `frame` per-OS; tab strip embedded in caption band; theme-token source = `nativeTheme` + `systemPreferences.getAccentColor()`. Produce a one-page locked decision doc + a `BrowserWindowFactory` signature. Capture the reserved caption area (UWP used 180px `TitleBarReservedArea`) as `titleBarOverlay` width.

### 0.B — Acceptance spec authoring (Lane D)

Author the behavioral parity matrix (`feature × input × expected`) as YAML, seeded from the appendix (`10-appendix-keyboard-commands.md`). Capture reference UWP golden images: Light/Dark/HC themes, per-component (tab strip, status bar, editor surface, find bar, settings panes). This is the acceptance contract; **nothing in Phase 1+ is "done" without a matching matrix row.**

### 0.C — Multi-instance broker + cross-window transfer spike (Lane A)

Prove a custom main-process broker can:

1. parse `process.argv` + capture `cwd` on initial launch AND in the `second-instance` event (Windows: file/protocol arrive in argv, NOT `open-url`);
2. decide redirect-vs-spawn per `AlwaysOpenNewWindow`;
3. serialize the drag envelope across two BrowserWindows via a token-keyed transfer registry (undo stack excluded).

Throwaway spike, but the broker API shape it yields is kept.

### 0.D — Editor-core behavioral-parity spike (Lane B)

Prove the shadow-buffer offset model and undo granularity on the _hard_ cases: CRLF↔LF offset mapping (UWP's RichEditBox stored `\r`; CM6 stores `\n` — line/col must match UWP's `GetLineColumnSelection` which adds back `\r\n` width), paste-as-one-undo, iterative-replace-as-N-undo, smart-trim-as-zero-undo.

### 0.E — Encoding heuristic fidelity spike (Lane A)

Port UWP's confidence ladder (`FileSystemUtility.AnalyzeAndGuessEncoding`): ASCII→UTF-8 promotion; fast-path `confidence>0.80 && single detection`; better-match search skipping `confidence≤0.5`, priority **UTF-8 > system-ANSI (codepage 0) > current-culture ANSI**; UTF-8 force-fallback when `<0.5`; `DecoderFallback`→system-ANSI retry. Validate `iconv-lite` + `jschardet`/`chardet` reproduce labels on a 20-file pilot subset.

### 0.F — .NET-regex reverse-search spike (Lane B+D)

Prove the `RegexOptions.RightToLeft` shim: forward-match-all + pick-last-before-cursor. Document .NET-vs-JS flavor gaps (balancing groups, `\Z`/`\z`, named-group syntax) for sign-off.

## Dependencies

None (this is the root). 0.A unblocks Phase 1 window creation; 0.C unblocks Phase 6 broker; 0.E unblocks Phase 3 encoding.

## VERIFICATION GATE 0

- [ ] Acceptance matrix exists and is committed; golden images captured for 3 themes × 5 components.
- [ ] Broker spike demonstrates argv+cwd parse on launch and second-instance, and a JSON envelope round-trips window→main→window with `editorId` preserved.
- [ ] Editor spike: a Playwright script proves CM6 line/col equals UWP's reported line/col on a fixture with mixed CRLF/LF, and the 4 undo-granularity cases pass.
- [ ] Encoding pilot: ≥18/20 labels match UWP on the pilot subset (documented misses).
- [ ] Regex shim: reverse-search fixture returns the last-match-before-cursor.
- [ ] Acrylic decision recorded (static blurred-tint + opacity tokens; wallpaper-sampling OUT) — decision only, not implemented.
