param (
    [switch]$Uninstall,
    [switch]$NoTunnel,
    [string]$Server = "https://otter.gpt.io.vn",
    [string]$Repo = "ptn1411/Otter",
    [string]$Version = "latest"
)

# ==============================================================================
# Otter Background Agent - Windows 1-Click Installer
# Cai dat tu dong bang 1 dong lenh duy nhat trong PowerShell:
# irm https://otter.gpt.io.vn/setup.ps1 | iex
#
# Hoac chay cuc bo:
# .\setup.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Thiet lap ma hoa UTF-8 cho Console Output (chong loi phong tieng Viet tren Windows PowerShell)
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    if ($host.Name -eq "ConsoleHost") {
        chcp 65001 | Out-Null
    }
} catch {}

$InstallDir = "$env:LOCALAPPDATA\Otter"
$StartupFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$ShortcutPath = "$StartupFolder\Otter.lnk"
$DesktopFolder = [Environment]::GetFolderPath("Desktop")
if (-not $DesktopFolder) { $DesktopFolder = "$env:USERPROFILE\Desktop" }
$DesktopShortcutPath = "$DesktopFolder\Otter.lnk"
$ExePath = "$InstallDir\otter.exe"
$VbsPath = "$InstallDir\run_silent.vbs"
$ExtZipPath = "$InstallDir\otter-extension.zip"
$ExtDir = "$InstallDir\extension"
$IconPath = "$InstallDir\otter.ico"

# ------------------------------------------------------------------------------
# 1. XU LY GO CAI DAT (UNINSTALL)
# ------------------------------------------------------------------------------
if ($Uninstall) {
    Write-Host "`n[*] Dang dung tien trinh Otter..." -ForegroundColor Yellow
    Get-Process -Name "otter-tray" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -Name "otter" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    Write-Host "[*] Xoa tu khoi dong cung Windows va phim tat Desktop..." -ForegroundColor Yellow
    if (Test-Path $ShortcutPath) { Remove-Item $ShortcutPath -Force }
    if (Test-Path $DesktopShortcutPath) { Remove-Item $DesktopShortcutPath -Force }

    Write-Host "[*] Xoa Otter khoi bien moi truong PATH..." -ForegroundColor Yellow
    try {
        $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($UserPath) {
            $PathParts = ($UserPath -split ';') | Where-Object { 
                $_ -and $_ -ne $InstallDir -and $_ -ne $BinDir
            }
            $NewUserPath = $PathParts -join ';'
            [Environment]::SetEnvironmentVariable("Path", $NewUserPath, "User")
        }
    } catch {}

    Write-Host "[*] Xoa thu muc cai dat ($InstallDir)..." -ForegroundColor Yellow
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }

    Write-Host "`n[+] DA GO CAI DAT THANH CONG OTTER AGENT!`n" -ForegroundColor Green
    return
}

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "     OTTER AGENT - TU DONG CAI DAT VA CHAY NGAM      " -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# ------------------------------------------------------------------------------
# 2. DUNG TIEN TRINH CU NEU DANG CHAY
# ------------------------------------------------------------------------------
Get-Process -Name "otter-tray" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "otter" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

# ------------------------------------------------------------------------------
# 3. CHUAN BI THU MUC CAI DAT
# ------------------------------------------------------------------------------
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
$BinDir = "$InstallDir\bin"
if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
}
if (-not (Test-Path $StartupFolder)) {
    New-Item -ItemType Directory -Path $StartupFolder -Force | Out-Null
}

# ------------------------------------------------------------------------------
# 4. TIM HOAC TAI TU DONG FILE BINARY
# ------------------------------------------------------------------------------
$SearchDirs = @()
if ($PSScriptRoot) {
    $SearchDirs += $PSScriptRoot
    $SearchDirs += (Join-Path $PSScriptRoot "..")
    $SearchDirs += (Join-Path $PSScriptRoot "..\deploy")
    $SearchDirs += (Join-Path $PSScriptRoot "..\dist")
}
try {
    $currentPwd = (Get-Location).Path
    if ($currentPwd) {
        $SearchDirs += $currentPwd
        $SearchDirs += (Join-Path $currentPwd "deploy")
        $SearchDirs += (Join-Path $currentPwd "dist")
    }
} catch {}

