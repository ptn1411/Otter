# Fleet multi-node — đã triển khai (Phase 0–3, B2)

Ngày: 2026-10-31. Plan gốc: `docs/plans/2026-10-31-fleet-multi-node.md`.
Người dùng chọn: làm cả hai theo plan, Phase 0 rồi Phase 1–3 hub B2.
Trạng thái: CODE XONG + TEST 2 DAEMON THẬT TRÊN VM, CHƯA test
trên Chrome thật và CHƯA test với `nam` (worker `nam` cần bun +
daemon chạy trước, xem "Chưa làm" cuối doc).

## Đã code gì

### Phase 0 — độc lập từng dự án
- Node identity: `OTTER_NODE_ID`, `OTTER_NODE_NAME`, `PORT` (đã có),
  `OTTER_PROJECTS` (mới, danh sách root cách nhau bằng dấu phẩy,
  đăng ký vào allowed workspaces lúc load `security.ts`).
  `GET /api/fleet/node` trả identity + projects + capabilities.
- Pack extension: `bun scripts/pack-extension.ts` → 
  `extension-pack/otter-extension-2.0.0.zip` (1.7 MB, từ
  `extension/dist/` sau `bun build.extension.ts`).
- Export/Import servers: `exportServers`/`importServers` trong
  `extension/src/background/server-registry.ts` + nút Export/Import
  ở tab Management (options). File export chứa token nếu có — giữ
  như mật khẩu, chỉ import trên máy của chính mình.
- Per-tab node picker: trước đây `setTabServer` tồn tại nhưng
  KHÔNG có UI nào gọi nó, nên mọi tab ChatGPT đều mặc định về
  localhost. Nay panel Activity có dropdown "Node (daemon cho tab
  này)" → background `set-tab-server` + `tab-connect` lại, tab này
  đổi node, tab khác không bị ảnh hưởng.

### Phase 1 — fleet khung
- Bảng mới trong `db.ts`: `fleet_nodes`, `fleet_dispatches`,
  `fleet_inbox` (PK dispatch_id = lớp chống trùng).
- Pure logic `src/daemon/fleet.ts` (không MCP/Zod): register/
  heartbeat (stale sau 90s) / list / remove node, create/get/list/
  update dispatch, timeout sweep (mặc định 60 phút), receive
  idempotent, refresh inbox từ plan, cancel inbox, allowlist check.
- Routes `src/daemon/routes/fleet-routes.ts`, cắm vào `index.ts`
  SAU global auth check (không route fleet nào là public path):
  `/api/fleet/node`, `/api/fleet/nodes` (+heartbeat, DELETE),
  `/api/fleet/dispatches` (+cancel), `/api/fleet/dispatch` (worker
  nhận), `/api/fleet/inbox` (+cancel), `/api/fleet/heartbeat`.
- MCP tools `src/daemon/tools/fleet-tools.ts` (8 tool, tổng MCP
  136 → 144): `fleet_list`, `fleet_register`, `fleet_dispatch`,
  `fleet_status`, `fleet_result`, `fleet_cancel`,
  `fleet_remove_node`, `fleet_inbox`. Khai báo ở
  `MCP_INSTRUCTIONS.md` nhóm H.

### Phase 2 — dispatch thật B2
- Worker nhận dispatch → tạo plan local `[FLEET <id>] <goal>`,
  resume plan (draft → running) → đưa prompt B2 vào injection
  outbox (để tab ChatGPT của worker nhận nếu đang nối) → inbox
  status running.
- Worker brain (ChatGPT của worker, hoặc MCP client mô phỏng trong
  test) chạy plan/loop tools local như bình thường: plan_next →
  làm → plan_task_update/loop_report_attempt.
- Hub poll: `fleet_status`/`fleet_result` gọi worker
  `/api/fleet/inbox/:id`, cập nhật trạng thái hub thành
  done/blocked/cancelled/timed_out. Sửa trong lúc test: 
  `refreshInboxFromPlan` gọi `refreshPlanStatus` trước, vì
  `plan_task_update` chỉ sửa task mà không promote plan → nếu
  không, plan đã xong task mà inbox vẫn running.
- Bảo mật: token không lưu trong DB fleet (hub dùng OTTER_API_KEY
  của mình, hoặc token truyền 1 lần qua tool, không log);
  project_root ngoài allowlist của worker bị từ chối 400;
  dispatch gửi lại cùng id trả alreadyExisted, không tạo plan mới;
  worker offline → hub thấy stale sau 90s, dispatch quá deadline
  → timed_out.

### Phase 3 — vận hành
- Tab Management có card Fleet: liệt kê node + 10 dispatch gần
  nhất từ hub daemon đang chọn, và form tạo lệnh fleet_dispatch
  để copy dán vào tab ChatGPT của hub (extension KHÔNG tự gọi
  worker, tránh dispatch trùng/lẫn — dispatch thật chỉ chạy qua
  MCP từ tab hub).
- Nhóm tool fleet trong `MCP_INSTRUCTIONS.md`.

