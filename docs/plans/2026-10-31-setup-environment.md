# Setup môi trường Node + Python cho chatmcp (2026-10-31)

## Cập nhật 2026-10-31 (chiều): bin/ chỉ chạy code, binaries là tùy chọn

Đúng như nhận xét của người dùng: bỏ hết exe khỏi `bin/` thì repo nhẹ
hơn và vẫn chạy được, vì daemon lõi không cần binary nào.

- Đã xóa khỏi `bin/`: `codebase-memory-mcp` (316 MB, chỉ cho
  `codebase_*`), `cloudflared` (39 MB, chỉ cho `--tunnel`),
  `bin/cua/cua_driver_node_runtime.node` (619 KB, DLL Windows, không
  dùng trên Linux). Tổng giải phóng ~354 MiB: `bin/` từ 440.550.887
  byte xuống còn 69.001.674 byte (phần còn lại chủ yếu là `bin/skills/`
  dạng markdown/code, không phải exe).
- `scripts/setup-environment.sh` đổi thành opt-in: mặc định chỉ cài
  lõi code thuần, binaries chỉ cài khi người dùng chọn:
  `--with-codebase`, `--with-cloudflared`, `--with-binaries`. Thiếu
  binary thì tool báo lỗi rõ ràng chứ daemon không crash (đã kiểm
  chứng: sau khi xóa, daemon vẫn lên, MCP vẫn đủ 136 tool, plan/
  terminal/synth vẫn chạy, `codebase_*` báo "Executable not found",
  tunnel báo "Không tìm thấy file thực thi cloudflared").
- `--with-cloudflared` đã kiểm chứng cài lại được từ GitHub rồi xóa
  lại để giữ `bin/` nhẹ; `--with-codebase` dùng `setup-binaries.ts`
  với `SKIP_CLOUDFLARED=1` để không kéo theo cloudflared, và
  `setup-binaries.ts` cũng nhận thêm `SKIP_CBM=1` cho chiều ngược lại.
- Khi nào cần cài lại: chỉ khi thật sự dùng nhóm tool đó, chạy đúng
  một lệnh trên rồi restart daemon bằng `scripts/run-daemon.sh`.

## Cập nhật 2026-10-31 (trưa): skills cũng opt-in, giống binaries

- Đã gỡ 8 skill khỏi CẢ `bin/skills/` lẫn `.agents/skills/` (daemon
  quét cả hai thư mục, nên chỉ gỡ một bên thì skill vẫn hiện):
  `video-shotcraft` 65M, `media-use` 2.1M, `hyperframes` 1.3M,
  `remotion-to-hyperframes` 384K, `hyperframes-cli` 148K,
  `hyperframes-registry` 116K, `slideshow` 52K, `figma` 16K.
  Tổng giải phóng ~138 MB local (~69 MB mỗi bên); `bin/` từ
  69.001.674 byte xuống còn 781.508 byte.
- Giữ lại duy nhất `remotion-video-creator` (24K): đây là skill gốc
  của Otter, không có upstream GitHub để cài lại, và nó mô tả đúng
  workflow TTS/synth mà daemon đang dùng.
- Cài lại khi cần, không mất nguồn: `bin/skills/sources.json` giữ đủ
  8 nguồn (7 HyperFrames từ heygen-com/hyperframes theo subdir
  `skills/<tên>`, cộng `video-shotcraft` từ Vincentwei1021/
  video-shotcraft mới thêm vào đợt này). Lệnh:
  `bun bin/skill.ts install <tên>` hoặc qua setup:
  `bash scripts/setup-environment.sh --with-skill=<tên>` (lặp lại
  được) / `--with-all-skills`. Đã kiểm chứng: cài `figma` (16K,
  sparse clone) thành công rồi gỡ lại, catalog về 1 skill.
- Lưu ý: cài lại bằng MCP `skills_install` chỉ hợp với skill là một
  repo riêng (video-shotcraft); skill trong monorepo HyperFrames
  phải dùng CLI trên mới sparse-clone đúng subdir.
- Sau khi gỡ, `skills_list` qua MCP chỉ còn 1 skill,
  `skills_get video-shotcraft` báo lỗi rõ ràng "not found", daemon
  vẫn chạy bình thường (không cần restart, cache skill chỉ 15s).

## Kiểm tra đa nền tảng 2026-10-31 (trưa): CHƯA đủ cả 3, nói rõ từng cái

Kết luận thẳng: **Linux là nền tảng duy nhất đã test thật end-to-end.
macOS có code path nhưng chưa chạy thật, Windows chưa có setup
tương đương và chưa test.** Không claim "hỗ trợ tốt cả 3" khi chưa có
máy thật để chạy.

