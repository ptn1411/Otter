# ChatMCP Model Context Protocol (MCP) Server Specification & User Guide

Chào mừng bạn và AI Agent đến với **ChatMCP** — Cầu nối toàn diện (Super MCP Bridge) giữa các mô hình AI (ChatGPT, Claude, Cursor) và hệ điều hành máy tính cục bộ.

---

## 1. Danh Mục Đầy Đủ 28 Công Cụ MCP (MCP Tools Inventory)

*(Bảng dưới đây là bản gốc. Các nhóm công cụ mới từ 2026-10-30/31 — plan, Facebook, database, task queue — nằm ở mục 4 cuối tài liệu, và prompt MCP `otter_agent_workflow` trong `src/daemon/tools/prompt.ts` là bản khai báo đầy đủ nhất cho AI Agent.)*

ChatMCP cung cấp 5 nhóm công cụ chính:

### Nhóm 1: Điều Khiển Màn Hình & Desktop (Computer Use & Automation)
| Tên Tool | Mô tả | Tham số |
| :--- | :--- | :--- |
| **`desktop_list_windows`** | Liệt kê tất cả cửa sổ ứng dụng và tiến trình GUI đang mở trên máy tính | Không có |
| **`desktop_take_screenshot`** | Chụp ảnh toàn màn hình để AI quan sát giao diện | `outputPath` *(tùy chọn)* |
| **`desktop_mouse_action`** | Di chuyển chuột và click tại toạ độ $(x, y)$ | `action` (`left_click`, `right_click`, `double_click`, `move`), `x`, `y` |
| **`desktop_keyboard_action`**| Gõ văn bản hoặc gửi phím tắt hệ thống | `keys` (hỗ trợ text, `{ENTER}`, `^c`, `^v`, `%{F4}`, `{TAB}`) |
| **`cua_get_inventory`** | Tra cứu 61 công cụ Computer Use Agent chuyên sâu của OpenAI trong `bin/cua/` | `query` *(lọc theo từ khóa)* |

---

### Nhóm 2: Sản Xuất Video & Âm Thanh Tự Động (Remotion & DSP)
| Tên Tool | Mô tả | Tham số |
| :--- | :--- | :--- |
| **`skills_list`** | Liệt kê danh mục kỹ năng AI (bao gồm `remotion-video-creator`) | `category` *(tùy chọn)* |
| **`skills_get`** | Đọc chi tiết tài liệu hướng dẫn chuẩn kỹ thuật `SKILL.md` | `skill_name` (`remotion-video-creator`) |
| **`skills_search`** | Tìm kiếm skill phù hợp với yêu cầu người dùng | `query` *(từ khóa nghiệp vụ)* |
| **`generate_speech_audio`** | Tạo giọng đọc AI thuyết minh tiếng Việt chuẩn truyền hình (Edge-TTS) | `text`, `outputFile`, `voice` (`vi-VN-NamMinhNeural` / `vi-VN-HoaiMyNeural`) |
| **`synthesize_bgm_or_sfx`** | Tổng hợp nhạc nền BGM & SFX thuần toán học DSP (NumPy) | `style` (`cyber`, `anime`, `acoustic`, `sfx`, `all`), `outputDir`, `duration` |
| **`render_remotion_video`** | Biên dịch và kết xuất video MP4 hoàn chỉnh bằng Remotion | `projectDir`, `compositionId`, `outputFile` |

---

