# Plan: Vòng lặp trên trang ChatGPT Web (Page Loop Driver)

Ngày: 2026-10-31. Phạm vi: bản local `~/workspace/code/chatmcp/` trước,
đồng bộ lên `nam` sau khi người dùng duyệt plan này (chưa code gì trong
plan này — đây là plan chi tiết, viết trước rồi mới code, theo lựa chọn
của người dùng).

## 1. Mục tiêu, nói một câu

Cho ChatGPT Web trên chính trang `chatgpt.com` làm liên tục theo một
nhiệm vụ: extension canh trang, chờ ChatGPT generate xong một lượt, đọc
lượt trả lời đó, daemon quyết định xong hay chưa, nếu chưa xong thì tự
gửi tiếp lệnh làm tiếp, lặp tới khi xong mới dừng và báo cáo — đúng theo
quy trình đang diễn ra trên trang đó, không phải chỉ chạy tiếp khi
worker IDE báo xong qua MCP như vòng lặp hiện tại.

## 2. Hiện trạng đã khảo sát (code thật, ngày 2026-10-31)

### 2.1. Cái đã có, dùng được luôn

- **Injector một chiều** (`extension/src/content/chatgpt-injector.ts`,
  216 dòng): biết ô nhập (`#prompt-textarea`, ProseMirror, textarea),
  nút Send (`data-testid="send-button"`…), nút Stop
  (`data-testid="stop-button"`, `.result-streaming`). Hàm
  `isGenerating()` đã có. `injectPromptToChatGPT(text, shouldSubmit)`
  trả `Promise<boolean>`.
- **Content script** (`extension/src/content/content.ts`, 159 dòng):
  nhận `inject-prompt` từ background, gọi injector, retry tối đa 3 lần
  cách nhau 5s, gửi `inject-result` về daemon qua background (đã làm ở
  Phase 5 của vòng lặp daemon). Nhận `tab-connect`, `server-status`,
  `activity-page`, `terminal-broadcast`, `plan-show`.
- **Background WS** (`extension/src/background/websocket-client.ts`):
  reconnect backoff 3s → 60s, gửi `inject_result`, nhận `inject_prompt`
  và `browser_action`. Background (`background.ts`) forward
  `inject-result` của tab về WS của tab đó.
- **Daemon WS** (`src/daemon/index.ts`): đã xử lý `browser_action_result`,
  `subscribe`, `inject_result`, `ping`. `browserBridge.injectPrompt(text,
  autoSubmit, injectionId?)` gửi `inject_prompt` kèm id để ack.
- **Vòng lặp daemon đã xong (Phases 1–7, 2026-10-30)**: bảng `plans` /
  `plan_tasks`, tool `plan_next` / `plan_resume_prompt`,
  `injection_outbox` (dedupe theo hash, retry tối đa 5 lần, flush khi
  extension subscribe lại), verify gate, heartbeat/sweeper, dashboard
  (`/plan-dashboard`, `/api/plans`) và tab Quản Lý trên extension.
- **UI sẵn để gắn nút điều khiển**: `PlanOverlay` dùng Shadow DOM
  (modal góc phải trên), `ActivityPanel` đã có toggle “continuous”
  (gửi `continuous-set` qua background). Hai mẫu này tái dùng được, khỏi
  làm panel mới từ đầu nếu không cần.

### 2.2. Cái chưa có — chính là khoảng trống plan này lấp

- Không có code nào **đọc lượt trả lời của assistant** trên trang.
  Grep toàn bộ `extension/src/` không thấy selector nào cho turn
  assistant / markdown của ChatGPT. Injector chỉ biết “đang generate”
  hay không, không biết “generate xong lượt này nói gì”.
- Injector **chờ tối đa 30s** nếu đang generate rồi cứ chèn tiếp, chứ
  không chờ tới khi generate xong hẳn. Một lượt trả lời dài hơn 30s là
  bị chèn chồng hoặc fail.
