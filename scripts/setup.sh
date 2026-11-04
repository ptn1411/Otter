#!/usr/bin/env bash
# ==============================================================================
# 🦦 Otter Background Agent - macOS & Linux 1-Click Installer
# Cài đặt tự động bằng 1 dòng lệnh duy nhất trong Terminal:
# curl -fsSL https://otter.gpt.io.vn/setup.sh | bash
#
# Hoặc chạy cục bộ:
# chmod +x setup.sh && ./setup.sh
# ==============================================================================

set -e

SERVER="https://otter.gpt.io.vn"
REPO="ptn1411/Otter"
VERSION="latest"
INSTALL_DIR="$HOME/.otter"
BIN_DIR="$INSTALL_DIR/bin"
LOG_DIR="$INSTALL_DIR/logs"
TARGET_EXE="$BIN_DIR/otter"
PLIST_FILE="$HOME/Library/LaunchAgents/com.otter.daemon.plist"
SYSTEMD_FILE="$HOME/.config/systemd/user/otter.service"

UNINSTALL=false
for arg in "$@"; do
    case $arg in
        -u|--uninstall)
            UNINSTALL=true
            shift
            ;;
    esac
done

# ------------------------------------------------------------------------------
# 1. XỬ LÝ GỠ CÀI ĐẶT (UNINSTALL)
# ------------------------------------------------------------------------------
if [ "$UNINSTALL" = true ]; then
    echo "[-] Đang gỡ bỏ Otter Background Daemon..."
    
    # macOS
    if [ "$(uname)" = "Darwin" ]; then
        if [ -f "$PLIST_FILE" ]; then
            launchctl unload "$PLIST_FILE" 2>/dev/null || true
            rm -f "$PLIST_FILE"
        fi
    fi

    # Linux
    if [ "$(uname)" = "Linux" ]; then
        if [ -f "$SYSTEMD_FILE" ]; then
            systemctl --user stop otter.service 2>/dev/null || true
            systemctl --user disable otter.service 2>/dev/null || true
            rm -f "$SYSTEMD_FILE"
            systemctl --user daemon-reload 2>/dev/null || true
        fi
    fi

    pkill -f "otter-tray" 2>/dev/null || true
    pkill -f "otter" 2>/dev/null || true
    pkill -f "cloudflared" 2>/dev/null || true
    rm -rf "$INSTALL_DIR"

    # Dọn dẹp PATH khỏi các file shell rc
    for rc in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.profile"; do
        if [ -f "$rc" ] && grep -q "Otter CLI" "$rc"; then
            sed -i.bak '/# Otter CLI/d' "$rc" 2>/dev/null || true
            sed -i.bak "\|$BIN_DIR|d" "$rc" 2>/dev/null || true
            rm -f "${rc}.bak" 2>/dev/null || true
        fi
    done
    rm -f "$HOME/.local/bin/otter" 2>/dev/null || true

    echo "[+] ĐÃ GỠ BỎ THÀNH CÔNG OTTER AGENT!"
    exit 0
fi

echo ""
echo "========================================================"
echo "     🦦 OTTER AGENT - TỰ ĐỘNG CÀI ĐẶT & CHẠY NGẦM      "
echo "========================================================"
echo ""

# ------------------------------------------------------------------------------
# 2. XÁC ĐỊNH HỆ ĐIỀU HÀNH & KIẾN TRÚC CPU
# ------------------------------------------------------------------------------
OS="$(uname)"
ARCH="$(uname -m)"

if [ "$OS" = "Darwin" ]; then
    if [ "$ARCH" = "arm64" ]; then
        BINARY_NAME="otter-darwin-arm64"
    else
        BINARY_NAME="otter-darwin-x64"
    fi
elif [ "$OS" = "Linux" ]; then
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
        BINARY_NAME="otter-linux-arm64"
    else
        BINARY_NAME="otter-linux-x64"
    fi
else
    echo "[!] Hệ điều hành không được hỗ trợ: $OS"
    exit 1
fi

# ------------------------------------------------------------------------------
# 3. CHUẨN BỊ THƯ MỤC CÀI ĐẶT
# ------------------------------------------------------------------------------
mkdir -p "$BIN_DIR" "$LOG_DIR"

# ------------------------------------------------------------------------------
# 4. TÌM HOẶC TẢI TỰ ĐỘNG FILE BINARY
# ------------------------------------------------------------------------------
FOUND_LOCAL=""
for cand in "./$BINARY_NAME" "./deploy/$BINARY_NAME" "./dist/$BINARY_NAME" "../deploy/$BINARY_NAME" "../dist/$BINARY_NAME" "./otter" "./deploy/otter" "./dist/otter"; do
    if [ -f "$cand" ]; then
        FOUND_LOCAL="$cand"
        break
    fi
