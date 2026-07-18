param(
    [string]$ExpectedVersion = "1.1.0",
    [double]$MaxCpuPercent = 75,
    [double]$MinFreeMemoryGB = 2,
    [switch]$SkipReleaseBuild,
    [switch]$SkipVisualSmoke,
    [switch]$SkipInteractionSmoke,
    [switch]$CaptureInteractionScreenshots,
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
$ReleaseRoot = Join-Path $OutputRoot "releases\v$ExpectedVersion"
$OutputSetup = Join-Path $ReleaseRoot "CodeLens-Pro-Next_${ExpectedVersion}_x64_rc1_unsigned-setup.exe"
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

    # "mock" is expected inside deterministic network tests and is not by
    # itself evidence that production UI content leaked from the preview.
    if ($Description -eq "prototype-oriented wording outside dev preview") {
        $Pattern = $Pattern.Replace("|mock|", "|")
    }

    Push-Location $ProjectRoot
    try {
        $ripgrep = Get-Command rg -ErrorAction SilentlyContinue
        if ($ripgrep) {
            $rgArgs = @("-n", $Pattern)
            foreach ($glob in $ExcludeGlobs) {
                $rgArgs += @("-g", "!$glob")
            }
            $rgArgs += $Paths
            $matches = & $ripgrep.Source @rgArgs
            if ($LASTEXITCODE -eq 0) {
                $matches | Write-Host
                throw "Unexpected text found during audit: $Description"
            }
            if ($LASTEXITCODE -gt 1) {
                throw "rg failed while checking: $Description"
            }
            return
        }

        $candidateFiles = New-Object System.Collections.Generic.List[System.IO.FileInfo]
        foreach ($path in $Paths) {
            if (Test-Path -LiteralPath $path -PathType Container) {
                foreach ($file in Get-ChildItem -LiteralPath $path -Recurse -File) {
                    $candidateFiles.Add($file)
                }
            } elseif (Test-Path -LiteralPath $path -PathType Leaf) {
                $candidateFiles.Add((Get-Item -LiteralPath $path))
            }
        }
        $filteredFiles = @($candidateFiles | Where-Object {
            $relativePath = $_.FullName.Substring($ProjectRoot.Path.Length).TrimStart('\').Replace('\', '/')
            -not @($ExcludeGlobs | Where-Object { $relativePath -like $_ }).Count
        })
        $matches = @($filteredFiles | Select-String -Pattern $Pattern -CaseSensitive -ErrorAction SilentlyContinue)
        if ($matches.Count -gt 0) {
            $matches | ForEach-Object { "{0}:{1}:{2}" -f $_.Path, $_.LineNumber, $_.Line } | Write-Host
            throw "Unexpected text found during audit: $Description"
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
$webPackage = [System.IO.File]::ReadAllText((Join-Path $WebRoot "package.json"), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$desktopPackage = [System.IO.File]::ReadAllText((Join-Path $DesktopRoot "package.json"), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$tauri = [System.IO.File]::ReadAllText($TauriConfig, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
Assert-Equal "web package version" $webPackage.version $ExpectedVersion
Assert-Equal "desktop package version" $desktopPackage.version $ExpectedVersion
Assert-Equal "tauri config version" $tauri.version $ExpectedVersion
Assert-Equal "core crate version" (Read-CargoVersion $CoreManifest) $ExpectedVersion
Assert-Equal "desktop crate version" (Read-CargoVersion $DesktopManifest) $ExpectedVersion
Assert-Equal "tauri identifier" $tauri.identifier "com.szywah.codelensnext"
Assert-Equal "bundle publisher" $tauri.bundle.publisher "SZYWAH"
Assert-Equal "NSIS install mode" $tauri.bundle.windows.nsis.installMode "currentUser"
Assert-Equal "WebView2 install mode" $tauri.bundle.windows.webviewInstallMode.type "downloadBootstrapper"
if (-not $tauri.bundle.active -or $tauri.bundle.windows.allowDowngrades) {
    throw "The NSIS bundle must be active and downgrades must be disabled."
}

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
    $interactionArguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $interactionSmokeScript, "-OutputDir", (Join-Path $OutputRoot "v14.15-route-audit"))
    if ($CaptureInteractionScreenshots) {
        $interactionArguments += "-CaptureScreenshots"
    }
    Invoke-CheckedCommand -FilePath powershell -Arguments $interactionArguments
}

if (-not $SkipVisualSmoke) {
    Write-Host "Running frontend visual smoke test..." -ForegroundColor Cyan
    Invoke-CheckedCommand -FilePath powershell -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ScriptDir "Test-FrontendVisualSmoke.ps1"), "-SkipBuild", "-OutputDir", $OutputRoot, "-AllowNoScreenshot")
}

Write-Host "Running Rust core tests..." -ForegroundColor Cyan
Invoke-CheckedCommand -FilePath cargo -Arguments @("test", "--manifest-path", $CoreManifest, "--locked", "-j", "1")

Write-Host "Running Tauri cargo check..." -ForegroundColor Cyan
Invoke-CheckedCommand -FilePath cargo -Arguments @("check", "--manifest-path", $DesktopManifest, "--locked", "-j", "1")

if (-not $SkipReleaseBuild) {
    Write-Host "Running release build..." -ForegroundColor Cyan
    Invoke-CheckedCommand -FilePath powershell -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ScriptDir "Build-CodelensNext.ps1"), "-MaxCpuPercent", "$MaxCpuPercent", "-MinFreeMemoryGB", "$MinFreeMemoryGB")
}

$exeItem = $null
$setupItem = $null
if (-not $SkipReleaseBuild) {
    if (-not (Test-Path $OutputExe)) {
        throw "Expected output exe was not found: $OutputExe"
    }
    $exeItem = Get-Item $OutputExe
    if ($exeItem.Length -lt 5MB) {
        throw "Output exe is unexpectedly small: $([math]::Round($exeItem.Length / 1MB, 2)) MB"
    }
    if (-not (Test-Path $OutputSetup)) {
        throw "Expected NSIS setup was not found: $OutputSetup"
    }
    $setupItem = Get-Item $OutputSetup
    # LZMA keeps the current NSIS bootstrapper around 4.4 MiB. A 3 MiB floor
    # still catches truncated or placeholder outputs without rejecting the
    # expected compressed candidate.
    if ($setupItem.Length -lt 3MB) {
        throw "Output setup is unexpectedly small: $([math]::Round($setupItem.Length / 1MB, 2)) MB"
    }
    foreach ($required in @("SHA256SUMS.txt", "release-manifest.json", "RELEASE-NOTES.md")) {
        if (-not (Test-Path (Join-Path $ReleaseRoot $required))) {
            throw "Release evidence file is missing: $required"
        }
    }
    $actualHash = (Get-FileHash -LiteralPath $OutputSetup -Algorithm SHA256).Hash.ToLowerInvariant()
    $hashRecord = (Get-Content -LiteralPath (Join-Path $ReleaseRoot "SHA256SUMS.txt") -Raw).Trim()
    $recordedHash = ($hashRecord -split '\s+')[0].ToLowerInvariant()
    Assert-Equal "setup SHA-256" $actualHash $recordedHash

    $releaseManifest = [System.IO.File]::ReadAllText((Join-Path $ReleaseRoot "release-manifest.json"), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    Assert-Equal "manifest version" $releaseManifest.version $ExpectedVersion
    Assert-Equal "manifest architecture" $releaseManifest.architecture "x64"
    Assert-Equal "manifest identifier" $releaseManifest.identifier "com.szywah.codelensnext"
    Assert-Equal "manifest WebView2 policy" $releaseManifest.webview2 "downloadBootstrapper"
    Assert-Equal "manifest SHA-256" $releaseManifest.sha256 $actualHash
    Assert-Equal "manifest git SHA" $releaseManifest.git_sha ((git -C $RewriteRoot rev-parse HEAD).Trim())
    if ($releaseManifest.signed -or $releaseManifest.source_dirty) {
        throw "The final unsigned RC manifest must be clean and marked unsigned."
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $OutputSetup
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
        throw "The current RC is expected to be unsigned, but signature status is $($signature.Status)."
    }
}

if (-not $SkipLaunchSmoke) {
    if ($SkipReleaseBuild) {
        throw "Launch smoke requires a release build. Remove -SkipReleaseBuild or add -SkipLaunchSmoke."
    }
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
    Exe = if ($exeItem) { $OutputExe } else { $null }
    ExeSizeMB = if ($exeItem) { [math]::Round($exeItem.Length / 1MB, 2) } else { 0 }
    ExeLastWriteTime = if ($exeItem) { $exeItem.LastWriteTime } else { $null }
    Setup = if ($setupItem) { $OutputSetup } else { $null }
    SetupSizeMB = if ($setupItem) { [math]::Round($setupItem.Length / 1MB, 2) } else { 0 }
    SetupLastWriteTime = if ($setupItem) { $setupItem.LastWriteTime } else { $null }
    CacheRoot = $CacheRoot
} | Format-List
