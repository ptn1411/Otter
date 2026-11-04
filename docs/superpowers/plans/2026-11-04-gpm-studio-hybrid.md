# GPM Studio Hybrid: Bộ Công Cụ MCP & Giao Diện Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Xây dựng giải pháp Hybrid hoàn chỉnh kết nối GPM Login (Port 9495) + GPM Automate (Port 19977) + Dual-Engine (Extension / CDP): bao gồm module MCP tools `src/daemon/tools/gpm-tools.ts`, REST API routes, và giao diện trực quan "GPM Studio" tab trong Chrome Extension (`options.html` + `options.ts`).

**Architecture:**
- **Daemon / MCP Backend**: Tạo module core `src/daemon/gpm.ts` và MCP tools `src/daemon/tools/gpm-tools.ts` bọc các API của GPM Login (`http://127.0.0.1:9495/api/v1`) và GPM Automate MCP (`http://127.0.0.1:19977/mcp`). Cung cấp 6 công cụ MCP và REST API cho extension.
- **Extension UI ("GPM Studio")**: Thêm tab "GPM Studio" vào `extension/options.html` và module xử lý `extension/src/options/options.ts` với 4 phân hệ: Quản lý profile, Live XPath Tester & DOM Inspector, Script Generator (Paste-ready JSON .NET cho GPM Automate V3), và Test Runner (chạy thử kịch bản qua Extension/CDP).
- **Tuân thủ 5 điểm đồng bộ công cụ** theo quy định `AGENTS.md` & `GEMINI.md`.

**Tech Stack:** Bun, TypeScript, Chrome Extension MV3, Tailwind-like CSS, Model Context Protocol (MCP) SDK, GPM Automate V3 (.NET JSON format), Chrome DevTools Protocol (CDP).

**Spec:** `C:\Users\NAM\.gemini\config\skills\gpm-automate\SKILL.md` và `references/`.

## Global Constraints
- Target: Browser automation qua GPM Login profiles & Google Chrome.
- Định dạng kịch bản GPM Automate V3: BẮT BUỘC là JSON serialize kiểu .NET (Json.NET, `$type`, ActionNode / NormalBlockNode, GUID v4, `raw_input` JSON-escaped, cú pháp điều kiện `hasElement(XPATH)`).
- Không thêm dependency bên ngoài nếu standard library hoặc dependencies hiện có (Bun, Zod, MCP SDK) đã đáp ứng đủ.
- Tuân thủ quy tắc 5 điểm đồng bộ công cụ khi tạo công cụ MCP mới (MCP Core Server, OpenAPI Schema, Discovery Servers, Universal Tool Gateway, Quyền truy cập Public).
- Biên dịch extension (`bun run build.extension.ts`) và sao chép vào `%LOCALAPPDATA%\Otter\extension` sau khi hoàn thành.

---

### Task 1: Core GPM Client Service (`src/daemon/gpm.ts`)

**Files:**
- Create: `src/daemon/gpm.ts`
- Test: `tests/gpm-service.test.ts`

**Interfaces:**
- Consumes: `fetch` (native Bun), `crypto.randomUUID()`.
- Produces:
  - `getGpmHealth(): Promise<{ gpmLogin: boolean; gpmAutomate: boolean; loginPort: number; automatePort: number }>`
  - `listGpmProfiles(): Promise<Array<{ id: string; name: string; proxy?: string; is_running?: boolean; remote_debugging_port?: number }>>`
  - `startGpmProfile(id: string, additionArgs?: string): Promise<{ success: boolean; port?: number; wsUrl?: string; message?: string }>`
  - `stopGpmProfile(id: string): Promise<{ success: boolean; message?: string }>`
  - `generateGscriptNode(actionType: number, params: Record<string, string>, xpath?: string, condition?: string): any`
  - `validateXPathExpression(xpath: string): { valid: boolean; error?: string }`

- [x] **Step 1: Write failing unit tests for GPM Service**
  - Tạo `tests/gpm-service.test.ts` kiểm thử các hàm tạo node JSON .NET của GPM Automate:
    - Kiểm tra cấu trúc `$type`, GUID v4, `raw_input` JSON escape chuỗi.
    - Kiểm tra sinh điều kiện `hasElement(//div)` đúng chuẩn GPM Automate V3.
    - Kiểm tra hàm `validateXPathExpression` từ chối các biểu thức XPath sai cú pháp.

- [x] **Step 2: Run tests to verify failure**
  - Chạy `bun test tests/gpm-service.test.ts` và xác nhận test fail do chưa có `src/daemon/gpm.ts`.

- [x] **Step 3: Implement `src/daemon/gpm.ts`**
  - Viết logic kết nối GPM Login Local API (`http://127.0.0.1:9495/api/v1/profiles`), start/stop profile.
  - Viết generator tạo node GPM Automate V3:
    - Action type 48 (Mouse click), type 49 (Mouse move), type 50 (Key press/type), type 53 (Mouse scroll), type 68 (Execute JS), type 118 (Wait element), type 11 (Go to URL).
    - Cấu trúc `$type: "GPMAutomateEditor.Models.ActionNode, GPMAutomateEditor.Models"`.
    - Escape `raw_input` sang dạng chuỗi JSON `[{"Key":"...","Value":"..."}]`.
    - Wrapper `NormalBlockNode` bọc mảng `nodes` paste-ready.

