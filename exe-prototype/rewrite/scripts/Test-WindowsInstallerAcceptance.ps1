param(
    [Parameter(Mandatory = $true)]
    [string]$CandidateSetup,
    [string]$ExpectedVersion = "1.1.0",
    [string]$UpgradeFixtureVersion = "1.0.9",
    [string]$UpgradeFixtureSetup = "",
    [string]$OutputDir = "",
    [switch]$ConfirmCurrentUserMutation,
    [switch]$SkipUpgradeFixtureBuild,
    [switch]$KeepPrivateArtifacts
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RewriteRoot = Resolve-Path (Join-Path $ScriptDir "..")
$PrototypeRoot = Resolve-Path (Join-Path $RewriteRoot "..")
$CacheRoot = Join-Path $PrototypeRoot ".cache\codelens-next\release-acceptance"
$SharedOutputRoot = if ($OutputDir.Trim()) {
    [System.IO.Path]::GetFullPath($OutputDir)
} else {
    Join-Path $PrototypeRoot "outputs\codelens-next\audits\v1.1.0-stable"
}
$runId = "{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), ([guid]::NewGuid().ToString("N").Substring(0, 8))
$PrivateRoot = Join-Path $CacheRoot "private\$runId"
$PrivateBackup = Join-Path $PrivateRoot "backup"
$PrivateFixture = Join-Path $PrivateRoot "fixture"
$PrivateTarget = Join-Path $PrivateRoot "cargo-target-upgrade"
$ProductName = "CodeLens Pro Next"
$BundleIdentifier = "com.szywah.codelensnext"
$MainBinaryName = "codelens_pro_next_desktop.exe"
$InstallRoot = Join-Path $env:LOCALAPPDATA $ProductName
$AppHome = Join-Path $env:LOCALAPPDATA $BundleIdentifier
$UninstallRegistry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$ProductName"
$ManufacturerRegistry = "HKCU:\Software\SZYWAH\$ProductName"
$StartMenuRoot = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$ProductName"
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "$ProductName.lnk"
$CandidateSetup = [System.IO.Path]::GetFullPath($CandidateSetup)

if (-not $ConfirmCurrentUserMutation) {
    throw "Installer acceptance changes the current user's install registration. Re-run with -ConfirmCurrentUserMutation."
}
if (-not (Test-Path -LiteralPath $CandidateSetup -PathType Leaf)) {
    throw "Candidate setup was not found: $CandidateSetup"
}
if ($ExpectedVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "ExpectedVersion must use semantic version form, for example 1.1.0."
}
if ($UpgradeFixtureVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "UpgradeFixtureVersion must use semantic version form, for example 1.0.9."
}

function Write-Utf8File {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Content)
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding -ArgumentList $false))
}

function Invoke-CheckedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [int]$TimeoutSeconds = 180
    )
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {}
        throw "Process timed out after $TimeoutSeconds seconds: $([System.IO.Path]::GetFileName($FilePath))"
    }
    if ($process.ExitCode -ne 0) {
        throw "Process failed with exit code $($process.ExitCode): $([System.IO.Path]::GetFileName($FilePath))"
    }
}

function Get-InstallState {
    if (-not (Test-Path -LiteralPath $UninstallRegistry)) { return $null }
    $item = Get-ItemProperty -LiteralPath $UninstallRegistry
    $location = ([string]$item.InstallLocation).Trim('"')
    [pscustomobject]@{
        Version = [string]$item.DisplayVersion
        InstallLocation = $location
        Executable = Join-Path $location $MainBinaryName
        Uninstaller = Join-Path $location "uninstall.exe"
    }
}

function Assert-InstallVersion {
    param([Parameter(Mandatory = $true)][string]$Version)
    $state = Get-InstallState
    if (-not $state) { throw "The installer did not create the expected HKCU uninstall registration." }
    if ($state.Version -ne $Version) { throw "Installed version is $($state.Version), expected $Version." }
    if (-not (Test-Path -LiteralPath $state.Executable)) { throw "Installed executable is missing." }
    if (-not (Test-Path -LiteralPath $state.Uninstaller)) { throw "Installed uninstaller is missing." }
    return $state
}