- Không có **trạng thái vòng lặp phía trang**: không có session, không
  đếm lượt, không biết lượt vừa rồi có tiến triển không, không có nút
  dừng vòng lặp trên trang (toggle “continuous” hiện tại chỉ set cờ
  `continuous_enabled` trong `conversation_settings`, qua route
  `PUT /conversations/:id/continuous` — đó là một cờ, không phải một
  driver vòng lặp, và không có code nào đọc cờ đó để tự gửi prompt tiếp).
- Daemon hiện tại chỉ chạy tiếp khi **worker IDE báo xong qua MCP**
  (`ide_task_completed`). Nếu người làm việc là chính ChatGPT Web trên
  trang, daemon không có tín hiệu nào để chạy tiếp.

### 2.3. Kết luận khảo sát

Không cần viết lại extension hay daemon. Cần thêm một lớp mỏng ở giữa:
**trang chỉ làm cảm biến + tay bấm** (canh generate, đọc lượt, gửi
prompt), **daemon giữ trạng thái + quyết định** (xong chưa, gửi gì
tiếp, dừng khi nào). Mọi quyết định về plan đã có sẵn thì tái dùng,
không phát minh lại.

## 3. Nguyên tắc (không thương lượng)

1. **Daemon là nguồn thật duy nhất.** Trang không tự quyết plan xong
   hay chưa, không tự tạo task mới. Trang chỉ báo cáo “lượt này xong,
   nội dung hash X, excerpt Y”. Daemon quyết định.
2. **Bật rõ ràng, dừng được ngay.** Vòng lặp chỉ chạy khi người dùng
   bấm bắt đầu cho một phiên cụ thể. Bất kỳ lúc nào người dùng bấm
   dừng (trên trang, tab Quản Lý, hoặc dashboard) thì không gửi thêm
   prompt nào nữa, kể cả prompt đang nằm trong outbox của phiên đó.
3. **Không gửi khi người dùng đang làm việc.** Nếu ô nhập có chữ do
   người dùng gõ, hoặc người dùng vừa gõ phím trong 10s gần nhất, thì
   hoãn gửi, không xóa chữ của họ, không chèn chồng.
4. **Mỗi lượt báo cáo đúng một lần, có idempotent.** Lượt được định
   danh bằng hash nội dung + thời điểm settle. Gửi trùng cùng hash thì
   daemon bỏ qua, không đếm thành lượt mới.
5. **Không lưu toàn bộ hội thoại.** DB chỉ lưu hash lượt + excerpt tối
   đa 500 ký tự + trạng thái. Nội dung đầy đủ vẫn chỉ nằm trên trang
   ChatGPT của người dùng.
6. **Chỉ chạy trên `chatgpt.com`.** Content script vốn chỉ match
   `https://chatgpt.com/*`; vòng lặp không được bật ở tab khác, không
   đọc tab khác, không chặn network request của trang.
7. **Thất bại thì dừng an toàn, không đoán.** Không đọc được lượt, gặp
   lỗi trang, hết giới hạn, hoặc không tiến triển thì chuyển sang
   `blocked` và báo người dùng, không tự bịa câu trả lời hay tự gửi
   tiếp.

## 4. Kiến trúc

```
Trang chatgpt.com
  ├─ PageLoopWatcher (content, mới)
  │    ├─ isGenerating() (có sẵn, mở rộng)
  │    ├─ MutationObserver + polling 500ms
  │    └─ readLastAssistantTurn() (mới, selector fallback)
  ├─ chatgpt-injector.ts (sửa: chờ tới khi xong, không cap 30s mù)
  └─ LoopBadge (activity panel / plan overlay, mới: trạng thái + Dừng)
        ↕ chrome.runtime.sendMessage (tab → background)
Background service worker
  ├─ DaemonWebSocketClient (có sẵn, thêm forward chatgpt_turn)
  └─ tab → WS của tab đó
        ↕ WebSocket /api/activity/v1/stream
Daemon (port 1993)
  ├─ WS handler: chatgpt_turn, page_loop_start/stop/status (mới)
  ├─ page-loop.ts (mới): session + quyết định xong/tiếp/dừng
  ├─ plan.ts / continuous-loop.ts (có sẵn): plan_next, continuation
  │    prompt, outbox, verify gate
  └─ routes: /api/page-loops (mới, cho dashboard + tab Quản Lý)
Dashboard / tab Quản Lý (có sẵn, thêm mục loop)
```

