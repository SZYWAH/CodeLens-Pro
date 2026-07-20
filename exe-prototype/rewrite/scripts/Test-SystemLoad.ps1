param(
    [double]$MaxCpuPercent = 60,
    [double]$MinFreeMemoryGB = 4,
    [int]$Samples = 3,
    [int]$SampleIntervalSeconds = 1
)

$ErrorActionPreference = "Stop"

$counter = Get-Counter "\Processor(_Total)\% Processor Time" -SampleInterval $SampleIntervalSeconds -MaxSamples $Samples
$cpu = ($counter.CounterSamples.CookedValue | Measure-Object -Average).Average
$memorySource = "performance-counter"
try {
    $memoryCounter = Get-Counter "\Memory\Available MBytes" -MaxSamples 1
    $availableMemoryMb = ($memoryCounter.CounterSamples.CookedValue | Measure-Object -Average).Average
    if ($null -eq $availableMemoryMb -or [double]::IsNaN([double]$availableMemoryMb)) {
        throw "The available-memory performance counter returned no usable value."
    }
    $freeMemoryGb = [math]::Round($availableMemoryMb / 1KB, 2)
} catch {
    $memorySource = "wmi-fallback"
    $os = Get-CimInstance Win32_OperatingSystem
    $freeMemoryGb = [math]::Round(($os.FreePhysicalMemory * 1KB) / 1GB, 2)
}
$cpuRounded = [math]::Round($cpu, 1)
$ready = ($cpuRounded -le $MaxCpuPercent) -and ($freeMemoryGb -ge $MinFreeMemoryGB)

[pscustomobject]@{
    Ready = $ready
    CpuPercent = $cpuRounded
    MaxCpuPercent = $MaxCpuPercent
    FreeMemoryGB = $freeMemoryGb
    MemorySource = $memorySource
    MinFreeMemoryGB = $MinFreeMemoryGB
} | Format-List

if (-not $ready) {
    Write-Host "Build postponed: system load is above the configured threshold." -ForegroundColor Yellow
    exit 2
}

exit 0
