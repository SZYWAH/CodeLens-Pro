param(
    [string]$ExpectedVersion = "1.0.0",
    [double]$MaxCpuPercent = 75,
    [double]$MinFreeMemoryGB = 2,
    [switch]$SkipReleaseBuild,
    [switch]$SkipVisualSmoke,
    [switch]$SkipInteractionSmoke,
    [switch]$SkipLaunchSmoke
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RewriteRoot = Resolve-Path (Join-Path $ScriptDir "..")
$PrototypeRoot = Resolve-Path (Join-Path $RewriteRoot "..")
$ProjectRoot = Resolve-Path (Join-Path $PrototypeRoot "..")
$CacheRoot = Join-Path $PrototypeRoot ".cache"
$OutputRoot = Join-Path $PrototypeRoot "outputs\codelens-next"
$OutputExe = Join-Path $OutputRoot "CodeLens Pro Next.exe"
$WebRoot = Join-Path $RewriteRoot "web"
$DesktopRoot = Join-Path $RewriteRoot "desktop"
$CoreManifest = Join-Path $RewriteRoot "core\Cargo.toml"
$DesktopManifest = Join-Path $DesktopRoot "src-tauri\Cargo.toml"
$TauriConfig = Join-Path $DesktopRoot "src-tauri\tauri.conf.json"
$CargoTarget = Join-Path $CacheRoot "cargo-target-next"
$CargoHome = Join-Path $CacheRoot "cargo-home-next"
$NpmCache = Join-Path $CacheRoot "npm-next"

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Actual,
        [Parameter(Mandatory = $true)][string]$Expected
    )

    if ($Actual -ne $Expected) {
        throw "$Name expected $Expected but found $Actual"
    }
}

function Read-CargoVersion {
    param([Parameter(Mandatory = $true)][string]$Path)

    $line = Select-String -Path $Path -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1
    if (-not $line) {
        throw "Version was not found in $Path"
    }
    return $line.Matches[0].Groups[1].Value
}

function Assert-NoPattern {
    param(
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string[]]$Paths,
        [string]$Description = $Pattern,
        [string[]]$ExcludeGlobs = @()
    )

    Push-Location $ProjectRoot
    try {
        $rgArgs = @("-n", $Pattern)
        foreach ($glob in $ExcludeGlobs) {
            $rgArgs += @("-g", "!$glob")
        }
        $rgArgs += $Paths
        $matches = & rg @rgArgs
        if ($LASTEXITCODE -eq 0) {
            $matches | Write-Host
            throw "Unexpected text found during audit: $Description"
        }
        if ($LASTEXITCODE -gt 1) {
            throw "rg failed while checking: $Description"
        }
    } finally {
        Pop-Location
    }
}

Write-Host "Checking system load..." -ForegroundColor Cyan
Invoke-CheckedCommand -FilePath powershell -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ScriptDir "Test-SystemLoad.ps1"), "-MaxCpuPercent", "$MaxCpuPercent", "-MinFreeMemoryGB", "$MinFreeMemoryGB")

New-Item -ItemType Directory -Force -Path $CacheRoot, $CargoTarget, $CargoHome, $NpmCache | Out-Null
$env:npm_config_cache = $NpmCache
$env:CARGO_TARGET_DIR = $CargoTarget
$env:CARGO_HOME = $CargoHome

Write-Host "Checking version consistency..." -ForegroundColor Cyan
$webPackage = Get-Content (Join-Path $WebRoot "package.json") -Raw | ConvertFrom-Json
$desktopPackage = Get-Content (Join-Path $DesktopRoot "package.json") -Raw | ConvertFrom-Json
$tauri = Get-Content $TauriConfig -Raw | ConvertFrom-Json
Assert-Equal "web package version" $webPackage.version $ExpectedVersion
Assert-Equal "desktop package version" $desktopPackage.version $ExpectedVersion
Assert-Equal "tauri config version" $tauri.version $ExpectedVersion
Assert-Equal "core crate version" (Read-CargoVersion $CoreManifest) $ExpectedVersion
Assert-Equal "desktop crate version" (Read-CargoVersion $DesktopManifest) $ExpectedVersion

