# Custom RelaxCode installer — fully branded wizard on top of the
# electron-builder NSIS machinery. Replaces stock assistedInstaller pages
# with our own nsDialogs UI (build/installer/ui.nsh) while reusing every
# update-critical piece from the stock templates:
#   - multiUser.nsh          install modes, per-user/per-machine, /D= parsing
#   - extractAppPackage.nsh  embedded app-64.7z with SetCompress off (blockmap!)
#   - registryAddInstallInfo + shortcut macros (registry contract of
#                              electron-updater)
#   - uninstaller.nsh        un.* section + flags handling
# The installer binary still gets latest.yml/.blockmap from electron-builder.
# An uninstaller is produced at install time via WriteUninstaller (with a
# custom script electron-builder does not run its two-pass uninstaller build).

# declared before the template includes: installUtil.nsh compiles its
# uninstallOldVersion FUNCTION at include time and it references $appExe;
# the link vars are used by setLinkVars/shortcut macros from the templates;
# the process-check vars are hoisted out of the vendored
# allowOnlyOneInstallerInstance.nsh so CHECK_APP_RUNNING can be inserted in
# both installer and uninstaller contexts
Var appExe
Var launchLink
Var newStartMenuLink
Var oldStartMenuLink
Var newDesktopLink
Var oldDesktopLink
Var oldShortcutName
Var oldMenuDirectory
Var CmdPath
Var PowerShellPath
Var IsPowerShellAvailable
# StartApp from common.nsh declares this var inside the macro, so we can
# insert it only once; our RelaxStartApp variant below is Var-free and used
# from both the finish page and the silent --force-run path
Var startAppArgs

!include "common.nsh"
# MUI2 is NOT used: all pages are custom nsDialogs and MUI2's own GUIINIT
# does not wire up without MUI pages (the wizard stayed a blank default-size
# window). Language tables are loaded directly in RelaxAddLangs below, the
# window is branded in our own .onGUIInit.
!include "multiUser.nsh"
!include "${PROJECT_DIR}\build\installer\vendor\allowOnlyOneInstallerInstance.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"
!include "StrContains.nsh"
!include "installer.nsh"
!include "installUtil.nsh"

# exe/dialog icons (MUI2 would normally apply MUI_ICON/MUI_UNICON for us)
!ifdef MUI_ICON
  Icon "${MUI_ICON}"
!endif
!ifdef MUI_UNICON
  UninstallIcon "${MUI_UNICON}"
!endif

# language tables without MUI2: the same languages electron-builder's
# generated addLangs would insert, via plain LoadLanguageFile
!macro RelaxAddLangs
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\English.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\German.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\French.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\SpanishInternational.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\SimpChinese.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\TradChinese.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Japanese.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Korean.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Italian.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Dutch.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Danish.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Swedish.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Norwegian.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Finnish.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Russian.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Portuguese.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\PortugueseBR.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Polish.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Ukrainian.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Czech.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Slovak.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Hungarian.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Arabic.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Turkish.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Thai.nlf"
  LoadLanguageFile "${NSISDIR}\Contrib\Language files\Vietnamese.nlf"
!macroend

# copied verbatim from templates/nsis/assistedInstaller.nsh — we do not
# include that file (it would add the stock pages), but the install mode
# init logic it carries is required by initMultiUser call sites
!macro initMultiUser
  !ifdef INSTALL_MODE_PER_ALL_USERS
    !insertmacro setInstallModePerAllUsers
  !else
    ${If} ${UAC_IsInnerInstance}
    ${AndIfNot} ${UAC_IsAdmin}
      # special return value for outer instance so it knows we did not have admin rights
      SetErrorLevel 0x666666
      Quit
    ${endIf}

    # checks registry for previous installation path (both for upgrading, reinstall, or uninstall)
    StrCpy $hasPerMachineInstallation "0"
    StrCpy $hasPerUserInstallation "0"

    # set installation mode to setting from a previous installation
    ReadRegStr $perMachineInstallationFolder HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $perMachineInstallationFolder != ""
      StrCpy $hasPerMachineInstallation "1"
    ${endif}

    ReadRegStr $perUserInstallationFolder HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $perUserInstallationFolder != ""
      StrCpy $hasPerUserInstallation "1"
    ${endif}

    ${GetParameters} $R0
    ${GetOptions} $R0 "/allusers" $R1
    ${IfNot} ${Errors}
      StrCpy $hasPerMachineInstallation "1"
      StrCpy $hasPerUserInstallation "0"
    ${EndIf}

    ${GetOptions} $R0 "/currentuser" $R1
    ${IfNot} ${Errors}
      StrCpy $hasPerMachineInstallation "0"
      StrCpy $hasPerUserInstallation "1"
    ${EndIf}

    ${if} $hasPerUserInstallation == "1"
    ${andif} $hasPerMachineInstallation == "0"
      !insertmacro setInstallModePerUser
    ${elseif} $hasPerUserInstallation == "0"
      ${andif} $hasPerMachineInstallation == "1"
      !insertmacro setInstallModePerAllUsers
    ${else}
      # if there is no installation, or there is both per-user and per-machine
      !ifdef INSTALL_MODE_PER_ALL_USERS
        !insertmacro setInstallModePerAllUsers
      !else
        !ifdef INSTALL_MODE_PER_ALL_USERS_DEFAULT
          !insertmacro setInstallModePerAllUsers
        !else
          !insertmacro setInstallModePerUser
        !endif
      !endif
    ${endif}
  !endif
