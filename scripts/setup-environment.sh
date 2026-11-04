#!/usr/bin/env bash
# =============================================================================
# Otter / chatmcp — Setup môi trường Node + Python (macOS & Linux)
# Bản đa nền tảng (Windows/macOS/Linux): bun scripts/setup-environment.ts
# — cùng logic, cùng cờ, chạy được cả trên Windows chỉ cần có bun.
# Bản .sh này giữ lại cho Unix, Windows dùng bản .ts.
#
# Mục đích: sửa đúng những lỗi đã gặp khi quét MCP trên VM Linux:
#   - generate_speech_audio / synthesize_bgm_or_sfx  -> cần `uv`
#   - render_remotion_video                        -> cần `bunx`
#   - vps_*                                        -> cần Python `paramiko`
#   - codebase_*                                   -> cần binary codebase-memory-mcp
#   - daemon                                       -> phải chạy với PATH có ~/.local/bin
#
# Nguồn cài đặt: CHỈ GitHub Releases + PyPI, không dùng server trung gian nào.
#   - uv:                https://github.com/astral-sh/uv/releases
#   - bun (nếu thiếu):   https://github.com/oven-sh/bun/releases
#   - codebase-memory:   https://github.com/DeusData/codebase-memory-mcp/releases
#     (qua script có sẵn scripts/setup-binaries.ts của repo)
#   - cloudflared:       https://github.com/cloudflare/cloudflared/releases
#     (qua script có sẵn scripts/setup-binaries.ts của repo)
#   - paramiko:          PyPI, theo scripts/requirements-vps.txt
#
# Cách dùng (chạy từ thư mục gốc của repo):
#   bash scripts/setup-environment.sh            # cài lõi (code thuần) + kiểm tra
#   bash scripts/setup-environment.sh --check    # chỉ kiểm tra, không cài gì
#
# Binaries nặng là TÙY CHỌN, mặc định KHÔNG cài (bin/ chỉ chạy code):
#   --with-codebase      cài codebase-memory-mcp (~316 MB, chỉ cho codebase_*)
#   --with-cloudflared   cài cloudflared (~39 MB, chỉ cho --tunnel)
#   --with-binaries      cài cả hai trên
#
# Skills cũng TÙY CHỌN, mặc định KHÔNG cài thêm skill nào ngoài
# remotion-video-creator (24K, skill gốc của Otter, không có upstream
# GitHub để cài lại nên giữ lại). Các skill khác chỉ cài khi cần:
#   --with-skill=<tên>   cài một skill (lặp lại được, ví dụ --with-skill=figma)
#   --with-all-skills    cài cả 8 skill trong bin/skills/sources.json
# Cài lại thủ công bất cứ lúc nào (không cần chạy lại setup):
#   bun bin/skill.ts install <tên>   # tên trong sources.json, ví dụ figma,
#                                    # hyperframes, media-use, video-shotcraft
# Lưu ý: cài lại bằng MCP skills_install chỉ hợp với skill là một repo
# riêng (video-shotcraft); skill nằm trong monorepo HyperFrames phải
# dùng CLI trên (nó sparse-clone đúng subdir skills/<tên>).
# Lý do: daemon lõi (plan/loop/file/terminal/db/fb tracker) không cần
# binary nào trong bin/; mỗi binary chỉ phục vụ đúng một nhóm tool, và
# khi thiếu nó tool chỉ báo lỗi rõ ràng chứ daemon không crash. Người
# dùng chỉ cài cái mình dùng, repo nhẹ hơn ~355 MB.
#
# Sau khi setup xong, CHẠY DAEMON BẰNG WRAPPER (đừng chạy bun trần):
#   bash scripts/run-daemon.sh
# Wrapper này tự thêm ~/.local/bin vào PATH rồi mới chạy daemon, nên các
# tool gọi `uv` / `bunx` qua shell mới tìm thấy chúng. Khởi động lại daemon
# sau mỗi lần setup là bắt buộc: bun không tự reload binary/PATH mới.
#
# Tính bền vững: ~/.local/bin và thư mục repo đều nằm trong $HOME nên sống
# qua VM replacement; /usr/local/bin thì không, vì vậy script KHÔNG cài
# gì vào /usr/local/bin. Sau khi VM bị thay, chỉ cần chạy lại script này
# + scripts/run-daemon.sh là đủ.
# =============================================================================
set -u