### Nhóm 3: Bộ Nhớ Tri Thức Đồ Thị Mã Nguồn (Codebase Memory Graph)
| Tên Tool | Mô tả | Tham số |
| :--- | :--- | :--- |
| **`codebase_list_projects`** | Liệt kê các dự án codebase đã lập chỉ mục AST | `detail` (`identity`, `stats`) |
| **`codebase_index_repository`**| Lập chỉ mục kiến trúc đồ thị AST cho repository | `repo_path`, `mode` (`fast`, `moderate`, `full`) |
| **`codebase_search_graph`** | Tìm kiếm hàm, class, route, biến trong đồ thị | `name_pattern`, `label`, `project`, `limit` |
| **`codebase_trace_path`** | Lần vết luồng gọi hàm đa tầng (Call graph 2 chiều) | `function_name`, `direction` (`inbound`, `outbound`, `both`), `depth` |
| **`codebase_get_snippet`** | Đọc chính xác đoạn code định nghĩa hàm/lớp | `qualified_name`, `project` |
| **`codebase_get_architecture`**| Xem kiến trúc tổng quan hệ thống và dependencies | `project`, `aspects` (`overview`, `structure`, `routes`...) |
| **`codebase_manage_adr`** | Quản lý các quyết định kiến trúc dài hạn (ADR) | `action` (`list`, `get`, `create`, `decide`), `title`, `decision` |

---

### Nhóm 4: Thực Thi Dòng Lệnh & Quản Lý Tệp
| Tên Tool | Mô tả | Tham số |
| :--- | :--- | :--- |
| **`execute_terminal_command`**| Thực thi lệnh console PowerShell hoặc CMD | `command`, `cwd` *(tùy chọn)* |
| **`read_file`** | Đọc nội dung tệp tin văn bản hoặc mã nguồn | `filePath` |
| **`write_file`** | Tạo mới hoặc ghi đè nội dung tệp tin | `filePath`, `content` |

---

### Nhóm 5: Quản Trị Máy Chủ VPS Từ Xa (SSH & SFTP via Python Paramiko)
| Tên Tool | Mô tả | Tham số |
| :--- | :--- | :--- |
| **`vps_session_open`** | **Mở phiên SSH tương tác liên tục KHÔNG TẮT (Keep-Alive)**, giữ nguyên `cd`, biến môi trường, stream trực tiếp lên Live Terminal | `host`, `user`, `port`, `key`, `password`, `conversationId` |
| **`vps_session_send`** | Gửi lệnh tiếp nối vào phiên SSH đang mở liên tục để chat/chạy lệnh không ngừng | `command`, `sessionId` *(tùy chọn)* |
| **`vps_test_connection`** | Kiểm tra độ trễ và thông số hệ thống của VPS qua SSH handshake | `host`, `user`, `port`, `key`, `password`, `timeout` |
| **`vps_ssh_execute`** | Thực thi lệnh bash/shell từ xa đơn lẻ trên VPS | `host`, `command`, `user`, `port`, `key`, `password`, `cwd`, `timeout` |
| **`vps_sftp_upload`** | Tải tệp hoặc toàn bộ thư mục từ máy tính lên VPS | `host`, `local`, `remote`, `user`, `port`, `key`, `password` |
| **`vps_sftp_download`** | Tải tệp từ VPS về máy tính để phân tích | `host`, `remote`, `local`, `user`, `port`, `key`, `password` |
| **`vps_sftp_list`** | Liệt kê danh sách tệp & thư mục kèm thuộc tính trên VPS | `host`, `remote_dir`, `user`, `port`, `key`, `password` |

---

### Nhóm 6: Tự Động Hóa Trình Duyệt Web (Browser Automation - AI Làm Não)
| Tên Tool | Mô tả | Tham số |
| :--- | :--- | :--- |
| **`browser_open`** | Mở trang web bất kỳ trên Google Chrome cục bộ của người dùng | `url` |
| **`browser_read_page`** | Đọc cấu trúc DOM nén rút gọn dạng text + bảng interactive elements đánh số `[1]`, `[2]`... | Không có |
| **`browser_click`** | Bấm chuột W3C + Hit-testing vào phần tử theo chỉ số `[index]` | `index` |
| **`browser_type`** | Nhập văn bản vào ô input theo `[index]` (hỗ trợ React bypass & Enter) | `index`, `text`, `pressEnter` *(tùy chọn)* |
| **`browser_select`** | Chọn option trong thẻ dropdown `<select>` theo `[index]` | `index`, `option` |
| **`browser_scroll`** | Cuộn trang lên/xuống mượt mà | `direction` (`up`/`down`), `amount` *(tùy chọn)* |
| **`browser_back`** | Quay lại trang trước trong lịch sử duyệt web | Không có |
| **`browser_inject_chat_message`** | Bơm trực tiếp thông điệp hoặc báo cáo vào ô chat của ChatGPT Web | `message`, `autoSubmit` *(tùy chọn)* |

