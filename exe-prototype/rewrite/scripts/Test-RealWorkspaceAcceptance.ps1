param(
    [string]$WorkspacePath = "",
    [string]$OutputDir = "",
    [switch]$KeepArtifacts
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RewriteRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$PrototypeRoot = (Resolve-Path (Join-Path $RewriteRoot "..")).Path

if ([string]::IsNullOrWhiteSpace($WorkspacePath)) {
    $WorkspacePath = $RewriteRoot
}
$WorkspacePath = (Resolve-Path $WorkspacePath).Path

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $PrototypeRoot "outputs\codelens-next\v14.16-acceptance"
}
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$runId = "{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), $PID
$tempBase = if ($env:RUNNER_TEMP) {
    Join-Path $env:RUNNER_TEMP "codelens-next-acceptance"
} else {
    Join-Path $PrototypeRoot ".cache\real-workspace-acceptance"
}
$testRoot = Join-Path $tempBase $runId
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

$resultPath = Join-Path $OutputDir "real-workspace-acceptance.json"
$summaryPath = Join-Path $OutputDir "real-workspace-acceptance.md"
$logPath = Join-Path $OutputDir "real-workspace-acceptance.log"
$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false

$previous = @{
    Workspace = $env:CODELENS_ACCEPTANCE_WORKSPACE
    Output = $env:CODELENS_ACCEPTANCE_OUTPUT
    Root = $env:CODELENS_TEST_ROOT
    Keep = $env:CODELENS_ACCEPTANCE_KEEP
}

try {
    $env:CODELENS_ACCEPTANCE_WORKSPACE = $WorkspacePath
    $env:CODELENS_ACCEPTANCE_OUTPUT = $resultPath
    $env:CODELENS_TEST_ROOT = $testRoot
    $env:CODELENS_ACCEPTANCE_KEEP = if ($KeepArtifacts) { "1" } else { "0" }

    Write-Host "Running isolated real-workspace acceptance..." -ForegroundColor Cyan
    Push-Location (Join-Path $RewriteRoot "core")
    try {
        # Merge Cargo's progress stream inside cmd.exe. Windows PowerShell 5.1
        # otherwise wraps normal stderr output as NativeCommandError.
        $cargoCommand = "cargo test --locked --test real_workspace_acceptance real_workspace_release_acceptance -- --ignored --exact --nocapture 2>&1"
        & $env:ComSpec /d /s /c $cargoCommand |
            Tee-Object -FilePath $logPath
        $cargoExit = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    if (-not (Test-Path $resultPath)) {
        throw "Acceptance test did not create its JSON result: $resultPath"
    }

    $result = Get-Content -LiteralPath $resultPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ($cargoExit -ne 0 -or $result.status -ne "passed") {
        $errorText = if ($result.error) { $result.error } else { "cargo test exited with $cargoExit" }
        $failure = @(
            "# CodeLens Pro Next real-workspace acceptance",
            "",
            "- Status: **FAILED**",
            "- Workspace: ``$WorkspacePath``",
            "- Isolated test root: ``$testRoot``",
            "- Log: ``$logPath``",
            "",
            "## Error",
            "",
            $errorText,
            "",
            "The isolated test root was preserved for diagnosis."
        ) -join "`r`n"
        [System.IO.File]::WriteAllText($summaryPath, $failure, $utf8)
        throw "Real-workspace acceptance failed. See $summaryPath"
    }

    $languages = @($result.workspace.languages | ForEach-Object { $_.language }) -join ", "
    $summary = @(
        "# CodeLens Pro Next real-workspace acceptance",
        "",
        "- Status: **PASSED**",
        "- Workspace: ``$WorkspacePath``",
        "- Files: $($result.workspace.file_count)",
        "- Code lines: $($result.workspace.total_lines)",
        "- Languages: $languages",
        "- Symbols / dependencies: $($result.workspace.symbols) / $($result.workspace.dependencies)",
        "- Findings / cards: $($result.findings) / $($result.cards)",
        "- Report: $($result.report.title) (``$($result.report.analysis_source)``)",
        "- Persistence reopen: $($result.persistence_reopen)",
        "- Archive API key exported: $($result.api_key_exported)",
        "- Duration: $($result.duration_ms) ms",
        "- Log: ``$logPath``",
        "",
        "The acceptance database was isolated from user data. Successful runs clean the temporary database unless ``-KeepArtifacts`` is supplied."
    ) -join "`r`n"
    [System.IO.File]::WriteAllText($summaryPath, $summary, $utf8)

    [pscustomobject]@{
        Passed = $true
        Workspace = $WorkspacePath
        Result = $resultPath
        Summary = $summaryPath
        Log = $logPath
        TestRoot = $testRoot
        KeptArtifacts = [bool]$KeepArtifacts
        FileCount = $result.workspace.file_count
        TotalLines = $result.workspace.total_lines
        Findings = $result.findings
        Cards = $result.cards
    } | Format-List
} finally {
    $env:CODELENS_ACCEPTANCE_WORKSPACE = $previous.Workspace
    $env:CODELENS_ACCEPTANCE_OUTPUT = $previous.Output
    $env:CODELENS_TEST_ROOT = $previous.Root
    $env:CODELENS_ACCEPTANCE_KEEP = $previous.Keep
}
