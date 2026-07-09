param(
    [int]$Port = 1421,
    [string]$OutputDir = "",
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
$ScreenshotPath = Join-Path $OutputDir "frontend-visual-smoke.png"

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

$activityGalaxyText = New-TextFromCodepoints @(0x6d3b, 0x52a8, 0x661f, 0x56fe)
$agentWorkspaceText = "Agent " + (New-TextFromCodepoints @(0x5de5, 0x4f5c, 0x533a))
$knowledgeCardsText = New-TextFromCodepoints @(0x77e5, 0x8bc6, 0x5361, 0x7247)
$localProductText = New-TextFromCodepoints @(0x672c, 0x5730, 0x684c, 0x9762, 0x5de5, 0x5177)
$traceabilityText = New-TextFromCodepoints @(0x5173, 0x8054, 0x6d1e, 0x5bdf)
$mainlineAlignmentText = New-TextFromCodepoints @(0x4eca, 0x65e5, 0x5de5, 0x4f5c, 0x4e3b, 0x7ebf)
$localLongTermText = New-TextFromCodepoints @(0x4ece, 0x6700, 0x8fd1, 0x5de5, 0x4f5c, 0x7ee7, 0x7eed, 0x63a8, 0x8fdb, 0x9879, 0x76ee, 0x5ba1, 0x67e5)
$codeSnippetText = New-TextFromCodepoints @(0x4ee3, 0x7801, 0x7247, 0x6bb5)
$emptyReportText = New-TextFromCodepoints @(0x62a5, 0x544a, 0x6b63, 0x6587, 0x4e3a, 0x7a7a)
Assert-SourceText -Needles @($activityGalaxyText, $agentWorkspaceText, $knowledgeCardsText, $localProductText, $traceabilityText, $mainlineAlignmentText, $localLongTermText, $codeSnippetText, $emptyReportText)
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
        "--user-data-dir=$BrowserUserDataDir",
        "--window-size=1440,1000"
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
    if ($screenshot.Length -lt 20KB) {
        throw "Frontend visual smoke screenshot is unexpectedly small: $([math]::Round($screenshot.Length / 1KB, 2)) KB"
    }

    [pscustomobject]@{
        Passed = $true
        Url = $url
        Browser = $browser
        ScreenshotCaptured = $true
        Screenshot = $ScreenshotPath
        ScreenshotKB = [math]::Round($screenshot.Length / 1KB, 2)
    } | Format-List
} finally {
    if ($pushed) {
        Pop-Location -ErrorAction SilentlyContinue
    }
    if ($previewProcess) {
        Stop-ProcessTree -TargetProcessId $previewProcess.Id
    }
}
