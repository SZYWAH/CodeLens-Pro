param()

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RewriteRoot = Resolve-Path (Join-Path $ScriptDir "..")
$StylesPath = Join-Path $RewriteRoot "web\src\styles.css"
$ComponentsRoot = Join-Path $RewriteRoot "web\src\components"
$styles = [System.IO.File]::ReadAllText($StylesPath)
$businessMarker = $styles.IndexOf("/* V12:")

if ($businessMarker -lt 0) {
    throw "The V12 business-style marker was not found."
}

$businessStyles = $styles.Substring($businessMarker)
$smallText = [regex]::Matches($businessStyles, 'font-size\s*:\s*(?<size>\d+(?:\.\d+)?)px') |
    Where-Object { [double]$_.Groups['size'].Value -gt 0 -and [double]$_.Groups['size'].Value -lt 11 }
if ($smallText.Count -gt 0) {
    $values = $smallText | Select-Object -First 12 | ForEach-Object { $_.Value }
    throw "Business CSS contains text below 11px: $($values -join ', ')"
}

if ($businessStyles -match '(?m)\bzoom\s*:') {
    throw "Business CSS must not use zoom for layout compensation."
}
if ($businessStyles -match '(?m)transform\s*:\s*scale\(') {
    throw "Business CSS must not use transform: scale() for layout compensation."
}

$requiredTokens = @(
    '--ui-text: 13px',
    '--ui-reading: 14px',
    '--ui-control-text: 12px',
    '--ui-meta: 11px',
    '--ui-control-height: 34px',
    '--ui-index-width: 216px'
)
foreach ($token in $requiredTokens) {
    if (-not $styles.Contains($token)) {
        throw "Required V14.1 scale token is missing: $token"
    }
}

$toolbarComponents = @(
    'AgentWorkspaceView.tsx',
    'AiChatView.tsx',
    'CodeMapView.tsx',
    'CodeWorkbenchView.tsx',
    'DailyLearningCenterView.tsx',
    'FindingsView.tsx',
    'HealthStatusView.tsx',
    'LearningCardsView.tsx',
    'ProjectGuideView.tsx',
    'SettingsView.tsx'
)
foreach ($component in $toolbarComponents) {
    $source = [System.IO.File]::ReadAllText((Join-Path $ComponentsRoot $component))
    if (-not $source.Contains('<ProductToolbar>')) {
        throw "$component is not connected to the ProductShell toolbar."
    }
}

$diffSource = [System.IO.File]::ReadAllText((Join-Path $ComponentsRoot 'CodeDiffView.tsx'))
if (-not $diffSource.Contains('<WorkbenchCommandBar')) {
    throw 'CodeDiffView is not connected to the shared workbench command bar.'
}
if ($diffSource.Contains('<ProductToolbar>')) {
    throw 'CodeDiffView must not inject mode-specific controls into ProductShell.'
}

$formalSources = Get-ChildItem $ComponentsRoot -Filter '*.tsx' -File |
    Where-Object { $_.Name -notin @('ActivityGalaxyCanvas.tsx', 'ActivityGalaxyView.tsx') }
foreach ($sourceFile in $formalSources) {
    $source = [System.IO.File]::ReadAllText($sourceFile.FullName)
    if ($source -match 'className="[^"]*(?:command-v13\d|agent-command-v140)') {
        throw "Legacy page command bar is still rendered by $($sourceFile.Name)."
    }
}

[pscustomobject]@{
    Passed = $true
    MinimumBusinessTextPx = 11
    ToolbarComponents = $toolbarComponents.Count
    UsesZoomCompensation = $false
    UsesScaleCompensation = $false
} | Format-List
