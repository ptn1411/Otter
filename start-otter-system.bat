@echo off
chcp 65001 >nul
echo =======================================================
echo   🦦 KHỞI ĐỘNG HỆ THỐNG OTTER MCP + MUSE AGENT
echo =======================================================
echo.

echo [1/3] Đang kiểm tra Cloudflare Tunnel...
start "Cloudflare Tunnel (myapp)" /min cmd /c "cloudflared tunnel run myapp"

echo [2/3] Đang khởi chạy Otter Daemon...
start "Otter MCP Daemon" cmd /k "bun src/daemon/index.ts"

timeout /t 2 /nobreak >nul

echo [3/3] Đang mở trình duyệt Chrome trực quan...
set EXT_PATH="%~dp0extension\dist"

:: 1. Kiểm tra Chrome GPM (nếu có cài trên máy)
set CHROME_GPM="%APPDATA%\GPMLoginGlobal\Browsers\ChromiumCore_v154\chrome.exe"
if exist %CHROME_GPM% (
    echo [+] Phát hiện Chromium GPM Core v154. Đang khởi chạy với cổng CDP 9222...
    start "" %CHROME_GPM% --user-data-dir="%USERPROFILE%\Code\gpm\64b20c37-715c-4f4c-897c-fbbac828e8bf" --remote-debugging-port=9222 --load-extension=%EXT_PATH% "https://chatgpt.com"
    goto :done
)

:: 2. Tự động dò Google Chrome mặc định của hệ thống
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    echo [+] Khởi chạy Google Chrome mặc định (Program Files)...
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --load-extension=%EXT_PATH% "https://chatgpt.com"
    goto :done
)

if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    echo [+] Khởi chạy Google Chrome mặc định (Program Files x86)...
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --load-extension=%EXT_PATH% "https://chatgpt.com"
    goto :done
)

if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    echo [+] Khởi chạy Google Chrome mặc định (LocalAppData)...
    start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --load-extension=%EXT_PATH% "https://chatgpt.com"
    goto :done
)

:: 3. Fallback lệnh gọi thông thường
start "" "chrome.exe" --remote-debugging-port=9222 --load-extension=%EXT_PATH% "https://chatgpt.com"

:done

echo.
echo [+] Hoàn tất! Hệ thống đã sẵn sàng kết nối Agent-to-Agent.
echo.
pause

