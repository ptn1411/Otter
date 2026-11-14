# Plan: ChatGPT Web code liên tục theo plan, loop tới khi xong, chống mất kết nối

Ngày: 2026-10-30. Phạm vi: bản local `~/workspace/code/chatmcp/` (chưa động tới `nam`).

## Tiến độ

- [x] **Phase 1 — DONE 2026-10-30** (bản local, chưa sync lên `nam`).
  File: `src/daemon/db.ts` (migration plans/plan_tasks + cột mới cho tasks),
  `src/daemon/plan.ts` (logic thuần, không phụ thuộc MCP),
  `src/daemon/tools/plan-tools.ts` (tool `plan_create/add_task/list/status/
  pause/resume/start/cancel`), `src/daemon/tools/task-bridge.ts`
  (`ide_dispatch_task` nhận thêm `planId/planTaskId/orderIndex/dependsOn`,
  task lẻ không có plan thì hành vi y cũ),
  `src/daemon/tools/index.ts` + `src/daemon/mcp.ts` (đăng ký tool),
  `scripts/test-plan-phase1.ts` (23 check, pass, chạy bằng
  `bun scripts/test-plan-phase1.ts` trên DB tạm, không cần node_modules).
  `bun build` các file đã sửa đều pass (external zod/MCP SDK, vì bản local
  chưa có node_modules).
  Chưa làm ở Phase 1 (đúng theo plan, để Phase 2/4): queue bền vững từ SQLite,
  heartbeat/timeout, `plan_next`, continuation prompt, injection outbox.
- [x] **Phase 2–7 — DONE 2026-10-30, đã đồng bộ lên `nam` cùng ngày.**
  Kiểm chứng trên `nam`: 9 file quan trọng khớp hash với bản local, 7 skill
  HyperFrames đủ số file ở cả `bin/skills` và `.agents/skills`, test Phase 1
  (23 check) và test vòng lặp (21 check) đều pass trên `nam` với bun 1.4.4
  vừa cài tại `~/.local/bin/bun` trên `nam` (chỉ để chạy test, không sửa
  code hệ thống).
  - Phase 2: `tasks` lưu đủ payload dispatch (`details`, `files_hint_json`,
    `verify_json`); `recoverTaskQueue()` trong task-bridge khôi phục queue
    sau restart (pending -> queue, stale running -> queue attempt+1,
    recent running -> in-flight để worker ack/complete tiếp).
  - Phase 3: tool `giano_task_heartbeat` (60s/lần), ack/progress cũng cập
    nhật heartbeat; sweeper 60s trong index.ts (`sweepStaleBridgeTasks`,
    stale >5 phút, max 3 lần -> blocked, plan task blocked -> plan paused).
  - Phase 4: tool `plan_next`, `plan_resume_prompt`; khi bridge task thuộc
    plan được pull thì plan task chuyển sang running; khi complete thì
    daemon tự tạo continuation prompt (hoặc final prompt khi hết plan) và
    gửi qua outbox thay cho report một lần.
  - Phase 5: bảng `injection_outbox` + `enqueueInjection` (dedupe theo hash)
    + `flushInjectionOutbox` (retry tối đa 5 lần); daemon flush outbox khi
    extension subscribe lại và khi có task complete; `injectPrompt` gửi kèm
    `injectionId`, extension ack lại bằng `inject_result`; WS reconnect
    backoff 3s -> 60s; content script retry inject 3 lần, mỗi lần cách 5s.
    Tool mới: `plan_outbox`, `plan_enqueue_prompt`.
  - Phase 6: verify gate chạy lệnh `verify` của plan task trước khi tính
    success (thất bại -> pending retry, hết lần thử -> blocked); dispatch
    từ chối task có mẫu lệnh nguy hiểm (`rm -rf`, `drop table`, ...) hoặc
    file thoát khỏi workspace.
  - Phase 7: `scripts/test-continuous-loop.ts` (21 check, pass: plan_next,
    continuation/resume prompt, recovery, sweeper, outbox, verify gate,
    safety) + chạy lại Phase 1 (23 check, pass). Giới hạn còn lại, nói
    thẳng: test ở mức SQLite + logic thuần, chưa test live với ChatGPT Web
    thật và chưa test extension trong trình duyệt (cần chạy daemon +
    extension thật trên máy có Chrome); bản local chưa có node_modules nên
    chưa chạy được daemon MCP thật, chỉ build + transpile kiểm tra cú pháp.