Luồng một vòng lặp, theo đúng quy trình trên trang:

```
Bắt đầu (người dùng bấm Start, chọn plan hoặc nhập mục tiêu)
  → daemon tạo page_loop session, gửi prompt đầu tiên qua outbox
  → trang inject prompt, bấm Send
  → ChatGPT generate (trang: WAITING_GENERATION)
  → generate dừng + đứng yên đủ lâu (SETTLING)
  → watcher đọc lượt cuối, gửi chatgpt_turn về daemon (1 lần)
  → daemon quyết định:
      • DONE      → gửi prompt tổng kết, session = done, báo cáo
      • CONTINUE  → gửi prompt làm tiếp qua outbox, quay lại generate
      • BLOCKED   → dừng, báo người dùng lý do (lỗi trang / hết giới
                    hạn / không tiến triển / ChatGPT hỏi lại)
      • PAUSED    → chờ người dùng bấm tiếp tục (resume prompt)
```

## 5. Phát hiện “generate xong một lượt” — phần khó nhất, làm kỹ

### 5.1. Tín hiệu dùng

- Đang generate: nút Stop hiện (`data-testid="stop-button"`),
  `.result-streaming`, nút Send bị disable. Đây là code đã có trong
  `isGenerating()`, giữ nguyên làm tín hiệu chính.
- Hết generate: cả ba tín hiệu trên đều tắt.
- Lượt mới xuất hiện: số lượng turn assistant trong DOM tăng lên, hoặc
  hash lượt cuối thay đổi.

### 5.2. Debounce “settle” (bắt buộc)

Một lượt chỉ được tính là xong khi đồng thời:

- `isGenerating() === false` liên tục trong **5 giây**,
- DOM không có thay đổi nào trong vùng hội thoại trong **2 giây** cuối,
- không có activity MCP mới nào cho conversation đó trong 5 giây đó
  (daemon biết, vì tool call đi qua daemon).

Poll mỗi 500ms như injector đang làm. Debounce này là để xử lý bẫy lớn
nhất: **ChatGPT tạm dừng để gọi tool qua MCP** — lúc đó trang trông
như đã xong, nhưng vài giây sau nó lại generate tiếp. Nếu không có
debounce + kiểm tra activity MCP, driver sẽ gửi nhắc tiếp quá sớm và
làm loạn hội thoại.

### 5.3. Đọc lượt cuối (Phase 0 phải xác minh trên trang thật)

Hiện chưa có selector nào được xác minh. Phase 0 phải mở trang thật và
ghi lại, theo thứ tự fallback sau (thứ tự này là giả thuyết, không
phải sự thật đã kiểm chứng):

1. Turn có `data-message-author-role="assistant"` mới nhất, lấy phần
   `.markdown` / text bên trong.
2. Các `article` / block tin nhắn mới nhất không phải của user.
3. Nếu không đọc được: **không đoán**, báo `turn_unreadable` và dừng
   phiên sang `blocked` để người dùng xem tay.

Selector phải nằm trong một file riêng
(`extension/src/content/chatgpt-turn-reader.ts`) với danh sách fallback
có thứ tự, để khi ChatGPT đổi DOM thì chỉ sửa một chỗ, và có log rõ
selector nào đã match trong lần chạy đó (phục vụ debug, không lưu nội
dung đầy đủ).

### 5.4. Phát hiện lỗi trang

Dừng ngay sang `blocked` khi thấy bất kỳ dấu hiệu nào sau đây (danh
sách này cũng phải xác minh ở Phase 0, vì text lỗi của ChatGPT thay
đổi theo thời gian):

- Banner / text lỗi kiểu “Something went wrong”, lỗi mạng, “rate
  limit”, “too many requests”.
- Trang chuyển khỏi cuộc hội thoại (không còn ở `/c/<id>` mà về trang
  chủ / trang đăng nhập).
- Nút Stop hiện liên tục quá **10 phút** mà lượt không thay đổi
  (generate kẹt) → dừng, không bấm Stop hộ người dùng trừ khi người
  dùng bật tùy chọn đó (mặc định: không tự bấm Stop).

