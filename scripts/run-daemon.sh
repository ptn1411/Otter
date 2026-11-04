#!/usr/bin/env bash
# Chạy Otter daemon với PATH đầy đủ cho các MCP tool gọi qua shell.
# BẮT BUỘC dùng wrapper này thay cho `bun src/daemon/index.ts` trần, vì:
#   - generate_speech_audio / synthesize_bgm_or_sfx cần `uv`
#   - render_remotion_video cần `bunx`
# mà cả hai đều được scripts/setup-environment.sh cài vào ~/.local/bin,
# thư mục này KHÔNG nằm trong PATH mặc định của daemon.
# Cách dùng:
#   bash scripts/run-daemon.sh                       # chạy foreground
#   nohup bash scripts/run-daemon.sh >> ~/workspace/chatmcp-daemon.log 2>&1 &
set -u
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:$REPO_ROOT/bin:$PATH"
cd "$REPO_ROOT"
echo "PATH=$PATH"
echo "uv: $(command -v uv || echo 'MISSING')"
echo "bunx: $(command -v bunx || echo 'MISSING')"
exec bun src/daemon/index.ts --tunnel "$@"
