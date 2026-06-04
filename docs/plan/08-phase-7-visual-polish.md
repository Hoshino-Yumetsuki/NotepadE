# Phase 7 — Visual Polish

**Objective:** Acrylic approximation, reveal brush, edge shadows, toast, compact overlay, animations — the final visual-parity layer.

## Tasks

1. (C) **Acrylic approximation:** static blurred-tint + opacity tokens (signed-off substitute). Settings-pane & notification acrylic equivalents. Wallpaper-sampling host-backdrop is explicitly OUT-OF-SCOPE (Chromium `backdrop-filter` only blurs in-page content; Electron acrylic/mica blurs windows behind, Win11-only/unstable).
2. (C) **Reveal brush** (CSS radial-gradient-follows-cursor) on caption/tab/status-bar hover; SetsView reveal background greys.
3. (C) **Edge-shadow system** (tab top/bottom/side shadows, blur 8–10, per-theme opacity tokens).
4. (C) **In-app toast:** 80ms slide, −20px offset (matching MainPage overrides), text-measured sizing.
5. (C) **Compact overlay** (F12 → frameless alwaysOnTop small window) + full-screen (F11 → `setFullScreen`).
6. (C) **Caption-button styling** within `titleBarOverlay` constraint (accept tradeoff); Segoe Fluent glyphs preserved.

## Dependencies

All prior phases.

## VERIFICATION GATE 7 (final UI gate)

- [ ] Full golden-image suite ≤0.1% per component per theme (Light/Dark/HC).
- [ ] Toast timing/offset matches; compact-overlay and full-screen behave per matrix.
- [ ] **Full acceptance matrix green; keyboard 100%; encoding 0% byte-mismatch; session parity green.**
