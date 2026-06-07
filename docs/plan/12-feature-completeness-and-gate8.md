# Phase 7.5 — Feature Completeness + Gate-8 Execution

Close the remaining UWP-parity gaps found by the 4-agent feature sweep, then run the
already-defined Gate-8 (non-functional release gate, `09-phase-8-nonfunctional-release.md`).

User decisions (this session):

- 1 MB large-file limit: **SKIP** (it was a UWP perf workaround, not a requirement).
- In-app updates: **DEFER**, document as a release-infra R-item (no signing/feed/publish here).
- Encoding system-ANSI: **query the real OS ANSI codepage** (ACP), not hardcoded 1252.
- Print preview: **keep** the @media-print host + OS print dialog preview (accepted substitution).

## Work items

### W1 — App-level close reminder (DATA-LOSS fix, highest priority)

UWP `MainPage_CloseRequested` intercepts window close; rewrite's `windowClose` just calls
`win.close()`. Port the deferral flow.

- `ipc-channels.ts`: add `WindowConfirmClose` (invoke) + `EvtWindowCloseRequested` (push).
- `ipc-contract.ts` `WindowApi`: add `confirmClose(): Promise<Result<void>>` and
  `onCloseRequested(cb): Unsubscribe`.
- `preload/index.ts`: wire both.
- `window-factory.ts`: `win.on('close', e)` — if window NOT in `confirmedClose` set,
  `e.preventDefault()` + `webContents.send(EvtWindowCloseRequested)`. Else allow.
- `window.ts`: `windowConfirmClose(event)` → add owning window to `confirmedClose`, call
  `win.close()` (now passes the guard). Keep existing `windowClose` (CaptionButtons X →
  `win.close()` → intercepted → unified path).
- `App.tsx`: subscribe `onCloseRequested`. Logic mirrors UWP:
  - `settings.sessionSnapshot` ON → snapshot already runs; `confirmClose()` immediately.
  - else no dirty tabs → `confirmClose()`.
  - else open new `AppCloseReminderDialog`: Save All & Exit (`doSaveAll`, confirm iff all
    saved), Discard & Exit (`confirmClose`), Cancel (stay open).
- New `AppCloseReminderDialog.tsx` (Fluent Dialog, `AppCloseSaveReminderDialog_*` keys).
- Tests: unit (reducer for decide-action), e2e (dirty tab + close → dialog → each branch).

### W2 — Read-only file handling + FileIO write retry

- `file-io.ts`: wrap `writeFile` in a retry helper (3 attempts, small backoff) on transient
  `EBUSY`/`EPERM`/`EACCES` (OneDrive/AV locks; UWP `ExecuteFileIOOperationWithRetries`).
- Detect a genuinely read-only target and return a descriptive `Result` error
  (renderer surfacing is the separately-deferred Toaster; no silent data loss — the close
  reminder's Save branch already aborts on a failed save).
- Unit test for the retry wrapper (mock fs rejects twice then resolves).

### W3 — Window bounds persistence

- New `window-bounds.ts`: persist `{x,y,width,height,isMaximized}` to `WindowBounds.json` in
  userData (atomic write, e2e-override aware — mirror `settings.ts`).
- `window-factory.ts`: restore saved bounds on create (validate inside a connected display;
  fall back to 1100×720 centered). Save on `resize`/`move` (debounced) + `close`; track
  maximize separately. **Skip restore+persist under `NOTEPADS_E2E=1`** so specs stay
  deterministic at the fixed default size.
- Unit test for the pure clamp-to-display + serialize logic.

### W4 — Go-to-line dialog (replace window.prompt)

- New `GoToLineDialog.tsx` (Fluent Dialog/inline bar, `GoTo_*` keys), numeric input +
  validation (`GoTo_NotificationMsg_InputError_InvalidInput`, line-count clamp).
- `useFindBar.tsx` `openGoToLine`: open the dialog instead of `window.prompt`; on submit call
  existing `goToLine(view, n)`.
- Unit test for validation/clamp.

### W5 — Editor right-click context menu (+ Share / RTL entry points)

- New `EditorContextMenu.tsx` mounted with the editor: CM6 `domEventHandlers.contextmenu`
  opens a Fluent Menu at the pointer. Items (UWP `TextEditorContextFlyout` order, existing
  `TextEditor_ContextFlyout_*` keys): Cut/Copy/Paste/Undo/Redo/Select All, RightToLeft
  reading order (`setLtr`/`setRtl`), Word Wrap (`toggleWordWrap`), Search in web
  (selection only → `webSearchSelection`), Toggle Preview (md only), Share (`useShare`;
  label swaps Share/Share Selected on selection).
- Cut/Copy/Paste via `navigator.clipboard` (renderer-allowed) + CM dispatch; PA-8 clean.
- This also gives Share + RTL their missing UI entry points.
- Tests: render + item-gating (preview only on .md, websearch only with selection).

### W6 — About version wired to package.json

- `vite.config`: `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`.
- `aboutInfo.ts`: `APP_VERSION = __APP_VERSION__` (declare the global). Value is currently
  `0.0.0` (package.json) — wiring is correct regardless; Gate-8 release bump flows through.

### W7 — Encoding: real OS ANSI codepage (ACP)

- New `system-codepage.ts` (MAIN): on win32, read ACP once from registry
  `HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage\ACP` (via `reg query`), map the
  codepage→codec through the existing `ANSI_CODECS` table; cache. Fallback `windows-1252`.
- `encoding.ts`: `systemAnsiCodec()` returns the resolved ACP codec.
- Unit test (mock the resolver) — keep all existing encoding tests green.

### W8 — Jump List "New Window" task (minor)

- `shell.ts`: on win32 add a `app.setUserTasks` "New window" task (protocol newinstance verb)
  alongside the existing Recents. Best-effort, swallow failures.

## Gate-8 execution (after W1–W8 pass the full gate)

Per `09-phase-8-nonfunctional-release.md`:

1. Full verification gate: `format && typecheck:node && typecheck:web && lint && pa8:scan &&
test && build` — all green.
2. e2e suite (note the 3 known environment-sensitive WM specs).
3. Measure: cold start ≤2000ms, idle RAM ≤250MB, 1MB open ≤300ms (add a small measure
   script); installer ≤150MB via electron-builder packaging **if** the build config is
   present — if packaging needs signing/infra not on this box, flag as red-flag divergence
   (sign-off), don't fake it.
4. PA-8 re-assert; record results + the deferred-updates R-item in
   `11-signoff-and-risk-register.md` and tick Gate-8 checkboxes.

## Constraints (standing)

- Do NOT weaken PA-8 (renderer never imports fs/child_process/path/electron/webUtils).
- No commit/push without explicit user request; footer
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Author and review/verify in separate passes.
