# Custom wizard UI for the RelaxCode installer — dark theme, Manrope,
# pixel-exact page art baked into BMPs (scripts/build-installer-assets.mjs,
# geometry in theme.nsh).
#
# CLICKS: everything navigational is handled by the NATIVE wizard buttons
# (controls 1/2/3 of the parent dialog) — the NSIS core processes them with
# zero plugin routing, so mouse clicks work at any DPI. The buttons are
# moved into our bottom bar (RelaxBarSetup in .onGUIInit), given Manrope
# and light text, and re-labelled per page in the pre callbacks.
# Page dialogs (nsDialogs) hold only passive content: the background art
# and the folder path edit — no plugin click handlers at all.

Var relaxSuffix          ; "-ru" / "-en" asset suffix
Var relaxPage            ; current nsDialogs page handle
Var relaxDeleteAppData   ; uninstaller: "1" when user asked to remove data

Var hBg                  ; page background bitmap control
Var hLEdit               ; dir page: folder path edit
Var hDSpace              ; dir page: free space label
Var hDNote               ; dir page: admin-rights note (hidden)
Var hFontReg
Var hFontMed
Var hFontSemi

# ---------------------------------------------------------------- macros ----

!macro RelaxSetFont CTL FONT
  System::Call 'user32::SendMessageW(p ${CTL}, i 0x0030, p ${FONT}, i 1)' ; WM_SETFONT
!macroend

# dark page: background bitmap baked into BMP, drawn 1:1 over the page area
!macro RelaxPageBmp NAME
  nsDialogs::CreateControl /NOUNLOAD "STATIC" "0x5000010E" 0 0 0 ${RELAX_WINDOW_W} ${RELAX_PAGE_H} "" ; CHILD|VISIBLE|SS_BITMAP
  Pop $hBg
  System::Call "user32::MoveWindow(p $hBg, i 0, i 0, i ${RELAX_WINDOW_W}, i ${RELAX_PAGE_H}, i 1)"
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\${NAME}$relaxSuffix.bmp", i 0, i 0, i 0, i 0x10) p .s' ; LR_LOADFROMFILE
  Pop $0
  System::Call 'user32::SendMessageW(p $hBg, i 0x0172, i 0, p $0)' ; STM_SETIMAGE
  System::Call "gdi32::DeleteObject(p $0)"
!macroend

!macro RelaxLabel CTL X Y W H TEXT COLOR FONT
  nsDialogs::CreateControl /NOUNLOAD "STATIC" "0x50000000" 0 ${X} ${Y} ${W} ${H} "${TEXT}" ; CHILD|VISIBLE
  Pop ${CTL}
  SetCtlColors ${CTL} ${COLOR} transparent
  !insertmacro RelaxSetFont ${CTL} ${FONT}
!macroend

# native wizard buttons into our bottom bar; the bar strip belongs to the
# parent window (below the page area), buttons are its children
!macro RelaxBarSetup
  # bar strip of the parent window: panel color + separator line
  SetCtlColors $HWNDPARENT "" ${RELAX_PANEL}
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x50000007, i 0, i ${RELAX_PAGE_H}, i ${RELAX_WINDOW_W}, i 2, p $HWNDPARENT, p 0, p 0, p 0) p .s' ; CHILD|VISIBLE|SS_ETCHEDHORZ
  Pop $0
  SetCtlColors $0 "" ${RELAX_PANEL}
  GetDlgItem $0 $HWNDPARENT 1   ; Next / Install / Finish / Uninstall
  System::Call "user32::MoveWindow(p $0, i ${RELAX_BTN_X}, i ${RELAX_BTN_Y}, i ${RELAX_BTN_W}, i ${RELAX_BTN_H}, i 1)"
  !insertmacro RelaxSetFont $0 $hFontSemi
  SetCtlColors $0 ${RELAX_FG}
  GetDlgItem $0 $HWNDPARENT 3   ; Back
  System::Call "user32::MoveWindow(p $0, i ${RELAX_BTN_BACK_X}, i ${RELAX_BTN_Y}, i ${RELAX_BTN_W}, i ${RELAX_BTN_H}, i 1)"
  !insertmacro RelaxSetFont $0 $hFontSemi
  SetCtlColors $0 ${RELAX_FG}
  GetDlgItem $0 $HWNDPARENT 2   ; Cancel
  System::Call "user32::MoveWindow(p $0, i ${RELAX_MARGIN}, i ${RELAX_BTN_Y}, i ${RELAX_BTN_W}, i ${RELAX_BTN_H}, i 1)"
  !insertmacro RelaxSetFont $0 $hFontSemi
  SetCtlColors $0 ${RELAX_FG}
