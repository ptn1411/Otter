# Plan: Extension nhiều máy / nhiều profile + 1 ChatGPT điều phối các node khác

Ngày: 2026-10-31. Trạng thái: PLAN, CHƯA CODE. Không code cho đến khi
người dùng chọn chế độ ở cuối plan (Phase 1 độc lập, Phase 2 hub,
hay cả hai theo thứ tự).

## 1. Người dùng muốn gì (diễn giải lại, cần user xác nhận)

1. Cài extension trên nhiều máy, hoặc nhiều profile Chrome trên cùng
   một máy, và mỗi nơi làm code cho từng dự án của nó.
2. HOẶC nối các nơi đó với nhau, để 1 tab ChatGPT Web duy nhất ra
   lệnh, điều phối task cho các ChatGPT / máy khác làm, rồi tổng hợp
   kết quả về tab điều phối đó.

Hai ý này không mâu thuẫn: (1) là nền tảng bắt buộc cho (2). Không
có (1) chạy ổn thì (2) không có gì để điều phối.

## 2. Hiện trạng đã có gì (khảo sát code ngày 2026-10-31)

### Đã có — dùng được ngay cho chế độ độc lập
- Extension MV3, content script chỉ chạy trên `https://chatgpt.com/*`,
  background service worker giữ WebSocket tới daemon.
- Server registry (`extension/src/background/server-registry.ts`):
  lưu trong `chrome.storage.local` (theo từng profile Chrome, nên mỗi
  profile đã độc lập về cấu hình), có `apiBase` + `apiKey`, có
  `getTabServer`/`setTabServer` — mỗi tab ChatGPT có thể gắn với
  một daemon khác nhau (lưu theo tab trong `chrome.storage.session`).
  Management Center đã có form add-server.
- Daemon: Bun.serve, port mặc định 1993 (`PORT` env đổi được), plan /
  loop / task-bridge / injection outbox chạy trên SQLite local của
  chính daemon đó, chỉ tác động lên cwd của daemon + workspace đã
  đăng ký (`assertSafePath`).
- Auth daemon (`security.ts`): `OTTER_API_KEY` + Bearer token hoặc
  `?token=`; host ngoài localhost BẮT BUỘC có token, localhost mà
  chưa đặt key thì cho phép. Đây là điểm tựa bảo mật cho fleet.

### Chưa có — là phần phải code thêm
- Daemon không có khái niệm node/fleet: không có bảng node, không
  có đăng ký worker, không có API daemon-gọi-daemon, không có tool
  dispatch. Một plan tạo trên daemon A chỉ chạy trên máy A, không
  tự sang máy B.
- Extension chưa có khái niệm "node": chỉ có "server" (daemon URL),
  chưa có tên node, dự án của node, trạng thái online/offline,
  năng lực (skill, ngôn ngữ, repo) của node.
- Chưa có gói cài extension: extension đang ở dạng load unpacked
  (`extension/` hoặc `extension/dist/`), không có file zip đóng gói,
  không có auto-update, không có export/import cấu hình server để
  mang sang máy/profile khác. Mỗi máy phải tự: clone repo, chạy
  daemon, load unpacked, đăng nhập ChatGPT.
- Plan chưa có trường project: plan chỉ có goal + task, không gắn
  chặt với một project root. Chạy nhiều dự án trên cùng một daemon
  thì plan các dự án trộn chung một DB, chỉ phân biệt bằng goal.
- Mạng giữa các máy chưa có chuẩn: đã có sẵn Tailscale + SSH relay
  qua `nam` (đã verify cho 1 daemon), Cloudflare Quick Tunnel thì
  đã từng fail TLS trên VM này. Fleet KHÔNG được thiết kế chạy trên
  Internet công khai nếu chưa có token + allowlist.

## 3. Thiết kế

### 3.1 Thuật ngữ (dùng thống nhất từ đây)
- **Node**: một daemon + một máy (hoặc một daemon trên một port, nếu
  cùng máy chạy nhiều daemon cho nhiều dự án). Mỗi node có:
  `node_id` (ổn định, ví dụ `nam`, `muse-vm`, `win-pc`),
  `node_name`, `apiBase` (URL mà hub gọi tới), `projects[]`
  (các root mà node được phép chạm vào), `capabilities[]`
  (skill / ngôn ngữ / tool đặc thù, lấy từ skills_list của node).