done

if [ -n "$FOUND_LOCAL" ]; then
    echo "[*] Phát hiện file binary cục bộ: $FOUND_LOCAL"
    cp "$FOUND_LOCAL" "$TARGET_EXE"

    # Đồng bộ bản quyền license.json nếu có
    LIC_DEST=""
    if [ "$OS" = "Darwin" ]; then
        LIC_DEST="$HOME/Library/Application Support/Otter"
    else
        LIC_DEST="$HOME/.config/otter"
    fi
    mkdir -p "$LIC_DEST"

    for lic_cand in "./data/license.json" "../data/license.json" "./license.json"; do
        if [ -f "$lic_cand" ]; then
            cp -f "$lic_cand" "$LIC_DEST/license.json" 2>/dev/null || true
            cp -f "$lic_cand" "$INSTALL_DIR/license.json" 2>/dev/null || true
            echo "[+] Đã đồng bộ bản quyền license.json từ: $lic_cand"
            break
        fi
    done

    # Đồng bộ otter-tray nếu có
    for tray_cand in "./otter-tray" "./deploy/otter-tray" "./dist/otter-tray" "../deploy/otter-tray" "./tray/target/release/otter-tray"; do
        if [ -f "$tray_cand" ]; then
            cp -f "$tray_cand" "$BIN_DIR/otter-tray" 2>/dev/null || true
            chmod +x "$BIN_DIR/otter-tray" 2>/dev/null || true
            echo "[+] Đã đồng bộ Otter Native Tray từ: $tray_cand"
            break
        fi
    done
else
    echo "[*] Đang tự động kéo bản build ($BINARY_NAME) từ $SERVER..."
    CANDIDATE_URLS=(
        "$SERVER/$BINARY_NAME"
        "https://github.com/$REPO/releases/latest/download/$BINARY_NAME"
    )

    DOWNLOADED=false
    for url in "${CANDIDATE_URLS[@]}"; do
        echo "    -> Kết nối tới: $url"
        if curl -fsSL --connect-timeout 15 "$url" -o "$TARGET_EXE"; then
            if [ -s "$TARGET_EXE" ]; then
                DOWNLOADED=true
                echo "[+] Tải file thực thi thành công! ($TARGET_EXE)"
                break
            fi
        fi
    done

    if [ "$DOWNLOADED" = false ]; then
        echo "[!] Không thể tự động tải file từ máy chủ: $SERVER"
        echo "    Vui lòng kiểm tra kết nối mạng hoặc truy cập $SERVER để tải thủ công."
        exit 1
    fi
fi

chmod +x "$TARGET_EXE"

# Tải thêm Chrome extension zip
echo "[*] Đang chuẩn bị tiện ích Chrome Extension..."
curl -fsSL --connect-timeout 15 "$SERVER/otter-extension.zip" -o "$INSTALL_DIR/otter-extension.zip" 2>/dev/null || true
if command -v unzip >/dev/null 2>&1 && [ -f "$INSTALL_DIR/otter-extension.zip" ]; then
    rm -rf "$INSTALL_DIR/extension"
    mkdir -p "$INSTALL_DIR/extension"
    unzip -qo "$INSTALL_DIR/otter-extension.zip" -d "$INSTALL_DIR/extension" 2>/dev/null || true
fi

# ------------------------------------------------------------------------------
# 4.2 TẢI CLOUDFLARED ĐỂ TẠO QUICK TUNNEL DOMAIN DÙNG 1 LẦN
# ------------------------------------------------------------------------------
if ! command -v cloudflared >/dev/null 2>&1 && [ ! -f "$BIN_DIR/cloudflared" ]; then
    echo "[*] Đang tải công cụ tạo domain 1-lần (cloudflared)..."
    CF_URL=""
    if [ "$OS" = "Darwin" ]; then
        if [ "$ARCH" = "arm64" ]; then
            CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz"
        else
            CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz"
        fi
        curl -fsSL "$CF_URL" 2>/dev/null | tar -xz -C "$BIN_DIR" 2>/dev/null || true
    elif [ "$OS" = "Linux" ]; then
        if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
            CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
        else
            CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
        fi
        curl -fsSL "$CF_URL" -o "$BIN_DIR/cloudflared" 2>/dev/null || true
    fi
    chmod +x "$BIN_DIR/cloudflared" 2>/dev/null || true
fi

# ------------------------------------------------------------------------------
# 5. CẤU HÌNH DAEMON CHẠY NGẦM (KÈM --tunnel TỰ ĐỘNG)
# ------------------------------------------------------------------------------
if [ "$OS" = "Darwin" ]; then
    echo "[*] Đang cấu hình macOS LaunchAgent (tự chạy khi đăng nhập)..."
    mkdir -p "$HOME/Library/LaunchAgents"

    cat <<EOF > "$PLIST_FILE"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.otter.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>$TARGET_EXE</string>
        <string>--tunnel</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/otter.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/otter.stderr.log</string>
