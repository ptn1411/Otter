# Tổng kết chatmcp: những gì đã làm được và toàn bộ tính năng

Ngày: 2026-10-31. Ngôn ngữ tài liệu: tiếng Việt.
Bản local: `~/workspace/code/chatmcp/`. Bản trên `nam`: `~/code/chatmcp/`.
Daemon: Bun + TypeScript, cổng 1993, v2.0.0, branch `main`.
Số liệu tool đếm trực tiếp từ mã nguồn ngày 2026-10-31 (lệnh `mcp.tool(` trong
`src/daemon/tools/*.ts`): **132 tool**, chưa kể external MCP gateway.

## 1. Trạng thái vận hành hiện tại

- Daemon đang chạy trên VM này: `http://127.0.0.1:1993`
  (`/activity`, `/openapi.json`, `/plan-dashboard` đều 200).
- License đã kích hoạt: Enterprise (trial, distributor cấp), leased token hết
  hạn 2026-11-07, tự làm mới qua heartbeat khi online. Key/email không ghi ở đây.
- Truy cập từ xa qua `nam`: SSH reverse tunnel tự nối lại
  (`127.0.0.1:11993` trên `nam`) + relay Python
  (`100.111.68.103:11994` → `11993`), đã kiểm chứng đầu cuối 200.
  Caveat: chưa đặt `OTTER_API_KEY` nên qua URL `nam` chỉ mở được path public
  (`/activity`); muốn dùng đủ dashboard thì SSH local forward từ máy người dùng
  hoặc đặt key + restart + nhập token vào extension.
- Cloudflare Quick Tunnel từ VM này **thất bại** (cloudflared không bắt tay TLS
  được tới `api.trycloudflare.com`) nên chưa có domain public.
- VM này là session-based, không sống sót khi VM thay mới; `nam` mới là máy
  chạy 24/7. Mọi code đều sync về `nam` bằng `~/workspace/sync_to_nam.sh`.

## 2. Phần A — Những gì đã làm được trong đợt này (30–31/10/2026)

### 2.1. Vòng lặp code liên tục, Phases 1–7 (xong, đã sync)

- Plan bền vững trên SQLite: bảng `plans`, `plan_tasks`, cột mới cho `tasks`.
- Logic thuần `src/daemon/plan.ts`; 13 tool plan (xem mục 3).
- Hàng đợi bền + khôi phục sau khởi động, heartbeat 60s + sweeper
  (task stale > 5 phút, tối đa 3 lần).
- Injection outbox (dedupe theo hash, retry tối đa 5, ack, WS backoff).
- Verify gate + từ chối task nguy hiểm.
- Test: `test-plan-phase1` 23/23, `test-continuous-loop` 21/21, pass cả hai máy.

### 2.2. Plan Dashboard (xong, đã sync)

- Trang `/plan-dashboard` + API `/api/plans` (list/detail/resume-prompt/
  pause/resume/cancel).
- Test: `test-plan-dashboard` 11/11.

### 2.3. Extension Management Center (xong, đã sync)

- Tab thứ 5 "Quản Lý Tổng" trên trang Options (trước đó có 4 tab: Commands,
  Guide, License, Settings).
- Plans (pause/resume/cancel/detail/outbox/copy resume prompt), trạng thái
  hàng đợi daemon, danh sách skill có tìm kiếm, form thêm máy chủ, tự làm mới
  5/10/30s, thông báo blocked/done, quick link Dashboard/Activity/ChatGPT.
- Thẻ tĩnh "Nhóm công cụ MCP" liệt kê các nhóm tool + số lượng (cập nhật theo
  từng đợt thêm tool: hiện có Loop controller 10, Code workspace 5, Plans 13...).
- Chưa có: tạo plan từ extension, sửa/xóa skill từ extension, test trong
  Chrome thật.

### 2.4. Vòng lặp trả lời bình luận Facebook (tracker + reader xong, đã sync)