- **Hub**: node điều phối. Tab ChatGPT gắn với hub là "ChatGPT điều
  phối" duy nhất mà người dùng nói tới.
- **Worker**: node nhận task từ hub. Worker vẫn chạy độc lập được
  khi hub chết (xem 3.4).
- **Dispatch**: một lần hub giao một task (hoặc một plan con) cho
  một worker, kèm goal, task list, verify gate, deadline, và nơi
  trả kết quả về.

### 3.2 Chế độ 1 — Độc lập từng dự án (làm trước, ít rủi ro nhất)
Mỗi máy/profile = một node độc lập, không nói chuyện với nhau.
- Một máy, nhiều dự án: chạy nhiều daemon, mỗi daemon một `PORT`
  (1993, 1994, 1995...) và một project root (cwd lúc start daemon).
  Mỗi profile Chrome gắn tab ChatGPT của nó với một daemon qua
  server picker theo tab (đã có nền tảng, cần hoàn thiện UI chọn
  node theo tab + nhớ theo tab).
- Nhiều máy: mỗi máy tự chạy daemon của nó, extension trên máy đó
  gắn với daemon local của máy đó. Không cần mạng giữa các máy.
- Cài đặt: script đóng gói extension (`bun scripts/pack-extension.ts`
  → `extension.zip` từ `extension/dist/`), hướng dẫn load unpacked
  / load zip theo từng OS, và export/import server list
  (`otter_servers_export.json`) để mang cấu hình sang profile khác
  mà không gõ lại từng daemon URL + token.
- Tiêu chí xong chế độ 1: cùng một máy mở 2 profile, 2 tab ChatGPT,
  mỗi tab làm một dự án khác nhau, không lẫn plan/task/file; tắt
  một daemon thì tab còn lại vẫn chạy.

### 3.3 Chế độ 2 — Hub điều phối (phần chính người dùng hỏi)
Có 2 cách hiểu "các cái khác làm", phải chọn một trước khi code
vì nó đổi hẳn luồng thực thi:

**Cách B2 (khuyến nghị, đúng chữ người dùng nói nhất): mỗi worker
có ChatGPT riêng của nó, hub chỉ ra lệnh + thu kết quả.**
- Worker vẫn cần đăng nhập ChatGPT trên máy/profile của worker,
  extension của worker vẫn nối với daemon của worker.
- Hub dispatch: hub ChatGPT gọi tool `fleet_dispatch`, hub daemon
  gọi HTTP tới worker daemon (route mới, token-auth):
  `POST /api/fleet/dispatch` với `{ dispatch_id, goal, tasks,
  verify, deadline, reply_to }`. Worker tạo một plan local từ đó,
  đưa prompt vào injection outbox của chính nó (cơ chế đã có:
  outbox + ack + WS backoff), ChatGPT của worker chạy loop local
  (plan/loop tools đã có), khi plan done/blocked thì worker ghi
  kết quả vào dispatch của nó.
- Hub thu kết quả: hub poll `GET /api/fleet/dispatch/:id` trên
  worker (hoặc worker callback về hub nếu worker gọi được hub),
  rồi đưa tóm tắt về tab ChatGPT của hub. Hub không tự chạy code
  của worker, không giữ context code của worker trong tab hub.
- Ưu: đúng mô hình "1 ra lệnh, nhiều đứa làm", context mỗi worker
  độc lập nên scale được nhiều task song song, worker chết thì
  dispatch của nó timeout rõ ràng chứ không làm chết hub.
- Nhược: cần ChatGPT login trên mọi worker, cần chờ worker chạy
  xong (bất đồng bộ), kết quả về chậm hơn và phải tổng hợp.

**Cách B1 (phương án dự phòng): hub là bộ não duy nhất, worker
chỉ là tay chân thi hành lệnh qua MCP.**
- Hub ChatGPT gọi `fleet_exec(node, tool, args)`, hub daemon
  forward thẳng sang MCP Streamable HTTP của worker
  (`POST <worker>/mcp`, kèm token của worker), worker chạy
  file/terminal/code tool trên máy nó và trả kết quả về ngay trong
  cùng một lượt chat của hub.
- Ưu: worker không cần ChatGPT login, kết quả về ngay, dễ test.
- Nhược: context tab hub phình nhanh khi nhiều worker, hub chết
  thì mọi worker dừng, và nó không còn là "các ChatGPT khác làm"
  nữa mà là "một ChatGPT điều khiển nhiều máy".