$LocalCandidates = @()
foreach ($d in $SearchDirs) {
    if ($d -and (Test-Path $d)) {
        $LocalCandidates += (Join-Path $d "otter.exe")
        $LocalCandidates += (Join-Path $d "otter-windows-x64.exe")
    }
}

$FoundLocal = $null
foreach ($path in $LocalCandidates) {
    if (Test-Path $path) {
        $FoundLocal = (Resolve-Path $path).Path
        break
    }
}

if ($FoundLocal) {
    Write-Host "[*] Phat hien bo cai cuc bo: $FoundLocal" -ForegroundColor Yellow
    Copy-Item -Path $FoundLocal -Destination $ExePath -Force
    Copy-Item -Path $FoundLocal -Destination (Join-Path $BinDir "otter.exe") -Force

    # Tim va sao chep thu muc bin di kem neu co
    $FoundDir = Split-Path $FoundLocal
    $BinSearch = @(
        (Join-Path $FoundDir "bin"),
        (Join-Path (Split-Path $FoundDir) "bin"),
        (Join-Path (Split-Path (Split-Path $FoundDir)) "bin")
    )
    foreach ($b in $BinSearch) {
        if (Test-Path "$b\cloudflared.exe") {
            Copy-Item -Path "$b\*" -Destination $BinDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "[+] Da dong bo thu muc bin tu: $b" -ForegroundColor Green
            break
        }
    }

    # Dong bo thu muc tools (skill, cua, vps-ssh, db-manager) neu co
    $ToolsSearch = @(
        (Join-Path $FoundDir "tools"),
        (Join-Path (Split-Path $FoundDir) "tools"),
        (Join-Path $PWD.Path "tools")
    )
    foreach ($t in $ToolsSearch) {
        if (Test-Path $t) {
            $TargetToolsDir = Join-Path $InstallDir "tools"
            if (-not (Test-Path $TargetToolsDir)) {
                New-Item -ItemType Directory -Path $TargetToolsDir -Force | Out-Null
            }
            Copy-Item -Path "$t\*" -Destination $TargetToolsDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "[+] Da dong bo thu muc tools tu: $t" -ForegroundColor Green
            break
        }
    }

    # Sao chep license.json neu co
    $LicSearch = @(
        (Join-Path $FoundDir "license.json"),
        (Join-Path (Split-Path $FoundDir) "data\license.json"),
        (Join-Path (Split-Path $FoundDir) "license.json"),
        (Join-Path $PWD.Path "data\license.json")
    )
    foreach ($l in $LicSearch) {
        if (Test-Path $l) {
            Copy-Item -Path $l -Destination "$InstallDir\license.json" -Force
            Write-Host "[+] Da dong bo ban quyen license.json tu: $l" -ForegroundColor Green
            break
        }
    }

    # Tim va sao chep otter-tray.exe (Native System Tray Rust) neu co
    $TrayCandidates = @(
        (Join-Path $FoundDir "otter-tray.exe"),
        (Join-Path (Split-Path $FoundDir) "otter-tray.exe"),
        (Join-Path (Split-Path $FoundDir) "deploy\otter-tray.exe"),
        (Join-Path (Split-Path $FoundDir) "tray\target\release\otter-tray.exe"),
        (Join-Path $PWD.Path "deploy\otter-tray.exe"),
        (Join-Path $PWD.Path "tray\target\release\otter-tray.exe")
    )
    foreach ($tc in $TrayCandidates) {
        if (Test-Path $tc) {
            Copy-Item -Path $tc -Destination "$InstallDir\otter-tray.exe" -Force
            Copy-Item -Path $tc -Destination (Join-Path $BinDir "otter-tray.exe") -Force
            Write-Host "[+] Da dong bo Otter Native Tray tu: $tc" -ForegroundColor Green
            break
        }
    }

    # Tim va sao chep otter.ico neu co
    $IconCandidates = @(
        (Join-Path $FoundDir "otter.ico"),
        (Join-Path (Split-Path $FoundDir) "otter.ico"),
        (Join-Path (Split-Path $FoundDir) "assets\otter.ico"),
        (Join-Path $PWD.Path "assets\otter.ico"),
        (Join-Path $PWD.Path "deploy\otter.ico")
    )
    foreach ($ic in $IconCandidates) {
        if (Test-Path $ic) {
            Copy-Item -Path $ic -Destination $IconPath -Force
            Write-Host "[+] Da dong bo bieu tuong ung dung otter.ico tu: $ic" -ForegroundColor Green
            break
        }
    }
} else {
    Write-Host "[*] Dang tu dong keo file thuc thi tu $Server..." -ForegroundColor Yellow
    
    $CandidateUrls = @(
        "$Server/otter-windows-x64.exe",
        "$Server/otter.exe"
    )

    $Downloaded = $false
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $hasCurl = $null -ne (Get-Command curl.exe -ErrorAction SilentlyContinue)

    foreach ($url in $CandidateUrls) {
        try {
            Write-Host "    -> Ket noi toi: $url" -ForegroundColor Gray
            if ($hasCurl) {
                & curl.exe -L --fail --connect-timeout 15 --max-time 600 -o $ExePath $url
            } else {
                Invoke-WebRequest -Uri $url -OutFile $ExePath -UseBasicParsing -TimeoutSec 600
            }
            if ((Test-Path $ExePath) -and ((Get-Item $ExePath).Length -gt 10000000)) {
                $Downloaded = $true
                $FileSizeMb = [math]::Round((Get-Item $ExePath).Length / 1MB, 1)
                Write-Host "[+] Tai file thuc thi thanh cong! ($FileSizeMb MB)" -ForegroundColor Green
                break
            }
        } catch {
            Write-Host "    [!] Ket noi URL that bai, dang thu nguon du phong..." -ForegroundColor DarkGray
        }
    }

    if (-not $Downloaded) {
        Write-Host "`n[X] Khong the tu dong tai file tu may chu." -ForegroundColor Red
        Write-Host "    Vui long kiem tra ket noi mang hoac truy cap: $Server de tai thu cong." -ForegroundColor Red
        return
    }

    # Tai Otter Native Tray (Rust) tu server neu chua co
    $TrayExePath = "$InstallDir\otter-tray.exe"
    if (-not (Test-Path $TrayExePath)) {
        try {
            Write-Host "[*] Dang tai Otter Native System Tray..." -ForegroundColor Yellow
            if ($hasCurl) {
                & curl.exe -s -L --fail --max-time 60 -o $TrayExePath "$Server/otter-tray.exe"
            } else {
                Invoke-WebRequest -Uri "$Server/otter-tray.exe" -OutFile $TrayExePath -UseBasicParsing -TimeoutSec 60
            }
            if (Test-Path $TrayExePath) {
                Copy-Item -Path $TrayExePath -Destination (Join-Path $BinDir "otter-tray.exe") -Force -ErrorAction SilentlyContinue
                Write-Host "[+] Tai Otter Native Tray thanh cong!" -ForegroundColor Green
            }
        } catch {}
    }

    # Tai bieu tuong otter.ico tu server neu chua co
    if (-not (Test-Path $IconPath)) {
        try {
            if ($hasCurl) {
                & curl.exe -s -L --fail --max-time 30 -o $IconPath "$Server/otter.ico"
            } else {
                Invoke-WebRequest -Uri "$Server/otter.ico" -OutFile $IconPath -UseBasicParsing -TimeoutSec 30
            }
            if (Test-Path $IconPath) {
                Write-Host "[+] Tai bieu tuong otter.ico thanh cong!" -ForegroundColor Green
            }
        } catch {}
    }
}