---

## 2. Hướng Dẫn Dành Cho AI Agent (Workflow Guide)

Khi người dùng đưa ra một yêu cầu, AI Agent nên tuân theo các kịch bản sau:

### Kịch bản A: Người dùng yêu cầu điều khiển phần mềm hoặc thao tác màn hình
1. **Bước 1**: Gọi `desktop_list_windows` để biết cửa sổ ứng dụng mục tiêu đang ở đâu và PID là gì.
2. **Bước 2**: Gọi `desktop_take_screenshot` để chụp ảnh màn hình và xác định toạ độ nút/ô nhập liệu.
3. **Bước 3**: Gọi `desktop_mouse_action` (với toạ độ $x, y$) và `desktop_keyboard_action` (để gõ phím/Enter).
4. **Bước 4**: Chụp lại màn hình sau khi thao tác để xác nhận kết quả đã hoàn tất.

### Kịch bản B: Người dùng yêu cầu tạo video hoặc thêm âm thanh
1. **Bước 1**: Gọi `skills_get("remotion-video-creator")` để đọc hướng dẫn chuẩn về cấu trúc Sequence, Audio Ducking và Google Fonts.
2. **Bước 2**: Gọi `generate_speech_audio` để tạo file giọng đọc AI theo từng cảnh (ví dụ: `voice1.mp3`, `voice2.mp3` đặt trong `public/`).
3. **Bước 3**: Gọi `synthesize_bgm_or_sfx` để tạo nhạc nền BGM và các hiệu ứng SFX.
4. **Bước 4**: Viết/sửa code Remotion trong `src/index.tsx` tích hợp đầy đủ `<Audio />` và typography UTF-8.
5. **Bước 5**: Gọi `render_remotion_video` để xuất ra file `out.mp4` hoàn chỉnh.

### Kịch bản C: Người dùng yêu cầu phân tích/sửa lỗi trong mã nguồn
1. **Bước 1**: Gọi `codebase_search_graph` tìm các biểu tượng liên quan đến lỗi hoặc tính năng.
2. **Bước 2**: Gọi `codebase_trace_path` để xem luồng gọi hàm trước và sau.
3. **Bước 3**: Gọi `codebase_get_snippet` để xem đoạn mã nguồn mà không cần tải cả file lớn.
4. **Bước 4**: Áp dụng sửa lỗi gốc và dùng `execute_terminal_command` chạy test kiểm thử.

---

## 3. Cách Kết Nối Dành Cho Người Dùng & Các Client AI

### 1. Kết nối với ChatGPT (Web / Chrome Extension):
- Server public tunnel mẫu: `https://your-domain.trycloudflare.com/mcp` (hoặc URL tunnel của bạn)
- Hoặc kết nối qua tiện ích mở rộng Chrome trong thư mục `extension/`.

### 2. Kết nối với Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "chatmcp": {
      "command": "bun",
      "args": ["src/daemon/index.ts"],
      "cwd": "/path/to/otter"
    }
  }
}
```

### 3. Kết nối với Cursor / Cline / Roo Code:
- Thêm MCP server loại `SSE` với URL: `http://localhost:1993/sse`
- Hoặc Streamable HTTP URL: `http://localhost:1993/mcp`

### 4. Kết nối với Antigravity IDE & Gemini CLI (`mcp_config.json`):
Thêm server vào `~/.gemini/antigravity/mcp_config.json` hoặc `~/.gemini/config/mcp_config.json`:
```json
{
  "mcpServers": {
    "otter": {
      "type": "http",
      "url": "http://localhost:1993/mcp"
    }
  }
}
```

---

