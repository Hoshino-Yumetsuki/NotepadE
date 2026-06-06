# notepads-next — Behavior Fixes Plan (round 2)

UWP ground truth verified against `E:\Projects\Notepads`. Current-state verified against `E:\Projects\notepads-next`.

## Worker partition (no shared files)

### worker-a — functional core (issues 3 + 4) [executor, opus]

Owns: `src/renderer/App.tsx`, `src/renderer/tabs/useTabsStore.ts`,
`src/renderer/editor/CodeMirrorEditor.tsx`, and as needed
`src/shared/ipc-contract.ts`, `src/main/ipc.ts`, `src/main/file-io.ts`, `src/preload/index.ts`.

**Issue 3 — dirty tracking + Save pipeline**

- CodeMirrorEditor: add a `onDocChanged?: () => void` prop backed by an
  `EditorView.updateListener` that fires on `update.docChanged`. (Live doc text is
  NOT in the store; baseline is `lastSavedTextRef` in App.)
- App.tsx: on doc change for a tab, compare `handle.getShadowText()` to
  `lastSavedTextRef` baseline → `store.setModified(editorId, dirty)`. This lights
  up the already-present tab dot (`TabStrip.tsx:345`) and status-bar "Modified"
  text (`StatusBar.tsx:405`) automatically.
- Save flow (UWP parity, `NotepadsMainPage.IO.cs:159-217`):
  - Add Ctrl+S handler (untitled OR no filePath → Save-As picker; else write to
    existing path). Ctrl+Shift+S → always Save-As. Plain Ctrl+S on an unmodified
    doc is a no-op.
  - Provide `onSave`/`onSaveAs`/`onSaveAll` in `menuCommands` (App.tsx:464) — this
    auto-enables the menu items that are `disabled={!commands.onSave}` in TabStrip.
  - Use `window.notepads.file.save` / `file.saveAs`. VERIFY whether main exposes a
    native Save dialog; if `saveAs` only writes a given path, add a
    `dialog.showSaveDialog` IPC in main + contract + preload.
  - On save success: write file, update `lastSavedTextRef` baseline, set
    `filePath`/untitled→named via store, clear `isModified`.
  - Save All loops modified editors.

**Issue 4 — last-tab close + setting**

- Honor `settings.exitWhenLastTabClosed` (`ipc-contract.ts:236`, default false).
- UWP behavior (`NotepadsMainPage.xaml.cs:496-602`):
  - Closing guard: if setting OFF and exactly 1 tab and it's a pristine untitled
    (no filePath, not modified) → refuse (do nothing).
  - After removal reaching 0 tabs: if setting ON → quit app (IPC to main); else →
    open a fresh untitled tab (window never empties).
  - Dirty tab close should still prompt save/don't-save/cancel — minimum: route
    through existing close confirmation if present, else allow but keep it simple
    and consistent with current close UX (don't silently lose data — if no
    confirm dialog exists, at least keep current behavior for dirty tabs and focus
    the last-tab guard + replacement/exit logic).
- Add app-quit IPC if missing (`app.quit()` in main).

### worker-b — UI fidelity (issues 1 + 2) [designer, sonnet]

Owns: `src/renderer/settings/SettingsSurface.tsx`,
`src/renderer/settings/SettingsPrimitives.tsx`,
`src/renderer/settings/{PersonalizationPane,AdvancedPane,TextEditorPane,AboutPane}.tsx`,
`src/renderer/tabs/TabStrip.tsx`.

**Issue 1 — settings sidebar text layout abnormal**

- Root cause: 385px pane − 132px fixed nav rail − gaps − 24px padding leaves
  ~221px for `space-between` rows → labels wrap, controls cramped.
- UWP inner nav is `PaneDisplayMode=LeftCompact` (icon-compact rail) inside the
  385px pane. Fix the width budget: shrink the nav rail (icon + compact text, no
  wrap, e.g. ~108-120px or icon-only with tooltip), trim paddings, allow rows to
  breathe. Ensure labels don't wrap and controls aren't pushed off. Keep all
  data-testids and the test-hook API intact.

**Issue 2 — (+) new-tab button "missing"**

- It IS in the DOM (`TabStrip.tsx:951` AddTabButton, wired to `onNewTab`). The
  regression is visual: transparent bg + glyph contrast, or tab-width crowding
  pushing it off the strip.
- Make it reliably visible: ensure it always sits at the right of the strip with
  guaranteed space (not consumed by `flex:1 1 auto` tab list), clear glyph
  contrast, optional subtle bg/border. VERIFY visually by booting the built app
  via `e2e/helpers/launch.ts` and screenshotting / asserting `[data-testid=
"tab-add"]` is visible and in-viewport.

## Verify (lead + verifier)

Full gate: `yarn format && tc:node && tc:web && oxlint && pa8 && unit && build &&
e2e (mount-smoke + roundtrip)`. Add e2e coverage: dirty-dot lights on type, Ctrl+S
saves (untitled→picker), last-tab guard/replacement, + button visible.