# ------------------------------------------------------------------------------
# 4.1 TAI TIEN ICH CHROME EXTENSION DI KEM
# ------------------------------------------------------------------------------
try {
    Write-Host "[*] Dang chuan bi tien ich mo rong Chrome Extension..." -ForegroundColor Yellow
    $ExtLocalCandidates = @()
    if ($FoundLocal) {
        $fDir = Split-Path $FoundLocal
        $ExtLocalCandidates += (Join-Path $fDir "otter-extension.zip")
        $ExtLocalCandidates += (Join-Path (Split-Path $fDir) "otter-extension.zip")
        $ExtLocalCandidates += (Join-Path (Split-Path $fDir) "deploy\otter-extension.zip")
        $ExtLocalCandidates += (Join-Path (Split-Path $fDir) "dist\otter-extension.zip")
        $ExtLocalCandidates += (Join-Path (Split-Path $fDir) "extension\dist")
    }
    if ($PSScriptRoot) {
        $ExtLocalCandidates += (Join-Path $PSScriptRoot "otter-extension.zip")
        $ExtLocalCandidates += (Join-Path $PSScriptRoot "..\extension\dist")
    }

    $FoundExt = $null
    foreach ($e in $ExtLocalCandidates) {
        if ($e -and (Test-Path $e)) {
            $FoundExt = (Resolve-Path $e).Path
            break
        }
    }

    if ($FoundExt) {
        if ((Get-Item $FoundExt).PSIsContainer) {
            if (Test-Path $ExtDir) { Remove-Item $ExtDir -Recurse -Force }
            Copy-Item -Path $FoundExt -Destination $ExtDir -Recurse -Force
        } else {
            Copy-Item -Path $FoundExt -Destination $ExtZipPath -Force
            if (Test-Path $ExtDir) { Remove-Item $ExtDir -Recurse -Force }
            Expand-Archive -Path $ExtZipPath -DestinationPath $ExtDir -Force
        }
        Write-Host "[+] Tien ich Chrome Extension da san sang tai: $ExtDir" -ForegroundColor Green
    } else {
        $hasCurl = $null -ne (Get-Command curl.exe -ErrorAction SilentlyContinue)
        if ($hasCurl) {
            & curl.exe -s -L --fail --max-time 60 -o $ExtZipPath "$Server/otter-extension.zip"
        } else {
            Invoke-WebRequest -Uri "$Server/otter-extension.zip" -OutFile $ExtZipPath -UseBasicParsing -TimeoutSec 60
        }
        if (Test-Path $ExtZipPath) {
            if (Test-Path $ExtDir) { Remove-Item $ExtDir -Recurse -Force }
            Expand-Archive -Path $ExtZipPath -DestinationPath $ExtDir -Force
            Write-Host "[+] Tien ich Chrome Extension da san sang tai: $ExtDir" -ForegroundColor Green
        }
    }
} catch {
    Write-Host "    [!] Tien ich extension se duoc cai sau tu trinh duyet." -ForegroundColor DarkGray
}