## 6. Hợp đồng “xong” — ba mức, không lẫn nhau

### 6.1. Mức 1: xong một lượt trả lời (turn settled)

Chỉ có nghĩa là ChatGPT đã ngừng generate và nội dung đã đứng yên đủ
lâu theo §5.2. Chưa có nghĩa là task xong.

### 6.2. Mức 2: xong một task

Một task được tính là xong khi **một trong hai** điều kiện sau đúng:

- **Marker:** dòng cuối cùng của lượt (sau khi trim) đúng là
  `OTTER-DONE`, đứng một mình trên một dòng. Marker dùng tiếng Anh
  cố định để khỏi phụ thuộc ngôn ngữ hội thoại. Prompt vòng lặp phải
  dặn ChatGPT: “chỉ ghi dòng này khi task đã xong thật, kèm tóm tắt
  ngay trước nó; các lượt chưa xong không được ghi dòng này”.
- **Worker báo xong:** `ide_task_completed` với `planTaskId` tương ứng
  đã tới daemon (luồng cũ, giữ nguyên). Nếu cả hai đều có thì lấy cái
  tới trước, cái sau bị bỏ qua nhờ idempotent theo task.

Nếu task thuộc plan và có lệnh `verify`, verify gate cũ vẫn chạy trước
khi tính success (tái dùng, không viết lại). Verify fail thì task về
pending/blocked như cũ, page loop không tự coi là xong.

### 6.3. Mức 3: xong cả plan / xong phiên

- Có plan: mọi task đều success/skipped → daemon gửi prompt tổng kết
  (tái dùng `buildFinalPrompt`) rồi session = `done`.
- Không có plan (chế độ mục tiêu tự do): marker `OTTER-DONE` ở lượt
  cuối → session = `done`.
- Hết giới hạn, lỗi trang, không tiến triển, người dùng dừng → session
  = `blocked` / `stopped`, kèm lý do rõ ràng, không gửi thêm.

### 6.4. Prompt nhắc tiếp (nudge) khi chưa xong

Khi lượt đã settle mà task chưa xong, daemon gửi một trong hai loại:

- Có plan: prompt tiếp theo từ `plan_next` + continuation prompt đã có
  (tóm tắt task vừa xong 1–2 dòng, task tiếp theo, file gợi ý, lệnh
  verify). Không gửi lại toàn bộ lịch sử.
- Không có plan: nudge gọn, mẫu cố định: “Tiếp tục làm tiếp, chưa
  xong. Đừng tóm tắt lại từ đầu, đừng hỏi lại những gì đã rõ. Phần
  còn lại cần làm: <excerpt lượt cuối, tối đa 500 ký tự, hoặc mục tiêu
  ban đầu nếu lượt cuối trống>.”

Nudge luôn đi qua `injection_outbox` như prompt vòng lặp cũ, để mất
kết nối cũng không mất lượt nhắc.

## 7. State machine của một phiên (page loop session)

Trạng thái: `off | armed | waiting_generation | settling |
deciding | injecting | paused | done | blocked | stopped`

| Từ trạng thái | Sự kiện | Sang trạng thái | Ghi chú |
|---|---|---|---|
| off | người dùng bấm Start | armed | Tạo session, ghi DB, gửi prompt đầu |
| armed | inject ok | waiting_generation | — |
| armed | inject fail | blocked | Lý do: inject failed, outbox giữ lại |
| waiting_generation | hết generate + debounce đủ | settling → deciding | Gửi chatgpt_turn 1 lần |
| deciding | DONE | done | Gửi prompt tổng kết |
| deciding | CONTINUE | injecting | Qua outbox |
| deciding | lỗi / hết giới hạn / không tiến triển | blocked | Báo lý do |
| deciding | ChatGPT hỏi lại / cần người dùng | paused | Chờ resume, không tự trả lời hộ |
| bất kỳ (trừ done/blocked/stopped) | người dùng bấm Dừng | stopped | Không gửi thêm prompt nào |
| paused | người dùng bấm Tiếp tục | injecting | Gửi resume prompt |
| waiting_generation | người dùng gõ vào ô nhập | paused (tạm) | Chờ người dùng idle 10s hoặc bấm tiếp tục |