Mục tiêu: ChatGPT Web làm PM, IDE worker làm từng task, daemon làm vòng lặp —
giao task 1 -> worker làm -> verify -> tự động giao task 2 -> ... -> hết plan mới dừng.
Không phụ thuộc vào trí nhớ của ChatGPT trong 1 đoạn chat: trạng thái thật nằm ở SQLite của daemon.

## Hiện trạng đã có (đừng phá)

- `src/daemon/tools/task-bridge.ts`: `ide_dispatch_task` (1 task lẻ), `giano_task_pull`
  (long-poll), `giano_task_ack/progress/complete`, `ide_get_task_status`,
  `giano_task_release`, `giano_queue_stats`. Queue + in-flight chỉ ở RAM.
- `src/daemon/index.ts` `handleMcpActivity`: khi `ide_task_completed` thì gọi
  `browserBridge.injectPrompt(report, true)` — báo cáo 1 lần, nội dung kết thúc bằng
  "Vui lòng tổng hợp kết quả", không chứa task tiếp theo.
- `src/daemon/browser-bridge.ts` `injectPrompt()`: fire-and-forget, trả `false`
  nếu không có socket đang mở, không lưu lại để gửi lại, không có ack.
- `extension/src/content/chatgpt-injector.ts`: chờ tối đa 30s nếu ChatGPT đang
  generate, 10s chờ ô nhập, nếu không thấy thì trả `false` và mất prompt.
- `extension/src/background/websocket-client.ts`: đã tự reconnect sau 3s cố định,
  ping mỗi 10s, nhưng không có backoff, không queue tin nhắn nhận trong lúc mất kết nối.
- `src/daemon/db.ts`: bảng `tasks` chỉ có id/conversation/title/status/created_at —
  không lưu goal/details/filesHint, thứ tự, plan, verify, attempt, heartbeat.

## Những lỗ hổng làm vòng lặp đứt (đây là lý do phải làm plan này)

1. Không có khái niệm plan/run: chỉ có task lẻ, ChatGPT phải tự nhớ và tự giao
   task tiếp theo bằng tay — đó là điểm dừng phổ biến nhất.
2. Queue không bền: daemon restart là mất queue + in-flight, task đang làm kẹt
   ở `running` trong SQLite mà không ai lấy lại.
3. Không heartbeat/timeout: worker mất kết nối (đóng IDE, rớt mạng) thì task kẹt
   ở in-flight mãi, không retry, không báo blocked.
4. Inject không có ack/outbox: extension mất kết nối đúng lúc task xong là báo
   cáo tiếp nối mất luôn, ChatGPT không biết để làm task tiếp theo.
5. Complete tự báo cáo, không verify: worker nói xong là xong, không có cửa
   kiểm thử/build/lint trước khi sang task sau.
6. Không có giới hạn vòng lặp: nếu làm sai hướng, loop có thể chạy vô hạn hoặc
   lặp lại task lỗi mãi.

## Nguyên tắc thiết kế

- SQLite là nguồn thật duy nhất; RAM chỉ là cache. Mọi bước đều idempotent
  (gọi lại cùng taskId không tạo task trùng, không gửi prompt trùng).
- Daemon điều khiển trạng thái, ChatGPT điều khiển nội dung: daemon biết
  "task nào tiếp theo", ChatGPT quyết định "task đó làm gì" theo plan.
- Mỗi lần chuyển task đều có checkpoint: xong task N mới ghi xong, rồi mới
  giao task N+1. Không bao giờ giao 2 task cùng lúc cho 1 worker trừ khi plan
  nói rõ là song song.
- Dừng an toàn mặc định: blocked, verify fail quá số lần, hết thời gian, hoặc
  người dùng pause/cancel thì dừng, không tự đoán tiếp.
- Tương thích ngược: `ide_dispatch_task` 1 task lẻ vẫn chạy như cũ. Chỉ các
  run có `planId` mới vào vòng lặp mới.

