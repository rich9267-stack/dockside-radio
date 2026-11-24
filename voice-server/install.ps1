# Dockside Radio voice server - one-time setup for Windows.
# Started by INSTALL.bat. Safe to run again: it skips anything already done.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Yellow }

try {
    Write-Host "Dockside Radio voice server setup" -ForegroundColor Cyan
    Write-Host "Folder: $here"

    # 1. uv: a small tool that downloads and runs the right Python for us
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        Step "Installing uv (it runs Python for the voice server)"
        Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
        $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    } else {
        Step "uv is already installed"
    }
    uv --version

    # 2. The Kokoro voice files (about 350 MB, downloaded once)
    $base = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
    $files = @{ "voices-v1.0.bin" = 28000000; "kokoro-v1.0.onnx" = 325000000 }
    foreach ($f in $files.Keys) {
        if ((Test-Path $f) -and ((Get-Item $f).Length -ge $files[$f])) {
            Step "$f is already downloaded"
        } else {
            Step "Downloading $f (this can take a few minutes)"
            curl.exe -L --fail --retry 3 -o $f "$base/$f"
            if ($LASTEXITCODE -ne 0) { throw "Download of $f failed. Check the internet connection and run INSTALL.bat again." }
        }
    }

    # 3. Install the Python pieces now, so the first start is quick
    Step "Installing the voice engine (first time takes a minute or two)"
    uv run --script server.py --setup-only
    if ($LASTEXITCODE -ne 0) { throw "The voice engine didn't install. Send Claude a photo of this window." }

    # 4. Start automatically when you sign in to Windows
    Step "Making the voice server start with Windows"
    $startup = [Environment]::GetFolderPath("Startup")
    $lnk = Join-Path $startup "Dockside Voice Server.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath = Join-Path $here "start-voice.bat"
    $sc.WorkingDirectory = $here
    $sc.WindowStyle = 7   # start minimized
    $sc.Description = "Dockside Radio voice server"
    $sc.Save()
    Write-Host "Added to Startup: $lnk"

    Step "Setup finished. Starting the voice server now."
    Write-Host "If Windows asks whether to allow Python on networks, tick PRIVATE networks and click Allow." -ForegroundColor Cyan
    Start-Process -FilePath (Join-Path $here "start-voice.bat") -WorkingDirectory $here
    Write-Host ""
    Write-Host "All done. You can close this window." -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "SETUP STOPPED: $($_.Exception.Message)" -ForegroundColor Red
}
Read-Host "Press Enter to close"