- [x] **Step 4: Run tests and make sure they pass**
  - Chạy `bun test tests/gpm-service.test.ts` và xác nhận 100% tests pass.

- [x] **Step 5: Git commit Task 1**
  - Commit với thông điệp: `feat(gpm): add core GPM service with GPM Automate V3 node generator`.

---

### Task 2: MCP Tools Integration & 5-Point Synchronization

**Files:**
- Create: `src/daemon/tools/gpm-tools.ts`
- Modify: `src/daemon/tools/index.ts`
- Modify: `src/daemon/mcp.ts`
- Modify: `src/daemon/routes/activity-routes.ts`
- Modify: `src/daemon/routes/mcp-routes.ts`
- Modify: `openapi.json`
- Test: `tests/gpm-mcp-tools.test.ts`

**Interfaces:**
- Consumes: `src/daemon/gpm.ts`, `@modelcontextprotocol/sdk`.
- Produces:
  - MCP Tools: `gpm_status`, `gpm_list_profiles`, `gpm_start_profile`, `gpm_stop_profile`, `gpm_test_xpath`, `gpm_generate_script`.
  - REST Endpoints:
    - `GET /api/activity/v1/gpm/status`
    - `GET /api/activity/v1/gpm/profiles`
    - `POST /api/activity/v1/gpm/profiles/start`
    - `POST /api/activity/v1/gpm/profiles/stop`
    - `POST /api/activity/v1/gpm/xpath/test`
    - `POST /api/activity/v1/gpm/script/generate`

- [x] **Step 1: Write integration test for GPM MCP tools**
  - Tạo `tests/gpm-mcp-tools.test.ts`: test đăng ký tool vào MCP server và gọi tool qua protocol.

- [x] **Step 2: Implement `src/daemon/tools/gpm-tools.ts`**
  - Định nghĩa các tools MCP với Zod schema:
    - `gpm_status`: Kiểm tra trạng thái GPM Login và GPM Automate.
    - `gpm_list_profiles`: Xem danh sách profile.
    - `gpm_start_profile`: Mở profile lấy CDP port.
    - `gpm_stop_profile`: Đóng profile.
    - `gpm_test_xpath`: Kiểm tra selector XPath trên trang hiện tại.
    - `gpm_generate_script`: Sinh kịch bản JSON paste-ready cho GPM Automate V3.

- [x] **Step 3: Register in MCP Server & Export**
  - Thêm `registerGpmTools` vào `src/daemon/tools/index.ts`.
  - Gọi `registerGpmTools(mcp, onActivity)` trong `src/daemon/mcp.ts`.

- [x] **Step 4: Implement REST routes in `activity-routes.ts` and sync `openapi.json`**
  - Thêm các route `/api/activity/v1/gpm/*` vào `src/daemon/routes/activity-routes.ts`.
  - Thêm khai báo `paths` tương ứng vào `openapi.json`.
  - Cập nhật server `otter_core` trong `GET /api/mcp/servers` (`src/daemon/routes/mcp-routes.ts`) để hiển thị các tool GPM mới.
  - Cập nhật xử lý proxy trong `matchDaemonRoutePrefix(url.pathname, "MCP_EXT_PREFIX")`.

- [x] **Step 5: Run tests and verify 5-point checklist**
  - Chạy `bun test tests/gpm-mcp-tools.test.ts`.
  - Kiểm tra endpoints qua curl / fetch nội bộ.

- [x] **Step 6: Git commit Task 2**
  - Commit với thông điệp: `feat(mcp): register GPM automation tools and REST endpoints with 5-point sync`.

---

### Task 3: Extension "GPM Studio" UI Markup & Styling (`extension/options.html`)

**Files:**
- Modify: `extension/options.html`

**Interfaces:**
- HTML Components:
  - Tab button `#tab-btn-gpm` có icon và badge trạng thái.
  - Tab pane `#tab-gpm` gồm 4 khối giao diện:
    1. **Quản lý Profile GPM Login**: Thẻ hiển thị port 9495 & 19977 (active/inactive), bảng profile với nút Mở (+ Extension) / Đóng, badge hiển thị CDP port.
    2. **Visual XPath Tester & DOM Inspector**: Ô nhập XPath, nút Test Live trên active tab, bảng kết quả (số phần tử khớp, preview HTML text, gợi ý chống trôi).
    3. **Trình Tạo Kịch Bản GPM Automate V3**: Form chọn hành động (Click, Type, Go URL, Scroll, Wait, Execute JS), preview JSON .NET, nút Copy 1-Click Paste-Ready, nút gửi prompt ChatGPT.
    4. **Test Runner & Chạy Thử Kịch Bản**: Bảng điều khiển kịch bản mẫu (Đăng nhập, cuộn feed ảo hóa, kiểm tra pop-up), nút chạy thử với Dual-Engine (Extension vs CDP), khung live log.