!macroend

!macro RelaxBarText IDC TEXT
  GetDlgItem $0 $HWNDPARENT ${IDC}
  SendMessage $0 ${WM_SETTEXT} 0 "STR:${TEXT}"
!macroend

!macro RelaxCreateFonts
  System::Call 'gdi32::CreateFontW(i -14, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, w "${RELAX_FONT_NAME}") p .s'
  Pop $hFontReg
  System::Call 'gdi32::CreateFontW(i -15, i 0, i 0, i 0, i 500, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, w "${RELAX_FONT_MEDIUM}") p .s'
  Pop $hFontMed
  System::Call 'gdi32::CreateFontW(i -15, i 0, i 0, i 0, i 600, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, w "${RELAX_FONT_SEMIBOLD}") p .s'
  Pop $hFontSemi
!macroend

# brands the outer wizard window: 960x640 client, centered, dark, no stock
# chrome; the page area (1018) covers everything above the bottom bar, and
# the bar strip below it belongs to the parent (native buttons live there)
!macro RelaxBrandWindow
  System::Alloc 16
  Pop $0
  System::Call "user32::GetWindowRect(p $HWNDPARENT, p $0)"
  System::Call "*$0(i .r1, i .r2, i .r3, i .r4)"
  System::Call "user32::GetClientRect(p $HWNDPARENT, p $0)"
  System::Call "*$0(i .r5, i .r6, i .r7, i .r8)"
  IntOp $7 $7 - $5            ; client width  (clobbers $7)
  IntOp $9 $3 - $1            ; window width
  IntOp $9 $9 - $7
  IntOp $9 $9 + ${RELAX_WINDOW_W}
  IntOp $8 $8 - $6            ; client height (clobbers $8)
  IntOp $4 $4 - $2            ; window height (clobbers $4)
  IntOp $8 $4 - $8
  IntOp $8 $8 + ${RELAX_WINDOW_H}
  # center on the desktop
  System::Call "user32::GetDesktopWindow() p .s"
  Pop $1
  System::Call "user32::GetWindowRect(p $1, p $0)"
  System::Call "*$0(i .r1, i .r2, i .r3, i .r4)"
  IntOp $5 $3 - $1            ; desktop width
  IntOp $5 $5 - $9
  IntOp $5 $5 / 2
  IntOp $5 $5 + $1            ; x
  IntOp $6 $4 - $2            ; desktop height
  IntOp $6 $6 - $8
  IntOp $6 $6 / 2
  IntOp $6 $6 + $2            ; y
  System::Call "user32::SetWindowPos(p $HWNDPARENT, p 0, i $5, i $6, i $9, i $8, i 0x4)" ; SWP_NOZORDER
  System::Free $0
  System::Free $1

  GetDlgItem $0 $HWNDPARENT 1
  ShowWindow $0 ${SW_HIDE}    ; Next (shown per-page)
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 ${SW_HIDE}    ; Cancel
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}    ; Back
  GetDlgItem $0 $HWNDPARENT 1028
  ShowWindow $0 ${SW_HIDE}    ; icon
  GetDlgItem $0 $HWNDPARENT 1036
  ShowWindow $0 ${SW_HIDE}    ; branding
  GetDlgItem $0 $HWNDPARENT 1039
  ShowWindow $0 ${SW_HIDE}    ; branding
  GetDlgItem $0 $HWNDPARENT 1256
  ShowWindow $0 ${SW_HIDE}    ; branding
  # page area above the bar
  GetDlgItem $0 $HWNDPARENT 1018
  System::Call "user32::MoveWindow(p $0, i 0, i 0, i ${RELAX_WINDOW_W}, i ${RELAX_PAGE_H}, i 1)"
  SetCtlColors $0 "" ${RELAX_BG}
  # bar strip belongs to the parent: panel color + separator + native buttons
  SetCtlColors $HWNDPARENT "" ${RELAX_PANEL}
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x50000007, i 0, i ${RELAX_PAGE_H}, i ${RELAX_WINDOW_W}, i 2, p $HWNDPARENT, p 0, p 0, p 0) p .s' ; SS_ETCHEDHORZ
  Pop $0
  SetCtlColors $0 "" ${RELAX_PANEL}
  !insertmacro RelaxBarSetup