CHECK_ONLY=0
WITH_CODEBASE=0
WITH_CLOUDFLARED=0
WITH_ALL_SKILLS=0
WITH_SKILLS=""
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --with-codebase) WITH_CODEBASE=1 ;;
    --with-cloudflared) WITH_CLOUDFLARED=1 ;;
    --with-binaries) WITH_CODEBASE=1; WITH_CLOUDFLARED=1 ;;
    --with-skill=*) WITH_SKILLS="$WITH_SKILLS ${arg#--with-skill=}" ;;
    --with-all-skills) WITH_ALL_SKILLS=1 ;;
    -h|--help)
      sed -n '2,60p' "$0"; exit 0 ;;
    *) echo "Tham số không rõ: $arg (dùng --check, --with-codebase, --with-cloudflared, --with-binaries, --with-skill=<tên>, --with-all-skills hoặc --help)" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
# Script này chỉ hỗ trợ macOS & Linux. Trên Windows native (PowerShell)
# nó không chạy được, và chạy trong Git Bash cũng sẽ rớt vào nhánh
# này (uname = MINGW64/CYGWIN) thay vì âm thầm chọn sai asset rồi fail
# khó hiểu ở bước uv/codebase. Hướng dẫn rõ thay vì fail ngầm.
case "$(uname -s)" in
  Linux|Darwin) ;;
  *)
    echo "[FAIL] setup-environment.sh chỉ hỗ trợ macOS & Linux." >&2
    echo "       Trên Windows: cài bun + node + python3 trước, rồi chạy" >&2
    echo "       'bun install' và 'bun scripts/setup-binaries.ts' trực tiếp" >&2
    echo "       (setup-binaries.ts có nhánh win32), sau đó chạy daemon bằng" >&2
    echo "       'bun src/daemon/index.ts --tunnel'. Script setup Windows" >&2
    echo "       tương đương với opt-in binaries/skills vẫn CHƯA CÓ và CHƯA TEST." >&2
    exit 2 ;;
esac
FAIL=0
ok()   { echo "[OK]   $*"; }
warn() { echo "[WARN] $*"; }
fail() { echo "[FAIL] $*"; FAIL=$((FAIL + 1)); }

command_exists() { command -v "$1" >/dev/null 2>&1; }
version_of() { "$@" 2>&1 | head -n 1; }

echo "Repo: $REPO_ROOT"
echo "Bin dir (persistent, trong HOME): $BIN_DIR"
mkdir -p "$BIN_DIR"
# Script tự thêm BIN_DIR vào PATH của chính nó để kiểm tra uv/bunx
# đúng cả khi shell gọi script chưa có BIN_DIR trong PATH. Daemon thì
# vẫn phải dùng scripts/run-daemon.sh (nó làm đúng việc này).
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) export PATH="$BIN_DIR:$PATH" ;;
esac

# ---------------------------------------------------------------- 1. Kiểm tra nền
echo ""
echo "== 1. Nền tảng: bun / node / python3 / ffmpeg / git / curl =="
for cmd in bun node python3 ffmpeg git curl tar; do
  if command_exists "$cmd"; then
    case "$cmd" in
      bun)     ok "bun: $(version_of bun --version)" ;;
      node)    ok "node: $(version_of node --version)" ;;
      python3) ok "python3: $(version_of python3 --version)" ;;
      ffmpeg)  ok "ffmpeg: $(version_of ffmpeg -version | head -n 1)" ;;
      *)       ok "$cmd: có sẵn" ;;
    esac
  else
    fail "$cmd: THIẾU — bun: https://github.com/oven-sh/bun/releases, node/python/ffmpeg: cài bằng package manager của hệ điều hành rồi chạy lại script này"
  fi
