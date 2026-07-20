; CodeLens Pro Next v1.1.0 release-candidate installer hooks.
; The stock Tauri NSIS finish page already provides a checked-by-default,
; optional desktop shortcut. Keep the upstream template and only add the
; migration hand-off plus the product rule that uninstall never deletes data.

!macro NSIS_HOOK_PREINSTALL
  ; Tauri's stock silent downgrade guard aborts its early-check section, but
  ; some NSIS runtimes continue into the install section afterwards. Enforce
  ; the product contract here as well: an older setup must never replace a
  ; newer current-user installation.
  ReadRegStr $R8 HKCU "${UNINSTKEY}" "DisplayVersion"
  ${If} $R8 != ""
    nsis_tauri_utils::SemverCompare "${VERSION}" $R8
    Pop $R9
    ${If} $R9 = -1
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}

  ${If} ${FileExists} "$EXEDIR\storage\codelens-next.sqlite"
    CreateDirectory "$LOCALAPPDATA\com.szywah.codelensnext"
    FileOpen $0 "$LOCALAPPDATA\com.szywah.codelensnext\legacy-candidate.txt" w
    FileWrite $0 "$EXEDIR"
    FileClose $0
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Tauri's standard uninstaller exposes an optional app-data checkbox.
  ; This release candidate always preserves user data regardless of that state.
  StrCpy $DeleteAppDataCheckboxState 0
!macroend