## 4. Các Nhóm Công Cụ Bổ Sung (từ 2026-10-30/31, chưa có trong bảng 28 tool gốc)

Các tool dưới đây đã đăng ký trong `src/daemon/mcp.ts` nên MCP client thấy qua `tools/list` tự động. Riêng ChatGPT Web biết tới chúng qua prompt MCP `otter_agent_workflow` (`src/daemon/tools/prompt.ts`, nhóm 9–15) và qua thẻ Quản Lý Tổng của extension.

### Nhóm A: Vòng lặp code liên tục theo plan (13 tool)
| Tên Tool | Mô tả |
| :--- | :--- |
| `plan_create`, `plan_add_task`, `plan_list`, `plan_status` | Tạo/thêm việc/liệt kê/xem trạng thái plan |
| `plan_pause`, `plan_resume`, `plan_start`, `plan_cancel` | Tạm dừng/chạy tiếp/bắt đầu/hủy plan |
| `plan_next`, `plan_resume_prompt`, `plan_enqueue_prompt`, `plan_outbox` | Lấy task tiếp theo, prompt tiếp tục/kết thúc, xem injection outbox |
| `plan_task_update` | Sửa title/notes/status/dependsOn của một task (từ chối id lạ, status không hợp lệ) |

### Nhóm B: Facebook — đọc & trả lời bình luận (15 tool)
| Tên Tool | Mô tả |
| :--- | :--- |
| `fb_read_comments` | Đọc bình luận có cấu trúc (author, thời gian, đã tự trả lời chưa) |
| `fb_reply_start`, `fb_reply_record`, `fb_reply_next`, `fb_reply_save_draft` | Mở phiên, ghi nhận, lấy việc tiếp theo, lưu bản nháp |
| `fb_reply_draft_prompt`, `fb_reply_send_to_chatgpt` | Soạn prompt trả lời, đẩy qua injection outbox cho ChatGPT Web soạn |
| `fb_reply_mark_replied`, `fb_reply_mark_skipped`, `fb_reply_mark_failed` | Ghi kết quả từng bình luận |
| `fb_reply_status`, `fb_reply_finish`, `fb_reply_stop`, `fb_reply_pause`, `fb_reply_resume` | Trạng thái, kết thúc, dừng/tạm dừng/chạy tiếp |

Mặc định: draft trước, 20 bình luận / 60 phút / nhịp 5–20s. ChatGPT soạn câu trả lời, daemon chỉ ghi sổ.

### Nhóm C: Facebook — đăng bài tin mới tự động (11 tool)
| Tên Tool | Mô tả |
| :--- | :--- |
| `fb_post_start`, `fb_post_fetch_news`, `fb_post_next` | Mở phiên, lấy tin RSS, lấy bài tổng hợp (mặc định 5 tin + link + nguồn) |
| `fb_post_mark_posted`, `fb_post_mark_failed`, `fb_post_mark_skipped` | Ghi kết quả từng bài |
| `fb_post_status`, `fb_post_finish`, `fb_post_stop`, `fb_post_pause`, `fb_post_resume` | Trạng thái, kết thúc, dừng/tạm dừng/chạy tiếp |

Chế độ auto (không duyệt trước), mặc định 1 bài/phiên, cửa sổ 60 phút, chống đăng trùng cùng link. Bước bấm Đăng chưa kiểm chứng trên tab đã đăng nhập — lần đầu cần người giám sát.

### Nhóm D: Quản lý database bằng Python (10 tool, wrapper qua `tools/db-manager/bin/dbm`)
| Tên Tool | Mô tả |
| :--- | :--- |
| `db_profile_add`, `db_profile_list`, `db_profile_show`, `db_profile_remove` | Quản lý profile (không lưu password) |
| `db_test`, `db_list_databases`, `db_list_tables`, `db_describe_table` | Kiểm tra kết nối, liệt kê DB/bảng, mô tả bảng |
| `db_query`, `db_export` | Truy vấn (mặc định chỉ đọc, limit 100, timeout 30s), xuất bảng |