!macroend

# --------------------------------------------------------------- welcome ----

Function showWelcome
  nsDialogs::Create 1018
  Pop $relaxPage
  !insertmacro RelaxPageBmp "page-welcome"
  nsDialogs::Show
FunctionEnd

Function leaveWelcome
FunctionEnd

# --------------------------------------------------------------- license ----

Function showLicense
  nsDialogs::Create 1018
  Pop $relaxPage
  !insertmacro RelaxPageBmp "page-license"
  nsDialogs::Show
FunctionEnd

Function leaveLicense
  # clicking Next IS the acceptance — no checkbox: plugin click routing
  # does not survive real mouse input, so the page carries no interactive
  # controls at all
FunctionEnd

# ------------------------------------------------------------ directory -----

Function showDir
  nsDialogs::Create 1018
  Pop $relaxPage
  !insertmacro RelaxPageBmp "page-dir"

  nsDialogs::CreateControl /NOUNLOAD "EDIT" "0x50010080" 0 ${RELAX_PATH_EDIT_X} ${RELAX_PATH_EDIT_Y} ${RELAX_PATH_EDIT_W} ${RELAX_PATH_EDIT_H} "" ; CHILD|VISIBLE|TABSTOP|AUTOHSCROLL
  Pop $hLEdit
  SetCtlColors $hLEdit ${RELAX_FG} ${RELAX_INPUT}
  !insertmacro RelaxSetFont $hLEdit $hFontReg
  SendMessage $hLEdit ${WM_SETTEXT} 0 "STR:$INSTDIR"

  !insertmacro RelaxLabel $hDSpace ${RELAX_SPACE_X} ${RELAX_SPACE_Y} 800 20 "" ${RELAX_MUTED} $hFontReg
  Call relaxUpdateSpace

  !insertmacro RelaxLabel $hDNote ${RELAX_NOTE_X} ${RELAX_NOTE_Y} 800 20 "$(relaxAdminNote)" ${RELAX_MUTED} $hFontReg
  ShowWindow $hDNote ${SW_HIDE}

  !insertmacro RelaxBarText 1 "$(relaxInstallBtn)"
  nsDialogs::Show
FunctionEnd

Function relaxUpdateSpace
  ${GetRoot} "$INSTDIR" $0
  StrCpy $0 "$0\"
  ${DriveSpace} "$0" "/D=F" $R0
  IntOp $R1 $R0 / 1024
  SendMessage $hDSpace ${WM_SETTEXT} 0 "STR:$(relaxSpaceAvailable)"
FunctionEnd

Function leaveDir
  ${NSD_GetText} $hLEdit $INSTDIR
  StrCpy $1 "$INSTDIR"

  ${If} $INSTDIR == ""
    Abort
  ${EndIf}

  # per-user install (the wizard does not offer per-machine choice; use
  # /allusers for a machine-wide silent install)
  !insertmacro setInstallModePerUser

  # the user's pick wins over the defaults/registry suggested by the mode switch
  StrCpy $INSTDIR "$1"

  # sanitize: make sure the path ends with the app folder (stock behavior)
  ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
  ${If} $0 == ""
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  ${EndIf}
FunctionEnd

# -------------------------------------------------------------- instfiles ---

Function relaxInstFilesPre
  GetDlgItem $0 $HWNDPARENT 1018
  SetCtlColors $0 "" ${RELAX_BG}
  GetDlgItem $0 $HWNDPARENT 1037
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1038
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1027
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1016
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1006
  SetCtlColors $0 ${RELAX_MUTED} ${RELAX_BG}
  System::Call "user32::MoveWindow(p $0, i ${RELAX_STATUS_X}, i ${RELAX_STATUS_Y}, i ${RELAX_STATUS_W}, i ${RELAX_STATUS_H}, i 1)"
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(relaxInstallTitle)"
  !insertmacro RelaxSetFont $0 $hFontMed
  GetDlgItem $0 $HWNDPARENT 1029
  System::Call "user32::MoveWindow(p $0, i ${RELAX_PROGRESS_X}, i ${RELAX_PROGRESS_Y}, i ${RELAX_PROGRESS_W}, i ${RELAX_PROGRESS_H}, i 1)"
  System::Call "user32::SendMessageW(p $0, i 0x0409, i 0, i ${RELAX_ACCENT_BGR})" ; PBM_SETBARCOLOR
  System::Call "user32::SendMessageW(p $0, i 0x0401, i 0, i ${RELAX_CARD_BGR})"  ; PBM_SETBKCOLOR