- Kiến trúc: ChatGPT soạn, daemon ghi sổ (daemon không có LLM).
- Tracker: `fb-reply.ts` + 15 tool `fb_reply_*` + `fb_read_comments`,
  bảng `fb_reply_runs`/`fb_reply_comments` (UNIQUE run_id + comment_key).
- Reader: `BrowserController.readComments()` trong extension, scope vào dialog
  đầu tiên chứa bình luận (cuộn trang không load thêm bình luận bài gốc mà load
  bài khác, nên không được quét toàn trang).
- DOM đã soi live trên 2 bài public (chỉ đọc, chưa đăng nhập): bình luận là
  `<article>` ngang hàng, phân biệt bằng accessible name
  (`Bình luận dưới tên <tác giả> vào <thời gian>` /
  `Phản hồi bình luận của <cha> dưới tên <tác giả> vào <thời gian>`);
  tác giả tách từ tên này, không lấy link đầu tiên (với phản hồi, link đầu có
  thể là người được nhắc tới). Nút tải thêm "Xem thêm bình luận" (+3/lần),
  nút mở phản hồi "Xem 1 phản hồi" / "Xem tất cả N phản hồi". Không dùng tổng
  số hiển thị (401 vs 3/180) làm điều kiện dừng.
- Parser bền vững `fb-comment-parser.ts` (fallback VN/EN, làm sạch badge).
- Test: `test-fb-reply` 12/12, `test-fb-comment-parser` 19/19, pass cả hai máy.
- Bug thật bắt được: sắp xếp theo (created_at, id) không ổn định khi nhiều
  bình luận cùng mili-giây → đổi sang sắp xếp theo SQLite `rowid`.
- Chưa kiểm chứng: bấm Trả lời + gõ + gửi trên tab đã đăng nhập (khi chưa
  đăng nhập không thấy nút Trả lời/ô nhập). Cần Chrome của người dùng đã đăng
  nhập Facebook + extension mới + daemon chạy.

### 2.5. Đăng bài tin mới tự động lên Facebook (code xong, đã sync)

- Người dùng chọn **đăng tự động luôn**, không duyệt trước.
- Tracker `fb-post.ts` (auto only, maxPosts mặc định 1, digestSize 5, cửa sổ
  60 phút) + `fb-news.ts` (RSS fetch timeout 15s, parser regex, feed lỗi trả []).
- 11 tool `fb_post_*`, bảng `fb_post_runs`/`fb_post_items`
  (UNIQUE run_id + item_key = sha256 của link)/`fb_post_digests`.
- Test: `test-fb-post` 38/38, pass cả hai máy.
- RSS mặc định đã verify live: VnExpress `tin-moi-nhat.rss` (45 tin),
  Tuổi Trẻ `home.rss` (50 tin; link tin-moi-nhat 301 về home).
- Chưa có: URL đích đăng bài + chủ đề tin (chờ người dùng), lịch chạy tự động
  mỗi sáng, test live fetch RSS qua đường MCP tool, bấm Đăng trên tab đã đăng
  nhập (không hardcode selector; `fb_post_next` chỉ dẫn dùng `browser_*` chung).

### 2.6. DB Manager tích hợp vào chatmcp (xong, đã sync)

- Python, phong cách VPS-SSH: SSH key-only, profile không lưu password
  (env var hoặc getpass), tunnel tự đóng khi thoát.
- Driver: SQLite chạy ngay (stdlib); PostgreSQL/MySQL/MongoDB/Redis đã code
  (optional import, thiếu driver báo rõ gói pip); SQL Server stub.
- An toàn: mặc định chỉ đọc (tokenizer classifier), ghi cần `--write` + gõ YES
  nêu profile + câu lệnh, `--dry-run`, limit 100, timeout 30s.
- MCP wrapper `db-tools.ts` (10 tool `db_*`, spawnSync 30s mặc định/120s tối
  đa, `DBM_HOME` dùng chung CLI ↔ daemon, không xử lý password ở TypeScript).
