# Phase 2 — Tabs / SetsView (largest custom component)

**Objective:** Tabbed editing with reorder, close, context menu, add-tab — full SetsView behavioral parity (intra-window only; cross-window transfer deferred to Phase 6, which depends on the broker).

## Tasks
1. (D) Matrix rows + golden images for tab strip (Light/Dark/HC).
2. (C) `TabStrip` component (dnd-kit + custom hit-testing). Reorder, drag-within-strip, scroll-overflow buttons (UWP `ScrollAmount=50`), add-tab button (glyph `E710`), close button (glyph `E711`), middle-click close.
3. (C) Tab context menu (Fluent `Menu`): Close (Ctrl+W), Close Others, Close to the Right, Close Saved, Copy Full Path, Open Containing Folder, Rename (F2) — exact UWP `TabContextFlyout` item set/order.
4. (B) Tab state model: each tab owns `{editorId, filePath|null, encodingId, eolId, isModified, viewMode, caret, scroll}`.
5. (B) Multi-editor lifecycle: create/activate/close, Ctrl+N/T/W, Ctrl+Tab/Ctrl+Shift+Tab, Ctrl+1–9 jump.

## Notes (custom-component reality)
SetsView in the source is a 547-line `ListViewBase` subclass with template parts, edge drop-shadows, reorder/drag-out, and a dynamic width algorithm. No Fluent v9 tab control comes close. This is a from-scratch React component (~1500–2500 LOC) and the second-largest fidelity risk after the editor core. Preserve Segoe MDL2/Fluent glyph codepoints for 1:1.

## Dependencies
Phase 1.

## Parallel streams
C (component+menu) ∥ B (state+lifecycle) ∥ D (golden images).

## VERIFICATION GATE 2
- [ ] Keyboard conformance: all tab shortcuts (see appendix) 100% pass via Playwright key-injection.
- [ ] Golden-image diff: tab strip ≤0.1% pixel delta per theme.
- [ ] Matrix: reorder, close-others, close-to-right, close-saved, rename, copy-path each assert correct DOM/file state.

## Phase-2 decisions (lead-approved)
- **Glyph fidelity / golden-image runner:** tab glyphs render as REAL "Segoe MDL2 Assets" codepoints (E710 add, E711 close, E76B/E76C/F127 etc.) for exact UWP icon metrics. The pixel-diff golden-image job runs on a **Windows CI runner** (the font is Windows-licensed and not redistributable, so we do NOT bundle it). PA-8 + unit + Playwright behavioral/keyboard tests stay cross-platform; only the golden-image job is Windows-pinned.
- **High-Contrast (HC) golden:** Phase 2 uses **strip-local HC tokens** (data-theme attr + HC token set in tabs/tokens.ts) so the harness can capture an HC golden of the tab strip now, WITHOUT rewiring the global FluentProvider. Phase-5 follow-up: promote strip-local HC tokens to the app-wide `webHighContrastTheme` when live theming lands.