$DevPreviewExcludes = @("**/dev-preview/**")
Assert-NoPattern -Pattern "课堂|classroom demo|0\.9\.0-preview|local-tauri-bridge/0\.9" -Paths @("exe-prototype/rewrite/web/src", "exe-prototype/rewrite/core/src", "exe-prototype/rewrite/README.md") -Description "old demo or preview bridge wording" -ExcludeGlobs $DevPreviewExcludes
Assert-NoPattern -Pattern "Daily Learning|Activity Calendar|Daily Log|Agent Workspace|Activity Galaxy|Activity Types|Daily Activity|Model Management|Workspace Review|Diff Review|Report Library|Conversations" -Paths @("exe-prototype/rewrite/web/src") -Description "English page eyebrow text" -ExcludeGlobs $DevPreviewExcludes
Assert-NoPattern -Pattern "Demo Report|demo-model|function demo|project_name:\s*`"Demo`"|browser-preview|local-preview|mock|浏览器预览|本地预览|课堂展示|教学展示|演示原型|v0\.6" -Paths @("exe-prototype/rewrite/web/src", "exe-prototype/rewrite/core/src", "exe-prototype/rewrite/README.md") -Description "prototype-oriented wording outside dev preview" -ExcludeGlobs $DevPreviewExcludes
Assert-NoPattern -Pattern "dev-preview" -Paths @("exe-prototype/rewrite/web/src") -Description "formal frontend source must not reference dev preview" -ExcludeGlobs $DevPreviewExcludes

Write-Host "Checking isolation..." -ForegroundColor Cyan
Invoke-CheckedCommand -FilePath powershell -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ScriptDir "Verify-Isolation.ps1"))

Write-Host "Running frontend build..." -ForegroundColor Cyan
Push-Location $WebRoot
try {
    Invoke-CheckedCommand -FilePath npm -Arguments @("run", "build")
} finally {
    Pop-Location
}

Write-Host "Running frontend scale audit..." -ForegroundColor Cyan
Invoke-CheckedCommand -FilePath powershell -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ScriptDir "Test-FrontendScaleAudit.ps1"))

if (-not $SkipInteractionSmoke) {
    Write-Host "Running frontend interaction smoke test..." -ForegroundColor Cyan
    $interactionSmokeScript = Join-Path $ScriptDir "Test-FrontendInteractionSmoke.ps1"
    if (-not (Test-Path $interactionSmokeScript)) {
        throw "Frontend interaction smoke script was not found: $interactionSmokeScript"
    }
    Invoke-CheckedCommand -FilePath powershell -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $interactionSmokeScript, "-OutputDir", (Join-Path $OutputRoot "v14.15-route-audit"))
}

if (-not $SkipVisualSmoke) {
    Write-Host "Running frontend visual smoke test..." -ForegroundColor Cyan
    Invoke-CheckedCommand -FilePath powershell -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ScriptDir "Test-FrontendVisualSmoke.ps1"), "-SkipBuild", "-OutputDir", $OutputRoot, "-AllowNoScreenshot")
}

Write-Host "Running Rust core tests..." -ForegroundColor Cyan
Invoke-CheckedCommand -FilePath cargo -Arguments @("test", "--manifest-path", $CoreManifest, "-j", "1")

Write-Host "Running Tauri cargo check..." -ForegroundColor Cyan
Invoke-CheckedCommand -FilePath cargo -Arguments @("check", "--manifest-path", $DesktopManifest, "-j", "1")

if (-not $SkipReleaseBuild) {
    Write-Host "Running release build..." -ForegroundColor Cyan
    Invoke-CheckedCommand -FilePath powershell -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ScriptDir "Build-CodelensNext.ps1"), "-MaxCpuPercent", "$MaxCpuPercent", "-MinFreeMemoryGB", "$MinFreeMemoryGB")
}

if (-not (Test-Path $OutputExe)) {
    throw "Expected output exe was not found: $OutputExe"
}

$exeItem = Get-Item $OutputExe
if ($exeItem.Length -lt 5MB) {
    throw "Output exe is unexpectedly small: $([math]::Round($exeItem.Length / 1MB, 2)) MB"
}

if (-not $SkipLaunchSmoke) {
    Write-Host "Running launch/close smoke test..." -ForegroundColor Cyan
    $existing = Get-Process | Where-Object { $_.Path -eq $exeItem.FullName }
    if ($existing) {
        throw "The app is already running. Close it before launch smoke testing."
    }

    # A hidden GUI process has no closable main-window handle on Windows, so the
    # smoke test must launch the real app window before exercising WM_CLOSE.
    $process = Start-Process -FilePath $exeItem.FullName -PassThru
    Start-Sleep -Seconds 6
    $running = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    if (-not $running) {
        throw "The app exited before the smoke test could close it."
    }

    $closeAccepted = $running.CloseMainWindow()
    if (-not $closeAccepted) {
        Stop-Process -Id $process.Id -Force
        throw "The app did not expose a closable main window; the smoke-test process was stopped."
    }
    if (-not $running.WaitForExit(6000)) {
        Stop-Process -Id $process.Id -Force
        throw "The app did not close within 6 seconds after CloseMainWindow; the smoke-test process was stopped."
    }
}

[pscustomobject]@{
    Passed = $true
    Version = $ExpectedVersion
    Exe = $OutputExe
    ExeSizeMB = [math]::Round($exeItem.Length / 1MB, 2)
    ExeLastWriteTime = $exeItem.LastWriteTime
    CacheRoot = $CacheRoot
} | Format-List