- Canonical duy nhất: `tools/db-manager/` (24 file); thư mục cũ
  `~/workspace/code/db-manager/` giờ là symlink trỏ tới đó.
- Test: Python unittest 35/35, `test-db-tools` 18/18, pass cả hai máy.
- Chưa verify: gọi `db_*` qua daemon MCP đang chạy thật, Postgres/MySQL/
  Mongo/Redis với server thật, tunnel SSH thật.

### 2.7. Khai báo tool cho ChatGPT Web (xong, đã sync)

- Đăng ký MCP trong `mcp.ts` đã đủ cho client thấy qua `tools/list`.
- Đã bổ sung 3 chỗ từng thiếu: prompt `otter_agent_workflow` trong `prompt.ts`
  (thêm các nhóm mới), `MCP_INSTRUCTIONS.md` mục 4, thẻ tĩnh trong extension.
- Hạn chế: thẻ extension là danh sách tĩnh (không có endpoint `/api/tools`),
  đổi nhóm tool thì phải sửa `options.ts`.

### 2.8. Code tools — tìm file/hàm không cần index (xong, đã sync)

- 5 tool `code_*` (ripgrep + grep fallback, dùng chung guard `assertSafePath`,
  cap output 2MB/30s/1MB): `code_search_text`, `code_list_files`,
  `code_find_symbol` (TS/JS + Python), `code_outline`, `code_git_status`
  (chỉ đọc).
- `plan_task_update` (sửa title/notes/status/dependsOn, từ chối id lạ, status
  sai, dependsOn ngoài plan). Không cần migration (cột đã có sẵn).
- Cố tình không làm trùng: `read_file` (range + số dòng) và `edit_file`
  (exact-match) đã có trong `terminal.ts`.
- Test: `test-code-tools` 25/25, pass cả hai máy.
- Chưa verify: nhánh grep fallback (máy này có rg nên chưa chạy tới), gọi qua
  daemon MCP thật, thẻ extension trong Chrome thật, cap với repo rất lớn.

### 2.9. Quy trình code chuẩn + Loop Controller (xong, đã sync)

- Tài liệu: `docs/plans/2026-10-31-standard-coding-loop.md` — 5 nguyên tắc
  (SQLite là sự thật duy nhất; test là trọng tài duy nhất quyết "xong";
  xong là làm tiếp ngay; tối đa 3 vòng sửa rồi blocked kèm bằng chứng;
  thay đổi nguy hiểm bị chặn), pipeline 7 bước, điều kiện dừng phải đủ cả 3
  (hết task + final gate pass + sync `nam` verify).
- Code: `loop-controller.ts` (state machine thuần) + 10 tool `loop_*`
  (`loop_start/next/report_attempt/status/pause/resume/stop/block/run_suite/
  finish`) + bảng `loop_runs`/`loop_attempts`/`loop_suite_runs`.
- Luật ép bằng code: task chỉ done khi có verdict pass; lần fail thứ 3 thì
  task + vòng lặp blocked kèm bằng chứng; `loop_next` từ chối khi
  blocked/paused/hết ngân sách/dependsOn chưa đủ; `loop_finish` tự chạy cả 8
  suite và chỉ pass khi mọi task done và mọi suite pass. Sync `nam` cố tình
  không nằm trong controller (vẫn là bước tay sau `loop_finish`).
- Test: `test-loop-controller` 42/42, pass cả hai máy.
- Bug thật bắt được nhờ chạy trên `nam`: runner gọi thẳng `bun` nhưng bun
  trên `nam` là user-local (`~/.local/bin/bun`), SSH không tương tác không
  thấy PATH → mọi suite chết ngay với exit code null, không output. Đã sửa:
  runner dùng `process.execPath` khi đó là bun, và ghi rõ lỗi spawn thay vì
  fail câm. Bài học: không pipe test qua `tail` khi exit code quan trọng.

### 2.10. Hạ tầng sync + skill (xong, đã sync)