## Test đã chạy (2026-10-31, trên VM này)
- `bun scripts/test-fleet.ts`: 16/16 pass (identity, register/
  stale, dispatch, receive idempotent, allowlist refuse, plan done
  → inbox done, cancel, timeout sweep, remove node).
- Live 2 daemon thật, cùng VM, DB riêng, cwd riêng:
  hub `hub-vm` port 1993 (repo chatmcp) + worker `worker-test`
  port 1994 (project `~/workspace/fleet-test-worker/`).
  - `GET /api/fleet/node` cả 2 đều đúng nodeId/port/projects.
  - Hub MCP `fleet_register` + `fleet_list` thấy worker online.
  - Hub MCP `fleet_dispatch` (goal "Fleet live test", 1 task tạo
    file) → worker plan `plan_1793434761079_7934f215` + outbox
    `inj_1793434761197_4ed0cf14`, hub dispatch running.
  - Worker MCP (mô phỏng ChatGPT của worker): plan_next lấy task,
    write_file tạo `fleet-test.txt` = "hello-fleet",
    plan_task_update task → success.
  - Worker `GET /api/fleet/inbox` → done, excerpt "1 success".
  - Hub MCP `fleet_status` → dispatch done, excerpt khớp.
  - Gửi lại cùng dispatch_id sang worker → alreadyExisted=true,
    không tạo plan mới. Gửi project `/etc` → 400 refused.
  - Dispatch tới node chưa đăng ký → lỗi rõ ràng, không tạo record.
  - MCP tổng: 144 tool (136 cũ + 8 fleet).
- Hồi quy sau fleet: plan-phase1 pass, loop-controller 42/42,
  fb-post pass.
- Extension build: `bun build.extension.ts` pass, `dist/` chứa
  set-tab-server (background + content) và manage-fleet-list
  (options); zip pack 1.7 MB.

## Chưa làm / chưa verify — nói rõ, không nhận đã xong
- Chưa test trong Chrome thật: node picker, Fleet card, Export/
  Import servers mới chỉ có trong code đã build, chưa mở Options
  page hay tab ChatGPT thật để bấm.
- Chưa test với `nam`: `nam` chưa có bun (setup script chưa chạy
  trên đó), chưa chạy daemon fleet trên `nam`, nên cặp hub VM +
  worker `nam` qua Tailscale vẫn là bước tiếp theo, không phải đã
  xong. Code fleet trên `nam` chỉ xong sau khi sync + chạy daemon
  ở đó với `OTTER_NODE_ID=nam`, `PORT=1993`,
  `OTTER_DB_PATH` riêng và `OTTER_PROJECTS` trỏ đúng repo.
- Worker chưa có ChatGPT tab thật: trong test live, "brain" của
  worker là MCP client gọi plan/write_file/task_update, không phải
  tab ChatGPT thật nhận outbox rồi chạy loop. Outbox prompt đã
  được tạo đúng (inj_... pending), nhưng bước tab thật nhận prompt
  vẫn chưa được chứng minh trong Chrome.
- Token per-node chưa làm: bản này hub dùng OTTER_API_KEY chung
  (hoặc token truyền 1 lần). Muốn mỗi worker một key riêng thì
  cần thêm mapping node→token ngoài DB (env/file 0600), chưa code.
- Daemon trên VM này là session-based: hub/worker test đã dừng
  khi turn kết thúc (quy luật đã biết của VM), cần start lại bằng
  run-daemon.ts / lệnh worker ở trên khi muốn dùng tiếp.
- File test live `~/workspace/fleet-test-worker/` (storage.sqlite
  + fleet-test.txt) nằm ngoài repo, không sync sang `nam`.

## Bổ sung 2026-10-31 (sau khi user nói "code đi")
- Chạy lại từ đầu trên VM: test-fleet 16/16, MCP 144 tool, hub 1993 +
  worker 1994 đều 200, dispatch mới disp_1793435370816_cb9659fd
  (file fleet-test-2.txt = "run2-ok") → worker plan done → hub
  fleet_status done, excerpt khớp. Code fleet đã có thật, không phải
  chỉ là plan.
- Sửa `scripts/pack-extension.ts`: Bun.spawn ném ENOENT khi `zip`
  vắng (nam) thay vì exit code, và GNU tar -a với tên .zip tạo ra
  file TAR chứ không phải ZIP — script cũ đã tạo 1 file .zip giả
  210K trên nam và bị python zipfile từ chối. Script mới try/catch
  từng lệnh và chỉ chấp nhận file bắt đầu bằng magic PK, nếu không
  thì báo fail rõ ràng.
- Trên nam: bun 1.4.4 đã có tại ~/.local/bin/bun (sửa lại ghi chú
  cũ nói nam chưa có bun), fleet.ts đã có, extension/dist đã build
  lại bằng `bun build.extension.ts` (2.4M, khớp local). Nam vẫn chưa
  tạo được .zip thật vì thiếu lệnh zip — trên nam cứ load unpacked
  trực tiếp từ extension/dist/, không cần zip.
