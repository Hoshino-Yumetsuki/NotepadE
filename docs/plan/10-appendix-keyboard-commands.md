# Appendix — Keyboard / Command Acceptance Checklist

Derived from source (3 command handlers + feature partials). `[C]` = confirmed in source; `[Δ]` = corrected vs insight bundle; `[?]` = cannot confirm.

## Editor core — editing
- `[C]` Ctrl+Z Undo · Ctrl+Shift+Z Redo
- `[C]` Alt+Z toggle word wrap
- `[C]` Ctrl++ / Ctrl+= / Ctrl+wheel zoom in; Ctrl+− zoom out; Ctrl+0 / Ctrl+Num0 reset (clamp **10–500%**)
- `[C]` F5 insert datetime — `[Δ]` **CurrentCulture default format, NOT fixed string**
- `[C]` Ctrl+E web search selection (URL or engine)
- `[C]` Ctrl+D duplicate line/selection
- `[C]` Ctrl+J join lines (single-space separator)
- `[C]` Tab indent / Shift+Tab outdent (tab-as-spaces -1/2/4/8, default real tab)
- `[C]` Alt+↑/↓ move line(s); Alt+←/→ move word(s)
- `[C]` Ctrl+L set LTR; Ctrl+R set RTL
- `[C]` Enter / Shift+Enter newline with auto-indent
- `[C]` `.LOG` auto-timestamp once per open — format **`"h:mm tt M/dd/yyyy"`**
- `[Δ]` Smart Copy (setting, default off) = **whitespace-trim of selection on copy only** (NOT paragraph expansion; cut never trims)
- `[C]` Swallowed (no-op): Ctrl+B/I/U, Ctrl+Tab/1-9/F3 defaults, Ctrl+Shift+variants, Ctrl+Shift+L, Shift+F3 (core level)
- `[C]` Easter egg Ctrl+Alt+Shift+D ×10 (no-op in source)

## Editor wrapper — find/replace/nav
- `[C]` Ctrl+F find · Ctrl+Shift+F / Ctrl+H find&replace · Ctrl+G go-to-line
- `[C]` Alt+P toggle markdown preview · Alt+D toggle diff viewer
- `[C]` F3 find next · Shift+F3 find previous · Escape dismiss
- `[C]` Find options: match-case, whole-word, regex (whole-word & regex mutually exclusive); wrap-around; regex reverse via RightToLeft shim
- `[C]` In find bar: Enter next / Shift+Enter prev; in replace bar: Enter replace / Shift+Enter replace-prev; Tab switch fields

## App level
- `[C]` Ctrl+N / Ctrl+T new tab · Ctrl+W close · Ctrl+Tab next · Ctrl+Shift+Tab prev · Ctrl+1–9 jump
- `[C]` Ctrl+O open · Ctrl+S save · Ctrl+Shift+S save-as · Ctrl+Shift+R reload-from-disk
- `[C]` Ctrl+P print · Ctrl+Shift+P print-all
- `[C]` Ctrl+Shift+N new app instance
- `[C]` F11 full screen · F12 compact overlay · F1 settings · F2 rename · Escape close pane
- `[C]` Ctrl+Alt+Shift+L open app log file

## Mouse
- `[C]` Ctrl+wheel zoom; Shift/Alt/Ctrl+Shift+wheel horizontal scroll; middle-click close tab

## Cannot confirm `[?]`
Context-menu-only commands (cut/copy/paste/select-all entries) were not exhaustively traced from `TextEditorContextFlyout.cs` — flag for a follow-up read before Phase 3 if exact menu parity is required.