done

if [ "$CHECK_ONLY" = 1 ]; then
  echo ""
  echo "== Chế độ --check: không cài gì thêm =="
fi

# ---------------------------------------------------------------- 2. uv (GitHub)
echo ""
echo "== 2. uv (cho generate_speech_audio + synthesize_bgm_or_sfx) =="
if command_exists uv; then
  ok "uv: $(version_of uv --version)"
else
  if [ "$CHECK_ONLY" = 1 ]; then
    fail "uv: THIẾU (chạy không có --check để cài từ GitHub astral-sh/uv)"
  else
    echo "[*] Đang tải uv từ GitHub Releases (astral-sh/uv)..."
    OS="$(uname -s)"; ARCH="$(uname -m)"
    case "$OS-$ARCH" in
      Linux-x86_64|Linux-amd64) ASSET="uv-x86_64-unknown-linux-gnu.tar.gz" ;;
      Linux-aarch64|Linux-arm64) ASSET="uv-aarch64-unknown-linux-gnu.tar.gz" ;;
      Darwin-arm64) ASSET="uv-aarch64-apple-darwin.tar.gz" ;;
      Darwin-x86_64) ASSET="uv-x86_64-apple-darwin.tar.gz" ;;
      *) ASSET="" ;;
    esac
    INSTALLED=0
    if [ -n "$ASSET" ]; then
      TMPDIR_UV="$(mktemp -d)"
      # Tách từng bước: tarball uv nằm trong thư mục con (uv-x86_64-.../uv),
      # cp thư mục sẽ fail nên phải dùng find để lấy đúng file binary.
      if curl -fsSL "https://github.com/astral-sh/uv/releases/latest/download/$ASSET" -o "$TMPDIR_UV/uv.tar.gz"; then
        if tar -xzf "$TMPDIR_UV/uv.tar.gz" -C "$TMPDIR_UV" 2>/dev/null; then
          find "$TMPDIR_UV" -type f -name uv -exec cp {} "$BIN_DIR/uv" \; 2>/dev/null || true
          chmod +x "$BIN_DIR/uv" 2>/dev/null || true
        fi
      fi
      rm -rf "$TMPDIR_UV"
      if [ -x "$BIN_DIR/uv" ]; then INSTALLED=1; fi
    fi
    if [ "$INSTALLED" = 0 ] && command_exists python3; then
      echo "[*] Tải trực tiếp thất bại, thử pip install --user uv..."
      # Debian/Ubuntu dùng PEP 668 (externally-managed): pip --user thường
      # bị chặn, cần --break-system-packages mới cài được vào ~/.local.
      python3 -m pip install --user --break-system-packages uv >/dev/null 2>&1 && INSTALLED=1 || true
    fi
    if [ "$INSTALLED" = 1 ] || command_exists uv || [ -x "$BIN_DIR/uv" ]; then
      ok "uv: $(PATH="$BIN_DIR:$PATH" version_of uv --version)"
    else
      fail "uv: CÀI THẤT BẠI — cài tay: https://github.com/astral-sh/uv (hoặc: python3 -m pip install --user uv)"
    fi
  fi
fi

# ---------------------------------------------------------------- 3. bunx shim
echo ""
echo "== 3. bunx (cho render_remotion_video) =="
if command_exists bunx; then
  ok "bunx: có sẵn"
