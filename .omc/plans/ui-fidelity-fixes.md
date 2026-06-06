# Plan: notepads-next UI Fidelity Fixes (UWP 1:1)

Investigation complete (3 Explore agents, read-only, against `E:\Projects\Notepads` UWP source + `E:\Projects\notepads-next`). This plan fixes 7 reported issues. File ownership is partitioned so the 4 execution workers do NOT edit the same files.

## Issues

1. GPU init failure → severe lag (`Failed to create shared context for virtualization`).
2. Hamburger dropdown menu (left of tabs) + right-side settings pane + new-doc (+) button.
3. Colors too light vs original.
4. Input box style mismatch.
5. Scrollbar style mismatch.
6. Language selection does not switch UI (stuck English).
7. Line numbers + active-line highlight not working.

## UWP ground truth (from investigation)

- **Hamburger**: `MainMenuButton`, glyph `GlobalNavigationButton` (MDL2 ``), width 42 h 32, LEFT of tab strip (SetsView `SetsStartHeader`, col 0). Opens a `MenuFlyout` (BottomEdgeAlignedLeft). Menu order: New (Ctrl+N), New Window (Ctrl+Shift+N), Open… (Ctrl+O), [Open Recent submenu], ─, Save (Ctrl+S), Save As… (Ctrl+Shift+S), Save All, ─, Find… (Ctrl+F), Replace… (Ctrl+Shift+F), ─, Enter Full Screen (F11), CompactOverlay (F12), ─, Print… (Ctrl+P), Print All… (Ctrl+Shift+P), ─, Settings (F1).
- **New (+) button**: `NewSetButton`, glyph ``, width 42 h 32, RIGHT of tab strip (`SetsActionHeader`, col 3). Action = new editor (same as Ctrl+N).
- **Settings presentation**: `RootSplitView` `DisplayMode=Overlay`, `PanePlacement=Right`, `OpenPaneLength=385`, slides in from RIGHT as overlay. Inside: NavigationView LeftCompact + content pages. F1 toggles, Esc closes.
- **Colors** (base tint): Light `#F0F0F0`, Dark `#2E2E2E`. Default tint opacity 0.75 BUT HostBackdropAcrylic remaps via min-threshold 0.35: `effective = (1-0.35)*tint + 0.35` → at 0.75 → **0.8375 weight** of the solid base over backdrop. Plus an Overlay noise grain. Editor text fg: Light `#000000`, Dark `#F0F0F0`. Selection highlight = **system accent color** (not muted). Title bar: Light `#D2D2D2`, Dark `#2D2D2D`.
- **Editor**: RichEditBox, font **Consolas 14px**, line-height EXACT = font size (tight), padding **6/6/10/6** (L/T/R/B), background Transparent.
- **Find/replace TextBox**: Light `#E0E0E0`@0.7, Dark `#1E1E1E`@0.7.
- **Scrollbar**: OS-default Win11 conscious-scroll — thin overlay rail, expands to ~6px thumb on hover, auto-hide, thumb ~`#8A8A8A` dark / `#898989` light semi-transparent. No custom template in UWP (inherits OS).

## notepads-next current state (from investigation)

- i18n machinery WORKS and is subscribed; break = settings panes use 100% hardcoded English literals (no `useT`). Locale tables already have keys (e.g. `AdvancedPage_LanguagePreferenceSettings_*`).
- No GPU switches anywhere. `window-factory.ts:70` sets `backgroundMaterial:'acrylic'` + transparent `backgroundColor` (`#00000000`) → the GPU trigger.
- Top bar = `TabStrip.tsx` only. `AddTabButton` (+, ``) ALREADY exists at right (line 793). NO hamburger. Settings = floating gear button in `App.tsx:483-495` (absolute top-right of editor) opening a **centered modal `Dialog`** (`SettingsSurface.tsx`), NOT a right pane.
- `tokens.ts` base colors match UWP, but `appBackgroundTint` (lines 95-103) uses tintOpacity 0.75 DIRECTLY as rgba alpha — missing the 0.35 min-threshold remap → too light. Acrylic CSS only applied to settings dialog, not editor.
- No custom scrollbar CSS anywhere; `.cm-scroller` uses UA default.
- `CodeMirrorEditor.tsx:156-163` theme sets only transparent bg + gutter transparent. NO font, caret, selection, active-line, line-number styling. `App.tsx:524-530` mounts `<CodeMirrorEditor>` passing ONLY `editorExtensions` — NOT `settings`/`lineNumbers`/`wordWrap`. → line numbers never render, active line uses invisible CM6 default.

## Work partition (FILE OWNERSHIP — no overlaps)

### Worker A — main/GPU (owns `src/main/**`)

- In `src/main/index.ts`, BEFORE `app.whenReady()`: add `app.commandLine.appendSwitch('use-angle', 'd3d11')` and `app.commandLine.appendSwitch('enable-gpu-rasterization')` to fix shared-context init on workstation GPUs while keeping acrylic.
- In `src/main/window-factory.ts`: keep `backgroundMaterial:'acrylic'` but make it resilient — wrap so that if acrylic can't init the window still paints (renderer already paints tinted base via `appBackgroundTint`). Do NOT call `app.disableHardwareAcceleration()` (kills blur). Verify dev launches with no GPU "Exiting GPU process" error.

