param(
    [string]$OutputDirectory = "..\desktop\src-tauri\resources"
)

$ErrorActionPreference = "Stop"
$backendRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputRoot = [IO.Path]::GetFullPath((Join-Path $backendRoot $OutputDirectory))
$buildRoot = Join-Path $backendRoot "build"

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
& (Join-Path $backendRoot ".venv\Scripts\python.exe") -m pip install -r (Join-Path $backendRoot "requirements-build.txt")
& (Join-Path $backendRoot ".venv\Scripts\python.exe") -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --name moonie-backend `
    --collect-all aiosqlite `
    --hidden-import greenlet `
    --paths $backendRoot `
    --distpath $outputRoot `
    --workpath (Join-Path $buildRoot "pyinstaller") `
    --specpath $buildRoot `
    (Join-Path $backendRoot "launcher.py")

Write-Host "Built packaged backend: $(Join-Path $outputRoot 'moonie-backend.exe')"
