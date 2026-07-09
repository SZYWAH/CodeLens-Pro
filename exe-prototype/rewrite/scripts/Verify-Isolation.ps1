$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\..\..")
$ProtectedPaths = @("backend", "frontend", "vscode-extension")

Push-Location $ProjectRoot
try {
    $changed = git diff --name-only -- $ProtectedPaths
    $staged = git diff --cached --name-only -- $ProtectedPaths

    if ($changed -or $staged) {
        Write-Host "Protected project directories have tracked modifications:" -ForegroundColor Red
        @($changed + $staged) | Where-Object { $_ } | Sort-Object -Unique
        exit 1
    }

    Write-Host "Isolation check passed: no tracked modifications under backend/frontend/vscode-extension." -ForegroundColor Green
    git status --short -- exe-prototype/rewrite exe-prototype/outputs/codelens-next
} finally {
    Pop-Location
}
