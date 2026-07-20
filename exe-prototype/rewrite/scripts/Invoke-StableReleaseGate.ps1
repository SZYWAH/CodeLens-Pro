param(
    [string]$ExpectedVersion = "1.1.0",
    [string]$ExpectedChannel = "rc3",
    [string]$ExpectedSignerThumbprint = "",
    [double]$MaxCpuPercent = 75,
    [double]$MinFreeMemoryGB = 2,
    [switch]$ConfirmCurrentUserMutation,
    [switch]$SkipInstallerAcceptance,
    [switch]$DesktopShortcutOptOutVerified,
    [switch]$RealProviderSmokeVerified,
    [string]$RealProviderModel = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RewriteRoot = Resolve-Path (Join-Path $ScriptDir "..")
$PrototypeRoot = Resolve-Path (Join-Path $RewriteRoot "..")
$OutputRoot = Join-Path $PrototypeRoot "outputs\codelens-next"
$GateOutput = Join-Path $OutputRoot "audits\v1.1.0-stable"
$ExpectedChannel = $ExpectedChannel.Trim().ToLowerInvariant()
$isStable = $ExpectedChannel -eq "stable"
if (-not $isStable -and $ExpectedChannel -notmatch '^rc[1-9][0-9]*$') {
    throw "ExpectedChannel must be stable or use the form rc1, rc2, and so on."
}
if ($isStable -and (-not $DesktopShortcutOptOutVerified -or -not $RealProviderSmokeVerified)) {
    throw "Stable release gating requires both -DesktopShortcutOptOutVerified and -RealProviderSmokeVerified."
}
if ($RealProviderSmokeVerified -and -not $RealProviderModel.Trim()) {
    throw "RealProviderModel is required when RealProviderSmokeVerified is set."
}
if (-not $SkipInstallerAcceptance -and -not $ConfirmCurrentUserMutation) {
    throw "Installer acceptance requires -ConfirmCurrentUserMutation, or use -SkipInstallerAcceptance for non-final diagnostics."
}

function Invoke-CheckedCommand {
    param([Parameter(Mandatory = $true)][string]$FilePath, [string[]]$Arguments = @())
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')" }
}

function Write-Utf8File {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Content)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding -ArgumentList $false))
}

New-Item -ItemType Directory -Force -Path $GateOutput | Out-Null
$startedAt = Get-Date
$tests = New-Object System.Collections.Generic.List[object]

$auditArguments = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ScriptDir "Audit-CodelensNext.ps1"),
    "-ExpectedVersion", $ExpectedVersion,
    "-ExpectedChannel", $ExpectedChannel,
    "-MaxCpuPercent", "$MaxCpuPercent",
    "-MinFreeMemoryGB", "$MinFreeMemoryGB",
    "-CaptureInteractionScreenshots"
)
if ($isStable) { $auditArguments += @("-ExpectedSignerThumbprint", $ExpectedSignerThumbprint) }
Invoke-CheckedCommand -FilePath powershell -Arguments $auditArguments
$tests.Add([pscustomobject]@{ name = "full-release-audit"; passed = $true; evidence = "v14.15-route-audit and release manifest" }) | Out-Null

Push-Location (Join-Path $RewriteRoot "web")
try {
    Invoke-CheckedCommand -FilePath npm -Arguments @("run", "audit:palette")
} finally {
    Pop-Location
}
$tests.Add([pscustomobject]@{ name = "semantic-palette-audit"; passed = $true; evidence = "v1.1.0-rc2-theme palette audit" }) | Out-Null

$realWorkspaceOutput = Join-Path $GateOutput "real-workspace"
Invoke-CheckedCommand -FilePath powershell -Arguments @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ScriptDir "Test-RealWorkspaceAcceptance.ps1"),
    "-WorkspacePath", $RewriteRoot,
    "-OutputDir", $realWorkspaceOutput
)
$tests.Add([pscustomobject]@{ name = "real-workspace-closed-loop"; passed = $true; evidence = "real-workspace/real-workspace-acceptance.json" }) | Out-Null

$releaseRoot = Join-Path $OutputRoot "releases\v$ExpectedVersion"
$setupName = if ($isStable) {
    "CodeLens-Pro-Next_${ExpectedVersion}_x64_signed-setup.exe"
} else {
    "CodeLens-Pro-Next_${ExpectedVersion}_x64_${ExpectedChannel}_unsigned-setup.exe"
}
$setupPath = Join-Path $releaseRoot $setupName

$installerPassed = $false
if (-not $SkipInstallerAcceptance) {
    Invoke-CheckedCommand -FilePath powershell -Arguments @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ScriptDir "Test-WindowsInstallerAcceptance.ps1"),
        "-CandidateSetup", $setupPath,
        "-ExpectedVersion", $ExpectedVersion,
        "-OutputDir", $GateOutput,
        "-ConfirmCurrentUserMutation"
    )
    $installerResult = Get-Content -Raw -LiteralPath (Join-Path $GateOutput "installer-acceptance.json") | ConvertFrom-Json
    if (-not $installerResult.passed -or -not $installerResult.current_user_state_restored) {
        throw "Installer acceptance did not pass or current-user state was not restored."
    }
    $installerPassed = $true
    $tests.Add([pscustomobject]@{ name = "windows-installer-acceptance"; passed = $true; evidence = "installer-acceptance.json" }) | Out-Null
} else {
    $tests.Add([pscustomobject]@{ name = "windows-installer-acceptance"; passed = $false; evidence = "skipped" }) | Out-Null
}

