; Installer hooks for Inkpen.
;
; Two things the Tauri NSIS bundler has no configuration for:
;
;   1. The "Markdown Document" entry in Explorer's right-click New menu.
;      Windows builds that menu from ShellNew subkeys under each file extension;
;      a NullFile value means "create an empty file" rather than copying a
;      template. The label comes from the friendly name on the ProgID that owns
;      the extension, so it reads "Markdown Document", not "Inkpen.Markdown".
;
;   2. Appearing in the Open With menu at all.
;      The bundler sets Inkpen as the *default* handler for Markdown, which is
;      why double-clicking a .md works — but Windows builds the Open With list
;      from two other places entirely: the OpenWithProgids values on each
;      extension, and Software\Classes\Applications\<exe>. The bundler writes
;      neither, so before this hook existed Inkpen was invisible in Open With
;      for every file type, including the ones it owned.
;
; Registering under OpenWithProgids is deliberately the polite half of the
; association API: it offers Inkpen as a choice without seizing the default. A
; .txt file keeps opening in Notepad until someone decides otherwise.
;
; SHCTX rather than a literal HKCU/HKLM: with installMode "both" the user picks
; per-user or all-users at install time, and the NSIS multi-user template points
; SHCTX at whichever hive matches. Hard-coding HKCU would write a per-user
; association during an all-users install.
;
; Everything here is removed on uninstall. A New-menu entry or an Open With
; offer that outlives the program is litter, and clicking either would fail.

!define INKPEN_TEXT_PROGID "Inkpen.Text"

; Offer Inkpen for an extension without disturbing whatever owns it.
!macro InkpenOfferFor EXT PROGID
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\inkpen.exe\SupportedTypes" "${EXT}" ""
!macroend

!macro InkpenWithdrawFrom EXT PROGID
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}"
!macroend

; The text and data types Inkpen offers itself for. Markdown is handled
; separately: the bundler already creates Inkpen.Markdown as the default
; handler, so those extensions only need adding to the Open With list.
!macro InkpenForEachTextExt MACRO PROGID
  !insertmacro ${MACRO} ".txt"  "${PROGID}"
  !insertmacro ${MACRO} ".log"  "${PROGID}"
  !insertmacro ${MACRO} ".json" "${PROGID}"
  !insertmacro ${MACRO} ".yaml" "${PROGID}"
  !insertmacro ${MACRO} ".yml"  "${PROGID}"
  !insertmacro ${MACRO} ".toml" "${PROGID}"
  !insertmacro ${MACRO} ".ini"  "${PROGID}"
  !insertmacro ${MACRO} ".csv"  "${PROGID}"
  !insertmacro ${MACRO} ".cfg"  "${PROGID}"
  !insertmacro ${MACRO} ".conf" "${PROGID}"
!macroend

!macro InkpenForEachMarkdownExt MACRO PROGID
  !insertmacro ${MACRO} ".md"       "${PROGID}"
  !insertmacro ${MACRO} ".markdown" "${PROGID}"
  !insertmacro ${MACRO} ".mdown"    "${PROGID}"
  !insertmacro ${MACRO} ".mkd"      "${PROGID}"
  !insertmacro ${MACRO} ".mdx"      "${PROGID}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering the New > Markdown Document entry"
  WriteRegStr SHCTX "Software\Classes\.md\ShellNew" "NullFile" ""

  DetailPrint "Adding Inkpen to the Open With menu"

  ; The application entry. FriendlyAppName is what the Open With list shows;
  ; without it Windows falls back to the file description baked into the exe.
  WriteRegStr SHCTX "Software\Classes\Applications\inkpen.exe" "FriendlyAppName" "Inkpen"
  WriteRegStr SHCTX "Software\Classes\Applications\inkpen.exe\DefaultIcon" "" "$INSTDIR\inkpen.exe,0"
  WriteRegStr SHCTX "Software\Classes\Applications\inkpen.exe\shell\open\command" "" '"$INSTDIR\inkpen.exe" "%1"'

  ; A ProgID for the plain text and data types. Inkpen.Markdown is the
  ; bundler's and stays that way; this one exists only so those files have
  ; something to point at in their OpenWithProgids list.
  WriteRegStr SHCTX "Software\Classes\${INKPEN_TEXT_PROGID}" "" "Text Document"
  WriteRegStr SHCTX "Software\Classes\${INKPEN_TEXT_PROGID}\DefaultIcon" "" "$INSTDIR\inkpen.exe,0"
  WriteRegStr SHCTX "Software\Classes\${INKPEN_TEXT_PROGID}\shell\open\command" "" '"$INSTDIR\inkpen.exe" "%1"'

  !insertmacro InkpenForEachTextExt InkpenOfferFor "${INKPEN_TEXT_PROGID}"
  !insertmacro InkpenForEachMarkdownExt InkpenOfferFor "Inkpen.Markdown"

  ; Explorer caches associations; without this the menu does not change until
  ; the next sign-in. SHCNE_ASSOCCHANGED, with SHCNF_IDLIST.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "Removing the New > Markdown Document entry"
  DeleteRegKey SHCTX "Software\Classes\.md\ShellNew"

  DetailPrint "Removing Inkpen from the Open With menu"
  !insertmacro InkpenForEachTextExt InkpenWithdrawFrom "${INKPEN_TEXT_PROGID}"
  !insertmacro InkpenForEachMarkdownExt InkpenWithdrawFrom "Inkpen.Markdown"

  DeleteRegKey SHCTX "Software\Classes\${INKPEN_TEXT_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\inkpen.exe"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
