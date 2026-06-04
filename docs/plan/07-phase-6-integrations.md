# Phase 6 — Integrations: Broker, Activation, Cross-Window Transfer, Markdown, Diff, Print, Share, i18n

**Objective:** Wire the productionized broker and all OS/content integrations.

## Workstreams

### 6.A — Broker + activation + transfer (Lane A)

Productionize 0.C: custom broker (redirect-vs-spawn per setting, focused-window tracking, argv/cwd forwarding on launch + second-instance), `notepads://` protocol + `newinstance`, file-type associations (electron-builder file associations from the ~80 group manifest list), CLI argv open.

**Windows protocol/file activation:** arrives via `process.argv` in the `second-instance` event, NOT `open-url` (macOS-only). Parse argv on initial launch AND second-instance; capture `cwd` for relative-path resolution.

#### Drag-out spec (ADJUDICATED — two distinct paths, both in-scope)

**(a) Drop tab onto ANOTHER window = FULL live-state transfer.** Renderer serializes a JSON envelope ONLY:

```
{ sourceWindowId, editorId, filePath|null, lastSavedText, pendingText|null (only if dirty),
  encodingId, eolId, isModified, fileNamePlaceholder, dateModifiedMs, viewMode:{preview,diff} }
```

HTML5 drag carries only a drag token. Flow: source renderer → preload `dragOut.begin(envelope)` → MAIN transfer registry keyed by token → target renderer `dragOut.complete(token,dropIndex)` → MAIN re-validates/re-resolves `filePath` via `fs.stat` + builds file descriptor → `editor.adopt` to target window + `editor.release` to source. MAIN is sole router (no renderer→renderer). **Undo stack is NOT carried** — target seeds fresh history from last-saved baseline + pending content.

**(b) Drop into empty desktop space** = ONLY an untitled+unmodified tab spawns a blank new window; a titled or dirty tab dropped into the void does nothing.

> This corrects the initial recon: the UWP void-drop path (`NotepadsCore.cs:819-830`) only spawns a blank window for untitled+unmodified tabs; the window→window path (`NotepadsCore.cs:715-804`, `OnSetDropped`) reconstructs full live state from the clipboard `DataPackage`.

### 6.B/C — Content integrations (Lane B/C)

- Markdown preview via markdown-it (GFM-equiv) toggled Alt+P (side-by-side, .md family).
- Diff viewer via JS diff lib, side-by-side, synced scroll, Alt+D, color coding (insert green / delete orange-red / modified yellow).
- Print (Ctrl+P / Ctrl+Shift+P print-all).
- Share → OS share / clipboard fallback.
- Jump list → OS recents.

### 6.D — i18n (Lane D/all)

Port 29 locales from `.resw` to the renderer i18n framework; language setting switches at runtime.

## Dependencies

Phases 2–5; 0.C spike.

## VERIFICATION GATE 6

- [ ] Broker: launch with file argv opens it; second instance with `AlwaysOpenNewWindow` off redirects, on spawns; `notepads://newinstance` spawns; relative path resolves via captured cwd.
- [ ] Cross-window transfer: drag tab to second window → full state (incl. pending dirty content) adopted, source releases, undo reset to baseline; titled/dirty-to-void is no-op; untitled-clean-to-void spawns blank window. Asserted by Playwright across two BrowserWindows.
- [ ] Markdown/diff functional-parity matrix rows pass; print produces output; all 29 locales load and switch at runtime.