An toàn bắt buộc: ghi chỉ khi `db_query` được gọi với cả `allowWrite=true` VÀ `confirmWrite=true`. Hỗ trợ SQLite (chạy ngay), PostgreSQL/MySQL/MongoDB/Redis (cần cài driver).

### Nhóm E: Hàng đợi task cho worker IDE/Giano (13 tool)
`ide_dispatch_task`, `ide_get_task_status`, `ide_queue_stats`, `ide_task_complete`, `giano_dispatch_task`, `giano_task_pull`, `giano_task_ack`, `giano_task_progress`, `giano_task_release`, `giano_task_complete`, `giano_task_heartbeat`, `giano_get_task_result`, `giano_queue_stats`.

### Nhóm F: Code workspace — tìm kiếm & phác thảo không cần index (5 tool)
| Tên Tool | Mô tả |
| :--- | :--- |
| `code_search_text` | Tìm chuỗi/regex toàn repo bằng ripgrep (fallback grep), không cần index; bỏ qua .git, node_modules, dist, file nhị phân; giới hạn output |
| `code_list_files` | Liệt kê file theo glob, bỏ qua .git, node_modules, __pycache__, dist; có cờ truncated |
| `code_find_symbol` | Tìm định nghĩa theo chuỗi tên: TS/JS (function, class, interface, type, const arrow) và Python (def, class) |
| `code_outline` | Phác thảo một file, chỉ symbol cấp cao nhất, tối đa 200 symbol |
| `code_git_status` | CHỈ ĐỌC: git status --short + diff --stat, diff đầy đủ tùy chọn tối đa 200 dòng; không bao giờ ghi |

Nhóm này không ghi file repo; mọi đường dẫn qua cùng luật workspace an toàn như terminal. Xem thêm `plan_task_update` ở nhóm A (đăng ký cùng `registerCodeTools` nhưng tính vào nhóm plan).

### Nhóm G: Bộ điều khiển vòng lặp code chuẩn (10 tool)
| Tên Tool | Mô tả |
| :--- | :--- |
| `loop_start` | Bắt đầu vòng lặp cho plan đang running; từ chối nếu task thiếu goal/details/verify hoặc dependsOn không hợp lệ (G0). Ngân sách mặc định 20 lượt / 60 phút |
| `loop_next` | Lấy task ready tiếp theo theo thứ tự + dependsOn; task failed còn lượt được dispatch lại; từ chối kèm lý do khi loop không running, hết ngân sách (tự pause làm checkpoint), plan không running, đã có task đang chạy |
| `loop_report_attempt` | Báo cáo passed (task done — chỉ passed mới được done) hoặc failed (tính vào luật 3 lần + 3 lượt không tiến triển → block task + loop kèm bằng chứng) |
| `loop_status`, `loop_pause`, `loop_resume`, `loop_stop` | Trạng thái + ngân sách còn lại; tạm dừng/chạy tiếp (có thể nới ngân sách)/dừng hẳn |
| `loop_block` | Block task + loop vì cần người quyết hoặc verify gate từ chối, kèm reason + decisionNeeded; không bao giờ tự bỏ qua test fail |
| `loop_run_suite` | Chạy một suite hồi quy đã đăng ký theo id (không nhận đường dẫn tùy ý); kết quả ghi vào loop_suite_runs |
| `loop_finish` | Cổng cuối có cưỡng chế: chỉ pass khi mọi task done VÀ mọi suite đăng ký pass; nếu không trả về đúng task/suite còn mở |

Sync lên `nam` KHÔNG thuộc cổng cuối — đó là bước thủ công (sync_to_nam.sh + verify hash) sau khi `loop_finish` pass.