| Nền tảng | Setup mới | Daemon lõi | Test thật |
|---|---|---|---|
| Linux x86_64 | `setup-environment.sh` --check exit 0, daemon 200, MCP 136 tool, skill 1, terminal/uv/paramiko OK (VM này, 2026-10-31, sau khi daemon rớt do VM thay phiên đã restart lại và test lại) | Chạy | ✅ Đã test |
| Linux arm64 | Asset mapping có sẵn (uv, codebase, cloudflared) trong script | Chưa test | ❌ Chưa có máy arm64 |
| macOS arm64/x86_64 | `setup-environment.sh` có nhánh Darwin cho uv/codebase/cloudflared (tgz), bunx shim `/bin/sh`, `run-daemon.sh` chạy được trên Terminal | Code daemon có nhánh darwin (terminal dùng zsh, desktop dùng osascript/screencapture) | ❌ Chưa chạy thật trên máy Mac nào; tên asset Darwin là giả định theo quy ước release, chưa đối chiếu với release thật |
| Windows | ❌ Không có: `setup-environment.sh` là bash, không chạy native trên PowerShell; Git Bash sẽ bị guard mới chặn lại với hướng dẫn rõ thay vì fail ngầm. `setup-binaries.ts` thì có nhánh win32 (.exe/.zip) nhưng chỉ chạy được khi gọi trực tiếp `bun scripts/setup-binaries.ts`, không qua setup script | Code daemon có nhánh win32 (tunnel dùng where.exe, cbm dùng .exe, desktop dùng PowerShell/CUA, terminal dùng PowerShell) nhưng desktop trên Linux đã từng fail, trên Windows chưa test | ❌ Chưa test, chưa có script setup Windows tương đương opt-in |

Các lỗ hổng đã sửa trong đợt này (không cần máy thật):
- Thêm guard OS đầu `setup-environment.sh`: chỉ Linux/Darwin, còn lại
  fail rõ ràng kèm hướng dẫn thủ công cho Windows, thay vì chọn sai
  asset rồi fail khó hiểu.
- Đổi thứ tự cài paramiko: thử `pip --user` thường trước, rồi mới
  `--break-system-packages`, rồi mới `uv pip` — vì pip cũ/macOS
  không có cờ đó, đưa cờ vào đầu sẽ fail ngay cả khi pip thường
  cài được. Đã test lại trên Linux: `--check` vẫn exit 0.
Các lỗ hổng còn lại, cần máy thật mới đóng được:
- Desktop trên Linux: mouse/keyboard báo "chưa hỗ trợ", screenshot
  báo thành công nhưng không ghi file (đã thấy từ sweep 2026-10-31).
- Tên asset macOS/Windows/arm64 chưa đối chiếu release thật.
- Không có `run-daemon` cho Windows, không có setup Windows opt-in.
- Extension Chrome: cần Chrome thật trên từng OS, chưa test ở đây.
Muốn đóng các mục trên cần: một máy Mac chạy
`bash scripts/setup-environment.sh` + `run-daemon.sh`, và một máy
Windows chạy `bun install` + `bun scripts/setup-binaries.ts` +
`bun src/daemon/index.ts --tunnel` rồi báo kết quả từng tool.

## Tối ưu đa nền tảng 2026-10-31 (chiều): bản setup bằng Bun

Thay vì viết thêm một script PowerShell riêng rồi lại không test
được, toàn bộ setup được viết lại bằng Bun — thứ vốn đã chạy trên
cả 3 OS — làm một nguồn duy nhất:

- Mới: `scripts/setup-environment.ts` — parity với bản `.sh`:
  check bun/node/python/ffmpeg/git/curl/tar, uv (asset theo từng
  OS/arch, zip trên Windows, tar.gz trên Unix, fallback pip),
  bunx shim (`.cmd` trên Windows, shell script trên Unix),
  paramiko (pip thường trước, rồi `--break-system-packages`, rồi
  `uv pip`), `bun install`, binaries opt-in, skills opt-in, cùng
  các cờ `--check/--with-codebase/--with-cloudflared/--with-binaries/
  --with-skill=<tên>/--with-all-skills`. Đã test trên Linux:
  `--check` exit 0, `--with-skill=figma` cài được rồi gỡ lại.
- Mới: `scripts/run-daemon.ts` — thay `run-daemon.sh` trên mọi OS:
  tự thêm user bin dir + repo bin vào PATH rồi chạy daemon.
  Daemon hiện tại đang chạy bằng chính launcher này, `/activity` 200.
- Sửa trong `setup-environment.ts` (và ghi chú cho bản `.sh`):
  Windows giờ dùng bản `.ts`, không còn bị guard chặn nữa.
