param(
    [double]$MaxCpuPercent = 60,
    [double]$MinFreeMemoryGB = 4,
    [int]$Samples = 3,
    [int]$SampleIntervalSeconds = 1
)

$ErrorActionPreference = "Stop"

$counter = Get-Counter "\Processor(_Total)\% Processor Time" -SampleInterval $SampleIntervalSeconds -MaxSamples $Samples
$cpu = ($counter.CounterSamples.CookedValue | Measure-Object -Average).Average
$os = Get-CimInstance Win32_OperatingSystem
$freeMemoryGb = [math]::Round(($os.FreePhysicalMemory * 1KB) / 1GB, 2)
$cpuRounded = [math]::Round($cpu, 1)
$ready = ($cpuRounded -le $MaxCpuPercent) -and ($freeMemoryGb -ge $MinFreeMemoryGB)

[pscustomobject]@{
    Ready = $ready
    CpuPercent = $cpuRounded
    MaxCpuPercent = $MaxCpuPercent
    FreeMemoryGB = $freeMemoryGb
    MinFreeMemoryGB = $MinFreeMemoryGB
} | Format-List

if (-not $ready) {
    Write-Host "Build postponed: system load is above the configured threshold." -ForegroundColor Yellow
    exit 2
}

exit 0