Mọi chuyển trạng thái đều ghi vào DB (bảng mới, §9) và broadcast qua
WS để dashboard / tab Quản Lý thấy ngay, không cần F5.

## 8. An toàn và giới hạn (mặc định, cấu hình được)

- `maxTurns`: **20 lượt** / phiên. Hết thì `blocked` với lý do
  “hết số lượt”.
- `maxRunMinutes`: **60 phút** / phiên. Hết thì `blocked`.
- `maxNoProgressTurns`: **3 lượt liên tiếp** không tiến triển
  (hash lượt lặp lại, hoặc lượt trống) → `blocked`.
- **Không gửi khi người dùng đang gõ:** ô nhập có nội dung do người
  dùng gõ, hoặc có phím bấm trong 10s gần nhất → hoãn gửi, chuyển
  phiên sang `paused (tạm)` và hiện badge “đang chờ bạn”.
- **Không tự bấm Stop, không tự trả lời câu hỏi của ChatGPT.** ChatGPT
  hỏi lại → `paused`, để người dùng trả lời tay rồi bấm tiếp tục.
- **Một phiên chạy tại một thời điểm trên một tab.** Bấm Start ở tab
  thứ hai trong khi phiên đang chạy thì bị từ chối, báo phiên đang
  chạy ở tab/conversation nào.
- **Rate limit:** giữa hai lần inject liên tiếp cách nhau tối thiểu
  2s, và sau mỗi lần inject fail thì backoff như outbox đã làm
  (5s/15s/30s, tối đa 5 lần).
- **Context:** prompt nhắc tiếp chỉ mang tóm tắt gọn, không mang toàn
  bộ hội thoại. Daemon chỉ giữ excerpt 500 ký tự / lượt trong DB.

## 9. Dữ liệu mới (migration trong `src/daemon/db.ts`)

