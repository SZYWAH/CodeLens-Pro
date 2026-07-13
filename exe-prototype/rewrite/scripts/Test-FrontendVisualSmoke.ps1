param(
    [int]$Port = 1421,
    [string]$OutputDir = "",
    [int]$ViewportWidth = 1440,
    [int]$ViewportHeight = 1000,
    [string]$ScreenshotName = "frontend-visual-smoke.png",
    [switch]$SkipBuild,
    [switch]$AllowNoScreenshot
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RewriteRoot = Resolve-Path (Join-Path $ScriptDir "..")
$PrototypeRoot = Resolve-Path (Join-Path $RewriteRoot "..")
$WebRoot = Join-Path $RewriteRoot "web"
$DistRoot = Join-Path $WebRoot "dist"
if (-not $OutputDir) {
    $OutputDir = Join-Path $PrototypeRoot "outputs\codelens-next"
}
$ScreenshotPath = Join-Path $OutputDir $ScreenshotName

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

function New-TextFromCodepoints {
    param([Parameter(Mandatory = $true)][int[]]$Codepoints)
    return [string]::Concat([char[]]$Codepoints)
}

function Find-Browser {
    $candidates = @(
        (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    foreach ($command in @("msedge", "chrome", "chrome.exe")) {
        $resolved = Get-Command $command -ErrorAction SilentlyContinue
        if ($resolved) {
            return $resolved.Source
        }
    }

    throw "No Edge or Chrome executable was found for the visual smoke test."
}

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$TargetProcessId)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $TargetProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -TargetProcessId $child.ProcessId
    }

    $process = Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $TargetProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Wait-HttpReady {
    param([Parameter(Mandatory = $true)][string]$Url)

    for ($index = 0; $index -lt 45; $index += 1) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "Vite preview did not become ready: $Url"
}

function Invoke-BrowserScreenshot {
    param(
        [Parameter(Mandatory = $true)][string]$BrowserPath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$ScreenshotFile,
        [int]$TimeoutSeconds = 28
    )

    $browserProcess = Start-Process -FilePath $BrowserPath -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    try {
        Wait-Process -Id $browserProcess.Id -Timeout $TimeoutSeconds -ErrorAction Stop
    } catch {
        if (Get-Process -Id $browserProcess.Id -ErrorAction SilentlyContinue) {
            Stop-ProcessTree -TargetProcessId $browserProcess.Id
            return $false
        }
    }

    return (Test-Path $ScreenshotFile)
}

function Test-ScreenshotHasVisiblePixels {
    param([Parameter(Mandatory = $true)][string]$Path)

    Add-Type -AssemblyName System.Drawing
    $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
    try {
        $stepX = [Math]::Max(1, [Math]::Floor($bitmap.Width / 160))
        $stepY = [Math]::Max(1, [Math]::Floor($bitmap.Height / 120))
        $visibleSamples = 0
        $totalSamples = 0
        $dockNearWhitePixels = 0
        $dockMilkyPixels = 0
        $dockChromaticPixels = 0
        $dockClearProfilePixels = 0
        $dockStageRows = 0
        $dockSandwichProfiles = 0
        $dockSandwichRows = 0
        $dockContinuousHighlightColumns = 0
        $dockCentralHighlightGroups = 0

        for ($y = 0; $y -lt $bitmap.Height; $y += $stepY) {
            for ($x = 0; $x -lt $bitmap.Width; $x += $stepX) {
                $pixel = $bitmap.GetPixel($x, $y)
                $totalSamples += 1
                if ($pixel.A -gt 0 -and (($pixel.R + $pixel.G + $pixel.B) -gt 30)) {
                    $visibleSamples += 1
                }
            }
        }

        $dockTop = [Math]::Floor($bitmap.Height * 0.52)
        $dockBottom = [Math]::Floor($bitmap.Height * 0.94)
        $dockLeft = [Math]::Floor($bitmap.Width * 0.05)
        $dockRight = [Math]::Floor($bitmap.Width * 0.95)
        $dockWidth = $dockRight - $dockLeft
        $dockHeight = $dockBottom - $dockTop
        $brightMask = New-Object bool[] ($dockWidth * $dockHeight)
        $dockArtifactComponents = 0
        $lockRect = New-Object System.Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)
        $bitmapData = $bitmap.LockBits(
            $lockRect,
            [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
            [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
        )
        try {
            $stride = [Math]::Abs($bitmapData.Stride)
            $bytes = New-Object byte[] ($stride * $bitmap.Height)
            [System.Runtime.InteropServices.Marshal]::Copy($bitmapData.Scan0, $bytes, 0, $bytes.Length)
            for ($y = $dockTop; $y -lt $dockBottom; $y += 1) {
                $row = if ($bitmapData.Stride -ge 0) { $y * $stride } else { ($bitmap.Height - 1 - $y) * $stride }
                $rowChromaticPixels = 0
                for ($x = $dockLeft; $x -lt $dockRight; $x += 1) {
                    $offset = $row + ($x * 4)
                    $blue = $bytes[$offset]
                    $green = $bytes[$offset + 1]
                    $red = $bytes[$offset + 2]
                    $maximum = [Math]::Max($red, [Math]::Max($green, $blue))
                    $minimum = [Math]::Min($red, [Math]::Min($green, $blue))
                    $average = ($red + $green + $blue) / 3
                    if ($average -ge 38 -and $average -le 180 -and ($maximum - $minimum) -le 5) {
                        $dockMilkyPixels += 1
                    }
                    if ($average -ge 18 -and ($maximum - $minimum) -ge 8) {
                        $dockChromaticPixels += 1
                        $rowChromaticPixels += 1
                    }
                    if ($average -ge 12 -and $average -le 190 -and ($maximum - $minimum) -le 34) {
                        $dockClearProfilePixels += 1
                    }
                    if ($red -ge 238 -and $green -ge 238 -and $blue -ge 238) {
                        $dockNearWhitePixels += 1
                        $maskIndex = (($y - $dockTop) * $dockWidth) + ($x - $dockLeft)
                        $brightMask[$maskIndex] = $true
                    }
                }
                if ($rowChromaticPixels -gt ($dockWidth * 0.35)) {
                    $dockStageRows += 1
                }
            }

            $profileLeft = [Math]::Floor($bitmap.Width * 0.38)
            $profileRight = [Math]::Floor($bitmap.Width * 0.62)
            $profileTop = [Math]::Floor($bitmap.Height * 0.72)
            $profileBottom = [Math]::Floor($bitmap.Height * 0.94)
            $profileHeight = $profileBottom - $profileTop
            $centralLinePositions = New-Object 'System.Collections.Generic.List[int]'
            for ($x = $profileLeft; $x -lt $profileRight; $x += 1) {
                $continuousHighlightPixels = 0
                $centralLinePixels = 0
                for ($y = $profileTop; $y -lt $profileBottom; $y += 1) {
                    $row = if ($bitmapData.Stride -ge 0) { $y * $stride } else { ($bitmap.Height - 1 - $y) * $stride }
                    $offset = $row + ($x * 4)
                    $blue = $bytes[$offset]
                    $green = $bytes[$offset + 1]
                    $red = $bytes[$offset + 2]
                    $maximum = [Math]::Max($red, [Math]::Max($green, $blue))
                    $minimum = [Math]::Min($red, [Math]::Min($green, $blue))
                    $average = ($red + $green + $blue) / 3
                    if ($average -ge 34 -and ($maximum - $minimum) -lt 18) {
                        $continuousHighlightPixels += 1
                    }
                    if ($x -ge ($profileLeft + 4) -and $x -lt ($profileRight - 4) -and $average -ge 90 -and ($maximum - $minimum) -le 6) {
                        $leftOffset = $row + (($x - 4) * 4)
                        $rightOffset = $row + (($x + 4) * 4)
                        $leftAverage = ($bytes[$leftOffset] + $bytes[$leftOffset + 1] + $bytes[$leftOffset + 2]) / 3
                        $rightAverage = ($bytes[$rightOffset] + $bytes[$rightOffset + 1] + $bytes[$rightOffset + 2]) / 3
                        $sideDifference = [Math]::Abs($leftAverage - $rightAverage)
                        if ($leftAverage -ge 18 -and $rightAverage -ge 18 -and $sideDifference -le 6 -and $average -ge ([Math]::Max($leftAverage, $rightAverage) + 18)) {
                            $centralLinePixels += 1
                        }
                    }
                }
                if ($continuousHighlightPixels -gt ($profileHeight * 0.20)) {
                    $dockContinuousHighlightColumns += 1
                }
                if ($centralLinePixels -gt ($profileHeight * 0.18)) {
                    $centralLinePositions.Add($x)
                }
            }
            if ($centralLinePositions.Count -gt 0) {
                $clusterStart = 0
                for ($positionIndex = 1; $positionIndex -le $centralLinePositions.Count; $positionIndex += 1) {
                    $clusterEnded = $positionIndex -eq $centralLinePositions.Count
                    if (-not $clusterEnded) {
                        $clusterEnded = ($centralLinePositions[$positionIndex] - $centralLinePositions[$positionIndex - 1]) -gt 2
                    }
                    if (-not $clusterEnded) {
                        continue
                    }
                    $dockCentralHighlightGroups += 1
                    $clusterStart = $positionIndex
                }
            }
            for ($y = $profileTop; $y -lt $profileBottom; $y += 1) {
                $row = if ($bitmapData.Stride -ge 0) { $y * $stride } else { ($bitmap.Height - 1 - $y) * $stride }
                $rowHasSandwich = $false
                for ($x = $profileLeft + 5; $x -lt $profileRight - 5; $x += 1) {
                    $centerOffset = $row + ($x * 4)
                    $centerLuminance = ($bytes[$centerOffset] + $bytes[$centerOffset + 1] + $bytes[$centerOffset + 2]) / 3
                    $leftPeak = 0
                    $rightPeak = 0
                    for ($distance = 2; $distance -le 5; $distance += 1) {
                        $leftOffset = $row + (($x - $distance) * 4)
                        $rightOffset = $row + (($x + $distance) * 4)
                        $leftLuminance = ($bytes[$leftOffset] + $bytes[$leftOffset + 1] + $bytes[$leftOffset + 2]) / 3
                        $rightLuminance = ($bytes[$rightOffset] + $bytes[$rightOffset + 1] + $bytes[$rightOffset + 2]) / 3
                        $leftPeak = [Math]::Max($leftPeak, $leftLuminance)
                        $rightPeak = [Math]::Max($rightPeak, $rightLuminance)
                    }
                    $pairedPeak = [Math]::Min($leftPeak, $rightPeak)
                    if ($pairedPeak -ge 24 -and $centerLuminance -le [Math]::Max(8, $pairedPeak * 0.48)) {
                        $dockSandwichProfiles += 1
                        $rowHasSandwich = $true
                    }
                }
                if ($rowHasSandwich) {
                    $dockSandwichRows += 1
                }
            }
        } finally {
            $bitmap.UnlockBits($bitmapData)
        }

        $visited = New-Object bool[] $brightMask.Length
        $queue = New-Object 'System.Collections.Generic.Queue[int]'
        for ($index = 0; $index -lt $brightMask.Length; $index += 1) {
            if (-not $brightMask[$index] -or $visited[$index]) {
                continue
            }

            $queue.Clear()
            $queue.Enqueue($index)
            $visited[$index] = $true
            $componentPixels = 0
            $minX = $dockWidth
            $maxX = 0
            $minY = $dockHeight
            $maxY = 0

            while ($queue.Count -gt 0) {
                $current = $queue.Dequeue()
                $localY = [Math]::Floor($current / $dockWidth)
                $localX = $current - ($localY * $dockWidth)
                $componentPixels += 1
                $minX = [Math]::Min($minX, $localX)
                $maxX = [Math]::Max($maxX, $localX)
                $minY = [Math]::Min($minY, $localY)
                $maxY = [Math]::Max($maxY, $localY)

                $neighbors = @()
                if ($localX -gt 0) { $neighbors += ($current - 1) }
                if ($localX -lt ($dockWidth - 1)) { $neighbors += ($current + 1) }
                if ($localY -gt 0) { $neighbors += ($current - $dockWidth) }
                if ($localY -lt ($dockHeight - 1)) { $neighbors += ($current + $dockWidth) }
                foreach ($neighbor in $neighbors) {
                    if ($brightMask[$neighbor] -and -not $visited[$neighbor]) {
                        $visited[$neighbor] = $true
                        $queue.Enqueue($neighbor)
                    }
                }
            }

            $componentWidth = $maxX - $minX + 1
            $componentHeight = $maxY - $minY + 1
            $isIsolated = $componentPixels -le 3
            $isSinglePixelLine = ($componentWidth -le 1 -and $componentHeight -ge 4) -or ($componentHeight -le 1 -and $componentWidth -ge 4)
            if ($isIsolated -or $isSinglePixelLine) {
                $dockArtifactComponents += 1
            }
        }

        $milkyPixelRatio = if ($bitmap.Width -le 480) { 0.032 } else { 0.011 }
        $maximumMilkyPixels = [Math]::Max(220, [Math]::Floor($dockWidth * $dockHeight * $milkyPixelRatio))
        $maximumNearWhitePixels = [Math]::Max(16, [Math]::Floor($dockWidth * $dockHeight * 0.001))
        $maximumContinuousHighlightColumns = [Math]::Max(48, [Math]::Floor($bitmap.Width * 0.085))
        [pscustomobject]@{
            Passed = ($bitmap.Width -ge 320 -and $bitmap.Height -ge 320 -and $visibleSamples -ge 20 -and $dockArtifactComponents -eq 0 -and $dockMilkyPixels -le $maximumMilkyPixels -and $dockClearProfilePixels -ge 30 -and $dockStageRows -eq 0 -and $dockNearWhitePixels -le $maximumNearWhitePixels -and $dockContinuousHighlightColumns -le $maximumContinuousHighlightColumns -and $dockCentralHighlightGroups -eq 0)
            Width = $bitmap.Width
            Height = $bitmap.Height
            VisibleSamples = $visibleSamples
            TotalSamples = $totalSamples
            DockNearWhitePixels = $dockNearWhitePixels
            DockMaxNearWhitePixels = $maximumNearWhitePixels
            DockArtifactComponents = $dockArtifactComponents
            DockMilkyPixels = $dockMilkyPixels
            DockChromaticPixels = $dockChromaticPixels
            DockClearProfilePixels = $dockClearProfilePixels
            DockStageRows = $dockStageRows
            DockContinuousHighlightColumns = $dockContinuousHighlightColumns
            DockMaxContinuousHighlightColumns = $maximumContinuousHighlightColumns
            DockCentralHighlightGroups = $dockCentralHighlightGroups
            DockSandwichProfiles = $dockSandwichProfiles
            DockSandwichRows = $dockSandwichRows
        }
    } finally {
        $bitmap.Dispose()
    }
}

function Assert-BundleText {
    param([Parameter(Mandatory = $true)][string[]]$Needles)

    $asset = Get-ChildItem -Path (Join-Path $DistRoot "assets") -Filter "index-*.js" | Sort-Object Length -Descending | Select-Object -First 1
    if (-not $asset) {
        throw "Built frontend JS asset was not found."
    }

    $content = Get-Content $asset.FullName -Raw
    foreach ($needle in $Needles) {
        if (-not $content.Contains($needle)) {
            throw "Built frontend bundle does not contain expected text: $needle"
        }
    }
}

function Assert-SourceText {
    param([Parameter(Mandatory = $true)][string[]]$Needles)

    $files = Get-ChildItem -Path (Join-Path $WebRoot "src") -Recurse -Include "*.ts", "*.tsx", "*.css"
    foreach ($needle in $Needles) {
        $found = $false
        foreach ($file in $files) {
            $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
            if ($content.Contains($needle)) {
                $found = $true
                break
            }
        }
        if (-not $found) {
            throw "Frontend source does not contain expected text: $needle"
        }
    }
}

function Assert-ShowcaseSourceDoesNotContain {
    param([Parameter(Mandatory = $true)][string[]]$Needles)

    $showcaseFile = Join-Path $WebRoot "src\components\ActivityGalaxyCanvas.tsx"
    $content = [System.IO.File]::ReadAllText($showcaseFile, [System.Text.Encoding]::UTF8)
    foreach ($needle in $Needles) {
        if ($content.Contains($needle)) {
            throw "Showcase source still contains retired V15/V16 implementation text: $needle"
        }
    }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (-not $SkipBuild) {
    Push-Location $WebRoot
    try {
        Invoke-CheckedCommand -FilePath npm -Arguments @("run", "build")
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $DistRoot "index.html"))) {
    throw "Frontend dist was not found. Run npm run build first."
}

$activityShowcaseText = New-TextFromCodepoints @(0x6d3b, 0x52a8, 0x5c55, 0x793a, 0x53f0)
$actionDraftText = New-TextFromCodepoints @(0x884c, 0x52a8, 0x8349, 0x7a3f)
$knowledgeCardsText = New-TextFromCodepoints @(0x77e5, 0x8bc6, 0x5361, 0x7247)
$reviewWorkbenchText = New-TextFromCodepoints @(0x5ba1, 0x67e5, 0x5de5, 0x4f5c, 0x53f0)
$traceabilityText = New-TextFromCodepoints @(0x5173, 0x8054, 0x6d1e, 0x5bdf)
$codeSnippetText = New-TextFromCodepoints @(0x4ee3, 0x7801, 0x7247, 0x6bb5)
$emptyReportText = New-TextFromCodepoints @(0x62a5, 0x544a, 0x6b63, 0x6587, 0x4e3a, 0x7a7a)
Assert-SourceText -Needles @($activityShowcaseText, $actionDraftText, $knowledgeCardsText, $reviewWorkbenchText, $traceabilityText, $codeSnippetText, $emptyReportText)
Assert-ShowcaseSourceDoesNotContain -Needles @(
    "createHiddenOpticsMaterial",
    "uOpticsGain",
    "createDockSurfaceTexture",
    "cyanRibbon",
    "violetRibbon",
    "amberRibbon",
    "uTime",
    'scene.background = new THREE.Color("#263440")',
    'new THREE.Vector3(-0.45, DOCK_Y + 0.72, 6.0)',
    '"#e7eef5"',
    '"#4fa8c1"',
    '"#8869bd"',
    'scene.background = new THREE.Color("#252c29")',
    "float lowerLift =",
    "environmentTransmissionBlend",
    "pearlSpecular"
)
Assert-SourceText -Needles @(
    "screen-transmission-crystal",
    "uBackDepth",
    "WebGLRenderTarget",
    "HOVER_SCALE_X_GAIN = 0.22",
    "SELECTED_SCALE_X_GAIN = 0.18",
    'source: "gap"',
    "createStaticBackdropMaterial",
    "verticalAtmosphere",
    "studioColumns",
    "createStudioEnvironment",
    "WebGLCubeRenderTarget",
    "CubeCamera",
    "uEnvironmentMap",
    "centerClearWindow",
    'return "#70a99b"',
    "SPINE_DEPTH = 0.46",
    "SPINE_WIDTH = 0.105",
    "SPINE_YAW = THREE.MathUtils.degToRad(11.5)",
    "studioLobeLeft",
    "studioLobeRight",
    "refractiveStudioSignal",
    "hiddenOpticsColor",
    "hiddenSampleUv",
    "liquidWindowCoordinate",
    "liquidTransmission",
    "HERO_OPEN_DURATION = 290",
    "HERO_CLOSE_DURATION = 220",
    "uHalfExtents",
    "opticalThickness",
    "showcaseHeroPhase",
    "showcaseHeroActionPending",
    "activity-showcase-hero-copy",
    "activity-showcase-hero-action",
    "ArrowUpRight",
    "codelens.shell.expanded",
    "product-shell-entry-transition",
    "product-page-toolbar-next",
    "product-toolbar-actions-next",
    "--ui-reading: 14px",
    "--ui-index-width: 216px",
    "code-workbench-v12",
    "workbench-mode-switch-v12",
    "workbench-mobile-mode-v142",
    "workspace-actions-menu-v142",
    "single-mobile-tabs-v142",
    "single-generation-v142",
    "project-workspace-v132",
    "workspace-index-v132",
    "workspace-scan-drawer-v132",
    "workspaceTraceability",
    "diff-workspace-v133",
    "diff-editor-resizer-v133",
    "codelens.diff.editorSplit",
    "diff-summary-toggle-v133",
    "cards-workspace-v135",
    "cards-index-v135",
    "cards-drawer-v135",
    "cards-toolbar-context-v141",
    "card-source-grid-v141",
    "card-status-actions-v141",
    "card-delete-dialog-v141",
    "findings-toolbar-context-v141",
    "finding-context-grid-v141",
    "finding-disposition-v141",
    "finding-ignore-dialog-v141",
    "logs-workspace-v136",
    "log-reader-v136",
    "log-editor-v136",
    "logs-drawer-v136",
    "chat-workspace-v137",
    "chat-messages-v137",
    "chat-composer-v137",
    "chat-context-drawer-v137",
    "project-understanding-v138",
    "system-workspace-v139",
    "settings-section-v139",
    "health-section-v139",
    "system-drawer-v139",
    "agent-workspace-v140",
    "agent-index-v140",
    "agent-detail-v140",
    "agent-drawer-v140",
    "project-index-v138",
    "map-table-v138",
    "history-switcher-v13",
    "history-switcher-search-v148",
    "history-filter-popover-v148",
    "history-delete-dialog-v148",
    "report-reader-v13",
    "report-reader-v13.is-fullscreen",
    "report-reader-grid-v13",
    "report-outline-popover-v149",
    "report-actions-drawer-v131"
)
Assert-BundleText -Needles @("CodeLens Pro Next")

$browser = Find-Browser
$url = "http://127.0.0.1:$Port"
$BrowserUserDataDir = Join-Path $OutputDir ".visual-smoke-browser"
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
    $npm = Get-Command npm -ErrorAction Stop
}

$previewProcess = $null
$pushed = $false
try {
    Push-Location $WebRoot
    $pushed = $true
    $previewProcess = Start-Process -FilePath $npm.Source -ArgumentList @("run", "preview", "--", "--host", "127.0.0.1", "--port", "$Port") -PassThru -WindowStyle Hidden
    Pop-Location
    $pushed = $false

    Wait-HttpReady -Url $url

    if (Test-Path $ScreenshotPath) {
        Remove-Item -LiteralPath $ScreenshotPath -Force
    }
    if (Test-Path $BrowserUserDataDir) {
        Remove-Item -LiteralPath $BrowserUserDataDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $BrowserUserDataDir | Out-Null

    $browserBaseArgs = @(
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-gpu",
        "--disable-sync",
        "--disable-features=UseSkiaRenderer,Vulkan,WebGPU,DawnGraphite",
        "--hide-scrollbars",
        "--no-default-browser-check",
        "--no-first-run",
        "--run-all-compositor-stages-before-draw",
        "--user-data-dir=$BrowserUserDataDir",
        "--timeout=12000",
        "--virtual-time-budget=8000",
        "--window-size=$ViewportWidth,$ViewportHeight"
    )

    $headlessNewArgs = @("--headless=new") + $browserBaseArgs + @("--screenshot=$ScreenshotPath", $url)
    $captured = Invoke-BrowserScreenshot -BrowserPath $browser -Arguments $headlessNewArgs -ScreenshotFile $ScreenshotPath

    if (-not $captured) {
        $headlessClassicArgs = @("--headless") + $browserBaseArgs + @("--screenshot=$ScreenshotPath", $url)
        $captured = Invoke-BrowserScreenshot -BrowserPath $browser -Arguments $headlessClassicArgs -ScreenshotFile $ScreenshotPath
    }

    if (-not (Test-Path $ScreenshotPath)) {
        if ($AllowNoScreenshot) {
            [pscustomobject]@{
                Passed = $true
                Url = $url
                Browser = $browser
                ScreenshotCaptured = $false
                Screenshot = $ScreenshotPath
                Note = "Headless browser did not create a screenshot on this machine; source and bundle smoke checks passed."
            } | Format-List
            return
        }
        throw "Headless browser did not create a screenshot."
    }

    $screenshot = Get-Item $ScreenshotPath
    $pixelCheck = Test-ScreenshotHasVisiblePixels -Path $ScreenshotPath
    if (-not $pixelCheck.Passed) {
        throw "Frontend visual smoke screenshot failed pixel checks: visible=$($pixelCheck.VisibleSamples)/$($pixelCheck.TotalSamples), dock-near-white=$($pixelCheck.DockNearWhitePixels), dock-artifacts=$($pixelCheck.DockArtifactComponents), dock-milky=$($pixelCheck.DockMilkyPixels), dock-clear=$($pixelCheck.DockClearProfilePixels), dock-stage-rows=$($pixelCheck.DockStageRows), dock-chromatic=$($pixelCheck.DockChromaticPixels), dock-highlight-columns=$($pixelCheck.DockContinuousHighlightColumns)/$($pixelCheck.DockMaxContinuousHighlightColumns), dock-center-lines=$($pixelCheck.DockCentralHighlightGroups), dock-sandwich=$($pixelCheck.DockSandwichProfiles), $($pixelCheck.Width)x$($pixelCheck.Height), $([math]::Round($screenshot.Length / 1KB, 2)) KB"
    }

    [pscustomobject]@{
        Passed = $true
        Url = $url
        Browser = $browser
        ScreenshotCaptured = $true
        Screenshot = $ScreenshotPath
        ScreenshotKB = [math]::Round($screenshot.Length / 1KB, 2)
        ScreenshotPixels = "$($pixelCheck.Width)x$($pixelCheck.Height)"
        VisibleSamples = $pixelCheck.VisibleSamples
        DockNearWhitePixels = $pixelCheck.DockNearWhitePixels
        DockMaxNearWhitePixels = $pixelCheck.DockMaxNearWhitePixels
        DockArtifactComponents = $pixelCheck.DockArtifactComponents
        DockMilkyPixels = $pixelCheck.DockMilkyPixels
        DockChromaticPixels = $pixelCheck.DockChromaticPixels
        DockClearProfilePixels = $pixelCheck.DockClearProfilePixels
        DockStageRows = $pixelCheck.DockStageRows
        DockContinuousHighlightColumns = $pixelCheck.DockContinuousHighlightColumns
        DockMaxContinuousHighlightColumns = $pixelCheck.DockMaxContinuousHighlightColumns
        DockCentralHighlightGroups = $pixelCheck.DockCentralHighlightGroups
        DockSandwichProfiles = $pixelCheck.DockSandwichProfiles
        DockSandwichRows = $pixelCheck.DockSandwichRows
    } | Format-List
} finally {
    if ($pushed) {
        Pop-Location -ErrorAction SilentlyContinue
    }
    if ($previewProcess) {
        Stop-ProcessTree -TargetProcessId $previewProcess.Id
    }
}