function Invoke-FixtureState {
    param([Parameter(Mandatory = $true)][ValidateSet("seed", "verify")][string]$Mode, [Parameter(Mandatory = $true)][string]$Home)
    $oldHome = $env:CODELENS_RELEASE_FIXTURE_HOME
    $oldMode = $env:CODELENS_RELEASE_FIXTURE_MODE
    $oldTarget = $env:CARGO_TARGET_DIR
    try {
        $env:CODELENS_RELEASE_FIXTURE_HOME = $Home
        $env:CODELENS_RELEASE_FIXTURE_MODE = $Mode
        $env:CARGO_TARGET_DIR = Join-Path $PrototypeRoot ".cache\cargo-target-next"
        & cargo test --manifest-path (Join-Path $RewriteRoot "core\Cargo.toml") --locked 'tests::release_installer_acceptance_fixture' -- --ignored --exact
        if ($LASTEXITCODE -ne 0) { throw "Release fixture $Mode failed." }
    } finally {
        $env:CODELENS_RELEASE_FIXTURE_HOME = $oldHome
        $env:CODELENS_RELEASE_FIXTURE_MODE = $oldMode
        $env:CARGO_TARGET_DIR = $oldTarget
    }
}

function Start-AndCloseInstalledApp {
    param([Parameter(Mandatory = $true)][string]$Executable)
    $process = Start-Process -FilePath $Executable -PassThru
    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 250
        $process.Refresh()
    } while (-not $process.HasExited -and $process.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline)
    if ($process.HasExited) { throw "Installed application exited before exposing its main window." }
    if ($process.MainWindowHandle -eq 0) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "Installed application did not expose a main window within 20 seconds."
    }
    if (-not ([InstallerAcceptanceWindow]::MoveWindow($process.MainWindowHandle, 80, 80, 1100, 720, $true))) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "Installed application window could not be resized."
    }
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) { throw "Installed application exited during the resize check." }
    if (-not $process.CloseMainWindow()) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "Installed application did not accept a normal window close request."
    }
    if (-not $process.WaitForExit(10000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "Installed application did not close within 10 seconds."
    }
}

function Build-UpgradeFixture {
    if ($UpgradeFixtureSetup.Trim()) {
        $resolved = [System.IO.Path]::GetFullPath($UpgradeFixtureSetup)
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Upgrade fixture setup was not found: $resolved" }
        return $resolved
    }
    if ($SkipUpgradeFixtureBuild) {
        throw "-SkipUpgradeFixtureBuild requires -UpgradeFixtureSetup."
    }

    New-Item -ItemType Directory -Force -Path $PrivateFixture, $PrivateTarget | Out-Null
    $overlayPath = Join-Path $PrivateFixture "tauri-upgrade-fixture.json"
    Write-Utf8File -Path $overlayPath -Content (([ordered]@{ version = $UpgradeFixtureVersion } | ConvertTo-Json -Depth 4) + "`n")
    $oldTarget = $env:CARGO_TARGET_DIR
    try {
        $env:CARGO_TARGET_DIR = $PrivateTarget
        Push-Location (Join-Path $RewriteRoot "desktop")
        try {
            & npm run tauri:build -- --config $overlayPath
            if ($LASTEXITCODE -ne 0) { throw "Failed to build the installer upgrade fixture." }
        } finally {
            Pop-Location
        }
    } finally {
        $env:CARGO_TARGET_DIR = $oldTarget
    }
    $setup = Get-ChildItem -LiteralPath (Join-Path $PrivateTarget "release\bundle\nsis") -Filter "*-setup.exe" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $setup) { throw "The installer upgrade fixture was not produced." }
    return $setup.FullName
}

function Backup-OptionalPath {
    param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Name)
    if (-not (Test-Path -LiteralPath $Source)) { return $null }
    $target = Join-Path $PrivateBackup $Name
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Move-Item -LiteralPath $Source -Destination $target
    return $target
}

function Restore-OptionalPath {
    param([string]$Backup, [Parameter(Mandatory = $true)][string]$Destination)
    if (-not $Backup -or -not (Test-Path -LiteralPath $Backup)) { return }
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Move-Item -LiteralPath $Backup -Destination $Destination
}