Khuyến nghị: làm B2 trước, giữ B1 làm fallback khi worker chưa có
ChatGPT tab đang nối (dispatch ở trạng thái `queued_no_brain` và
hub báo rõ, thay vì âm thầm chạy hộ bằng B1 gây lẫn trách nhiệm).

### 3.4 Các quyết định thiết kế bắt buộc (không thỏa hiệp)
- **Mạng**: fleet mặc định chỉ chạy trên mạng riêng: Tailscale IP,
  hoặc SSH relay kiểu đã verify qua `nam`. KHÔNG mở daemon ra
  Internet công khai, KHÔNG dùng Cloudflare Quick Tunnel cho fleet
  cho đến khi tunnel được verify lại (đã từng fail TLS trên VM).
- **Auth 2 chiều**: worker chỉ nhận dispatch từ hub có token khớp
  `OTTER_API_KEY` của worker; hub chỉ nhận worker đã đăng ký trước
  (allowlist `node_id`, không nhận node lạ tự đăng ký). Token
  không bao giờ ghi vào plan, log, hay dispatch result.
- **Idempotency**: `dispatch_id` là UUID do hub sinh, worker lưu
  UNIQUE(dispatch_id); hub gửi lại cùng id thì worker trả kết quả
  cũ, không tạo plan trùng, không chạy task 2 lần.
- **Timeout + stale**: worker heartbeat 30s về hub, hub đánh stale
  sau 90s không heartbeat; dispatch có deadline (mặc định 60 phút,
  giống loop hiện tại), quá deadline → `timed_out`, hub báo cho
  người dùng chọn gửi lại node khác hay hủy.
- **Worker vẫn sống khi hub chết**: worker giữ plan local của nó,
  tiếp tục loop local đến done/blocked, kết quả nằm trong DB local
  chờ hub hỏi lại. Hub chết không xóa plan worker.
- **Không trộn dự án**: dispatch phải ghi rõ `project_root` mà
  worker được phép chạm vào; worker từ chối dispatch trỏ ra ngoài
  project list của nó (dùng lại `assertSafePath`), hub không được
  gửi đường dẫn tuyệt đối tùy ý sang worker.
- **Không lưu toàn bộ code qua mạng**: hub chỉ gửi goal/task/
  verify + excerpt kết quả (tối đa 500 ký tự mỗi task như quy ước
  excerpt hiện tại), không gửi toàn bộ file hay toàn bộ conversation
  của worker về hub.

### 3.5 Dữ liệu mới (hub + worker, SQLite local mỗi bên)
- Hub: `fleet_nodes(node_id PK, name, api_base, token_ref,
  projects_json, capabilities_json, last_heartbeat, status)`,
  `fleet_dispatches(dispatch_id PK, parent_plan_id, node_id,
  goal, status, result_excerpt, created_at, deadline)`.
  `token_ref` chỉ là tên tham chiếu, không lưu token thô trong DB
  fleet (token lấy từ env `OTTER_API_KEY` / keyring của hub).
- Worker: `fleet_inbox(dispatch_id PK UNIQUE, goal, tasks_json,
  verify_json, status, plan_id, result_excerpt)` — worker ánh xạ
  dispatch → plan local của nó qua `plan_id`.
- API mới (đều qua auth token, đều trả JSON, đều có kiểm tra
  project allowlist trước khi tạo plan):
  - Hub: `POST /api/fleet/nodes` (đăng ký tay), `GET /api/fleet/nodes`
    (kèm online/stale), `POST /api/fleet/dispatch`,
    `GET /api/fleet/dispatch/:id`, `POST /api/fleet/dispatch/:id/cancel`.
  - Worker: `POST /api/fleet/dispatch` (nhận), `GET /api/fleet/dispatch/:id`,
    `POST /api/fleet/heartbeat` (hoặc hub poll, chọn một, không làm cả hai).
- MCP tools mới (chỉ trên hub): `fleet_list`, `fleet_dispatch`,
  `fleet_status`, `fleet_cancel`, `fleet_result`. Worker không cần
  tool mới ngoài route HTTP trên, vì worker chạy bằng plan/loop
  tools đã có.

### 3.6 Extension thay đổi gì
- Server picker theo tab: hoàn thiện UI chọn node cho tab hiện tại
  (đã có `setTabServer` ở background, cần nút chọn rõ trong panel
  + hiển thị node đang gắn + trạng thái online/offline của node).