- `bin/skill.ts` nâng cấp: chặn path traversal, exit code thật,
  `--json`/`--compact`, search chấm điểm, cài theo link + `sources.json`,
  clone sparse + blobless khi có `subdir`.
- Cài 7 skill HyperFrames (hyperframes 77, hyperframes-cli 13,
  hyperframes-registry 13, media-use 116, figma 2, slideshow 2,
  remotion-to-hyperframes 78 file); tổng `bin/skills/` là 9 skill gồm 2 skill
  gốc, mỗi skill cũng có bản sao ở `.agents/skills/`.
- Script sync chuẩn `~/workspace/sync_to_nam.sh`: rsync từng item + retry 4,
  `mkdir -p` thư mục cha, đích tuyệt đối `/home/nam/`, verify SHA-256 từng
  item, exit khác 0 nếu FAIL/DIFF. Quy trình từ nay: sửa local → test → chạy
  script → đọc dòng OK.

### 2.11. Bảng test tổng cộng (đợt này)

| Suite | Checks | Máy |
|---|---|---|
| test-plan-phase1 | 23 | local + nam |
| test-continuous-loop | 21 | local + nam |
| test-plan-dashboard | 11 | local + nam |
| test-fb-post | 38 | local + nam |
| test-fb-reply | 12 | local + nam |
| test-fb-comment-parser | 19 | local + nam |
| test-db-tools | 18 | local + nam |
| test-code-tools | 25 | local + nam |
| test-loop-controller | 42 | local + nam |
| Python unittest (db-manager) | 35 | local |
| **Tổng** | **244** | |

## 3. Phần B — Toàn bộ tính năng chatmcp (kể cả tính năng gốc)

### 3.1. Daemon lõi

- MCP server Bun + TypeScript, cổng 1993, HTTP + WebSocket, SQLite làm kho
  trạng thái bền vững, OpenAPI schema tại `/openapi.json`.
- Trang Activity (`/activity`), Plan Dashboard (`/plan-dashboard`), các route:
  activity, bookmarks, conversations, custom-commands, lcg, license, mcp,
  oauth, plan-dashboard, skills, system.
- License: kích hoạt online, heartbeat gia hạn token, kiểm tra trạng thái.
- Cloudflare Quick Tunnel tích hợp (`--tunnel`, cloudflared trong `bin/`);
  hiện lỗi TLS từ VM này (xem mục 1).
- Bảo mật: chặn theo Host (non-localhost cần Bearer token), guard
  `assertSafePath` chống path traversal, verify gate chặn thao tác nguy hiểm.
- Extension Chrome kết nối daemon với ChatGPT Web: điều khiển tab, injector
  một chiều (đợi tối đa 30s nếu trang đang generate rồi mới inject).

### 3.2. Nhóm tool MCP (132 tool trong `src/daemon/tools/*.ts`)

