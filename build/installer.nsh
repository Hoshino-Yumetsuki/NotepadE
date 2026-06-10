; installer.nsh — installer customizations.
;
; 1. "Open with NotepadsE" is controlled at runtime via Settings > Advanced.
;    The installer no longer writes the registry key; the uninstall macro still
;    cleans up any key that was written at runtime.
;
; 2. Desktop shortcut is opt-in/opt-out via a wizard checkbox (default checked).
;    electron-builder always creates the desktop link in its install section
;    (addDesktopLink, which runs before customInstall); we add a checkbox page
;    after the directory page and, if the user unchecks it, remove the link in
;    customInstall. Silent installs never show the page, so $CreateDesktopShortcut
;    stays "1" (default) and the link is kept — matching electron-builder's
;    default. The built-in `--no-desktop-shortcut` silent flag is unaffected.
;
; 3. The chosen installation directory is created explicitly before the install
;    section runs. electron-builder's section relies on `SetOutPath $INSTDIR`
;    to materialize the folder right before extraction; when the user typed a
;    path whose parents don't exist yet, creating it up-front (CreateDirectory
;    is recursive and a no-op on an existing folder) guarantees the extraction
;    CopyFiles never sees a missing destination. Best-effort: a per-machine
;    target the outer (non-elevated) instance can't create is recreated by the
;    elevated section's SetOutPath as before.
;
; NOTE: this file is prepended BEFORE MUI2.nsh is included, so LogicLib / nsDialogs
; macros (${If}, ${NSD_*}) may only be used INSIDE macros — those bodies are
; expanded later, after MUI2 is loaded. Plain `Var` declarations are fine here.

; The desktop-shortcut machinery (the Var + the three installer-side macros that
; read/write it) is installer-only. electron-builder compiles this file twice: a
; BUILD_UNINSTALLER pass (for the embedded uninstaller) and the main installer
; pass. In the uninstaller pass electron-builder's !ifmacrodef guards skip
; customInit/customPageAfterChangeDir/customInstall, so an unconditional
; `Var CreateDesktopShortcut` would be declared-but-never-referenced and trip
; NSIS warning 6001 — which electron-builder escalates to a fatal error. Guarding
; the block keeps the var (and its references) paired in the only pass that uses
; them. customUninstall stays outside the guard so it still builds.
!ifndef BUILD_UNINSTALLER

Var CreateDesktopShortcut
Var CreateDesktopShortcutCheckbox

; Default to "create" so silent / unattended installs keep the standard behavior.
!macro customInit
  StrCpy $CreateDesktopShortcut "1"
!macroend

; Custom wizard page (shown after the install-directory page) with a single
; "Create a desktop shortcut" checkbox, checked by default.
!macro customPageAfterChangeDir
  Page custom CreateDesktopShortcutPageCreate CreateDesktopShortcutPageLeave

  Function CreateDesktopShortcutPageCreate
    !insertmacro MUI_HEADER_TEXT "附加任务 / Additional Tasks" "选择安装时要执行的附加任务 / Choose additional tasks to perform during installation."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 10u 100% 12u "创建桌面快捷方式 (Create a desktop shortcut)"
    Pop $CreateDesktopShortcutCheckbox
    ${If} $CreateDesktopShortcut == "1"
      ${NSD_Check} $CreateDesktopShortcutCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function CreateDesktopShortcutPageLeave
    ${NSD_GetState} $CreateDesktopShortcutCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $CreateDesktopShortcut "1"
    ${Else}
      StrCpy $CreateDesktopShortcut "0"
    ${EndIf}

    ; Auto-create the chosen installation directory (point 3 in the header).
    ; This page is the last stop after the directory page, so $INSTDIR is the
    ; user's pick; CreateDirectory builds the whole parent chain and is a
    ; no-op when the folder already exists. (electron-builder's instFilesPre
    ; may still append the app-name subfolder afterwards — the install
    ; section's SetOutPath creates that final level on top of this chain.)
    ClearErrors
    CreateDirectory "$INSTDIR"
  FunctionEnd
!macroend

; Runs after electron-builder's addDesktopLink. If the user opted out, remove the
; desktop shortcut it just created (and unregister its AppUserModelID).
!macro customInstall
  ; Point 3, defensive: by now the install section's SetOutPath/extraction has
  ; materialized $INSTDIR; this re-assert only matters if a later step (or an
  ; external tool) removed it mid-install. No-op when present.
  CreateDirectory "$INSTDIR"

  ${If} $CreateDesktopShortcut != "1"
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend

!endif ; !BUILD_UNINSTALLER

!macro customUninstall
  DeleteRegKey HKCU "Software\Classes\*\shell\NotepadsE"
!macroend
