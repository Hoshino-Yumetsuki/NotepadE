# Phase 5 — Settings Panes + Live Theme/Accent

**Objective:** All 4 settings panes (Text&Editor, Personalization, Advanced, About) with live OS theme + accent follow.

## Tasks
1. (C) Settings shell (Fluent `Nav`) + 4 panes. Every setting from the confirmed inventory:
   - **Text & Editor:** text-wrap, spellcheck-highlight, line-highlighter, line-numbers, font family/size/style/weight, default line-ending, default encoding, default decoding (auto/UTF-8/ANSI), tab-indents (-1/2/4/8), search engine + custom URL.
   - **Personalization:** theme mode (Light/Dark/system), tint opacity slider (default 0.75), Windows-accent toggle (default on), custom accent picker.
   - **Advanced:** show-status-bar, smart-copy, session-snapshot toggle, always-open-new-window, exit-when-last-tab-closed, language (29 locales).
   - **About:** version, links, dependency credits, disclaimer.
2. (A) Settings persistence in MAIN (replaces UWP `ApplicationSettingsStore`); broker reads `AlwaysOpenNewWindow`.
3. (C) Theme tokens hardcoded & confirmed against `ThemeSettingsService.cs`:
   - Base: Dark `#2E2E2E`, Light `#F0F0F0`.
   - Titlebar: `#2D2D2D` (dark) / `#D2D2D2` (light).
   - Caption hover/pressed greys: dark `#5A5A5A`/`#787878`, light `#B4B4B4`/`#969696`.
   - Tab edge-shadow opacity: Light 0.55 / Dark 0.7 / HC 0.0.
   - Tint opacity default 0.75.
   - `nativeTheme.on('updated')` + accent-change listeners → Fluent `BrandVariants`.

## Dependencies
Phases 2–4 (settings drive their behavior).

## Parallel streams
C (panes+theming) ∥ A (persistence).

## VERIFICATION GATE 5
- [ ] Each setting persists across restart and live-affects behavior (matrix rows).
- [ ] OS theme switch (Light↔Dark↔HC) live-updates without restart; accent change reflected.
- [ ] Settings-pane golden-image ≤0.1% per theme.
