#ifndef AppVersion
  #define AppVersion "1.5.0"
#endif
#ifndef AppGuid
  #define AppGuid "8A0E0E87-2DC8-4E66-857F-E5881EAA379E"
#endif
#ifndef AppTitle
  #define AppTitle "RG2 Desktop"
#endif
#ifndef InstallRoot
  #define InstallRoot "{localappdata}\Programs\RG2 Desktop"
#endif
#ifndef ProfileRoot
  #define ProfileRoot "{localappdata}\RG2 Desktop"
#endif
#ifndef AppRegKey
  #define AppRegKey "Software\RG2 Desktop"
#endif
#ifndef AppMutexName
  #define AppMutexName "Local\RG2.Desktop.8A0E0E87-2DC8-4E66-857F-E5881EAA379E"
#endif
#ifndef OutputBase
  #define OutputBase "RG2-Desktop-" + AppVersion + "-Setup-x64"
#endif
#ifndef PayloadDir
  #error PayloadDir must point to a self-contained Windows x64 publish directory
#endif
#ifndef WebViewInstaller
  #error WebViewInstaller must point to Microsoft's signed Evergreen standalone x64 installer
#endif
#ifndef ReleaseDir
  #define ReleaseDir "..\..\..\outputs"
#endif

[Setup]
AppId={{{#AppGuid}}
AppName={#AppTitle}
AppVersion={#AppVersion}
AppVerName={#AppTitle} {#AppVersion}
AppPublisher=RG2 Desktop
AppPublisherURL=https://github.com/pro-007-m/rg2-desktop
AppSupportURL=https://github.com/pro-007-m/rg2-desktop/issues
AppUpdatesURL=https://github.com/pro-007-m/rg2-desktop/releases/latest
DefaultDirName={#InstallRoot}
DefaultGroupName={#AppTitle}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=no
UsePreviousAppDir=no
UsePreviousTasks=yes
UninstallDisplayIcon={app}\RG2.Desktop.exe
UninstallDisplayName={#AppTitle}
UninstallFilesDir={app}\Uninstall
AppMutex={#AppMutexName}
SetupMutex=RG2.Setup.{#AppGuid}
CloseApplications=yes
CloseApplicationsFilter=RG2.Desktop.exe,RG2.Desktop.dll
RestartApplications=no
WizardStyle=modern dynamic
WizardSizePercent=115
SetupIconFile=..\app.ico
Compression=lzma2
SolidCompression=yes
OutputDir={#ReleaseDir}
OutputBaseFilename={#OutputBase}
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppTitle}
VersionInfoDescription=Установка и обновление RG2 Desktop
Uninstallable=yes
ChangesAssociations=no

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Ярлыки:"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Excludes: "*.pdb"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#WebViewInstaller}"; DestDir: "{tmp}"; Flags: dontcopy nocompression

[INI]
Filename: "{app}\RG2.install.ini"; Section: "Installation"; Key: "AppId"; String: "{#AppGuid}"
Filename: "{app}\RG2.install.ini"; Section: "Installation"; Key: "Version"; String: "{#AppVersion}"

[Registry]
Root: HKCU; Subkey: "{#AppRegKey}"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; Flags: uninsdeletekey

[Icons]
Name: "{userprograms}\{#AppTitle}"; Filename: "{app}\RG2.Desktop.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\{#AppTitle}"; Filename: "{app}\RG2.Desktop.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\RG2.Desktop.exe"; Description: "Запустить {#AppTitle}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\RG2.install.ini"

[Code]
const
  ReparsePoint = $400;
  InvalidAttributes = $FFFFFFFF;
var
  PurgeProfile: Boolean;

function GetFileAttributesW(lpFileName: String): Cardinal;
  external 'GetFileAttributesW@kernel32.dll stdcall';

function ExpectedInstallRoot: String;
begin
  Result := RemoveBackslashUnlessRoot(ExpandFileName(ExpandConstant('{#InstallRoot}')));
end;

function ExpectedProfileRoot: String;
begin
  Result := RemoveBackslashUnlessRoot(ExpandFileName(ExpandConstant('{#ProfileRoot}')));
end;

function HasLinkedAncestor(Path: String): Boolean;
var Attributes, ErrorCode: Cardinal; Parent: String;
begin
  Result := False;
  Path := RemoveBackslashUnlessRoot(ExpandFileName(Path));
  while Length(Path) > 3 do begin
    Attributes := GetFileAttributesW(Path);
    if Attributes = InvalidAttributes then begin
      ErrorCode := DLLGetLastError;
      if (ErrorCode <> 2) and (ErrorCode <> 3) then begin Result := True; Exit; end;
    end;
    if (Attributes <> InvalidAttributes) and ((Attributes and ReparsePoint) <> 0) then begin Result := True; Exit; end;
    Parent := ExtractFileDir(Path);
    if CompareText(Parent, Path) = 0 then Exit;
    Path := Parent;
  end;
end;

function HasLinkedDirectory(const Path: String): Boolean;
var Entry: TFindRec; Child: String; ErrorCode: Cardinal;
begin
  Result := False;
  if not DirExists(Path) then Exit;
  if FindFirst(AddBackslash(Path) + '*', Entry) then begin
    try
      repeat
        if (Entry.Name <> '.') and (Entry.Name <> '..') then begin
          Child := AddBackslash(Path) + Entry.Name;
          if (Entry.Attributes and ReparsePoint) <> 0 then begin Result := True; Exit; end;
          if (Entry.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then
            if HasLinkedDirectory(Child) then begin Result := True; Exit; end;
        end;
      until not FindNext(Entry);
    finally FindClose(Entry); end;
  end else begin
    ErrorCode := DLLGetLastError;
    if (ErrorCode <> 2) and (ErrorCode <> 3) and (ErrorCode <> 18) then Result := True;
  end;
end;

function SafeInstallRoot(const Path: String): Boolean;
begin
  Result := False;
  if CompareText(RemoveBackslashUnlessRoot(ExpandFileName(Path)), ExpectedInstallRoot) <> 0 then Exit;
  if HasLinkedAncestor(Path) then Exit;
  if HasLinkedDirectory(Path) then Exit;
  Result := True;
end;

function VersionValue(Value: String): Int64;
var Count, J, Separator, Number: Integer; Part: String;
begin
  Result := 0; Count := 0;
  repeat
    Separator := Pos('.', Value);
    if Separator = 0 then begin Part := Value; Value := ''; end
    else begin Part := Copy(Value, 1, Separator-1); Delete(Value, 1, Separator); end;
    if (Part = '') or ((Separator <> 0) and (Value = '')) or (Count >= 4) then begin Result := -1; Exit; end;
    for J := 1 to Length(Part) do
      if (Part[J] < '0') or (Part[J] > '9') then begin Result := -1; Exit; end;
    Number := StrToIntDef(Part, -1);
    if (Number < 0) or (Number > 9999) then begin Result := -1; Exit; end;
    Result := Result * 10000 + Number;
    Count := Count + 1;
  until Separator = 0;
  if Count < 3 then begin Result := -1; Exit; end;
  while Count < 4 do begin Result := Result * 10000; Count := Count + 1; end;
end;

function NewerVersionInstalled: Boolean;
var InstalledVersion, Key: String; IncomingVersion, BinaryVersion: Int64;
begin
  Result := False;
  Key := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\' + '{' + '{#AppGuid}' + '}_is1';
  if RegQueryStringValue(HKCU, Key, 'DisplayVersion', InstalledVersion) and
    (VersionValue(InstalledVersion) > VersionValue('{#AppVersion}')) then begin Result := True; Exit;
  end;
  if StrToVersion('{#AppVersion}', IncomingVersion) and
    GetPackedVersion(AddBackslash(ExpectedInstallRoot) + 'RG2.Desktop.exe', BinaryVersion) then
    if ComparePackedVersion(BinaryVersion, IncomingVersion) > 0 then Result := True;
end;

function InitializeSetup: Boolean;
begin
  Result := False;
  if not SafeInstallRoot(ExpectedInstallRoot) then begin
    SuppressibleMsgBox('Папка установки содержит ссылку на другую папку. Установка остановлена, чтобы сохранить остальные файлы.', mbError, MB_OK, IDOK); Exit;
  end;
  if NewerVersionInstalled then begin
    SuppressibleMsgBox('Уже установлена более новая версия RG2. Этот установщик не будет её заменять.', mbInformation, MB_OK, IDOK); Exit;
  end;
  Result := True;
end;

function WebViewAvailable: Boolean;
var Version: String;
begin
  Result := (RegQueryStringValue(HKCU32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'))
    or (RegQueryStringValue(HKLM32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  if not SafeInstallRoot(WizardDirValue) then begin Result := 'Недопустимая папка установки.'; Exit; end;
  if NewerVersionInstalled then begin Result := 'Уже установлена более новая версия RG2.'; Exit; end;
#if AppGuid == "8A0E0E87-2DC8-4E66-857F-E5881EAA379E"
  if FindWindowByWindowName('RG2 · Desktop') <> 0 then begin Result := 'Закрой запущенную RG2, затем нажми «Повторить». Настройки и результаты сохранятся.'; Exit; end;
#endif
  if not WebViewAvailable then begin
    WizardForm.StatusLabel.Caption := 'Устанавливается Microsoft WebView2…';
    ExtractTemporaryFile('MicrosoftEdgeWebView2RuntimeInstallerX64.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) then begin
      Result := 'Не удалось запустить установку Microsoft WebView2. Повтори запуск установщика.'; Exit;
    end;
    if not WebViewAvailable then Result := 'Microsoft WebView2 не установлен (код ' + IntToStr(Code) + '). Установка RG2 остановлена; повтори запуск установщика.';
  end;
end;

function ChooseUninstallOptions: Boolean;
var Form: TSetupForm; Info: TNewStaticText; Check: TNewCheckBox; RemoveButton, CancelButton: TNewButton;
begin
  Form := CreateCustomForm(480, 215, True, True);
  try
    Form.Caption := 'Удаление {#AppTitle}';
    Form.Position := poScreenCenter;
    Info := TNewStaticText.Create(Form); Info.Parent := Form;
    Info.Left := ScaleX(20); Info.Top := ScaleY(18); Info.Width := ScaleX(440); Info.Height := ScaleY(65);
    Info.WordWrap := True; Info.Caption := 'Программа, библиотека и ярлыки будут удалены. Выбери, нужно ли также удалить настройки, избранное, раскраски куба, результаты и загруженные обновления.';
    Check := TNewCheckBox.Create(Form); Check.Parent := Form;
    Check.Left := ScaleX(20); Check.Top := ScaleY(92); Check.Width := ScaleX(440); Check.Height := ScaleY(35);
    Check.Caption := 'Удалить все личные данные RG2'; Check.Checked := False;
    RemoveButton := TNewButton.Create(Form); RemoveButton.Parent := Form;
    RemoveButton.Left := ScaleX(190); RemoveButton.Top := ScaleY(163); RemoveButton.Width := ScaleX(170); RemoveButton.Caption := 'Удалить программу'; RemoveButton.ModalResult := mrOk; RemoveButton.Default := True;
    CancelButton := TNewButton.Create(Form); CancelButton.Parent := Form;
    CancelButton.Left := ScaleX(370); CancelButton.Top := ScaleY(163); CancelButton.Width := ScaleX(90); CancelButton.Caption := 'Отмена'; CancelButton.ModalResult := mrCancel; CancelButton.Cancel := True;
    Result := Form.ShowModal = mrOk;
    if Result then PurgeProfile := Check.Checked;
  finally Form.Free; end;
end;

function InitializeUninstall: Boolean;
begin
  Result := False;
  if not SafeInstallRoot(ExpandConstant('{app}')) then begin
    SuppressibleMsgBox('Папка RG2 содержит ссылку на другую папку. Удаление остановлено, чтобы сохранить остальные файлы.', mbError, MB_OK, IDOK); Exit;
  end;
  PurgeProfile := ExpandConstant('{param:PURGEDATA|0}') = '1';
#if AppGuid == "8A0E0E87-2DC8-4E66-857F-E5881EAA379E"
  if FindWindowByWindowName('RG2 · Desktop') <> 0 then begin
    SuppressibleMsgBox('Сначала закрой запущенную RG2, затем повтори удаление.', mbInformation, MB_OK, IDOK); Exit;
  end;
#endif
  if not UninstallSilent then begin Result := ChooseUninstallOptions; Exit; end;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Profile: String; Attempt: Integer; Removed: Boolean;
begin
  if (CurUninstallStep <> usPostUninstall) or not PurgeProfile then Exit;
  Profile := ExpectedProfileRoot;
  if HasLinkedAncestor(Profile) then begin
    Log('Data cleanup refused: linked profile root or ancestor.');
    SuppressibleMsgBox('Личные данные находятся в папке-ссылке. Они сохранены, чтобы не затронуть другие файлы.', mbInformation, MB_OK, IDOK); Exit;
  end;
  Removed := not DirExists(Profile);
  for Attempt := 1 to 20 do begin
    if Removed then Break;
    Removed := DelTree(Profile, True, True, True);
    if not Removed then Sleep(250);
  end;
  if not Removed then SuppressibleMsgBox('Программа удалена, но часть личных данных занята другим процессом. Закрой окна RG2 и удали папку ' + Profile + '.', mbInformation, MB_OK, IDOK);
end;