### Nhóm H: Fleet / multi-node (8 tool, B2)
| Tên Tool | Mô tả |
| :--- | :--- |
| `fleet_list`, `fleet_register`, `fleet_remove_node` | Liệt kê / đăng ký / gỡ worker node trên hub (node_id, apiBase trên mạng riêng, projects, capabilities; stale sau 90s không heartbeat) |
| `fleet_dispatch` | Giao task cho worker: hub tạo dispatch record, POST sang worker `/api/fleet/dispatch` kèm token; worker tạo plan local + đưa prompt vào outbox cho ChatGPT của worker; gửi lại cùng dispatch_id không tạo plan mới |
| `fleet_status`, `fleet_result` | Poll worker `/api/fleet/inbox/:id` để cập nhật trạng thái thật (done/blocked/timed_out/cancelled) về hub |
| `fleet_cancel` | Hủy dispatch trên hub và gửi cancel sang worker (worker hủy plan local) |
| `fleet_inbox` | Xem inbox dispatch mà daemon này đã nhận với vai trò worker |

Fleet chỉ chạy trên mạng riêng (Tailscale/SSH relay), token không bao giờ lưu trong DB fleet, project_root ngoài allowlist của worker bị từ chối. Worker không có ChatGPT tab đang nối thì dispatch vẫn tạo plan + outbox pending chờ tab nối lại, hub báo rõ trạng thái đó thay vì âm thầm chạy hộ.

### Nhóm I: Chrome theo profile (2 tool, chạy trên máy đó)
| Tên Tool | Mô tả |
| :--- | :--- |
| `chrome_list_profiles` | Liệt kê profile Chrome trên máy này từ Local State (thư mục Default/Profile N, tên hiển thị, đường dẫn) |
| `chrome_open_profile` | Mở Chrome với đúng profile (tên thư mục, tên hiển thị duy nhất, hoặc đường dẫn trong user-data-dir), mặc định mở https://chatgpt.com; spawn detached, không kill Chrome đang chạy, chỉ nhận URL http(s), máy headless không DISPLAY thì báo lỗi rõ. Có `browserPath` thì mở đúng file trình duyệt user cung cấp (ví dụ GPM), profile truyền thẳng thành --profile-directory, không tra Chrome Local State |

Hub KHÔNG mở Chrome hộ worker: luồng B2 là dispatch → ChatGPT của worker gọi `chrome_open_profile` trên máy worker → tab ChatGPT của worker mở ra, extension nối về daemon worker → worker chạy loop. Nút "Mở Chrome theo profile" trong tab Management cũng gọi daemon đang chọn qua `POST /api/chrome/open`.

### Nhóm J: Page Loop — vòng lặp trên trang ChatGPT (10 tool, plan nâng cấp từ codex-web)
| Tên Tool | Mô tả |
| :--- | :--- |
| `page_loop_start` | Bắt đầu phiên page-loop (explicit opt-in, mặc định tắt; 10 lượt / 30 phút). Auto: enqueue prompt đầu + báo tab bắt đầu watcher. Zero-risk: chỉ trả preparedPrompt, user tự paste/gửi, daemon không đọc/sửa DOM |
| `page_loop_stop`, `page_loop_resume` | Dừng ngay (revoke token, trả lease, outbox pending của phiên không gửi nữa) / tiếp tục phiên paused |
| `page_loop_status`, `page_loop_list` | Trạng thái phiên (lượt, checkpoint, receipt, budget còn lại; không trả token thật) / danh sách phiên + lease |
| `page_loop_confirm_sent`, `page_loop_prepare_next` | Zero-risk only: xác nhận user đã gửi tay / chuẩn bị prompt tiếp theo không enqueue |
| `page_loop_lease_list`, `page_loop_lease_heartbeat` | Lease đang chạy/stale (tối đa 5/daemon, stale sau 120s không heartbeat) / cập nhật heartbeat |
| `doctor_run` | Doctor end-to-end: DB, phiên đang chạy, outbox, lease, tab extension, Chrome/GPM path; không trả secret/token/nội dung hội thoại |