## Các phase (làm theo thứ tự, mỗi phase xong mới sang phase sau)

### Phase 0 — Đóng băng hành vi hiện tại (0,5 ngày, không đổi tính năng)

- [ ] 0.1 Viết test tay / script ghi lại luồng hiện tại: dispatch -> pull -> ack
  -> progress -> complete -> inject report -> ChatGPT nhận được.
- [ ] 0.2 Ghi lại vào file này: thời gian pull timeout mặc định, injector chờ
  bao lâu, WS reconnect bao lâu. Làm baseline để so sánh sau này.
- Xong khi: chạy lại được luồng cũ, không cần sửa code đã có.

### Phase 1 — Plan & Run trong SQLite (nền móng, bắt buộc trước mọi phase khác)

File chạm: `src/daemon/db.ts`, `src/daemon/tools/task-bridge.ts` (thêm
`src/daemon/tools/plan.ts` nếu file quá lớn), `src/daemon/tools/index.ts` đăng ký tool.

- [ ] 1.1 Thêm bảng (migration, không xóa bảng cũ):
  `plans(id, goal, loop_prompt, status, created_at, updated_at)`,
  `plan_tasks(id, plan_id, order_index, goal, details, files_hint_json,
  verify_json, depends_on_json, status, attempt_count, max_attempts,
  last_heartbeat_at, created_at, updated_at)`,
  mở rộng `tasks` thêm `plan_id, plan_task_id, attempt_count, last_heartbeat_at`.
  Status plan: `draft | running | paused | done | failed | cancelled`.
  Status task: `pending | running | success | failed | blocked | skipped`.
- [ ] 1.2 Tool mới: `plan_create(goal, tasks[], loop_prompt?)`,
  `plan_add_task(planId, task)`, `plan_list`, `plan_status(planId)`,
  `plan_pause`, `plan_resume`, `plan_cancel`.
  `plan_status` trả về: plan, từng task + trạng thái + attempt, task hiện tại,
  task tiếp theo, thời gian heartbeat cuối, lần inject cuối.
- [ ] 1.3 `ide_dispatch_task` nhận thêm `planId, orderIndex, dependsOn` (tùy chọn).
  Task không có planId thì hành vi y như cũ.
- Xong khi: tạo được plan 3 task, `plan_status` đọc đúng thứ tự, pause/resume
  đổi được trạng thái, dữ liệu còn nguyên sau khi restart daemon.

### Phase 2 — Queue bền vững + khôi phục sau restart

File chạm: `src/daemon/tools/task-bridge.ts`, `src/daemon/index.ts` (khởi động).

- [ ] 2.1 Khi dispatch, ghi đủ goal/details/filesHint/plan/order vào SQLite,
  không chỉ title. Queue lúc chạy lấy từ SQLite, RAM chỉ là bản sao.
- [ ] 2.2 Khi daemon khởi động: load `pending` vào queue theo `order_index`,
  load `running` thành `pending` (kèm `attempt_count + 1` và ghi timeline
  `task_recovered`), không tự chạy lại task đang dở mà không có worker pull.
- [ ] 2.3 `giano_task_pull` idempotent theo lease: 1 task chỉ giao cho 1 worker
  trong 1 lease; worker pull lại cùng taskId trong lease thì trả lại cùng task,
  không tạo bản sao.
- Xong khi: kill daemon giữa chừng, khởi động lại, task pending và task đang
  làm đều xuất hiện lại đúng thứ tự, không mất, không trùng.

### Phase 3 — Heartbeat, timeout, retry (chống worker mất kết nối)

File chạm: `src/daemon/tools/task-bridge.ts`, `src/daemon/index.ts` (sweeper).

- [ ] 3.1 Tool `giano_task_heartbeat(taskId)` — worker gọi mỗi 60s (hoặc mỗi
  lần `progress`). Daemon ghi `last_heartbeat_at`.
- [ ] 3.2 Sweeper chạy mỗi 60s trong daemon: task `running` mà không có heartbeat
  quá 5 phút (cấu hình được) thì tự `release` về queue, `attempt_count + 1`,
  ghi timeline. Quá `max_attempts` (mặc định 3) thì chuyển `blocked`, dừng
  plan đó lại, inject báo cáo blocked cho ChatGPT + người dùng.