# ------------------------------------------------------------------------------
# 4.2 TAI CLOUDFLARED DE TAO QUICK TUNNEL DOMAIN DUNG 1 LAN
# ------------------------------------------------------------------------------
$CloudflaredExe = "$BinDir\cloudflared.exe"
if (-not (Test-Path $CloudflaredExe)) {
    Write-Host "[*] Dang tai cong cu tao domain 1-lan (Cloudflare Quick Tunnel)..." -ForegroundColor Yellow
    $CfCandidates = @(
        "$Server/bin/cloudflared.exe",
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    )
    $hasCurl = $null -ne (Get-Command curl.exe -ErrorAction SilentlyContinue)
    foreach ($cfUrl in $CfCandidates) {
        try {
            Write-Host "    -> Tai cloudflared tu: $cfUrl" -ForegroundColor Gray
            if ($hasCurl) {
                & curl.exe -s -L --fail --max-time 300 -o $CloudflaredExe $cfUrl
            } else {
                Invoke-WebRequest -Uri $cfUrl -OutFile $CloudflaredExe -UseBasicParsing -TimeoutSec 300
            }
            if ((Test-Path $CloudflaredExe) -and ((Get-Item $CloudflaredExe).Length -gt 10000000)) {
                Write-Host "[+] Tai cloudflared thanh cong!" -ForegroundColor Green
                break
            }
        } catch {}
    }
}

# ------------------------------------------------------------------------------
# 5. TAO LAUNCHER VBS AN HOAN TOAN CUA SO DONG LENH (KEM TUNNEL TU DONG & GHI LOG)
# ------------------------------------------------------------------------------
$TunnelParam = if ($NoTunnel) { "" } else { " --tunnel" }
$LogPath = "$InstallDir\otter.log"
$VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$InstallDir"
q = Chr(34)
cmd = "cmd.exe /c " & q & q & "$ExePath" & q & "$TunnelParam > " & q & "$LogPath" & q & " 2>&1" & q
WshShell.Run cmd, 0, False
"@
Set-Content -Path $VbsPath -Value $VbsContent -Encoding ASCII