Page-loop: trang chỉ cảm biến + bấm nút, daemon quyết định. Lượt gắn bằng data-turn-id (không dùng chỉ số hiển thị), settle = hết generate 5s + DOM yên 2s + không MCP activity 5s, tool-paused không tính là settled. Marker: OTTER-DONE (xong task/phiên), OTTER-CHECKPOINT (compaction epoch mới). Token theo lượt chỉ lưu hash trong DB, không lưu token thật, fleet không mang token sang worker. Selector turn CHƯA xác minh trên trang thật có đăng nhập — xem docs/plans/2026-10-31-chatgpt-page-loop-dom-notes.md khi Phase 0 làm xong (hiện chưa có file này, vì lần code này không có tab thật).

### Nhóm K: Motion MCP free — tìm docs/ví dụ Motion và đọc source thật
| Tên Tool | Mô tả |
| :--- | :--- |
| `motion_search-motion-docs` | (Qua gateway, từ mcp_config.json: server `motion` https://mcp.motion.dev, không cần key) Tìm docs/ví dụ/Motion UI theo platform js/react/vue + searchTerm cụ thể. Trả resource_links motion:// — phải đọc bằng `motion_read_doc` trước khi viết code |
| `motion_insert-motion-component` | (Qua gateway, cùng server) Liệt kê component/section/ví dụ khớp query dưới dạng text + resource_links. Lưu ý: panel UI chỉ hiện ở host hỗ trợ MCP Apps; ở ChatGPT Web qua daemon này chỉ nhận được danh sách text, user phải nói tên thứ muốn chèn trong chat |
| `motion_read_doc` | Đọc nội dung đầy đủ của một URI motion:// (docs/examples) từ server free; chỉ chấp nhận scheme motion://, timeout 20s, cắt ở 20.000 ký tự |

Motion: dùng skill `motion` (best-practices) trước, search rồi đọc source thật, import từ `motion` (`motion/react`, `motion-v`) — `framer-motion` là tên cũ, chỉ đổi tên khi user đồng ý. Kết quả search có thể chứa mục Motion+ (trả phí): đó chỉ là metadata (title, mô tả, MotionScore, link demo), không có source để đọc và không được suy ra source/methodology từ mô tả. Server Motion+ (mcp.motion.dev/plus, cần đăng nhập) KHÔNG nối vào daemon.

### Nhóm L: Facebook Feed Engagement, Messenger Auto-Listener & Kịch Bản Bán Hàng SQLite (16 tool)
| Tên Tool | Mô tả |
| :--- | :--- |
| `fb_feed_scan`, `fb_feed_engage_post`, `fb_feed_history` | Quét Bảng feed Facebook (lọc bài tài trợ/trùng), tương tác like/comment theo ngữ cảnh, xem lịch sử tương tác SQLite |
| `fb_messenger_open_list`, `fb_messenger_sales_reply`, `fb_messenger_history` | Mở danh sách chat, trả lời tin nhắn theo phễu bán hàng, xem lịch sử tin nhắn của khách hàng |
| `fb_messenger_listen_start`, `fb_messenger_listen_stop`, `fb_messenger_listen_status` | Quản lý tiến trình chạy ngầm 24/7 tự động lắng nghe tin nhắn mới và tự động rep theo kịch bản |
| `fb_notifications_read`, `fb_notification_open_and_reply` | Đọc thông báo Facebook, mở bài viết từ thông báo và tự động rep bình luận theo kịch bản |
| `fb_sales_get_playbook` | Xem toàn bộ kịch bản bán hàng (phễu 6 giai đoạn, intent nhận diện ý định và bình luận dạo) trong SQLite |
| `fb_sales_update_stage` | ChatGPT Web cập nhật câu mẫu cho từng bước phễu (`greeting`, `discovery`, `pitch`, `objection`, `closing`, `support`) |
| `fb_sales_update_intent` | ChatGPT Web cập nhật câu trả lời khi khách hỏi theo ý định (`identity`, `features`, `pricing`, `praise`, `objection_safety`, `general_support`) |
| `fb_sales_update_comments` | ChatGPT Web cập nhật câu bình luận dạo theo chủ đề (`travel`, `shop`, `general`) |
| `fb_sales_reset_playbook` | Khôi phục toàn bộ kịch bản bán hàng & bình luận về mặc định ban đầu |

