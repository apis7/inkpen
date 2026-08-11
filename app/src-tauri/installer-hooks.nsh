; Installer hooks for Inkpen.
;
; Adds a "Markdown Document" entry to Explorer's right-click New menu, which the
; Tauri NSIS bundler has no configuration for. Windows builds that menu from
; ShellNew subkeys under each file extension; a NullFile value means "create an
; empty file" rather than copying a template.
;
; The label shown in the menu comes from the friendly name on the ProgID that
; owns the extension, so it reads "Markdown Document" rather than "Inkpen.Markdown".
;
; HKCU throughout, deliberately: this is a per-user install (installMode is
; currentUser), it needs no administrator, and it must not alter the New menu
; for other accounts on the machine.
;
; The ShellNew key is attached to the extension rather than to Inkpen, so it is
; removed on uninstall — leaving a New-menu entry behind after the app is gone
; would be litter, and clicking it would create files nothing opens by default.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering the New > Markdown Document entry"
  WriteRegStr HKCU "Software\Classes\.md\ShellNew" "NullFile" ""
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "Removing the New > Markdown Document entry"
  DeleteRegKey HKCU "Software\Classes\.md\ShellNew"
!macroend