- [x] **Step 1: Add Nav Tab Button for GPM Studio**
  - Thêm `<button type="button" class="tab-btn" id="tab-btn-gpm" data-tab="tab-gpm">🤖 GPM Studio</button>` vào thanh `nav-tabs` trong `extension/options.html`.

- [x] **Step 2: Add GPM Studio Tab Pane Markup**
  - Tạo cấu trúc HTML thẻ đẹp mắt, chuẩn dark theme hiện có của Otter (`card-box`, `card-header`, `card-title`, `btn-copy`...).
  - Thiết kế bảng profile responsive có lọc tìm kiếm profile.
  - Thiết kế ô nhập XPath có nút "Lấy XPath chuẩn (hasElement)" và "Sao chép điều kiện".
  - Thiết kế bộ sinh kịch bản JSON có syntax highlighting / preformatted code box.

- [x] **Step 3: Validate HTML markup and styling**
  - Kiểm tra cú pháp HTML đảm bảo đóng mở thẻ đầy đủ, không vỡ layout tab hiện tại.

- [x] **Step 4: Git commit Task 3**
  - Commit với thông điệp: `feat(extension): add GPM Studio tab markup and responsive cards in options.html`.

---

### Task 4: Extension "GPM Studio" Controller Logic & Build (`extension/src/options/options.ts`)

**Files:**
- Modify: `extension/src/options/options.ts`
- Build: `bun run build.extension.ts`

**Interfaces:**
- Event handlers:
  - `initGpmStudio()`: Khởi tạo dữ liệu GPM Studio khi mở tab hoặc tải trang.
  - `checkGpmHealth()`: Polling kiểm tra trạng thái port 9495 và 19977.
  - `loadGpmProfiles()`: Tải danh sách profile và render vào table.
  - `handleStartProfile(id)`: Gọi daemon mở profile kèm cờ load extension Otter và remote debugging port.
  - `handleStopProfile(id)`: Gọi daemon đóng profile.
  - `handleTestXPath(xpath)`: Gửi thông điệp tới active tab / CDP để evaluate XPath, đếm số element, highlight element viền xanh, và trả về chi tiết.
  - `handleGenerateGscript()`: Lấy thông tin form hành động, gọi `generateGscriptNode`, render JSON và tự động copy vào clipboard (paste-ready cho GPM Editor).
  - `handleRunScenario(steps, engine)`: Chạy thử kịch bản qua Dual-Engine và in log tiến độ.

- [x] **Step 1: Implement GPM Studio controller functions in `options.ts`**
  - Viết các hàm điều khiển `initGpmStudio`, load profile, start/stop profile.
  - Viết logic Live XPath Tester: kết nối với Chrome tabs API / daemon CDP để query selector/XPath và highlight trên màn hình.
  - Viết logic Script Generator: sinh mã JSON .NET paste-ready, kèm chức năng copy vào clipboard có toast báo thành công.
  - Viết logic Test Runner: điều phối các bước test và hiển thị log trực tiếp.

- [x] **Step 2: Bind UI event listeners in `options.ts`**
  - Gắn sự kiện click cho các nút bấm: `#gpm-refresh-btn`, `#gpm-test-xpath-btn`, `#gpm-generate-script-btn`, `#gpm-copy-script-btn`, `#gpm-run-test-btn`...

- [x] **Step 3: Build extension and sync to local AppData**
  - Chạy `bun run build.extension.ts`.
  - Xác minh file build trong `extension/dist` và `%LOCALAPPDATA%\Otter\extension`.

- [x] **Step 4: Git commit Task 4**
  - Commit với thông điệp: `feat(extension): implement GPM Studio interactive controller and build bundle`.

---

### Task 5: End-to-End Verification, Production Build & Deployment

**Files:**
- Verify: All tests in `tests/`
- Build: Standalone binaries (`dist/otter.exe`)
- Deploy: Deploy bundle to VPS (`160.250.181.51` / `otter.gpt.io.vn`)

- [x] **Step 1: Run complete test suite**
  - Chạy `bun test` đảm bảo 100% tests (bao gồm `gpm-service.test.ts`, `gpm-mcp-tools.test.ts`, `gpmautomate-mcp.test.ts`) đều pass sạch sẽ.

- [x] **Step 2: Build standalone binary**
  - Chạy `bun run build` để xuất bản binary `dist/otter.exe`.

- [x] **Step 3: Deploy to VPS**
  - Chạy `bun run deploy:vps` để cập nhật bản mới nhất lên server production `otter.gpt.io.vn`.
  - Kiểm tra sức khỏe endpoint qua `curl https://otter.gpt.io.vn/api/gpm/status`.

- [x] **Step 4: Final Git Commit & Push**
  - Push toàn bộ commits lên GitHub `origin/main`.