- Sửa `src/daemon/desktop.ts` (tối ưu Linux, áp dụng cho mọi OS):
  screenshot giờ kiểm chứng file thật trước khi trả về — trước đây
  Linux trả 1920x1080 dù không ghi file nào; giờ trên VM headless
  này nó báo lỗi rõ ràng (isError, không có công cụ nào, cần
  DISPLAY) và không tạo file giả, daemon vẫn sống. Mouse/keyboard
  Linux giờ thử `xdotool` trước, thiếu thì báo rõ cần cài xdotool
  + màn hình thật thay vì "chưa hỗ trợ" chung chung.
  `listWindows` Linux giờ thử `wmctrl -l -p` rồi `xdotool search`.
- Sửa kèm trong bản `.ts`: cloudflared trên macOS không đi qua
  `setup-binaries.ts` nữa, vì bản đó viết trực tiếp file `.tgz`
  vào vị trí cloudflared mà không giải nén (trên macOS sẽ ra file
  hỏng); bản `.ts` tải tgz rồi giải nén đúng, và sau khi chạy
  `setup-binaries.ts` cho codebase thì kiểm chứng file thật thay
  vì tin thông báo thành công của nó.
- Vẫn CHƯA test thật: chưa có máy Mac/Windows thật để chạy bản
  `.ts` này, tên asset macOS/Windows/arm64 vẫn là giả định, và
  desktop trên máy có màn hình thật (Win/Mac/Linux desktop) vẫn
  cần chạy thử. Đừng claim "đã tối ưu xong cả 3" — đã tối ưu code
  để chạy được cả 3, còn chứng minh trên máy thật thì vẫn thiếu
  2/3 nền tảng.


## Vấn đề gốc

Quét MCP ngày 2026-10-31 cho thấy nhóm tool chạy qua shell bị hỏng
không phải do logic tool, mà do thiếu binary/thư viện trên máy chạy daemon:

| MCP tool | Lỗi trước setup | Nguyên nhân | Cách setup sửa |
|---|---|---|---|
| `generate_speech_audio` | `uv: command not found` | Tool chạy `uv run --with edge-tts ...` | Cài `uv` từ GitHub astral-sh/uv |
| `synthesize_bgm_or_sfx` | `uv: command not found` | Tool chạy `uv run --with numpy python synth_audio.py` | Cài `uv` (numpy được `uv run` tự tải) |
| `render_remotion_video` | `bunx: command not found` | Bản bun rút gọn không kèm binary `bunx` | Tạo shim `~/.local/bin/bunx` -> `bun x` |
| `vps_*` | `paramiko chưa được cài đặt` | `scripts/vps_ssh.py` import paramiko bằng `python3` hệ thống | `pip install --user paramiko` theo `scripts/requirements-vps.txt` |
| `codebase_*` | `Executable not found: codebase-memory-mcp` | `bin/codebase-memory-mcp` trống | `bun scripts/setup-binaries.ts` tải từ GitHub DeusData/codebase-memory-mcp |

## Quy trình mới (chỉ GitHub + PyPI, không server trung gian)

```bash
# Từ thư mục gốc repo, Linux/macOS:
bash scripts/setup-environment.sh            # cài + kiểm tra, exit 0 = OK
bash scripts/setup-environment.sh --check    # chỉ kiểm tra, không cài gì

# Chạy daemon — BẮT BUỘC dùng wrapper, không chạy bun trần:
bash scripts/run-daemon.sh
# hoặc chạy nền:
nohup bash scripts/run-daemon.sh >> ~/workspace/chatmcp-daemon.log 2>&1 &
```

Hai file mới:

- `scripts/setup-environment.sh` — kiểm tra bun/node/python3/ffmpeg/git/curl,
  cài `uv` (GitHub Releases, giải nén bằng `find` vì tarball nằm trong
  thư mục con), tạo shim `bunx`, cài `paramiko`, chạy `bun install` +
  `bun scripts/setup-binaries.ts`, rồi kiểm tra lại tất cả. Lặp lại được
  (idempotent), chạy lại sau mỗi lần VM bị thay là đủ.
- `scripts/run-daemon.sh` — thêm `$HOME/.local/bin` và `bin/` vào PATH
  rồi mới `exec bun src/daemon/index.ts --tunnel`.

Sửa kèm trong `scripts/setup-binaries.ts`: trước đây nó chọn asset đầu
tiên chứa `linux-amd64`, trúng file `.mcpb` (không giải nén được) rồi
vẫn in "Successfully installed" dù `bin/` vẫn trống. Nay nó ưu tiên
asset giải nén được (`.tar.gz` trên Unix, `.zip` trên Windows), loại
`.mcpb`/`.bundle`/bản `-ui-`. `setup-environment.sh` còn có fallback
tải trực tiếp asset `.tar.gz` nếu `setup-binaries.ts` vẫn chưa ra binary.

