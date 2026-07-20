param(
    [double]$MaxCpuPercent = 75,
    [double]$MinFreeMemoryGB = 3,
    [switch]$SkipLoadCheck,
    [switch]$SkipWebBuild,
    [switch]$SkipTests,
    [switch]$AllowDirty,
    [string]$ReleaseChannel = "rc3",
    [string]$CertificateThumbprint = "",
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RewriteRoot = Resolve-Path (Join-Path $ScriptDir "..")
$PrototypeRoot = Resolve-Path (Join-Path $RewriteRoot "..")
$CacheRoot = Join-Path $PrototypeRoot ".cache"
$OutputRoot = Join-Path $PrototypeRoot "outputs\codelens-next"
$Version = "1.1.0"
$ReleaseRoot = Join-Path $OutputRoot "releases\v$Version"
$WebRoot = Join-Path $RewriteRoot "web"
$DesktopRoot = Join-Path $RewriteRoot "desktop"
$CoreManifest = Join-Path $RewriteRoot "core\Cargo.toml"
$CargoTarget = Join-Path $CacheRoot "cargo-target-next"
$CargoHome = Join-Path $CacheRoot "cargo-home-next"
$NpmCache = Join-Path $CacheRoot "npm-next"
$IconPath = Join-Path $DesktopRoot "src-tauri\icons\icon.ico"

$ReleaseChannel = $ReleaseChannel.Trim().ToLowerInvariant()
$isStable = $ReleaseChannel -eq "stable"
if (-not $isStable -and $ReleaseChannel -notmatch '^rc[1-9][0-9]*$') {
    throw "ReleaseChannel must be stable or use the form rc1, rc2, and so on."
}

$normalizedThumbprint = ($CertificateThumbprint -replace '\s', '').ToUpperInvariant()
if ($isStable -and -not $normalizedThumbprint) {
    throw "Stable builds require CertificateThumbprint. Unsigned stable installers are not allowed."
}
if (-not $isStable -and $normalizedThumbprint) {
    throw "Release candidates must remain unsigned. Use ReleaseChannel stable for a signed build."
}

$signingCertificate = $null
if ($isStable) {
    $certificatePath = "Cert:\CurrentUser\My\$normalizedThumbprint"
    $signingCertificate = Get-Item -LiteralPath $certificatePath -ErrorAction SilentlyContinue
    if (-not $signingCertificate) {
        throw "Code-signing certificate was not found in CurrentUser\\My: $normalizedThumbprint"
    }
    if (-not $signingCertificate.HasPrivateKey) {
        throw "The selected code-signing certificate does not have a private key."
    }
    $codeSigningOid = "1.3.6.1.5.5.7.3.3"
    $hasCodeSigningUsage = @($signingCertificate.EnhancedKeyUsageList | Where-Object { $_.ObjectId.Value -eq $codeSigningOid }).Count -gt 0
    if (-not $hasCodeSigningUsage) {
        throw "The selected certificate is not valid for code signing."
    }
    $now = Get-Date
    if ($signingCertificate.NotBefore -gt $now -or $signingCertificate.NotAfter -le $now) {
        throw "The selected code-signing certificate is not currently valid."
    }
}

$dirty = git -C $RewriteRoot status --porcelain -- .
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect the release source state."
}
if ($dirty -and -not $AllowDirty) {
    throw "Release candidates must be built from a clean rewrite working tree. Commit the scoped changes or pass -AllowDirty for a non-final verification build."
}

if (-not (Test-Path $IconPath)) {
    throw "Required Windows icon was not found: $IconPath"
}

if (-not $SkipLoadCheck) {
    & (Join-Path $ScriptDir "Test-SystemLoad.ps1") -MaxCpuPercent $MaxCpuPercent -MinFreeMemoryGB $MinFreeMemoryGB
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

New-Item -ItemType Directory -Force -Path $CacheRoot, $OutputRoot, $ReleaseRoot, $CargoTarget, $CargoHome, $NpmCache | Out-Null

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
    Invoke-CheckedCommand cargo test --manifest-path $CoreManifest --locked
}

Write-Host "Installing web dependencies..." -ForegroundColor Cyan
Push-Location $WebRoot
Invoke-CheckedCommand npm ci
if (-not $SkipTests) {
    Invoke-CheckedCommand npm test
}
if (-not $SkipWebBuild) {
    Invoke-CheckedCommand npm run build
}
Pop-Location

Write-Host "Installing desktop dependencies..." -ForegroundColor Cyan
Push-Location $DesktopRoot
Invoke-CheckedCommand npm ci
$tauriArguments = @("run", "tauri:build")
if ($isStable) {
    $signingConfig = Join-Path $CacheRoot "tauri-signing-config.json"
    $config = @{
        bundle = @{
            windows = @{
                certificateThumbprint = $normalizedThumbprint
                timestampUrl = $TimestampUrl.Trim()
            }
        }
    } | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($signingConfig, $config, (New-Object System.Text.UTF8Encoding -ArgumentList $false))
    $tauriArguments += @("--", "--config", $signingConfig)
}
Invoke-CheckedCommand npm @tauriArguments
Pop-Location

$BuiltExe = Join-Path $CargoTarget "release\codelens_pro_next_desktop.exe"
if (-not (Test-Path $BuiltExe)) {
    throw "Expected Tauri exe was not found: $BuiltExe"
}

$BundleRoot = Join-Path $CargoTarget "release\bundle\nsis"
$BuiltSetup = Get-ChildItem -LiteralPath $BundleRoot -Filter "*-setup.exe" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $BuiltSetup) {
    throw "Expected NSIS setup was not found under: $BundleRoot"
}