function Add-ScenarioResult {
    param([string]$Name, [bool]$Passed, [string]$Detail)
    $script:ScenarioResults.Add([pscustomobject]@{ name = $Name; passed = $Passed; detail = $Detail }) | Out-Null
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Current-user installer acceptance must run from a non-elevated PowerShell session."
}
if (Get-Process -Name "codelens_pro_next_desktop" -ErrorAction SilentlyContinue) {
    throw "CodeLens Pro Next is currently running. Close it before installer acceptance."
}
$systemDrive = Get-PSDrive -Name ([System.IO.Path]::GetPathRoot($env:LOCALAPPDATA).TrimEnd('\').TrimEnd(':'))
if (-not $systemDrive -or $systemDrive.Free -lt 2GB) {
    throw "Installer acceptance requires at least 2 GB free on the current user's local application-data drive."
}
if (Get-InstallState -or (Test-Path -LiteralPath $InstallRoot)) {
    throw "An installed CodeLens Pro Next instance already exists. The acceptance harness refuses to overwrite it."
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class InstallerAcceptanceWindow {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int width, int height, bool repaint);
}
"@

New-Item -ItemType Directory -Force -Path $PrivateBackup, $SharedOutputRoot | Out-Null
$candidateHash = (Get-FileHash -LiteralPath $CandidateSetup -Algorithm SHA256).Hash.ToLowerInvariant()
$candidateSignature = Get-AuthenticodeSignature -LiteralPath $CandidateSetup
$ScenarioResults = New-Object System.Collections.Generic.List[object]
$RestorationErrors = New-Object System.Collections.Generic.List[string]
$passed = $false
$failure = $null
$appHomeBackup = $null
$startMenuBackup = $null
$desktopBackup = $null
$manufacturerRegBackup = Join-Path $PrivateBackup "manufacturer.reg"
$hadManufacturerRegistry = Test-Path -LiteralPath $ManufacturerRegistry

try {
    $upgradeSetup = Build-UpgradeFixture
    Add-ScenarioResult "upgrade-fixture" $true "Built isolated $UpgradeFixtureVersion setup outside release outputs."

    $appHomeBackup = Backup-OptionalPath -Source $AppHome -Name "app-home"
    $startMenuBackup = Backup-OptionalPath -Source $StartMenuRoot -Name "start-menu"
    $desktopBackup = Backup-OptionalPath -Source $DesktopShortcut -Name "desktop-shortcut.lnk"
    if ($hadManufacturerRegistry) {
        & reg.exe export "HKCU\Software\SZYWAH\$ProductName" $manufacturerRegBackup /y | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Failed to back up the installer manufacturer registry key." }
        Remove-Item -LiteralPath $ManufacturerRegistry -Recurse -Force
    }
    Add-ScenarioResult "current-user-backup" $true "Existing application data and shortcuts were moved to a private cache backup."

    Invoke-CheckedProcess -FilePath $upgradeSetup -Arguments @("/S")
    $fixtureInstall = Assert-InstallVersion $UpgradeFixtureVersion
    Add-ScenarioResult "fresh-current-user-install" $true "Installed $UpgradeFixtureVersion without elevation."
    if (-not (Test-Path -LiteralPath $StartMenuRoot) -or -not (Test-Path -LiteralPath $DesktopShortcut)) {
        throw "Silent install did not create the expected Start menu and desktop shortcuts."
    }
    Add-ScenarioResult "shortcut-defaults" $true "Silent install created the Start menu entry and default desktop shortcut."

    Invoke-FixtureState -Mode seed -Home $AppHome
    Start-AndCloseInstalledApp -Executable $fixtureInstall.Executable
    Add-ScenarioResult "launch-close" $true "Installed application opened a main window and accepted a normal close request."

    Invoke-CheckedProcess -FilePath $CandidateSetup -Arguments @("/S")
    $candidateInstall = Assert-InstallVersion $ExpectedVersion
    $installedSignature = Get-AuthenticodeSignature -LiteralPath $candidateInstall.Executable
    if ($candidateSignature.Status -eq [System.Management.Automation.SignatureStatus]::Valid) {
        if ($installedSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
            throw "The signed setup installed an executable without a valid signature."
        }
        if ($installedSignature.SignerCertificate.Thumbprint -ne $candidateSignature.SignerCertificate.Thumbprint) {
            throw "The setup and installed executable use different signing certificates."
        }
        if (-not $installedSignature.TimeStamperCertificate) {
            throw "The installed stable executable does not contain a timestamp."
        }
    } elseif ($installedSignature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
        throw "The unsigned candidate installed an executable with an unexpected signature state: $($installedSignature.Status)."
    }
    Add-ScenarioResult "installed-signature" $true "The installed executable signature matches the candidate channel contract."
    Invoke-FixtureState -Mode verify -Home $AppHome
    Add-ScenarioResult "upgrade-data-preservation" $true "Upgraded $UpgradeFixtureVersion to $ExpectedVersion and retained workspace, report, chat, model, and key-configured state."

    $candidateBinaryHash = (Get-FileHash -LiteralPath $candidateInstall.Executable -Algorithm SHA256).Hash
    Invoke-CheckedProcess -FilePath $upgradeSetup -Arguments @("/S")
    $afterDowngrade = Assert-InstallVersion $ExpectedVersion
    $afterDowngradeHash = (Get-FileHash -LiteralPath $afterDowngrade.Executable -Algorithm SHA256).Hash
    if ($candidateBinaryHash -ne $afterDowngradeHash) { throw "The downgrade attempt replaced the installed executable." }
    Add-ScenarioResult "downgrade-blocked" $true "The lower-version installer did not replace $ExpectedVersion."

    Invoke-CheckedProcess -FilePath $candidateInstall.Uninstaller -Arguments @("/S")
    if (Get-InstallState -or (Test-Path -LiteralPath $InstallRoot)) { throw "Uninstall left the application registration or install directory behind." }
    Invoke-FixtureState -Mode verify -Home $AppHome
    Add-ScenarioResult "uninstall-preserves-data" $true "Uninstall removed the app and retained application data."

    Invoke-CheckedProcess -FilePath $CandidateSetup -Arguments @("/S")
    $reinstalled = Assert-InstallVersion $ExpectedVersion
    Start-AndCloseInstalledApp -Executable $reinstalled.Executable
    Invoke-FixtureState -Mode verify -Home $AppHome
    Add-ScenarioResult "reinstall-restores-data" $true "Reinstall reopened the retained application data."
    Invoke-CheckedProcess -FilePath $reinstalled.Uninstaller -Arguments @("/S")

    Remove-Item -LiteralPath $AppHome -Recurse -Force
    $legacyRoot = Join-Path $PrivateFixture "legacy-portable"
    Invoke-FixtureState -Mode seed -Home $legacyRoot
    $legacySetup = Join-Path $legacyRoot ([System.IO.Path]::GetFileName($CandidateSetup))
    Copy-Item -LiteralPath $CandidateSetup -Destination $legacySetup
    Invoke-CheckedProcess -FilePath $legacySetup -Arguments @("/S")
    $migrationInstall = Assert-InstallVersion $ExpectedVersion
    Start-AndCloseInstalledApp -Executable $migrationInstall.Executable
    Invoke-FixtureState -Mode verify -Home $AppHome
    Invoke-FixtureState -Mode verify -Home $legacyRoot
    if (-not (Test-Path -LiteralPath (Join-Path $AppHome "migration-v1.json"))) { throw "Migration marker was not created." }
    Add-ScenarioResult "legacy-portable-migration" $true "Portable data migrated while the source remained intact."
    Invoke-CheckedProcess -FilePath $migrationInstall.Uninstaller -Arguments @("/S")
    Invoke-FixtureState -Mode verify -Home $AppHome

    Remove-Item -LiteralPath (Join-Path $AppHome "migration-v1.json") -Force
    $nonemptySource = Join-Path $PrivateFixture "legacy-nonempty-guard"
    Invoke-FixtureState -Mode seed -Home $nonemptySource
    $targetDatabase = Join-Path $AppHome "storage\codelens-next.sqlite"
    $targetHashBefore = (Get-FileHash -LiteralPath $targetDatabase -Algorithm SHA256).Hash
    Write-Utf8File -Path (Join-Path $AppHome "legacy-candidate.txt") -Content $nonemptySource
    Invoke-CheckedProcess -FilePath $CandidateSetup -Arguments @("/S")
    $nonemptyInstall = Assert-InstallVersion $ExpectedVersion
    Start-AndCloseInstalledApp -Executable $nonemptyInstall.Executable
    Invoke-FixtureState -Mode verify -Home $AppHome
    Invoke-FixtureState -Mode verify -Home $nonemptySource
    $targetHashAfter = (Get-FileHash -LiteralPath $targetDatabase -Algorithm SHA256).Hash
    if ($targetHashBefore -ne $targetHashAfter) { throw "A non-empty destination database was replaced during migration discovery." }
    Add-ScenarioResult "nonempty-migration-guard" $true "A non-empty destination was preserved and the legacy source remained intact."
    Invoke-CheckedProcess -FilePath $nonemptyInstall.Uninstaller -Arguments @("/S")

    $passed = $true
} catch {
    $failure = $_.Exception.Message
    Add-ScenarioResult "acceptance-failure" $false $failure
} finally {
    try {
        Get-Process -Name "codelens_pro_next_desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        $installed = Get-InstallState
        if ($installed -and (Test-Path -LiteralPath $installed.Uninstaller)) {
            Invoke-CheckedProcess -FilePath $installed.Uninstaller -Arguments @("/S") -TimeoutSeconds 120
        }
    } catch { $RestorationErrors.Add("Failed to remove the test installation: $($_.Exception.Message)") | Out-Null }
    try {
        if (Test-Path -LiteralPath $AppHome) { Remove-Item -LiteralPath $AppHome -Recurse -Force }
        Restore-OptionalPath -Backup $appHomeBackup -Destination $AppHome
    } catch { $RestorationErrors.Add("Failed to restore application data: $($_.Exception.Message)") | Out-Null }
    try { Restore-OptionalPath -Backup $startMenuBackup -Destination $StartMenuRoot } catch { $RestorationErrors.Add("Failed to restore Start menu state: $($_.Exception.Message)") | Out-Null }
    try { Restore-OptionalPath -Backup $desktopBackup -Destination $DesktopShortcut } catch { $RestorationErrors.Add("Failed to restore desktop shortcut state: $($_.Exception.Message)") | Out-Null }
    try {
        if (Test-Path -LiteralPath $ManufacturerRegistry) { Remove-Item -LiteralPath $ManufacturerRegistry -Recurse -Force }
        if ($hadManufacturerRegistry -and (Test-Path -LiteralPath $manufacturerRegBackup)) {
            & reg.exe import $manufacturerRegBackup | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "reg import returned $LASTEXITCODE" }
        }
    } catch { $RestorationErrors.Add("Failed to restore installer registry state: $($_.Exception.Message)") | Out-Null }
}

if ($RestorationErrors.Count -gt 0) { $passed = $false }
$webViewVersion = $null
foreach ($path in @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8FCA-00C04F7CAB13}",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8FCA-00C04F7CAB13}"
)) {
    if (Test-Path -LiteralPath $path) {
        $webViewVersion = (Get-ItemProperty -LiteralPath $path).pv
        if ($webViewVersion) { break }
    }
}