- [ ] 3.3 `giano_task_release` hiện có giữ nguyên, nhưng thêm lý do + attempt
  vào timeline để lần retry sau worker thấy được lỗi lần trước.
- Xong khi: giả lập worker chết (không heartbeat 5 phút), task tự về queue,
  retry đủ 3 lần thì plan pause ở trạng thái blocked, không kẹt ở running mãi.

### Phase 4 — Vòng lặp tiếp nối ở ChatGPT Web (phần quan trọng nhất)

File chạm: `src/daemon/index.ts` (`handleMcpActivity`), `src/daemon/tools/task-bridge.ts`.

- [ ] 4.1 Tool `plan_next(planId)`: trả về đúng 1 task tiếp theo đủ điều kiện
  (task trước đã success + verify pass, dependency đã xong), hoặc `done`
  nếu hết plan, hoặc `blocked` nếu task trước chưa xong. ChatGPT chỉ cần gọi
  tool này, không tự chọn task.
- [ ] 4.2 Khi task trong plan complete: daemon không inject báo cáo chung chung
  nữa mà inject **continuation prompt** có cấu trúc cố định:
  plan goal, task vừa xong (summary, files, verify), task tiếp theo
  (goal/details/filesHint), và chỉ thị: "Gọi plan_next / dispatch task tiếp
  theo ngay, không dừng, không hỏi lại, trừ khi task báo blocked/failed".
  Khi hết plan thì inject **final summary prompt** thay vì continuation.
- [ ] 4.3 Context gọn cho vòng lặp dài: continuation prompt chỉ mang tóm tắt
  các task đã xong (mỗi task 1-2 dòng), không mang toàn bộ log, để ChatGPT
  không bị tràn context sau nhiều task. Toàn bộ log vẫn ở SQLite/timeline.
- Xong khi: chạy plan 3 task liên tiếp mà không cần người chạm vào: task 1
  xong -> ChatGPT tự giao task 2 -> task 2 xong -> task 3 -> báo cáo cuối.

### Phase 5 — Chống mất kết nối phía Web/Extension (inject có ack + outbox)

File chạm: `src/daemon/browser-bridge.ts`, `src/daemon/db.ts`,
`src/daemon/index.ts`, `extension/src/background/websocket-client.ts`,
`extension/src/content/content.ts`, `extension/src/content/chatgpt-injector.ts`.

- [ ] 5.1 Daemon: bảng `injection_outbox(id, plan_id, task_id, text, status,
  attempt_count, created_at, delivered_at)`. `injectPrompt()` khi không có
  socket thì ghi outbox `pending`, không trả `false` rồi mất. Khi socket
  extension mở lại (sự kiện subscribe), daemon flush outbox theo thứ tự.
- [ ] 5.2 Extension: `inject_prompt` phải trả ack về daemon
  (`inject_result`: ok/error + text hash). Daemon chỉ đánh dấu delivered khi
  có ack. Không có ack sau 30s thì retry với backoff (5s, 15s, 30s, tối đa 5 lần).
- [ ] 5.3 Extension WS: reconnect backoff lũy thừa (3s -> 6s -> 12s -> tối đa 60s),
  giữ nguyên ping 10s. Khi reconnect, gửi lại subscribe + xin flush outbox.
- [ ] 5.4 Injector: nếu ChatGPT đang generate quá 30s hoặc không thấy ô nhập,
  không vứt prompt mà trả về lỗi có mã để daemon giữ outbox và thử lại sau,
  thay vì coi như đã gửi.
- [ ] 5.5 Resume sau khi reload tab ChatGPT: tool `plan_resume_prompt(planId)`
  sinh lại prompt tiếp nối đúng task hiện tại, để người dùng chỉ cần paste
  hoặc extension tự inject khi tab sẵn sàng.
- Xong khi: tắt extension / reload tab đúng lúc task xong, báo cáo + task tiếp
  theo vẫn tới được ChatGPT sau khi kết nối lại, không mất, không trùng
  (kiểm tra bằng hash của prompt trong outbox).

### Phase 6 — Verify gate + an toàn trước khi sang task sau