!macroend

# Var-free variant of StartApp from common.nsh (same body, no Var declaration);
# defined before ui.nsh, which inserts it from relaxOnLaunch
!macro RelaxStartApp
  ${if} ${isUpdated}
    StrCpy $startAppArgs "--updated"
  ${else}
    StrCpy $startAppArgs ""
  ${endIf}
  ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$startAppArgs"
!macroend

!include "${PROJECT_DIR}\build\installer\theme.nsh"
!include "${PROJECT_DIR}\build\installer\lang.nsh"
!include "${PROJECT_DIR}\build\installer\ui.nsh"
# The un.* section for WriteUninstaller; must come after ui.nsh so the
# customUnInit/customUnInstall hooks are already defined. The stock templates
# switch Call targets via BUILD_UNINSTALLER (their two-pass uninstaller
# build), so we emulate the uninstaller pass for this include: getProcessInfo
# was already included in installer mode, so we define the un.-prefixed
# variant of its helper ourselves and let CHECK_APP_RUNNING inside
# un.onInit call it.
!define BUILD_UNINSTALLER
Function un._GetProcessInfo
  !insertmacro FUNC_GETPROCESSINFO
FunctionEnd
!include "uninstaller.nsh"
!undef BUILD_UNINSTALLER

RequestExecutionLevel user

BrandingText "RelaxCode"
XPStyle off
# our UI is laid out in raw pixels (CreateWindowExW + pixel-perfect BMPs);
# without this NSIS processes are DPI-virtualized and Windows scales the
# whole dialog, clipping the art to the top-left corner
ManifestDPIAware true

# ---------------------------------------------------------------- init ------