- Tab Fleet (mới, trong Options/Management Center): danh sách node
  (từ hub `/api/fleet/nodes`), nút dispatch nhanh (chọn node +
  goal), trạng thái dispatch đang chạy/done/blocked/timeout.
- Pack + export/import: `extension.zip` + export/import server list.
  Không đổi manifest permission (đã có `<all_urls>` + storage),
  không thêm host mới.

### 3.7 Các phase (thứ tự, mỗi phase xong mới sang phase sau)
- **Phase 0 — Nền độc lập (1–2 ngày)**: node identity
  (`OTTER_NODE_ID`, `OTTER_NODE_NAME`, `PORT`, project list),
  pack extension + export/import server, hoàn thiện server picker
  theo tab, test 2 profile trên cùng 1 máy với 2 daemon khác port.
  Xong phase này là đã có chế độ 1.
- **Phase 1 — Fleet khung (2–3 ngày)**: bảng fleet_nodes /
  fleet_dispatches / fleet_inbox, route đăng ký + heartbeat +
  dispatch nhận, tool `fleet_list`/`fleet_status` (chưa chạy task
  thật, chỉ đăng ký + ping + dispatch giả lập). Test 2 node thật:
  VM này (hub) + `nam` (worker) qua Tailscale, với token.
- **Phase 2 — Dispatch thật B2 (3–4 ngày)**: worker ánh xạ dispatch
  → plan → injection outbox → loop local → done/blocked, hub poll
  + tổng hợp về tab hub, timeout/cancel/idempotency, từ chối
  project ngoài allowlist. Test end-to-end: hub giao 1 task code
  nhỏ cho worker, worker làm xong, hub nhận excerpt + plan done.
- **Phase 3 — Vận hành (1–2 ngày)**: tab Fleet trong extension,
  cảnh báo node stale/dispatch timeout, log dispatch, doc vận hành
  (cách thêm node mới, cách xoay token, cách gỡ node). Không làm
  B1 trong phase này trừ khi user yêu cầu riêng sau khi B2 chạy.

Tổng ước lượng một người: 7–11 ngày, chưa tính thời gian chờ
ChatGPT trên worker chạy task thật.

## 4. Rủi ro + câu hỏi mở (cần user quyết trước khi code)
- **Rủi ro lớn nhất**: worker không có ChatGPT tab đang nối thì
  dispatch kẹt ở queued. B2 chấp nhận điều này và báo rõ; nếu user
  muốn worker luôn chạy được kể cả không có ChatGPT thì phải làm
  thêm B1, tốn thêm công.
- **Mạng**: nếu các máy không chung Tailscale thì phải chọn cách
  nối khác trước (SSH relay từng cặp, hoặc VPN riêng) — không có
  cách nối "tự động qua Internet" an toàn trong plan này.
- **Token**: ai giữ token của worker? Đề xuất: mỗi worker một
  `OTTER_API_KEY` riêng, hub lưu mapping node→token trong env/
  keyring của hub, không lưu thô trong DB fleet.
- **Câu hỏi mở cho user**:
  1. Làm B2 (mỗi worker có ChatGPT riêng) hay B1 (hub là não duy
     nhất) trước?
  2. Node đầu tiên để test fleet có phải là `nam` (worker) + VM
     này (hub) qua Tailscale không?
  3. Mỗi dự án = một daemon riêng (cách ly mạnh, tốn port) hay
     một daemon nhiều workspace (tiết kiệm, plan trộn DB)?
  4. Có cho phép dispatch tự động chọn node theo capability
     (hub tự pick worker rảnh + đúng skill) hay user luôn chỉ
     định node bằng tay trong lần đầu?

## 5. Tiêu chí nghiệm thu (khi nào gọi là xong)
- Chế độ 1: 2 profile, 2 daemon khác port, 2 dự án, plan không lẫn.
- Fleet: hub list thấy worker online, dispatch 1 task code nhỏ,
  worker tạo plan + chạy loop + done, hub nhận được excerpt và
  trạng thái done, gửi lại cùng dispatch_id không chạy trùng.
- Bảo mật: worker từ chối dispatch không token, từ chối project
  ngoài allowlist, từ chối node lạ chưa đăng ký.
- Hỏng hóc: worker offline → hub báo stale sau 90s, dispatch quá
  deadline → timed_out, hub chết → worker vẫn chạy xong plan local.