# ------------------------------------------------------------------------------
# 6. DANG KY PHIM TAT KHOI DONG VA BIEU TUONG DESKTOP (RUN IN BACKGROUND & TRAY)
# ------------------------------------------------------------------------------
Write-Host "[*] Dang cau hinh bieu tuong khoi chay tren Desktop va Startup..." -ForegroundColor Yellow
$TrayExePath = "$InstallDir\otter-tray.exe"
$WshShell = New-Object -ComObject WScript.Shell

# 6.1 Tao Shortcut trong thu muc Startup va Registry Run (Tu chay ngam khi mo may tinh)
$StartupShortcut = $WshShell.CreateShortcut($ShortcutPath)
if (Test-Path $TrayExePath) {
    # Uu tien dung Otter Native Tray (Rust): 0 cua so, icon khay he thong, tu dong quan ly daemon ngam
    $StartupShortcut.TargetPath = $TrayExePath
    $StartupShortcut.Arguments = "--autostart"
    $StartupShortcut.WorkingDirectory = $InstallDir
    $StartupShortcut.Description = "Otter Agent Native System Tray"
    $StartupShortcut.IconLocation = "$TrayExePath,0"
    $StartupShortcut.Save()

    try {
        Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Otter" -Value "`"$TrayExePath`" --autostart" -Force
    } catch {}
    Write-Host "[+] Da dang ky tu khoi dong cung Windows qua Otter Native Tray!" -ForegroundColor Green
} else {
    # Fallback VBS neu khong co tray binary
    $StartupShortcut.TargetPath = "wscript.exe"
    $StartupShortcut.Arguments = "`"$VbsPath`""
    $StartupShortcut.WorkingDirectory = $InstallDir
    $StartupShortcut.Description = "Otter Agent Background Service"
    if (Test-Path $IconPath) { $StartupShortcut.IconLocation = "$IconPath,0" }
    $StartupShortcut.Save()
    Write-Host "[+] Da dang ky tu khoi dong cung Windows qua WScript VBS!" -ForegroundColor Green
}

# 6.2 Tao Shortcut tren man hinh Desktop (Nhan dup de bat va chay ngam)
$DesktopShortcut = $WshShell.CreateShortcut($DesktopShortcutPath)
if (Test-Path $TrayExePath) {
    $DesktopShortcut.TargetPath = $TrayExePath
    $DesktopShortcut.Arguments = ""
    $DesktopShortcut.WorkingDirectory = $InstallDir
    $DesktopShortcut.Description = "Otter - Bat va chay ngam (Khay he thong)"
    $DesktopShortcut.IconLocation = "$TrayExePath,0"
    $DesktopShortcut.Save()
    Write-Host "[+] Da tao bieu tuong Desktop thanh cong: $DesktopShortcutPath" -ForegroundColor Green
} else {
    $DesktopShortcut.TargetPath = "wscript.exe"
    $DesktopShortcut.Arguments = "`"$VbsPath`""
    $DesktopShortcut.WorkingDirectory = $InstallDir
    $DesktopShortcut.Description = "Otter - Bat va chay ngam"
    if (Test-Path $IconPath) { $DesktopShortcut.IconLocation = "$IconPath,0" }
    $DesktopShortcut.Save()
    Write-Host "[+] Da tao bieu tuong Desktop thanh cong: $DesktopShortcutPath" -ForegroundColor Green
}

try {
    & ie4uinit.exe -show 2>$null
} catch {}