Function .onInit
  Call setInstallSectionSpaceRequired

  SetOutPath $INSTDIR
  ${LogSet} on

  !insertmacro check64BitAndSetRegView

  ${IfNot} ${UAC_IsInnerInstance}
    !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
  ${EndIf}

  !insertmacro initMultiUser

  StrCpy $relaxSuffix "-en"
  ${If} $LANGUAGE == 1049
    StrCpy $relaxSuffix "-ru"
  ${EndIf}

  InitPluginsDir
  ${IfNot} ${Silent}
    File /oname=$PLUGINSDIR\Manrope.ttf "${PROJECT_DIR}\build\installer\fonts\Manrope.ttf"
    System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\Manrope.ttf", i 0x10, p 0) i .r0' ; FR_PRIVATE
    File /oname=$PLUGINSDIR\page-welcome-ru.bmp "${PROJECT_DIR}\build\installer\assets\page-welcome-ru.bmp"
    File /oname=$PLUGINSDIR\page-welcome-en.bmp "${PROJECT_DIR}\build\installer\assets\page-welcome-en.bmp"
    File /oname=$PLUGINSDIR\page-license-ru.bmp "${PROJECT_DIR}\build\installer\assets\page-license-ru.bmp"
    File /oname=$PLUGINSDIR\page-license-en.bmp "${PROJECT_DIR}\build\installer\assets\page-license-en.bmp"
    File /oname=$PLUGINSDIR\page-dir-ru.bmp "${PROJECT_DIR}\build\installer\assets\page-dir-ru.bmp"
    File /oname=$PLUGINSDIR\page-dir-en.bmp "${PROJECT_DIR}\build\installer\assets\page-dir-en.bmp"
    File /oname=$PLUGINSDIR\page-finish-ru.bmp "${PROJECT_DIR}\build\installer\assets\page-finish-ru.bmp"
    File /oname=$PLUGINSDIR\page-finish-en.bmp "${PROJECT_DIR}\build\installer\assets\page-finish-en.bmp"
    File /oname=$PLUGINSDIR\page-unconfirm-ru.bmp "${PROJECT_DIR}\build\installer\assets\page-unconfirm-ru.bmp"
    File /oname=$PLUGINSDIR\page-unconfirm-en.bmp "${PROJECT_DIR}\build\installer\assets\page-unconfirm-en.bmp"
    File /oname=$PLUGINSDIR\page-unfinish-ru.bmp "${PROJECT_DIR}\build\installer\assets\page-unfinish-ru.bmp"
    File /oname=$PLUGINSDIR\page-unfinish-en.bmp "${PROJECT_DIR}\build\installer\assets\page-unfinish-en.bmp"
    File /oname=$PLUGINSDIR\license-ru.txt "${PROJECT_DIR}\build\installer\assets\license-ru.txt"
    File /oname=$PLUGINSDIR\license-en.txt "${PROJECT_DIR}\build\installer\assets\license-en.txt"
    File /oname=$PLUGINSDIR\cb-off.bmp "${PROJECT_DIR}\build\installer\assets\cb-off.bmp"
    File /oname=$PLUGINSDIR\cb-on.bmp "${PROJECT_DIR}\build\installer\assets\cb-on.bmp"
    File /oname=$PLUGINSDIR\btn-next-ru.bmp "${PROJECT_DIR}\build\installer\assets\btn-next-ru.bmp"
    File /oname=$PLUGINSDIR\btn-next-en.bmp "${PROJECT_DIR}\build\installer\assets\btn-next-en.bmp"
    File /oname=$PLUGINSDIR\btn-next-dis-ru.bmp "${PROJECT_DIR}\build\installer\assets\btn-next-dis-ru.bmp"
    File /oname=$PLUGINSDIR\btn-next-dis-en.bmp "${PROJECT_DIR}\build\installer\assets\btn-next-dis-en.bmp"
    File /oname=$PLUGINSDIR\btn-back-ru.bmp "${PROJECT_DIR}\build\installer\assets\btn-back-ru.bmp"
    File /oname=$PLUGINSDIR\btn-back-en.bmp "${PROJECT_DIR}\build\installer\assets\btn-back-en.bmp"
    File /oname=$PLUGINSDIR\btn-cancel-ru.bmp "${PROJECT_DIR}\build\installer\assets\btn-cancel-ru.bmp"
    File /oname=$PLUGINSDIR\btn-cancel-en.bmp "${PROJECT_DIR}\build\installer\assets\btn-cancel-en.bmp"
    File /oname=$PLUGINSDIR\btn-install-ru.bmp "${PROJECT_DIR}\build\installer\assets\btn-install-ru.bmp"
    File /oname=$PLUGINSDIR\btn-install-en.bmp "${PROJECT_DIR}\build\installer\assets\btn-install-en.bmp"
    File /oname=$PLUGINSDIR\btn-finish-ru.bmp "${PROJECT_DIR}\build\installer\assets\btn-finish-ru.bmp"
    File /oname=$PLUGINSDIR\btn-finish-en.bmp "${PROJECT_DIR}\build\installer\assets\btn-finish-en.bmp"
    File /oname=$PLUGINSDIR\btn-launch-ru.bmp "${PROJECT_DIR}\build\installer\assets\btn-launch-ru.bmp"
    File /oname=$PLUGINSDIR\btn-launch-en.bmp "${PROJECT_DIR}\build\installer\assets\btn-launch-en.bmp"
    File /oname=$PLUGINSDIR\btn-browse-ru.bmp "${PROJECT_DIR}\build\installer\assets\btn-browse-ru.bmp"
    File /oname=$PLUGINSDIR\btn-browse-en.bmp "${PROJECT_DIR}\build\installer\assets\btn-browse-en.bmp"
    File /oname=$PLUGINSDIR\card-user-on-ru.bmp "${PROJECT_DIR}\build\installer\assets\card-user-on-ru.bmp"
    File /oname=$PLUGINSDIR\card-user-on-en.bmp "${PROJECT_DIR}\build\installer\assets\card-user-on-en.bmp"
    File /oname=$PLUGINSDIR\card-user-off-ru.bmp "${PROJECT_DIR}\build\installer\assets\card-user-off-ru.bmp"
    File /oname=$PLUGINSDIR\card-user-off-en.bmp "${PROJECT_DIR}\build\installer\assets\card-user-off-en.bmp"
    File /oname=$PLUGINSDIR\card-all-on-ru.bmp "${PROJECT_DIR}\build\installer\assets\card-all-on-ru.bmp"
    File /oname=$PLUGINSDIR\card-all-on-en.bmp "${PROJECT_DIR}\build\installer\assets\card-all-on-en.bmp"
    File /oname=$PLUGINSDIR\card-all-off-ru.bmp "${PROJECT_DIR}\build\installer\assets\card-all-off-ru.bmp"
    File /oname=$PLUGINSDIR\card-all-off-en.bmp "${PROJECT_DIR}\build\installer\assets\card-all-off-en.bmp"
  ${EndIf}