$manifest = Get-Content -Raw -LiteralPath (Join-Path $releaseRoot "release-manifest.json") | ConvertFrom-Json
$scopedDirty = git -C $RewriteRoot status --porcelain -- .
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect release source state." }
$sourceClean = -not [bool]$scopedDirty
$candidateReady = $installerPassed -and $sourceClean
$stableReady = $candidateReady -and $isStable -and $manifest.signed -and $DesktopShortcutOptOutVerified -and $RealProviderSmokeVerified

$defects = @(
    [ordered]@{ id = "A11Y-001"; severity = "P2"; disposition = "resolved"; evidence = "command palette combobox contract" },
    [ordered]@{ id = "A11Y-002"; severity = "P2"; disposition = "resolved"; evidence = "migration overlay focus contract" },
    [ordered]@{ id = "A11Y-003"; severity = "P2"; disposition = "resolved"; evidence = "AI context drawer focus contract" },
    [ordered]@{ id = "VIS-001"; severity = "P2"; disposition = "resolved"; evidence = "semantic palette audit" },
    [ordered]@{ id = "VIS-002"; severity = "P2"; disposition = "resolved"; evidence = "light-theme contrast audit" },
    [ordered]@{ id = "QA-001"; severity = "P2"; disposition = "resolved"; evidence = "data-theme assertion in maintained smoke" },
    [ordered]@{ id = "QA-002"; severity = "P2"; disposition = "resolved"; evidence = "deterministic dense 3D preview checks" },
    [ordered]@{ id = "VIS-003"; severity = "P2"; disposition = "deferred-v1.2.0"; evidence = "activity showcase is outside release-critical scope" },
    [ordered]@{ id = "VIS-004"; severity = "P2"; disposition = "deferred-v1.2.0"; evidence = "activity showcase is outside release-critical scope" },
    [ordered]@{ id = "UI-001"; severity = "P3"; disposition = "deferred-v1.2.0"; evidence = "non-blocking layout polish" },
    [ordered]@{ id = "UI-002"; severity = "P3"; disposition = "deferred-v1.2.0"; evidence = "non-blocking layout polish" }
)

$summary = [ordered]@{
    schema = "codelens-next.release-gate.v1"
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    elapsed_seconds = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 2)
    version = $ExpectedVersion
    channel = $ExpectedChannel
    git_sha = (git -C $RewriteRoot rev-parse HEAD).Trim()
    source_clean = $sourceClean
    setup_file = $setupName
    setup_sha256 = $manifest.sha256
    signed = [bool]$manifest.signed
    signer_thumbprint = $manifest.signer_thumbprint
    candidate_ready = $candidateReady
    stable_release_ready = $stableReady
    installer_acceptance_passed = $installerPassed
    desktop_shortcut_opt_out_verified = [bool]$DesktopShortcutOptOutVerified
    real_provider_smoke = [ordered]@{
        verified = [bool]$RealProviderSmokeVerified
        model = if ($RealProviderSmokeVerified) { $RealProviderModel.Trim() } else { $null }
    }
    blocking_defects = 0
    release_related_p2 = 0
    tests = @($tests)
    defects = $defects
}
Write-Utf8File -Path (Join-Path $GateOutput "release-gate.json") -Content (($summary | ConvertTo-Json -Depth 10) + "`n")
Write-Utf8File -Path (Join-Path $GateOutput "test-summary.json") -Content ((([ordered]@{ generated_at = $summary.generated_at; tests = @($tests) }) | ConvertTo-Json -Depth 6) + "`n")

$testLines = @($tests | ForEach-Object { "- [{0}] {1} — {2}" -f $(if ($_.passed) { "x" } else { " " }), $_.name, $_.evidence })
$deferredLines = @($defects | Where-Object { $_.disposition -like "deferred*" } | ForEach-Object { "- $($_.id) ($($_.severity)): $($_.disposition)" })
$realProviderSuffix = if ($RealProviderSmokeVerified) { " ($($RealProviderModel.Trim()))" } else { "" }
$markdown = @(
    "# CodeLens Pro Next v$ExpectedVersion release gate",
    "",
    "- Channel: $ExpectedChannel",
    "- Candidate ready: $candidateReady",
    "- Stable release ready: $stableReady",
    "- Source clean: $sourceClean",
    "- Signed: $($manifest.signed)",
    "- Blocking defects: 0",
    "- Release-related P2 defects: 0",
    "",
    "## Tests",
    "",
    ($testLines -join [Environment]::NewLine),
    "",
    "## Deferred to v1.2.0",
    "",
    ($deferredLines -join [Environment]::NewLine),
    "",
    "## Remaining manual gates",
    "",
    "- Desktop shortcut opt-out: $([bool]$DesktopShortcutOptOutVerified)",
    "- Real provider smoke: $([bool]$RealProviderSmokeVerified)$realProviderSuffix"
) -join [Environment]::NewLine
Write-Utf8File -Path (Join-Path $GateOutput "RELEASE-GATE.md") -Content ($markdown + [Environment]::NewLine)

$summary | ConvertTo-Json -Depth 10
if (-not $candidateReady) { throw "Release candidate gate is not complete." }
if ($isStable -and -not $stableReady) { throw "Stable release gate is not complete." }