elif command_exists bun; then
  if [ "$CHECK_ONLY" = 1 ]; then
    fail "bunx: THIẾU — bản bun hiện tại không kèm bunx (chạy không có --check để tạo shim ~/.local/bin/bunx -> bun x)"
  else
    printf '#!/bin/sh\n# bunx shim: bản bun rút gọn không kèm binary bunx, dùng `bun x` thay thế.\nexec bun x "$@"\n' > "$BIN_DIR/bunx"
    chmod +x "$BIN_DIR/bunx"
    ok "bunx: đã tạo shim $BIN_DIR/bunx -> bun x"
  fi
else
  fail "bunx: THIẾU và bun cũng thiếu — cài bun trước: https://github.com/oven-sh/bun/releases"
fi

# ---------------------------------------------------------------- 4. paramiko
echo ""
echo "== 4. Python paramiko (cho vps_*) =="
if python3 -c "import paramiko; print(paramiko.__version__)" >/dev/null 2>&1; then
  ok "paramiko: $(python3 -c "import paramiko; print(paramiko.__version__)")"
elif [ "$CHECK_ONLY" = 1 ]; then
  fail "paramiko: THIẾU (chạy không có --check để pip install theo scripts/requirements-vps.txt)"
else
  echo "[*] Đang cài paramiko theo scripts/requirements-vps.txt..."
  # Thứ tự có chủ ý cho đa nền tảng: thử pip --user thường trước
  # (macOS / pip cũ không có cờ --break-system-packages, đưa cờ này
  # vào đầu sẽ fail ngay cả khi pip thường cài được). Chỉ khi pip
  # thường bị chặn (Debian/Ubuntu PEP 668) mới dùng cờ đó, cuối
  # cùng mới fallback sang uv pip.
  if python3 -m pip install --user -r "$REPO_ROOT/scripts/requirements-vps.txt" >/dev/null 2>&1 \
    || python3 -m pip install --user paramiko >/dev/null 2>&1 \
    || python3 -m pip install --user --break-system-packages -r "$REPO_ROOT/scripts/requirements-vps.txt" >/dev/null 2>&1 \
    || python3 -m pip install --user --break-system-packages paramiko >/dev/null 2>&1 \
    || (command_exists uv && uv pip install --system --break-system-packages paramiko >/dev/null 2>&1); then
    if python3 -c "import paramiko" >/dev/null 2>&1; then
      ok "paramiko: $(python3 -c "import paramiko; print(paramiko.__version__)")"
    else
      fail "paramiko: pip báo xong nhưng python3 vẫn import không được — kiểm tra PYTHONPATH / venv đang dùng"
    fi
  else
    fail "paramiko: CÀI THẤT BẠI — cài tay: python3 -m pip install --user paramiko (xem scripts/requirements-vps.txt)"
  fi
fi

# ---------------------------------------------------------------- 5. Bun deps
# + binaries TÙY CHỌN (mặc định không cài — xem header)
echo ""
echo "== 5. bun install + binaries tùy chọn =="
if command_exists bun && [ "$CHECK_ONLY" = 0 ]; then
  (cd "$REPO_ROOT" && bun install) || fail "bun install thất bại"
  ok "bun install: xong"
elif [ -d "$REPO_ROOT/node_modules" ]; then
  ok "node_modules: có sẵn"
elif [ "$CHECK_ONLY" = 1 ]; then
  warn "node_modules: chưa có (chạy không có --check để bun install)"
else
  fail "bun install: bỏ qua vì thiếu bun"