FunctionEnd

# ---------------------------------------------------------------- finish ----

Function showFinish
  nsDialogs::Create 1018
  Pop $relaxPage
  !insertmacro RelaxPageBmp "page-finish"
  # NSIS hides Next on the last page; bring it back as the launch button
  GetDlgItem $0 $HWNDPARENT 1
  ShowWindow $0 ${SW_SHOW}
  !insertmacro RelaxBarText 1 "$(relaxLaunch)"
  nsDialogs::Show
FunctionEnd

Function leaveFinish
  # the install section already ran; clicking "Launch" closes the wizard
  # and the app start is handled by the Run-after-finish logic below
FunctionEnd

# ------------------------------------------------------------ uninstall -----

Function un.showUnConfirm
  nsDialogs::Create 1018
  Pop $relaxPage
  !insertmacro RelaxPageBmp "page-unconfirm"
  StrCpy $relaxDeleteAppData "0"
  nsDialogs::Show
FunctionEnd

Function un.leaveUnConfirm
FunctionEnd

Function un.relaxUnInstPre
  GetDlgItem $0 $HWNDPARENT 1018
  SetCtlColors $0 "" ${RELAX_BG}
  GetDlgItem $0 $HWNDPARENT 1037
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1038
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1027
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1016
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1006
  SetCtlColors $0 ${RELAX_MUTED} ${RELAX_BG}
  System::Call "user32::MoveWindow(p $0, i ${RELAX_STATUS_X}, i ${RELAX_STATUS_Y}, i ${RELAX_STATUS_W}, i ${RELAX_STATUS_H}, i 1)"
  !insertmacro RelaxSetFont $0 $hFontMed
  GetDlgItem $0 $HWNDPARENT 1029
  System::Call "user32::MoveWindow(p $0, i ${RELAX_PROGRESS_X}, i ${RELAX_PROGRESS_Y}, i ${RELAX_PROGRESS_W}, i ${RELAX_PROGRESS_H}, i 1)"
  System::Call "user32::SendMessageW(p $0, i 0x0409, i 0, i ${RELAX_DESTRUCTIVE_BGR})" ; PBM_SETBARCOLOR
  System::Call "user32::SendMessageW(p $0, i 0x0401, i 0, i ${RELAX_CARD_BGR})"       ; PBM_SETBKCOLOR
FunctionEnd

Function un.showUnFinish
  nsDialogs::Create 1018
  Pop $relaxPage
  !insertmacro RelaxPageBmp "page-unfinish"
  nsDialogs::Show
FunctionEnd

Function un.leaveUnFinish
FunctionEnd

# uninstall data removal hook used by the stock uninstaller section:
# interactive uninstalls keep user data (safe default); silent uninstalls
# still honor the --delete-app-data flag inside uninstaller.nsh
!macro customUnInstall
  ${If} $relaxDeleteAppData == "1"
    ${If} $installMode == "all"
      SetShellVarContext current
    ${EndIf}
    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    !endif
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
!macroend

# assets for the uninstaller process (un.onInit runs in a fresh exe; fonts
# are created by un.onGUIInit)
!macro customUnInit
  StrCpy $relaxSuffix "-en"
  ${If} $LANGUAGE == 1049
    StrCpy $relaxSuffix "-ru"
  ${EndIf}
  InitPluginsDir
  ${IfNot} ${Silent}
    File /oname=$PLUGINSDIR\Manrope.ttf "${PROJECT_DIR}\build\installer\fonts\Manrope.ttf"
    System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\Manrope.ttf", i 0x10, p 0) i .r0' ; FR_PRIVATE
    File /oname=$PLUGINSDIR\page-unconfirm-ru.bmp "${PROJECT_DIR}\build\installer\assets\page-unconfirm-ru.bmp"
    File /oname=$PLUGINSDIR\page-unconfirm-en.bmp "${PROJECT_DIR}\build\installer\assets\page-unconfirm-en.bmp"
    File /oname=$PLUGINSDIR\page-unfinish-ru.bmp "${PROJECT_DIR}\build\installer\assets\page-unfinish-ru.bmp"
    File /oname=$PLUGINSDIR\page-unfinish-en.bmp "${PROJECT_DIR}\build\installer\assets\page-unfinish-en.bmp"
  ${EndIf}
!macroend