| Nhóm | Số tool | Làm gì |
|---|---|---|
| Plan (`plan_*`) | 13 | Tạo/xem/sửa plan, task, dependsOn, pause/resume/cancel, lấy việc tiếp theo, resume prompt, outbox |
| Loop controller (`loop_*`) | 10 | Vòng lặp code chuẩn: start/next/report/status/pause/resume/stop/block/run_suite/finish |
| FB reply (`fb_reply_*` + `fb_read_comments`) | 15 | Phiên trả lời bình luận, draft/auto, dedupe, verify sau gửi |
| FB post (`fb_post_*`) | 11 | Đăng tin RSS tự động, digest, dedupe theo sha256 link |
| DB manager (`db_*`) | 10 | Profile, schema, query an toàn, SSH tunnel, gate ghi |
| Code workspace (`code_*`) | 5 | Tìm chuỗi/liệt kê file/tìm symbol/outline/git status, không cần index |
| Task bridge (`ide_*` + `giano_*`) | 13 | Hàng đợi task IDE, heartbeat, báo cáo hoàn thành, prompt tiếp tục/kết thúc |
| VPS (`vps_*`) | 13 | Điều khiển máy VPS qua SSH (engine `vps_ssh.py`) |
| Terminal + file | 7 | Chạy lệnh console, đọc/ghi/sửa file (range, exact-match) |
| Codebase graph (`codebase_*`) | 7 | Tìm kiếm/lần vết/snippet/kiến trúc/ADR trên knowledge graph mã nguồn (cần index AST trước) |
| Browser (`browser_*`) | 8 | Mở/đọc/click/gõ/cuộn/quay lại tab qua extension, đọc bình luận có cấu trúc |
| Desktop + CUA (`desktop_*`, `cua_*`) | 5 | Liệt kê cửa sổ, chụp màn hình, chuột, bàn phím; tra cứu 61 tool Computer Use Agent trong `bin/cua` |
| Multi-agent (`agent_*`) | 5 | Chạy Claude/Codex/Gemini CLI, orchestrate pipeline, xem trạng thái |
| Skills (`skills_*`) | 4 | Quản lý và tra cứu skill (kể cả `skills_get`) |
| Bookmarks | 4 | Quản lý bookmark |
| Custom commands (`command_*`) | 4 | Tạo/xóa/liệt kê/ghim lệnh tùy chỉnh |
| Prompt | 2 | Workflow prompt cho agent (`otter_agent_workflow`) + prompt phụ |
| Video & audio | 3 | `render_remotion_video`, `generate_speech_audio` (giọng vi-VN), `synthesize_bgm_or_sfx` |
| MCP gateway | 2 | Liệt kê/reload external MCP server |

Ngoài ra còn có MCP gateway cho external server (số tool thay đổi theo server
ngoài, không tính trong 132).

### 3.3. Hệ thống skill

- 9 skill trong `bin/skills/` (7 HyperFrames + 2 skill gốc, gồm
  remotion-video-creator), mỗi skill có bản sao ở `.agents/skills/`.
- CLI `bin/skill.ts`: cài/search/list skill, sparse + blobless clone.
- Video: render MP4 bằng Remotion, giọng đọc AI tiếng Việt theo cảnh, nhạc
  nền BGM + SFX tổng hợp.

### 3.4. Extension Chrome (5 tab Options)

- Commands, Guide, License, Settings, Manage (Quản Lý Tổng).
- Manage: plans, hàng đợi daemon, skills, thêm máy chủ, tự làm mới,
  thông báo blocked/done, link nhanh Dashboard/Activity/ChatGPT, thẻ nhóm tool.
- Browser controller thật (mở/đọc/click/gõ) + injector ChatGPT một chiều.

## 4. Chưa làm được / còn mở

1. **Page-loop driver cho ChatGPT Web** (nút nghẽn lớn nhất): mới có plan
   (`docs/plans/2026-10-31-chatgpt-page-loop.md`, Phases 0–6, ước 5–7 ngày),
   chưa code. Cần Phase 0 soi DOM thật. Câu hỏi mở: wording marker
   `OTTER-DONE`, plan-only hay free-goal trước, siết mặc định xuống
   10 lượt / 30 phút cho lần chạy đầu không.
2. FB reply: bấm Trả lời + gửi trên tab đã đăng nhập (chờ Chrome người dùng).
3. FB auto-post: URL đích + chủ đề tin (chờ người dùng), lịch chạy mỗi sáng,
   test live fetch RSS qua MCP tool, bấm Đăng trên tab đã đăng nhập.
4. Domain Cloudflare public (Quick Tunnel lỗi TLS từ VM này; cần chạy trên
   `nam` hoặc named tunnel).
5. Chưa verify qua daemon MCP đang chạy thật: gọi `db_*`, `code_*`, `loop_*`;
   thẻ extension trong Chrome thật; cap với repo rất lớn; suite chạm timeout
   120s.
6. Việc phụ: dọn trùng `video-shotcraft` giữa `bin/skills/` và
   `.agents/skills/`; tạo plan từ extension; sửa/xóa skill từ extension.
