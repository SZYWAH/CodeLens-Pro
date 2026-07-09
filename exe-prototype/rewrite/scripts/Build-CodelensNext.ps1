param(
    [double]$MaxCpuPercent = 75,
    [double]$MinFreeMemoryGB = 3,
    [switch]$SkipLoadCheck,
    [switch]$SkipWebBuild,
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RewriteRoot = Resolve-Path (Join-Path $ScriptDir "..")
$PrototypeRoot = Resolve-Path (Join-Path $RewriteRoot "..")
$CacheRoot = Join-Path $PrototypeRoot ".cache"
$OutputRoot = Join-Path $PrototypeRoot "outputs\codelens-next"
$WebRoot = Join-Path $RewriteRoot "web"
$DesktopRoot = Join-Path $RewriteRoot "desktop"
$CoreManifest = Join-Path $RewriteRoot "core\Cargo.toml"
$CargoTarget = Join-Path $CacheRoot "cargo-target-next"
$CargoHome = Join-Path $CacheRoot "cargo-home-next"
$NpmCache = Join-Path $CacheRoot "npm-next"
$IconPath = Join-Path $DesktopRoot "src-tauri\icons\icon.ico"

if (-not (Test-Path $IconPath)) {
    throw "Required Windows icon was not found: $IconPath"
}

if (-not $SkipLoadCheck) {
    & (Join-Path $ScriptDir "Test-SystemLoad.ps1") -MaxCpuPercent $MaxCpuPercent -MinFreeMemoryGB $MinFreeMemoryGB
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

New-Item -ItemType Directory -Force -Path $CacheRoot, $OutputRoot, $CargoTarget, $CargoHome, $NpmCache | Out-Null

$env:npm_config_cache = $NpmCache
$env:CARGO_TARGET_DIR = $CargoTarget
$env:CARGO_HOME = $CargoHome

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

function Get-DirectorySizeMB {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path $Path)) {
        return 0
    }
    $bytes = (Get-ChildItem -Force -Recurse $Path -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    return [math]::Round(($bytes / 1MB), 2)
}

if (-not $SkipTests) {
    Write-Host "Running Rust core tests..." -ForegroundColor Cyan
    Invoke-CheckedCommand cargo test --manifest-path $CoreManifest
}

Write-Host "Installing web dependencies..." -ForegroundColor Cyan
Push-Location $WebRoot
Invoke-CheckedCommand npm install
if (-not $SkipWebBuild) {
    Invoke-CheckedCommand npm run build
}
Pop-Location

Write-Host "Installing desktop dependencies..." -ForegroundColor Cyan
Push-Location $DesktopRoot
Invoke-CheckedCommand npm install
Invoke-CheckedCommand npm run tauri:build
Pop-Location

$BuiltExe = Join-Path $CargoTarget "release\codelens_pro_next_desktop.exe"
if (-not (Test-Path $BuiltExe)) {
    throw "Expected Tauri exe was not found: $BuiltExe"
}

New-Item -ItemType Directory -Force -Path (Join-Path $OutputRoot "storage"), (Join-Path $OutputRoot "logs") | Out-Null
Copy-Item -Force $BuiltExe (Join-Path $OutputRoot "CodeLens Pro Next.exe")
Copy-Item -Force (Join-Path $RewriteRoot "README.md") (Join-Path $OutputRoot "README.md")

$VerifyScript = Join-Path $ScriptDir "Verify-Isolation.ps1"
if (Test-Path $VerifyScript) {
    & $VerifyScript
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$OutputExe = Join-Path $OutputRoot "CodeLens Pro Next.exe"
$ExeItem = Get-Item $OutputExe
[pscustomobject]@{
    Output = $OutputRoot
    Exe = $OutputExe
    ExeSizeMB = [math]::Round(($ExeItem.Length / 1MB), 2)
    ExeLastWriteTime = $ExeItem.LastWriteTime
    Cache = $CacheRoot
    CacheSizeMB = Get-DirectorySizeMB $CacheRoot
    OutputSizeMB = Get-DirectorySizeMB $OutputRoot
} | Format-List
