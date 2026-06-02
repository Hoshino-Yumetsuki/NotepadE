# Phase 4 — File IO, Session Snapshot, Crash Recovery + Status Bar

**Objective:** Persistence parity and the 8-column status bar (consumes encoding/EOL/zoom/line-col state from Phase 3).

## Workstreams

### 4.A — File IO + session (Lane A)
Open/save/save-as/reload-from-disk over IPC. Session snapshot every 7s (dirty-checked against last JSON, like UWP `_lastSessionJsonStr`). Backup files (LastSaved + Pending, no extension). Versioned `NotepadsSessionData.json` (`Version==1`), `SessionDataCorruptedException`-equivalent → rename corrupted backups. Recovery 3-case logic (no-file / file-no-pending / file-with-pending) with `ignoreFileSizeLimit:true`.

**FutureAccessList substitute (PA-4):** session stores ABSOLUTE PATHS (not UWP tokens). On load each path is re-validated via `fs.stat`; missing/renamed → tab marked unavailable (no crash), mirroring UWP's `GetItemAsync` try/catch silent-skip.

### 4.C — Status bar (Lane C)
8 columns matching UWP:
0. file-mod-state indicator (`E7BA` warn / `E9CE` unknown)
1. path + flyout (reload `E72C`, copy-path `E8C8`, open-folder `ED25`, rename `E8AC`)
2. modification + flyout (preview-changes `E89A`, revert `E7A7`)
3. line/col + go-to
4. zoom slider flyout (10–500, icons `E108`/`E109`)
5. line-ending menu (CRLF/CR/LF)
6. encoding menu built dynamically (reopen-with / save-with, Unicode set + "More encodings" from ANSI table)
7. shadow-window indicator (`E737`)

Hover reveal backgrounds. 25px height, 11px font, 8/4 padding.

### 4.D — Harness (Lane D)
Session/state parity script: kill-with-dirty → restart → assert tab count, dirty flags, caret, scroll, encoding, view-mode. Status-bar golden images + flyout matrix rows.

## Dependencies
Phase 3.

## VERIFICATION GATE 4
- [ ] Session parity: scripted dirty-kill → restart restores tab count, dirty flags, caret, scroll, encoding, view-mode exactly.
- [ ] Status bar golden-image ≤0.1% per theme; all 8 flyouts assert correct actions via matrix.
- [ ] Reload-from-disk and external-modification indicator behave per matrix.