### Worker B — top chrome (owns `src/renderer/App.tsx`, `src/renderer/tabs/TabStrip.tsx`, `src/renderer/settings/SettingsSurface.tsx` STRUCTURE only)

- Add a **hamburger MainMenu button** (glyph ``) to the LEFT of the tab list in `TabStrip.tsx` (before the tablist, ~line 722). Use Fluent v9 `Menu`/`MenuTrigger`/`MenuPopover`/`MenuItem` (NOT preview NavDrawer). Items per UWP order above; wire each to existing commands where they exist (New→new tab, Open, Save, Save As, Find, Replace, Full Screen F11, CompactOverlay F12, Settings). For commands not yet implemented (New Window, Print, Print All, Save All, Open Recent) render the item disabled (greyed) so structure matches — leave a `TODO` comment. Keyboard accelerators shown as right-aligned labels.
- Move Settings invocation off the floating gear: REMOVE the absolute gear `Button` in `App.tsx:483-495`; Settings now opens from the hamburger menu "Settings" item + existing `Ctrl+,`/F1. Keep `settingsOpen` state + test hook.
- Ensure the `+` `AddTabButton` is visible (always shown, right of tabs) — verify it renders; if hidden by opacity, ensure opacity 1.
- Convert `SettingsSurface.tsx` from centered modal `Dialog` to a **right-side overlay pane** (~385px, slides in from right, dismiss on Esc/scrim click). Keep internal nav-left/content-right and all `data-testid`s (`settings-nav`, `settings-nav-${id}`) and the test-hook open/close API. Do NOT edit the `*Pane.tsx` contents (Worker D owns strings).
- In `App.tsx` editor mount (~524-530): PASS `settings`, `lineNumbers`, `wordWrap`, `direction` props to `<CodeMirrorEditor>` (Worker C makes the component consume them). Coordinate via existing `CodeMirrorEditorProps`.

### Worker C — editor + theme (owns `src/renderer/editor/CodeMirrorEditor.tsx`, `src/renderer/theme/tokens.ts`, `src/renderer/chrome.css`)

- **Colors (issue 3)**: in `tokens.ts` `appBackgroundTint`, apply UWP min-threshold remap `effective = (1-0.35)*tintOpacity + 0.35` before building rgba, so default 0.75 → 0.8375 alpha (less washed out). Keep HC opaque Canvas.
- **Editor typography + line numbers + active line (issues 4,7)**: in `CodeMirrorEditor.tsx` `EditorView.theme`, set: `.cm-content` font-family from settings (default `Consolas, monospace`), font-size (default 14px), line-height = font-size (tight); `.cm-line` padding to match 6/6/10/6 feel; **active line**: `.cm-activeLine { background: <subtle overlay> }` and `.cm-activeLineGutter` so it's visible on the transparent surface; **line-number gutter**: visible color from theme; **selection**: `.cm-selectionBackground` = accent color (`#0078D4` default / settings accent). Make the component actually consume `settings.editorFontFamily/Size/Style/Weight` and render `lineNumbers()` when the `lineNumbers` prop is true. Ensure `highlightActiveLine` background is explicit (not invisible default).
- **Scrollbar (issue 5)**: add Win11 conscious-scroll overlay scrollbar CSS (thin rail, ~6px thumb on hover, auto-hide, thumb `rgba(138,138,138,.x)` dark / `rgba(137,137,137,.x)` light) — target `.cm-scroller` + a global `::-webkit-scrollbar` rule in `chrome.css`. Overlay (do not reserve gutter).
- Do NOT edit App.tsx or TabStrip.tsx (Worker B owns them) — only the component's own props consumption.

### Worker D — i18n strings (owns `src/renderer/settings/PersonalizationPane.tsx`, `AdvancedPane.tsx`, `TextEditorPane.tsx`, `AboutPane.tsx`, `src/renderer/i18n/locales/*`)

- Wrap ALL user-visible string literals in the four `*Pane.tsx` files with `const { t } = useT()` + `t('<key>')`, using existing ported `.resw` keys in the locale tables. Add any missing keys to every locale file (en + others) so switching language re-localizes settings. Do NOT edit `SettingsSurface.tsx` (Worker B owns it) — but DO add the section-label keys to locales so B can use them.
- Verify selecting a non-English language now changes the settings UI text live.

## Verify (team-verify)

- `yarn typecheck:node` 0, `yarn typecheck:web` 0, `oxlint` 0, `oxfmt --check` clean, `pa8` PASS, unit tests pass, `yarn build` exit 0.
- Manual/e2e: dev launches with NO GPU "Exiting GPU process" error; hamburger menu left of tabs opens dropdown; + button visible; Settings opens as right pane; language switch re-localizes settings; line numbers + active line render; scrollbar thin/overlay; colors less washed out.