fi
echo "    Binaries tùy chọn: codebase=$WITH_CODEBASE cloudflared=$WITH_CLOUDFLARED (mặc định 0 = không cài)"
if [ "$WITH_CODEBASE" = 1 ] && [ "$CHECK_ONLY" = 0 ] && command_exists bun; then
  # SKIP_CLOUDFLARED=1: chỉ cài codebase, không kéo theo cloudflared 39 MB.
  (cd "$REPO_ROOT" && SKIP_CLOUDFLARED=1 bun scripts/setup-binaries.ts) || warn "setup-binaries.ts báo lỗi (xem log ở trên)"
  # Fallback trực tiếp: nếu setup-binaries vẫn chưa có binary (ví dụ nó
  # từng chọn nhầm asset .mcpb), tải đúng asset .tar.gz từ GitHub và giải nén.
  if [ ! -x "$REPO_ROOT/bin/codebase-memory-mcp" ] && command_exists curl; then
    OS="$(uname -s)"; ARCH="$(uname -m)"
    case "$OS-$ARCH" in
      Linux-x86_64|Linux-amd64) CBM_ASSET="codebase-memory-mcp-linux-amd64.tar.gz" ;;
      Linux-aarch64|Linux-arm64) CBM_ASSET="codebase-memory-mcp-linux-arm64.tar.gz" ;;
      Darwin-arm64) CBM_ASSET="codebase-memory-mcp-darwin-arm64.tar.gz" ;;
      Darwin-x86_64) CBM_ASSET="codebase-memory-mcp-darwin-amd64.tar.gz" ;;
      *) CBM_ASSET="" ;;
    esac
    if [ -n "$CBM_ASSET" ]; then
      echo "[*] setup-binaries chưa có binary, tải trực tiếp $CBM_ASSET từ GitHub..."
      TMPDIR_CBM="$(mktemp -d)"
      if curl -fsSL "https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/$CBM_ASSET" -o "$TMPDIR_CBM/cbm.tar.gz" \
        && tar -xzf "$TMPDIR_CBM/cbm.tar.gz" -C "$TMPDIR_CBM" 2>/dev/null; then
        find "$TMPDIR_CBM" -type f -name "codebase-memory-mcp*" ! -name "*.tar.gz" -exec cp {} "$REPO_ROOT/bin/codebase-memory-mcp" \; 2>/dev/null || true
        chmod +x "$REPO_ROOT/bin/codebase-memory-mcp" 2>/dev/null || true
      fi
      rm -rf "$TMPDIR_CBM"
    fi
  fi
fi
if [ "$WITH_CLOUDFLARED" = 1 ] && [ "$CHECK_ONLY" = 0 ] && [ ! -x "$REPO_ROOT/bin/cloudflared" ]; then
  # Tải trực tiếp cloudflared, KHÔNG chạy setup-binaries.ts ở đây vì
  # script đó cài cả codebase-memory (~316 MB) cùng lúc, mất ý nghĩa
  # chọn riêng từng binary.
  OS="$(uname -s)"; ARCH="$(uname -m)"
  case "$OS-$ARCH" in
    Linux-x86_64|Linux-amd64) CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" ;;
    Linux-aarch64|Linux-arm64) CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" ;;
    Darwin-arm64|Darwin-x86_64) CF_URL="" ;;
    *) CF_URL="" ;;
  esac
  if [ -n "$CF_URL" ]; then
    echo "[*] Đang tải cloudflared từ GitHub..."
    curl -fsSL "$CF_URL" -o "$REPO_ROOT/bin/cloudflared" && chmod +x "$REPO_ROOT/bin/cloudflared" || warn "tải cloudflared thất bại"
  elif [ "$OS" = "Darwin" ]; then
    echo "[*] macOS: tải cloudflared-darwin tgz từ GitHub..."
    TMPDIR_CF="$(mktemp -d)"
    CF_TGZ="cloudflared-darwin-arm64.tgz"; [ "$ARCH" = "x86_64" ] && CF_TGZ="cloudflared-darwin-amd64.tgz"
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/$CF_TGZ" 2>/dev/null | tar -xz -C "$TMPDIR_CF" 2>/dev/null || true
    find "$TMPDIR_CF" -type f -name cloudflared -exec cp {} "$REPO_ROOT/bin/cloudflared" \; 2>/dev/null || true
    chmod +x "$REPO_ROOT/bin/cloudflared" 2>/dev/null || true
    rm -rf "$TMPDIR_CF"
  else
    warn "cloudflared: không rõ OS/ARCH ($OS-$ARCH), tải tay: https://github.com/cloudflare/cloudflared/releases"
  fi