$signature = Get-AuthenticodeSignature -LiteralPath $BuiltSetup.FullName
$exeSignature = Get-AuthenticodeSignature -LiteralPath $BuiltExe
$isSigned = $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid
$isExeSigned = $exeSignature.Status -eq [System.Management.Automation.SignatureStatus]::Valid
if ($isStable) {
    if (-not $isSigned -or -not $isExeSigned) {
        throw "Stable signatures are invalid. setup=$($signature.Status) exe=$($exeSignature.Status)"
    }
    if ($signature.SignerCertificate.Thumbprint -ne $normalizedThumbprint -or $exeSignature.SignerCertificate.Thumbprint -ne $normalizedThumbprint) {
        throw "Stable binaries were not signed by the requested certificate."
    }
    if (-not $signature.TimeStamperCertificate -or -not $exeSignature.TimeStamperCertificate) {
        throw "Stable binaries must contain an Authenticode timestamp."
    }
} elseif ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned -or $exeSignature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
    throw "Release candidates must be unsigned. setup=$($signature.Status) exe=$($exeSignature.Status)"
}
$signatureLabel = if ($isSigned) { "signed" } else { "unsigned" }
$setupName = if ($isStable) {
    "CodeLens-Pro-Next_${Version}_x64_signed-setup.exe"
} else {
    "CodeLens-Pro-Next_${Version}_x64_${ReleaseChannel}_unsigned-setup.exe"
}
$outputSetup = Join-Path $ReleaseRoot $setupName
Copy-Item -Force $BuiltSetup.FullName $outputSetup

New-Item -ItemType Directory -Force -Path (Join-Path $OutputRoot "storage"), (Join-Path $OutputRoot "logs") | Out-Null
Copy-Item -Force $BuiltExe (Join-Path $OutputRoot "CodeLens Pro Next.exe")
Copy-Item -Force (Join-Path $RewriteRoot "README.md") (Join-Path $OutputRoot "README.md")

$gitSha = (git -C $RewriteRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Unable to resolve the release source commit."
}
$setupHash = (Get-FileHash -LiteralPath $outputSetup -Algorithm SHA256).Hash.ToLowerInvariant()
$hashLine = "$setupHash *$setupName`n"
[System.IO.File]::WriteAllText((Join-Path $ReleaseRoot "SHA256SUMS.txt"), $hashLine, (New-Object System.Text.UTF8Encoding -ArgumentList $false))

$manifest = [ordered]@{
    product = "CodeLens Pro Next"
    version = $Version
    channel = $ReleaseChannel
    architecture = "x64"
    installer = "nsis"
    setup_file = $setupName
    sha256 = $setupHash
    git_sha = $gitSha
    source_dirty = [bool]$dirty
    built_at = (Get-Date).ToUniversalTime().ToString("o")
    webview2 = "downloadBootstrapper"
    install_mode = "currentUser"
    identifier = "com.szywah.codelensnext"
    signature_status = $signature.Status.ToString()
    executable_signature_status = $exeSignature.Status.ToString()
    signed = $isSigned
    signer_subject = if ($isSigned) { $signature.SignerCertificate.Subject } else { $null }
    signer_thumbprint = if ($isSigned) { $signature.SignerCertificate.Thumbprint } else { $null }
    timestamp_status = if ($signature.TimeStamperCertificate) { "present" } else { "missing" }
    timestamp_url = if ($isStable) { $TimestampUrl.Trim() } else { $null }
    tests = @("core:cargo-test", "web:model-and-ai-tests", "web:production-build", "tauri:release-build")
}
$manifestJson = $manifest | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $ReleaseRoot "release-manifest.json"), $manifestJson, (New-Object System.Text.UTF8Encoding -ArgumentList $false))

$releaseNotesLines = @(
    $(if ($isStable) { "# CodeLens Pro Next v1.1.0" } else { "# CodeLens Pro Next v1.1.0 $($ReleaseChannel.ToUpperInvariant())" }),
    "",
    "- Adds the true 3D dependency space, semantic LOD, relation inspector, and immersive graph mode.",
    "- Connects settings, reviews, diffs, AI chat, and learning materials through one AI runtime.",
    "- Installs per user through NSIS and downloads WebView2 only when it is required.",
    "- Keeps user data under %LOCALAPPDATA%\com.szywah.codelensnext after uninstall."
)
if ($isStable) {
    $releaseNotesLines += @(
        "- Authenticode signature: valid and timestamped.",
        "",
        "This is the signed v1.1.0 stable release."
    )
} else {
    $releaseNotesLines += @(
        "- Candidate signature status: unsigned.",
        "",
        "This candidate is intended for install, upgrade, and uninstall acceptance before the signed stable release."
    )
}
$releaseNotes = ($releaseNotesLines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText((Join-Path $ReleaseRoot "RELEASE-NOTES.md"), $releaseNotes, (New-Object System.Text.UTF8Encoding -ArgumentList $false))

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
    Output = $ReleaseRoot
    Setup = $outputSetup
    SetupSizeMB = [math]::Round((Get-Item $outputSetup).Length / 1MB, 2)
    SetupSHA256 = $setupHash
    Signature = $signature.Status
    Exe = $OutputExe
    ExeSizeMB = [math]::Round(($ExeItem.Length / 1MB), 2)
    ExeLastWriteTime = $ExeItem.LastWriteTime
    Cache = $CacheRoot
    CacheSizeMB = Get-DirectorySizeMB $CacheRoot
    OutputSizeMB = Get-DirectorySizeMB $OutputRoot
} | Format-List