File chạm: `src/daemon/tools/task-bridge.ts`, `src/daemon/security.ts`
(kiểm tra luật hiện có trước khi thêm).

- [ ] 6.1 Mỗi plan task có `verify` là danh sách lệnh kiểm tra (ví dụ: build,
  test, lint) + tiêu chí pass. Worker báo complete phải kèm `verify` result.
  Daemon chỉ cho sang task sau khi verify pass; fail thì retry cùng task kèm
  log lỗi, đủ `max_attempts` thì blocked.
- [ ] 6.2 Approval gate: task đụng file ngoài workspace, xóa file, chạy lệnh
  nguy hiểm thì plan pause và đưa vào hàng approvals đã có, chờ người duyệt
  rồi mới tiếp tục. Không tự duyệt.
- [ ] 6.3 Giới hạn vòng lặp: `max_tasks` của plan, `max_attempts` mỗi task,
  `max_run_minutes` của plan. Vượt giới hạn thì plan chuyển `failed/paused`
  kèm lý do, không loop vô hạn.
- Xong khi: task cố tình làm sai test thì không được sang task sau, retry 3 lần
  rồi dừng ở blocked; task nguy hiểm thì dừng chờ duyệt.

### Phase 7 — Quan sát + kiểm thử đầu-cuối + rollout

File chạm: `src/daemon/tools/task-bridge.ts`, extension panel (file panel hiện có),
script test mới `scripts/test-continuous-loop.ts` (hoặc test tay có checklist).

- [ ] 7.1 Panel/queue stats mở rộng: `plan_status` hiển thị plan đang chạy,
  task hiện tại, attempt, heartbeat cuối, inject outbox pending. Người dùng
  nhìn 1 chỗ là biết loop đang ở đâu.
- [ ] 7.2 Test đầu-cuối (làm bằng script giả lập worker, không cần ChatGPT thật
  cho vòng lặp kỹ thuật): plan 5 task -> worker pull/complete từng task ->
  daemon inject continuation đúng thứ tự -> giả lập daemon restart giữa task 3
  -> giả lập extension mất kết nối ở task 4 -> loop vẫn về đích, không mất,
  không trùng, không kẹt.
- [ ] 7.3 Rollout: tính năng loop chỉ bật cho run có planId; task lẻ cũ không đổi.
  Ghi lại trong `MCP_INSTRUCTIONS.md` / `README.md`: cách tạo plan, cách resume,
  cách pause/cancel, giới hạn mặc định (heartbeat 60s, timeout 5 phút,
  max_attempts 3).
- Xong khi: checklist 7.2 pass, tài liệu cập nhật, bản trên máy này chạy được
  plan 5 task liên tục không cần chạm tay.

## Thứ tự làm và ước lượng

Phase 0 (0,5 ngày) -> 1 (1-2 ngày) -> 2 (1 ngày) -> 3 (1 ngày) ->
4 (1-2 ngày) -> 5 (2 ngày, phần khó nhất vì đụng extension + daemon cùng lúc) ->
6 (1 ngày) -> 7 (1 ngày). Tổng khoảng 8-11 ngày làm 1 mình, có thể rút ngắn
nếu bỏ Phase 6 approval gate sang đợt sau (nhưng không nên bỏ verify gate).

## Rủi ro còn lại (nói thẳng, không giấu)

- ChatGPT Web vẫn có thể tự dừng vì giới hạn của chính ChatGPT (hết context,
  bị rate limit, tab bị đóng): plan này giảm đứt do Otter gây ra, không xóa
  được giới hạn của ChatGPT. Mitigation là Phase 5 resume prompt + Phase 4
  context gọn.
- Injector phụ thuộc vào DOM của ChatGPT Web (selector của ô nhập/nút gửi):
  ChatGPT đổi giao diện là injector có thể vỡ — cần giữ lại fallback nhiều
  chiến lược đã có trong `chatgpt-injector.ts` và test lại sau mỗi lần đổi UI.
- Worker IDE không gọi heartbeat thì Phase 3 sẽ release task dù worker vẫn
  đang làm nhưng im lặng: mitigation là worker phải gọi heartbeat/progress
  định kỳ, và tài liệu worker phải nói rõ điều này.
