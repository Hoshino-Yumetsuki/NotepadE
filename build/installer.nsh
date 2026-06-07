; installer.nsh — "Open with NotepadsE" is now controlled at runtime via
; Settings > Advanced. The installer no longer writes the registry key.
; The uninstall macro still cleans up any key that was written at runtime.

!macro customInstall
!macroend

!macro customUninstall
  DeleteRegKey HKCU "Software\Classes\*\shell\NotepadsE"
!macroend