## Vì sao cài vào ~/.local/bin, không phải /usr/local/bin

`~/.local/bin` nằm trong `$HOME` nên sống qua VM replacement (giống
`~/workspace`); `/usr/local/bin` thì không. Ngược lại, `~/.local/bin`
không nằm trong PATH mặc định của daemon, nên daemon phải chạy qua
`scripts/run-daemon.sh`. Đây là điểm dễ quên nhất của cả quy trình:
sửa code hay cài binary xong mà không restart daemon bằng wrapper thì
tool vẫn báo thiếu như cũ (bun cũng không tự reload).

## Cạm bẫy đã gặp khi viết script (ghi lại để lần sau khỏi vấp)

1. **PEP 668 (externally-managed):** trên Debian/Ubuntu, `pip install
   --user` bị chặn. Phải thêm `--break-system-packages` mới cài được
   `paramiko`/`uv` vào `~/.local`.
2. **Tarball uv:** file binary nằm trong thư mục con
   `uv-x86_64-unknown-linux-gnu/uv`, `cp uv*` thư mục sẽ fail và làm
   đứt chuỗi `&&` — phải dùng `find -name uv` để lấy đúng file.
3. **Asset .mcpb:** xem mục sửa `setup-binaries.ts` ở trên.

## Kết quả kiểm chứng trên VM này (2026-10-31, sau setup)

- `bash scripts/setup-environment.sh` -> exit 0: bun 1.4.4, node
  v24.22.1, python 3.12.3, ffmpeg 8.1.2, uv 0.13.6, bunx shim,
  paramiko 5.1.0, `bin/codebase-memory-mcp` (v0.12.1), cloudflared.
- Daemon restart bằng `scripts/run-daemon.sh`, `/activity` 200.
- `synthesize_bgm_or_sfx` (sfx, 5s): **PASS** — tạo được 3 file mp3
  (ding/whoosh/pop) trong `scratch/`, đã xóa sau test.
- `codebase_list_projects`: **chạy được** (trước đây lỗi binary),
  trả `projects: 0`, hướng dẫn gọi `index_repository` trước.
- `vps_test_connection` tới 127.0.0.1: lỗi đổi từ "thiếu paramiko"
  thành "Unable to connect to port 22" — tức paramiko đã chạy, chỉ là
  không có SSH server ở đó (đúng như mong đợi).
- `generate_speech_audio`: uv + edge-tts đã chạy được tới bước gọi
  dịch vụ TTS của Microsoft, rồi fail SSL (`WRONG_VERSION_NUMBER`) do
  proxy TLS của VM này (cùng họ lỗi với cloudflared trước đây). Đây
  không còn là lỗi thiếu môi trường nữa.
- `render_remotion_video`: bunx đã chạy được (bun x resolve và tải
  16 package), rồi fail `could not determine executable to run for
  package remotion` — tool đang gọi `bunx remotion` trong khi binary
  thực thi nằm ở `@remotion/cli`. Đây là lỗi lệnh gọi trong tool,
  không sửa bằng setup môi trường, để lại cho lần sửa code sau.
- `codebase_index_repository` (fast, toàn repo): vượt quá giới hạn
  10 giây của `Bun.serve()` nên MCP bị ngắt kết nối, nhưng worker
  index vẫn chạy nền — giống hệt giới hạn đã gặp ở `agent_run_codex`.
  Index lần đầu nên chạy trực tiếp bằng binary hoặc tăng `idleTimeout`
  của daemon, không phải việc của script setup.

## Chưa làm (giới hạn của đợt này)

- Windows: script `.sh` chỉ cho Linux/macOS. Trên Windows làm tay theo
  cùng bảng ở trên: cài bun/node/python từ GitHub Releases chính thức,
  `uv` từ astral-sh/uv, `bunx` đi kèm bộ cài bun đầy đủ, rồi
  `pip install paramiko`, `bun scripts/setup-binaries.ts`.
- Browser extension, desktop Linux, và tunnel Cloudflare vẫn là các
  giới hạn riêng, không thuộc setup Node/Python này.
- Đã sync sang `nam` ngày 2026-10-31 (4 file: 2 script mới,
  `setup-binaries.ts`, doc này — hash verified). Trên `nam` vẫn cần
  chạy script này trước (nó có node 22 + python 3.12 nhưng chưa có
  bun), rồi mới chạy test bun được.
