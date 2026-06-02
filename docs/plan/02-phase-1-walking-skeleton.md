# Phase 1 — Walking Skeleton + PA-8 Security Gate

**Objective:** End-to-end thinnest slice: Electron main + typed preload + React renderer, one window, one CM6 editor, open/save one file over IPC (bytes→main→decode→string→renderer; save reverse), Fluent theme applied. PA-8 gate green and wired into CI permanently.

## Tasks (TDD order)
1. (D) Write PA-8 static-scan script (fails build on `nodeIntegration:true`, `contextIsolation:false`, `sandbox:false`, any `require|import` of `fs|child_process|path` in renderer sources, any `@electron/remote`). Commit as red against a deliberately-bad fixture, then green.
2. (A) `BrowserWindowFactory` from 0.A decision; `webPreferences` hardened.
3. (Preload) `window.notepads.file.open/save` + `.d.ts` contract.
4. (A) MAIN handlers: read bytes → encoding engine (from 0.E) → `{decodedText, encodingId, eolId}`.
5. (B) Renderer: CM6 mounted, shadow buffer normalization, Fluent v9 `FluentProvider` + theme tokens (Dark `#2E2E2E` / Light `#F0F0F0` bases hardcoded).
6. (D) Playwright Electron driver boots app, opens a fixture file, asserts editor content == expected decoded string; saves, asserts file bytes.

## PA-8 Security mandate (non-negotiable, build-breaking, runs in CI)
- `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true` where feasible.
- Static scan FAILS build on: `nodeIntegration:true` / `contextIsolation:false` / `sandbox:false` / any `require|import` of `fs|child_process|path` in renderer sources / any `@electron/remote`.
- The `contextBridge` surface must be a single typed `window.notepads` API whose method signatures are the ONLY IPC contract (no raw `ipcRenderer.send` exposed).
- Gate runs in CI, not just locally. Must live in the walking skeleton — retrofitting after fs logic reaches the renderer is a rewrite.

## Dependencies
0.A (window), 0.E (encoding engine), 0.D (shadow model).

## Parallel streams
D (scan+harness) ∥ A (main+ipc) ∥ B (renderer+CM6). Join at gate.

## VERIFICATION GATE 1
- [ ] PA-8 scan runs in CI and **fails** the bad fixture, **passes** the real tree.
- [ ] Playwright: open→assert content→save→assert bytes round-trips one UTF-8 file.
- [ ] App cold-starts in a window with the correct base theme color per OS theme.