$result = [ordered]@{
    schema = "codelens-next.installer-acceptance.v1"
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    passed = $passed
    version = $ExpectedVersion
    upgrade_fixture_version = $UpgradeFixtureVersion
    setup_file = [System.IO.Path]::GetFileName($CandidateSetup)
    setup_sha256 = $candidateHash
    signature_status = $candidateSignature.Status.ToString()
    webview2_version = $webViewVersion
    elevated = $false
    current_user_state_restored = $RestorationErrors.Count -eq 0
    manual_checks_remaining = @("interactive desktop-shortcut opt-out")
    scenarios = @($ScenarioResults)
    restoration_errors = @($RestorationErrors)
    private_backup_retained = (-not $passed) -or $KeepPrivateArtifacts
}
$jsonPath = Join-Path $SharedOutputRoot "installer-acceptance.json"
Write-Utf8File -Path $jsonPath -Content (($result | ConvertTo-Json -Depth 8) + "`n")

$scenarioLines = @($ScenarioResults | ForEach-Object { "- [{0}] {1}: {2}" -f $(if ($_.passed) { "x" } else { " " }), $_.name, $_.detail })
$markdown = @(
    "# CodeLens Pro Next v$ExpectedVersion installer acceptance",
    "",
    "- Result: $(if ($passed) { 'PASS' } else { 'FAIL' })",
    "- Setup: $([System.IO.Path]::GetFileName($CandidateSetup))",
    "- SHA-256: $candidateHash",
    "- Signature: $($candidateSignature.Status)",
    "- WebView2: $(if ($webViewVersion) { $webViewVersion } else { 'not detected' })",
    "- Current-user state restored: $($RestorationErrors.Count -eq 0)",
    "",
    "## Automated scenarios",
    "",
    ($scenarioLines -join [Environment]::NewLine),
    "",
    "## Manual release check",
    "",
    "- [ ] Run the interactive installer once and clear the desktop-shortcut checkbox; confirm no desktop shortcut is created.",
    "",
    "No API key, source text, prompt, model response, or private backup path is included in this report."
) -join [Environment]::NewLine
Write-Utf8File -Path (Join-Path $SharedOutputRoot "installer-acceptance.md") -Content ($markdown + [Environment]::NewLine)

if ($passed -and -not $KeepPrivateArtifacts) {
    Remove-Item -LiteralPath $PrivateRoot -Recurse -Force
}

$result | ConvertTo-Json -Depth 8
if (-not $passed) {
    throw "Installer acceptance failed. Private recovery data was retained under the release-acceptance cache."
}
