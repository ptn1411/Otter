# Workspace Agent Instructions (AGENTS.md)

## BẮT BUỘC: Sử dụng Codebase Memory MCP thay vì Git Grep / File Search

Dự án này sử dụng Knowledge Graph của `codebase-memory-mcp` (Project identifier: `C-Users-NAM-Code-rust-chatmcp`).

### Quy tắc bất di bất dịch cho AI Agent:
1. **Tìm kiếm hàm, struct, class, interface, module**:
   - **CẤM** dùng `git grep` hoặc `grep_search` để tìm symbols/functions khi chưa tra cứu graph.
   - **BẮT BUỘC** gọi `call_mcp_tool(ServerName="codebase-memory", ToolName="search_graph", Arguments={"project": "C-Users-NAM-Code-rust-chatmcp", "name_pattern": ".*<tên>.*"})`.

2. **Lần vết luồng logic & quan hệ gọi hàm (Call Graph)**:
   - **BẮT BUỘC** gọi `call_mcp_tool(ServerName="codebase-memory", ToolName="trace_path", Arguments={"project": "C-Users-NAM-Code-rust-chatmcp", "function_name": "<tên_hàm>", "direction": "both"})`.

3. **Xem kiến trúc tổng thể & phân bố component**:
   - **BẮT BUỘC** gọi `call_mcp_tool(ServerName="codebase-memory", ToolName="get_architecture", Arguments={"project": "C-Users-NAM-Code-rust-chatmcp", "aspects": ["overview"]})`.

4. **Đọc mã nguồn một hàm/class cụ thể**:
   - **BẮT BUỘC** gọi `call_mcp_tool(ServerName="codebase-memory", ToolName="get_code_snippet", Arguments={"project": "C-Users-NAM-Code-rust-chatmcp", "qualified_name": "<tên_đầy_đủ>"})`.

5. **Kiểm tra trạng thái & độ phủ index**:
   - Gọi `call_mcp_tool(ServerName="codebase-memory", ToolName="index_status", Arguments={"project": "C-Users-NAM-Code-rust-chatmcp"})` hoặc `check_index_coverage`.

6. **Trường hợp duy nhất được dùng `git grep` / `grep_search`**:
   - Tìm chuỗi string thô (chuỗi UI tiếng Việt/Anh, thông báo lỗi cụ thể, cấu hình `.env`, comment).

---

## Kiến trúc Tổng quan Dự án (Otter)
- **Runtime**: Bun + TypeScript (Port 1993)
- **Mục đích**: Local MCP Server Daemon kết nối ChatGPT Web / Desktop Agent với hệ điều hành (Windows UI Automation, Terminal, Browser Extension, SQLite Storage, Video Creation Skill).
- **Core modules**:
  - `src/daemon/index.ts`: Entry point HTTP & WebSocket server.
  - `src/daemon/mcp.ts`: Xử lý giao thức Model Context Protocol (MCP) và đăng ký công cụ.
  - `src/daemon/cbm.ts`: Cầu nối tích hợp trực tiếp với binary `codebase-memory-mcp` cho AI client.
  - `src/daemon/desktop.ts`: Điều khiển chuột, bàn phím và giao diện ứng dụng desktop (CUA).
  - `src/daemon/terminal.ts`: Quản lý terminal giả lập (PTY).
  - `src/daemon/browser-bridge.ts`: Cầu nối điều khiển trình duyệt qua Chrome Extension.
  - `extension/`: Chrome Extension kết nối ChatGPT Web với local daemon.
  - `.agents/skills/`: Kho lưu trữ kỹ năng chuyên biệt (Remotion Video Creator, Video Shotcraft, Motion, GSAP).

---

## QUY TẮC BẮT BUỘC KHI TẠO/THÊM CÔNG CỤ (TOOL REGISTRATION CHECKLIST)

Mỗi khi tạo mới hoặc sửa đổi bất kỳ công cụ nào trong hệ thống, AI **BẮT BUỘC** phải hoàn thành đủ 5 điểm đồng bộ sau, tuyệt đối không được sót:

1. **MCP Core Server (`src/daemon/tools/` & `src/daemon/mcp.ts`)**:
   - Định nghĩa tool qua `mcp.tool("tool_name", schema, handler)`.
   - Đăng ký hàm nạp tool vào `createMcpServer()` trong `src/daemon/mcp.ts` và export tại `src/daemon/tools/index.ts`.

2. **OpenAPI Schema (`openapi.json` & `src/daemon/routes/activity-routes.ts`)**:
   - Định nghĩa endpoint REST tương ứng trong `src/daemon/routes/activity-routes.ts` (ví dụ: `/api/activity/v1/...`).
   - Khai báo path, `operationId`, request body, parameters vào `openapi.json` ở root để ChatGPT Custom GPT Action nhận diện được.

3. **Danh sách Khám phá MCP Servers (`GET /api/mcp/servers` trong `src/daemon/routes/mcp-routes.ts`)**:
   - **BẮT BUỘC** thêm tool vào danh sách tools của server `otter_core` trong hàm trả về của `GET /api/mcp/servers`.
   - Thêm xử lý proxy tại `matchDaemonRoutePrefix(url.pathname, "MCP_EXT_PREFIX")` cho server `otter_core` để ChatGPT hoặc Client gọi trực tiếp qua gateway.

4. **Universal Tool Call Gateway (`/api/activity/v1/tools/call`)**:
   - Đảm bảo client có thể gọi tool qua `mcp_call_tool` với `toolName: "<tên_tool>"` kết nối vào SSE endpoint.

5. **Quyền truy cập qua Tunnel (`isPublicPath` trong `src/daemon/index.ts`)**:
   - Đảm bảo các route schema (`/openapi.json`), khám phá (`/api/mcp/servers`), và dashboard (`/dashboard`) nằm trong danh sách `isPublicPath` để không bị chặn bởi lỗi `401 Unauthorized` khi client truy cập từ domain ngoài (Cloudflare Tunnel).

6. **Biên dịch & Khởi động lại**:
   - Nếu tool có logic phía Chrome Extension (`extension/src/`): chạy `bun run build:extension`.
   - Khởi động lại Otter Daemon (`bun src/daemon/index.ts`) để nạp toàn bộ cấu hình mới.