fi
if [ -x "$REPO_ROOT/bin/codebase-memory-mcp" ]; then ok "codebase-memory-mcp: bin/codebase-memory-mcp (tùy chọn, đã cài)"; else warn "codebase-memory-mcp: chưa cài (tùy chọn, chỉ cần cho codebase_* — cài bằng: bash scripts/setup-environment.sh --with-codebase)"; fi
if [ -x "$REPO_ROOT/bin/cloudflared" ]; then ok "cloudflared: bin/cloudflared (tùy chọn, đã cài)"; else warn "cloudflared: chưa cài (tùy chọn, chỉ cần cho --tunnel — cài bằng: bash scripts/setup-environment.sh --with-cloudflared; daemon vẫn chạy local bình thường)"; fi

# ---------------------------------------------------------------- 5b. Skills TÙY CHỌN
echo ""
echo "== 5b. Skills tùy chọn (mặc định: chỉ remotion-video-creator) =="
if [ "$WITH_ALL_SKILLS" = 1 ]; then
  WITH_SKILLS="$WITH_SKILLS figma hyperframes hyperframes-cli hyperframes-registry media-use remotion-to-hyperframes slideshow video-shotcraft"
fi
if [ -n "$WITH_SKILLS" ] && [ "$CHECK_ONLY" = 0 ] && command_exists bun; then
  for SKILL_NAME in $WITH_SKILLS; do
    if [ -d "$REPO_ROOT/bin/skills/$SKILL_NAME" ]; then
      ok "skill $SKILL_NAME: đã có sẵn, bỏ qua"
    else
      echo "[*] Đang cài skill $SKILL_NAME từ bin/skills/sources.json..."
      if (cd "$REPO_ROOT" && bun bin/skill.ts install "$SKILL_NAME"); then
        ok "skill $SKILL_NAME: đã cài"
      else
        warn "skill $SKILL_NAME: cài thất bại (xem log ở trên; kiểm tra tên trong: bun bin/skill.ts sources)"
      fi
    fi
  done
elif [ -n "$WITH_SKILLS" ] && [ "$CHECK_ONLY" = 1 ]; then
  warn "skills yêu cầu ($WITH_SKILLS) chưa cài trong chế độ --check (chạy không có --check để cài)"
fi
if [ -d "$REPO_ROOT/bin/skills/remotion-video-creator" ]; then ok "skill remotion-video-creator: luôn có sẵn (24K, skill gốc của Otter)"; else warn "skill remotion-video-creator: THIẾU — đây là skill gốc, không có upstream GitHub để cài lại"; fi
echo "    Các skill tùy chọn khác cài khi cần: bun bin/skill.ts install <tên> (xem: bun bin/skill.ts sources)"

# ---------------------------------------------------------------- 6. PATH cho daemon
echo ""
echo "== 6. PATH =="
case ":$PATH:" in
  *":$BIN_DIR:"*) ok "PATH hiện tại đã có $BIN_DIR" ;;
  *) warn "PATH hiện tại CHƯA có $BIN_DIR — shell này cần: export PATH=\"$BIN_DIR:\$PATH\" (daemon thì dùng scripts/run-daemon.sh, nó tự thêm)" ;;
esac
echo "    Daemon phải chạy bằng: bash scripts/run-daemon.sh"
echo "    (không chạy 'bun src/daemon/index.ts' trần nếu PATH chưa có $BIN_DIR)"

echo ""
if [ "$FAIL" = 0 ]; then
  echo "[✓] Setup environment: OK — khởi động lại daemon bằng scripts/run-daemon.sh rồi test lại MCP."
else
  echo "[!] Setup environment: còn $FAIL mục FAIL ở trên — sửa theo gợi ý từng mục rồi chạy lại script."
fi
exit "$FAIL"
