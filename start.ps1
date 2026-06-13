$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendLog = Join-Path $Root "logs\backend.log"
$FrontendLog = Join-Path $Root "logs\frontend.log"
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$VenvPip = Join-Path $Root ".venv\Scripts\pip.exe"

New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null

if (-not (Test-Path (Join-Path $Root ".env"))) {
    Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
    Write-Host "Created .env from .env.example. Fill in your MySQL password and DeepSeek API key if needed."
}

$mysqlService = Get-Service -Name "MySQL80" -ErrorAction SilentlyContinue
if (-not $mysqlService) {
    Write-Host "MySQL80 service was not found. Please install/start local MySQL or update DATABASE_URL in .env."
} elseif ($mysqlService.Status -ne "Running") {
    Write-Host "Starting MySQL80..."
    Start-Service -Name "MySQL80"
}

if (-not (Test-Path $VenvPython)) {
    Write-Host "Creating Python virtual environment..."
    python -m venv (Join-Path $Root ".venv")
}

Write-Host "Installing backend dependencies..."
& $VenvPip install -r (Join-Path $Root "requirements.txt")

if (-not (Test-Path (Join-Path $Root "frontend\node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    Push-Location (Join-Path $Root "frontend")
    npm install
    Pop-Location
}

Write-Host "Starting backend on http://127.0.0.1:8000"
Start-Process -WindowStyle Hidden -FilePath "powershell" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    "cd '$Root'; & '$VenvPython' -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 *> '$BackendLog'"
)

Write-Host "Starting frontend on http://127.0.0.1:5173"
Start-Process -WindowStyle Hidden -FilePath "powershell" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    "cd '$Root\frontend'; npm run dev -- --host 127.0.0.1 *> '$FrontendLog'"
)

Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:5173"
Write-Host "CodeLens Pro is starting. Logs: logs\backend.log and logs\frontend.log"