# ------------------------------------------------------------------------------
# 6.1 DANG KY VAO BIEN MOI TRUONG PATH (USER ENV)
# ------------------------------------------------------------------------------
Write-Host "[*] Dang ky Otter va thu muc bin vao bien moi truong PATH nguoi dung..." -ForegroundColor Yellow
try {
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $PathParts = ($UserPath -split ';') | Where-Object { [string]::IsNullOrWhiteSpace($_) -eq $false }
    $SkillToolDir = Join-Path $InstallDir "tools\skill"
    $DirsToAdd = @($InstallDir, $BinDir, $SkillToolDir)
    $Changed = $false

    foreach ($d in $DirsToAdd) {
        if ($PathParts -notcontains $d) {
            $PathParts += $d
            $Changed = $true
        }
    }

    if ($Changed) {
        $NewUserPath = ($PathParts | Select-Object -Unique) -join ';'
        [Environment]::SetEnvironmentVariable("Path", $NewUserPath, "User")
        $env:Path = "$InstallDir;$BinDir;$env:Path"
        Write-Host "[+] Da dang ky PATH thanh cong: Co the go lenh 'otter' o moi noi!" -ForegroundColor Green
    } else {
        Write-Host "[+] PATH da co san duong dan Otter." -ForegroundColor Gray
    }
} catch {
    Write-Host "    [!] Khong the tu dong ghi PATH: $_" -ForegroundColor DarkGray
}

# ------------------------------------------------------------------------------
# 7. KHOI CHAY TIEN TRINH NGAM & TU DONG LAY DOMAIN 1 LAN
# ------------------------------------------------------------------------------
Write-Host "[*] Dang kich hoat Otter chay ngam..." -ForegroundColor Yellow
if (Test-Path $TrayExePath) {
    Start-Process $TrayExePath -WorkingDirectory $InstallDir
} else {
    Start-Process "wscript.exe" -ArgumentList "`"$VbsPath`"" -WorkingDirectory $InstallDir
}

Write-Host "[*] Dang ket noi may chu va tao domain 1-lan (TryCloudflare)..." -ForegroundColor Yellow

$proc = $null
$TunnelUrl = $null

for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    if (-not $proc) {
        $proc = Get-Process -Name "otter" -ErrorAction SilentlyContinue
    }
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:1993/api/system/tunnel" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($status -and $status.url) {
            $TunnelUrl = $status.url
            break
        }
    } catch {}
}

# Kiem tra file tunnel.url neu API chua phan hoi kip
if (-not $TunnelUrl) {
    $TunnelFile = "$InstallDir\tunnel.url"
    if (Test-Path $TunnelFile) {
        $TunnelUrl = (Get-Content $TunnelFile -Raw).Trim()
    }
}

if ($proc) {
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host " [OK] CAI DAT THANH CONG! OTTER DANG CHAY NGAM" -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host " - Tien trinh: PID $($proc.Id) (Khong ton tai nguyen)" -ForegroundColor White
    Write-Host " - Cong cuc bo: http://127.0.0.1:1993" -ForegroundColor White
    if ($TunnelUrl) {
        Write-Host " - [Web] Domain 1-lan (Quick Tunnel): $TunnelUrl" -ForegroundColor Cyan
        Write-Host " - [Link] MCP Endpoint: $TunnelUrl/mcp" -ForegroundColor Cyan
        Write-Host " - [Link] SSE Endpoint: $TunnelUrl/sse" -ForegroundColor Cyan
    } else {
        Write-Host " - [Web] Domain 1-lan: Dang cap phat trong nen (Xem tai http://127.0.0.1:1993)" -ForegroundColor Yellow
    }
    Write-Host " - Bieu tuong Desktop: $DesktopShortcutPath (Nhan bat & chay ngam)" -ForegroundColor Cyan
    Write-Host " - Tu khoi dong: Da bat moi khi mo may tinh" -ForegroundColor White
    Write-Host " - Lenh goi CLI: 'otter' (Da dang ky PATH toan cuc)" -ForegroundColor Cyan
    Write-Host " - Thu muc cai dat: $InstallDir" -ForegroundColor White
    if (Test-Path $ExtDir) {
        Write-Host " - Chrome Extension: $ExtDir (Da giai nen san)" -ForegroundColor Gray
    }
    Write-Host "`n-> Buoc tiep theo: Mo chrome://extensions/ bat Developer Mode va chon 'Tai tien ich da giai nen' -> tro vao: $ExtDir" -ForegroundColor Yellow
    Write-Host "========================================================`n" -ForegroundColor Green
} else {
    Write-Host "[!] Da khoi dong lenh nhung chua thay tien trinh otter.exe. Vui long kiem tra lai log." -ForegroundColor Yellow
}