```sql
-- Phiên vòng lặp trên trang
CREATE TABLE IF NOT EXISTS page_loops (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL DEFAULT 'chatgpt-web',
  plan_id TEXT,                 -- NULL = chế độ mục tiêu tự do
  goal TEXT NOT NULL,
  status TEXT CHECK(status IN
    ('armed','waiting_generation','settling','deciding','injecting',
     'paused','done','blocked','stopped')) NOT NULL DEFAULT 'armed',
  turn_count INTEGER NOT NULL DEFAULT 0,
  max_turns INTEGER NOT NULL DEFAULT 20,
  max_run_minutes INTEGER NOT NULL DEFAULT 60,
  last_turn_hash TEXT,
  no_progress_count INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Một lượt trả lời đã settle (chỉ hash + excerpt, không lưu full text)
CREATE TABLE IF NOT EXISTS page_loop_turns (
  id TEXT PRIMARY KEY,
  loop_id TEXT NOT NULL REFERENCES page_loops(id),
  turn_index INTEGER NOT NULL,
  turn_hash TEXT NOT NULL,
  excerpt TEXT,                 -- tối đa 500 ký tự
  is_done_marker INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

Migration theo mẫu đã dùng ở Phases 1–7: `CREATE TABLE IF NOT
EXISTS`, cột mới thêm bằng `PRAGMA table_info` + `ALTER TABLE` chỉ
khi chưa có, chạy lại nhiều lần vẫn an toàn.

## 10. Tin nhắn và API mới

### 10.1. WebSocket (extension ↔ daemon, qua background như hiện tại)

- Tab → daemon: `chatgpt_turn` `{ loopId, turnHash, excerpt,
  isDoneMarker, settledAt }`.
- Tab → daemon: `page_loop_status` `{ loopId, status }` (trang báo
  nó đã dừng / bị lỗi phía trang).
- Daemon → tab: `page_loop_start` `{ loopId, planId?, goal }`,
  `page_loop_stop` `{ loopId, reason }` (daemon ra lệnh dừng, trang
  phải ngừng watcher ngay).
- Tái dùng: `inject_prompt` (+ `injectionId`), `inject_result`,
  `browser_action_result`, `ping`/`pong` — không đổi.

### 10.2. MCP tools mới (daemon, file mới `src/daemon/tools/page-loop-tools.ts`)

- `page_loop_start` `{ goal, planId?, maxTurns?, maxRunMinutes? }`
  → tạo session, gửi prompt đầu qua outbox. Chỉ chạy khi chưa có
  session đang chạy cho cùng conversation.
- `page_loop_stop` `{ loopId, reason? }` → dừng, không gửi thêm.
- `page_loop_status` `{ loopId }` → session + lượt gần nhất + giới
  hạn còn lại.
- `page_loop_resume` `{ loopId }` → từ `paused` quay lại `injecting`
  bằng resume prompt.

### 10.3. HTTP routes mới (cho dashboard + tab Quản Lý)

- `GET /api/page-loops` — danh sách session.
- `GET /api/page-loops/:id` — session + các lượt gần nhất.
- `POST /api/page-loops/:id/stop`, `POST /api/page-loops/:id/resume`
  — cùng logic với MCP tools, dùng chung hàm trong `page-loop.ts`,
  không viết logic hai lần.

## 11. Các phase thực hiện (thứ tự bắt buộc)

### Phase 0 — Khám phá DOM thật + đóng băng baseline (0.5 ngày)

- Mở ChatGPT Web thật, chạy một hội thoại 3 lượt (ngắn, dài, có gọi
  tool), ghi lại: selector turn assistant nào match, nút Stop xuất
  hiện/biến mất khi nào, khi gọi tool thì DOM đứng yên bao lâu, text
  lỗi hiển thị ra sao.
- Deliverable: file ghi chú `docs/plans/2026-10-31-chatgpt-page-loop-dom-notes.md`
  (selector đã xác minh + ảnh chụp màn hình mô tả bằng chữ, không lưu
  nội dung hội thoại riêng tư). Nếu selector không ổn định thì dừng ở
  đây và báo lại, không code tiếp mù.
- Đóng băng hành vi hiện tại: test Phase 1, vòng lặp, dashboard vẫn
  pass trước khi sửa (làm baseline để so sánh sau mỗi phase).

### Phase 1 — Turn watcher + báo cáo lượt (1 ngày)

- File mới: `extension/src/content/chatgpt-turn-watcher.ts`
  (watcher + debounce §5.2 + `readLastAssistantTurn()` với fallback
  §5.3 + phát hiện lỗi §5.4), `chatgpt-turn-reader.ts` tách riêng
  selector để dễ sửa khi DOM đổi.
- Background: forward `chatgpt_turn` và `page_loop_status` qua WS của
  tab (theo mẫu `inject-result` đã có).
- Daemon: WS handler nhận `chatgpt_turn`, ghi vào `page_loop_turns`,
  idempotent theo hash (trùng hash thì bỏ qua, không tăng turn_count).
- Chấp nhận khi: watcher báo đúng 1 lần cho mỗi lượt settle trong test
  tay trên trang thật, và không báo khi ChatGPT chỉ tạm dừng để gọi
  tool (test bằng hội thoại có tool call).

### Phase 2 — Session + quyết định ở daemon (1 ngày)

- File mới: `src/daemon/page-loop.ts` (logic thuần, không phụ thuộc
  MCP/Zod để test được không cần node_modules, theo mẫu `plan.ts`).
  Hàm: `createPageLoop`, `getPageLoopStatus`, `recordTurn`
  (cập nhật turn_count, no_progress_count, phát hiện marker),
  `decideNext` (trả về `done | continue | blocked | paused` + lý do),
  `stopPageLoop`, `resumePageLoop`.
- MCP tools `page_loop_start/stop/status/resume` trong
  `src/daemon/tools/page-loop-tools.ts`, đăng ký trong `mcp.ts` sau
  plan tools.
- Chấp nhận khi: test script mới `scripts/test-page-loop.ts` pass trên
  DB tạm — các ca: marker → done, không marker → continue, hash lặp
  3 lần → blocked, hết maxTurns → blocked, stop giữa chừng → không
  quyết định tiếp nữa.

### Phase 3 — Nối với plan + nudge qua outbox (1 ngày)

- Khi `decideNext = continue` và session có `planId`: lấy task tiếp
  theo bằng `plan_next`, tạo continuation prompt bằng
  `buildContinuationPrompt` đã có, gửi qua `enqueueInjection`.
- Khi không có plan: gửi nudge mẫu §6.4 qua outbox.
- Sửa injector: bỏ cap chờ 30s mù, thay bằng “chờ tới khi hết
  generate hoặc tới timeout của phiên” (timeout lấy từ session, mặc
  định 10 phút cho một lượt). Inject fail thì outbox giữ lại như cũ,
  session chuyển `blocked` chỉ khi hết retry của outbox.
- Chấp nhận khi: một plan 3 task chạy bằng page loop (test tay trên
  trang thật, có worker hoặc marker) đi hết 3 task và dừng ở `done`,
  không gửi thừa prompt nào sau khi done.

### Phase 4 — UI điều khiển + quan sát (0.5–1 ngày)

- Trang ChatGPT: badge trạng thái vòng lặp (dựa theo mẫu Shadow DOM
  của `PlanOverlay` / `ActivityPanel`): đang chạy / đang chờ bạn /
  đã dừng, nút **Dừng** luôn hiện khi session chạy.
- Tab Quản Lý (extension): thêm mục vòng lặp — session đang chạy,
  lượt đã dùng / tối đa, nút Dừng / Tiếp tục, link tới dashboard.
- Dashboard (`/plan-dashboard`): thêm mục session page loop của plan
  đang xem (trạng thái, lượt, lý do blocked nếu có).
- Chấp nhận khi: bấm Dừng ở bất kỳ chỗ nào trong ba chỗ trên thì
  không còn prompt nào được gửi thêm (kiểm tra bằng log outbox và
  bằng mắt trên trang).

### Phase 5 — An toàn, giới hạn, resume sau mất kết nối (0.5–1 ngày)

- Hoãn gửi khi người dùng đang gõ (§8), pause khi ChatGPT hỏi lại,
  một phiên / một tab, backoff giữa các lần inject.
- Mất kết nối giữa chừng: session giữ nguyên trong DB, extension
  reconnect (backoff đã có) rồi gửi lại `page_loop_status` để daemon
  biết trang đã quay lại; người dùng bấm Tiếp tục thì daemon gửi
  resume prompt (tái dùng `buildResumePrompt` cho plan, hoặc nudge
  resume cho chế độ tự do).
- Chấp nhận khi: tắt/mở lại extension giữa một phiên, bấm Tiếp tục,
  vòng lặp chạy tiếp từ lượt chưa xong, không làm lại lượt đã xong,
  không gửi trùng prompt.

### Phase 6 — Test + rollout (0.5–1 ngày)

- Test tự động: `scripts/test-page-loop.ts` (logic daemon, DB tạm)
  + test watcher debounce bằng logic thuần tách khỏi DOM (hàm
  `shouldSettle(signals, now)` test được không cần trình duyệt).
- Test tay bắt buộc trên trang thật (checklist, không thay bằng test
  tự động): (a) plan 3 task tới done, (b) ChatGPT hỏi lại → paused →
  người dùng trả lời → tiếp tục → done, (c) người dùng gõ giữa chừng
  → không bị xóa chữ, (d) bấm Dừng giữa chừng → dừng hẳn,
  (e) mất kết nối extension giữa chừng → resume được,
  (f) lượt dài > 30s → không bị chèn chồng.
- Build extension (`bun build.extension.ts`), cập nhật tài liệu
  (plan này + doc extension + doc dashboard), đồng bộ lên `nam`
  bằng rsync chia nhỏ với wrapper bền `~/workspace/ssh_to_nam.sh`
  (không dùng `/tmp/ssh_to_nam.sh`, và `mkdir -p extension/dist`
  trên `nam` trước nếu cần), kiểm chứng hash + chạy lại các test
  trên `nam`.
- Rollout: mặc định **tắt**. Người dùng phải bấm Start cho từng phiên.
  Không bật tự động cho mọi cuộc hội thoại, không bật cho mọi tab.

## 12. Những gì KHÔNG làm trong plan này

- Không chặn / đọc network request của ChatGPT (chỉ đọc DOM, tránh
  giòn và tránh chạm vào cơ chế nội bộ của trang).
- Không tự bấm Stop, không tự trả lời câu hỏi của ChatGPT hộ người
  dùng, không tự tạo plan mới từ hội thoại (tạo plan vẫn qua
  `plan_create`).
- Không lưu toàn bộ hội thoại vào DB, không gửi nội dung hội thoại ra
  ngoài daemon local.
- Không làm vòng lặp chạy song song nhiều phiên trên cùng một tab.
- Không sửa hành vi task lẻ không có planId, không sửa luồng worker
  IDE hiện tại — page loop là một driver mới chạy song song, dùng
  chung plan/outbox/verify, không thay thế chúng.

## 13. Rủi ro và cách giảm

- **ChatGPT đổi DOM:** selector fallback + file reader tách riêng +
  log selector đã match + Phase 0 xác minh trước khi code. Nếu DOM
  đổi sau này, chỉ cần sửa reader, không sửa logic quyết định.
- **Nhầm “tạm dừng gọi tool” thành “xong”:** debounce 5s + kiểm tra
  activity MCP trong 5s đó + không quyết done chỉ bằng “hết generate”
  (phải có marker hoặc worker báo xong).
- **Vòng lặp vô hạn / rate limit:** maxTurns, maxRunMinutes,
  no-progress, backoff, và mặc định tắt.
- **Context phình:** nudge chỉ mang tóm tắt gọn, excerpt 500 ký tự,
  không mang toàn bộ lịch sử. Plan dài vẫn sẽ chạm giới hạn context
  của chính ChatGPT Web — plan này không xóa được giới hạn đó, chỉ
  làm chậm nó lại.
- **ChatGPT từ chối làm tiếp / hỏi lại liên tục:** coi là `paused` /
  `blocked`, để người dùng quyết, không tự thuyết phục tiếp.

## 14. Ước lượng (thô, cho một người làm)

| Phase | Việc | Ước lượng |
|---|---|---|
| 0 | DOM thật + baseline | 0.5 ngày |
| 1 | Watcher + báo cáo lượt | 1 ngày |
| 2 | Session + quyết định daemon | 1 ngày |
| 3 | Nối plan + nudge qua outbox | 1 ngày |
| 4 | UI điều khiển + quan sát | 0.5–1 ngày |
| 5 | An toàn, giới hạn, resume | 0.5–1 ngày |
| 6 | Test + rollout + sync `nam` | 0.5–1 ngày |
| **Tổng** | | **5–7 ngày** |

Ước lượng này chưa tính thời gian chờ ChatGPT generate trong test tay
và chưa tính việc DOM đổi giữa chừng phải làm lại Phase 0.

## 15. Câu hỏi cần chốt trước khi code (không cần trả lời ngay trong plan này)

1. Marker `OTTER-DONE` có chấp nhận được không, hay muốn dùng một cụm
   khác (ví dụ tiếng Việt)? Khuyến nghị: giữ `OTTER-DONE` vì nó không
   phụ thuộc ngôn ngữ hội thoại.
2. Chế độ không có plan (mục tiêu tự do) có cần ngay từ đầu không, hay
   chỉ làm chế độ có plan trước? Khuyến nghị: làm cả hai, nhưng ưu
   tiên test chế độ có plan trước vì nó có verify gate sẵn.
3. Giới hạn mặc định 20 lượt / 60 phút có phù hợp không, hay muốn chặt
   hơn (ví dụ 10 lượt) cho lần chạy đầu tiên? Khuyến nghị: lần đầu để
   10 lượt / 30 phút cho an toàn, tăng sau khi đã chạy thật vài lần.

## 16. Trạng thái

- [ ] Phase 0 — DOM thật + baseline
- [ ] Phase 1 — Watcher + báo cáo lượt
- [ ] Phase 2 — Session + quyết định daemon
- [ ] Phase 3 — Nối plan + nudge qua outbox
- [ ] Phase 4 — UI điều khiển + quan sát
- [ ] Phase 5 — An toàn, giới hạn, resume
- [ ] Phase 6 — Test + rollout

Plan này chỉ là tài liệu, chưa code gì. Khi người dùng duyệt thì bắt
đầu từ Phase 0, không nhảy thẳng sang code watcher.