</dict>
</plist>
EOF

    # Dừng service cũ nếu có và nạp service mới
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    launchctl load "$PLIST_FILE"

elif [ "$OS" = "Linux" ]; then
    echo "[*] Đang cấu hình Linux Systemd User Service..."
    mkdir -p "$HOME/.config/systemd/user"

    cat <<EOF > "$SYSTEMD_FILE"
[Unit]
Description=Otter Agent Background Service
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$TARGET_EXE --tunnel
Restart=always
RestartSec=3
StandardOutput=append:$LOG_DIR/otter.stdout.log
StandardError=append:$LOG_DIR/otter.stderr.log

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    systemctl --user enable --now otter.service
fi

# ------------------------------------------------------------------------------
# 6.1 ĐĂNG KÝ VÀO BIẾN MÔI TRƯỜNG PATH (SHELL RC & ~/.local/bin)
# ------------------------------------------------------------------------------
echo "[*] Đăng ký Otter CLI vào biến môi trường PATH..."
TARGET_RCS=()

if [ "$OS" = "Darwin" ]; then
    # Trên macOS: zsh là mặc định từ Catalina (10.15+)
    [ ! -f "$HOME/.zshrc" ] && touch "$HOME/.zshrc"
    TARGET_RCS+=("$HOME/.zshrc")
    [ -f "$HOME/.zprofile" ] && TARGET_RCS+=("$HOME/.zprofile")
    [ -f "$HOME/.bash_profile" ] && TARGET_RCS+=("$HOME/.bash_profile")
else
    # Trên Linux
    [ ! -f "$HOME/.bashrc" ] && touch "$HOME/.bashrc"
    TARGET_RCS+=("$HOME/.bashrc")
    [ -f "$HOME/.zshrc" ] && TARGET_RCS+=("$HOME/.zshrc")
    [ -f "$HOME/.profile" ] && TARGET_RCS+=("$HOME/.profile")
fi

# Đồng thời tạo symlink vào ~/.local/bin nếu thư mục tồn tại
if [ -d "$HOME/.local/bin" ]; then
    ln -sf "$TARGET_EXE" "$HOME/.local/bin/otter" 2>/dev/null || true
fi

for rc in "${TARGET_RCS[@]}"; do
    if [ -f "$rc" ] && ! grep -q "$BIN_DIR" "$rc"; then
        echo "" >> "$rc"
        echo "# Otter CLI" >> "$rc"
        echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$rc"
    fi
done

echo "[*] Đang kết nối máy chủ và tạo domain 1-lần (TryCloudflare)..."

TUNNEL_URL=""
for i in {1..15}; do
    sleep 1
    TUNNEL_URL=$(curl -s http://127.0.0.1:1993/api/system/tunnel 2>/dev/null | grep -o 'https://[^"]*trycloudflare.com' || true)
    if [ -n "$TUNNEL_URL" ]; then
        break
    fi
done

if [ -z "$TUNNEL_URL" ] && [ -f "$INSTALL_DIR/tunnel.url" ]; then
    TUNNEL_URL=$(cat "$INSTALL_DIR/tunnel.url")
fi

echo ""
echo "========================================================"
echo " [✓] CÀI ĐẶT THÀNH CÔNG TRÊN $(uname)!"
echo "========================================================"
echo " - Dịch vụ: Đang chạy ngầm"
echo " - Cổng cục bộ: http://127.0.0.1:1993"
if [ -n "$TUNNEL_URL" ]; then
    echo " - 🌐 Domain 1-lần (Quick Tunnel): $TUNNEL_URL"
    echo " - 🔗 MCP Endpoint: $TUNNEL_URL/mcp"
    echo " - 🔗 SSE Endpoint: $TUNNEL_URL/sse"
else
    echo " - 🌐 Domain 1-lần: Đang khởi tạo trong nền (Xem tại http://127.0.0.1:1993)"
fi
echo " - Tự khởi động: Đã bật mỗi khi mở máy tính"
echo " - Lệnh gọi CLI: 'otter' (Đã đăng ký PATH toàn cục)"
echo " - Vị trí cài đặt: $TARGET_EXE"
echo " - File nhật ký (Logs): $LOG_DIR"
if [ -d "$INSTALL_DIR/extension" ]; then
    echo " - Chrome Extension: $INSTALL_DIR/extension (Đã giải nén sẵn)"
fi
echo ""
echo "👉 Bước tiếp theo: Mở chrome://extensions/ bật Developer Mode và chọn 'Tải tiện ích đã giải nén' -> trỏ vào: $INSTALL_DIR/extension"
echo "========================================================"
echo ""