FunctionEnd

# brands the outer wizard window: 960x640 client, dark, no stock chrome;
# the caption text comes from the per-page Caption directives (NSIS resets
# the window title on every page activation)
Function .onGUIInit
  !insertmacro RelaxBrandWindow
  !insertmacro RelaxCreateFonts
  !insertmacro RelaxBarSetup
FunctionEnd

Function un.onGUIInit
  !insertmacro RelaxBrandWindow
  !insertmacro RelaxCreateFonts
  !insertmacro RelaxBarSetup
FunctionEnd

# ---------------------------------------------------------------- pages -----

# PageEx (no Caption: NSIS concatenates it onto the default window title,
# which already reads "Установка RelaxCode" / "Setup RelaxCode" via the
# language file — good enough and always localized)
PageEx custom
  PageCallbacks showWelcome leaveWelcome
PageExEnd
PageEx custom
  PageCallbacks showLicense leaveLicense
PageExEnd
PageEx custom
  PageCallbacks showDir leaveDir
PageExEnd
PageEx instfiles
  PageCallbacks relaxInstFilesPre
PageExEnd
PageEx custom
  PageCallbacks showFinish leaveFinish
PageExEnd

PageEx un.custom
  PageCallbacks un.showUnConfirm un.leaveUnConfirm
PageExEnd
PageEx un.instfiles
  PageCallbacks un.relaxUnInstPre
PageExEnd
PageEx un.custom
  PageCallbacks un.showUnFinish un.leaveUnFinish
PageExEnd

!insertmacro RelaxAddLangs

# ------------------------------------------------------------- install ------

Section "install" INSTALL_SECTION_ID
  # silent upgrade of a per-machine installation elevates first (stock logic)
  !ifndef INSTALL_MODE_PER_ALL_USERS
    ${if} $hasPerMachineInstallation == "1"
    ${andIf} ${Silent}
      ${ifNot} ${UAC_IsAdmin}
        ShowWindow $HWNDPARENT ${SW_HIDE}
        !insertmacro UAC_RunElevated
        ${Switch} $0
          ${Case} 0
            ${Break}
          ${Case} 1223 ;user aborted
            ${Break}
          ${Default}
            MessageBox mb_IconStop|mb_TopMost|mb_SetForeground "Unable to elevate, error $0"
            ${Break}
        ${EndSwitch}
        Quit
      ${else}
        !insertmacro setInstallModePerAllUsers
      ${endIf}
    ${endIf}
  !endif

  ${IfNot} ${Silent}
    SetDetailsPrint none
  ${endif}

  StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  # must be called before uninstallOldVersion
  !insertmacro setLinkVars

  ${ifNot} ${UAC_IsInnerInstance}
    !insertmacro CHECK_APP_RUNNING
  ${endif}

  Var /GLOBAL keepShortcuts
  StrCpy $keepShortcuts "false"
  !insertmacro setIsTryToKeepShortcuts
  ${if} $isTryToKeepShortcuts == "true"
    ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts

    ${if} $R1 == "true"
    ${andIf} ${FileExists} "$appExe"
      StrCpy $keepShortcuts "true"
    ${endIf}
  ${endif}

  !insertmacro uninstallOldVersion SHELL_CONTEXT
  !insertmacro handleUninstallResult SHELL_CONTEXT

  ${if} $installMode == "all"
    !insertmacro uninstallOldVersion HKEY_CURRENT_USER
    !insertmacro handleUninstallResult HKEY_CURRENT_USER
  ${endIf}

  SetOutPath $INSTDIR

  !insertmacro extractEmbeddedAppPackage

  # electron always uses per user app data
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}
  !insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}

  # custom script: electron-builder does not run its two-pass uninstaller
  # build, so the uninstaller is written right here from the un.* section
  WriteUninstaller "$INSTDIR\${UNINSTALL_FILENAME}"

  !insertmacro registryAddInstallInfo
  !insertmacro addStartMenuLink $keepShortcuts
  !insertmacro addDesktopLink $keepShortcuts

  ${if} ${FileExists} "$newStartMenuLink"
    StrCpy $launchLink "$newStartMenuLink"
  ${else}
    StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${endIf}

  !ifmacrodef registerFileAssociations
    !insertmacro registerFileAssociations
  !endif

  # for assisted installer run only if silent, because the wizard has the
  # dedicated "Launch RelaxCode" button for interactive installs
  ${if} ${isForceRun}
  ${andIf} ${Silent}
    HideWindow
    !insertmacro RelaxStartApp
  ${endIf}
SectionEnd

Function setInstallSectionSpaceRequired
  !insertmacro setSpaceRequired ${INSTALL_SECTION_ID}
FunctionEnd

