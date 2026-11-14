# ChatMCP Full Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng cấp toàn diện Chrome Extension và Bun Daemon của ChatMCP để tích hợp trọn vẹn 55 modules tính năng từ ChatGPT Activity Clean (Auto-Approval, Live Terminal PTY, Folder Picker, Plan Overlay, Continuous Mode).

**Architecture:** Đồng bộ bộ source code sạch của Extension vào `extension/`, cấu hình lại `build.extension.ts` để đóng gói đầy đủ tài nguyên tĩnh (vendor, sounds, HTML/CSS). Đồng thời bổ sung các router REST & WebSocket trong Bun Daemon (`src/daemon/`) để đáp ứng trọn vẹn đặc tả giao thức `/api/activity/v1` và `/api/local/system/folder-picker`.

**Tech Stack:** Bun, TypeScript, Chrome Extension Manifest V3, SQLite (bun:sqlite), PowerShell .NET Windows Forms GUI, xterm.js, Prism.js.

**Spec:** `docs/superpowers/specs/2026-10-25-chatmcp-upgrade-spec.md`

## Global Constraints
- Cổng daemon mặc định: `9998` (khớp với extension).
- Host permissions trên Chrome Extension: `https://chatgpt.com/*`, `http://127.0.0.1/*`, `http://localhost/*`.
- Tuân thủ nguyên tắc Ponytail: Tối ưu ngắn gọn, tái sử dụng native Bun API và Node stdlib, không thêm dependency cồng kềnh.

---

### Task 1: Đồng bộ toàn bộ mã nguồn Chrome Extension & Cấu hình Build

**Files:**
- Create/Sync: `extension/` (55 tệp .js, `sounds/`, `vendor/`, `theme.css`, `plan-overlay.css`, `options.html`, `manifest.json`)
- Modify: `build.extension.ts`
- Modify: `extension/server-registry.js`

**Interfaces:**
- Input: Tệp nguồn tại `C:\Users\NAM\Downloads\ChatGPT-windows-x64\chatgpt-extension-clean`
- Output: Thư mục `extension/dist/` sẵn sàng tải vào trình duyệt qua `chrome://extensions`

- [ ] **Step 1: Sao chép toàn bộ tệp từ chatgpt-extension-clean vào extension/**
Sao chép đè toàn bộ tệp .js, .html, .css, .json, thư mục sounds/ và vendor/ từ `C:\Users\NAM\Downloads\ChatGPT-windows-x64\chatgpt-extension-clean` sang `c:\Users\NAM\Code\rust\chatmcp\extension\`.

- [ ] **Step 2: Cập nhật server-registry.js để mặc định kết nối cả localhost và Cloudflare tunnel**
Đảm bảo danh sách server mặc định hỗ trợ:
```javascript
const defaultServers = [
  { id: "localhost", name: "Localhost (9998)", apiBase: "http://127.0.0.1:9998", local: true },
  { id: "tunnel", name: "Cloudflare Tunnel", apiBase: "https://chatmcp.bug.edu.vn", local: false }
];
```

- [ ] **Step 3: Cập nhật build.extension.ts để copy toàn bộ cấu trúc sang extension/dist/**
Viết lại `build.extension.ts` sao chép toàn bộ extension sang `extension/dist/` để người dùng có thể nạp thẳng `extension/` hoặc `extension/dist/` vào Chrome.

- [ ] **Step 4: Chạy bun run build:extension và kiểm tra output**
Chạy `bun run build:extension` và kiểm tra `extension/dist/manifest.json`.

---

### Task 2: Triển khai Native Folder Picker Endpoint trong Daemon

**Files:**
- Create: `src/daemon/system.ts`
- Modify: `src/daemon/index.ts`

**Interfaces:**
- Produces: `POST /api/local/system/folder-picker` -> `{ ok: true, path: string }` hoặc `{ ok: false, canceled: true }`

- [ ] **Step 1: Viết module system.ts gọi PowerShell FolderBrowserDialog**
Tạo file `src/daemon/system.ts`:
```typescript
import { spawn } from "bun";

export async function openFolderPicker(initialPath?: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  const isWindows = process.platform === "win32";
  if (!isWindows) {
    return { ok: false, error: "Only Windows is supported for native folder picker" };
  }

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Chọn thư mục dự án cho ChatGPT"
    $dialog.ShowNewFolderButton = $true
    if ("${(initialPath || "").replace(/\\/g, "\\\\")}" -and (Test-Path "${(initialPath || "").replace(/\\/g, "\\\\")}")) {
      $dialog.SelectedPath = "${(initialPath || "").replace(/\\/g, "\\\\")}"
    }
    $result = $dialog.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
      Write-Output $dialog.SelectedPath
    } else {
      Write-Output "::CANCELED::"
    }
  `;

  const proc = spawn({
    cmd: ["powershell.exe", "-NoProfile", "-Sta", "-Command", script],
    stdout: "pipe",
    stderr: "pipe"
  });

  const stdout = (await new Response(proc.stdout).text()).trim();
  await proc.exited;

  if (!stdout || stdout === "::CANCELED::") {
    return { ok: false, canceled: true };
  }
  return { ok: true, path: stdout };
}
```

- [ ] **Step 2: Gắn endpoint vào src/daemon/index.ts**
```typescript
if (url.pathname === "/api/local/system/folder-picker" && req.method === "POST") {
  return (async () => {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const res = await openFolderPicker(body.initialPath);
    return Response.json(res, { headers: corsHeaders });
  })();
}
```

- [ ] **Step 3: Kiểm thử endpoint folder-picker qua curl/fetch**
Gửi request test xem phản hồi trả về đúng chuẩn.

---

### Task 3: Triển khai Live PTY Terminal Streaming trong Daemon

**Files:**
- Modify: `src/daemon/terminal.ts`
- Modify: `src/daemon/index.ts`

**Interfaces:**
- `GET /api/activity/v1/conversations/:id/terminals` -> `TerminalSessionInfo[]`
- `GET /api/activity/v1/conversations/:id/terminals/:sessionId/live` -> Long-polling chuỗi ANSI text
- `POST /api/activity/v1/conversations/:id/terminals/:sessionId/input` -> `{ ok: true }`

- [ ] **Step 1: Xây dựng TerminalSessionManager trong src/daemon/terminal.ts**
Quản lý buffer sequence, tiến trình con đa phiên và gửi ký tự vào stdin.

- [ ] **Step 2: Gắn các route terminal vào src/daemon/index.ts**
Xử lý các request `terminal-list`, `terminal-output`, `terminal-input`.

- [ ] **Step 3: Kiểm thử luồng terminal bằng script mẫu**
Gửi lệnh `dir` hoặc `whoami`, xác nhận output trả về qua `/live`.

---

### Task 4: Triển khai Quản lý Sự kiện Activity, Continuous Mode & Prompt Steer

**Files:**
- Modify: `src/daemon/db.ts`
- Modify: `src/daemon/index.ts`

**Interfaces:**
- `GET /api/activity/v1/conversations/:id/events`
- `PUT /api/activity/v1/conversations/:id/continuous`
- `POST /api/activity/v1/conversations/:id/continuous/extend`
- `POST /api/activity/v1/conversations/:id/immediate`
- WebSocket message: `{ type: "activity.ready" }` và `{ type: "activity.page" }`

- [ ] **Step 1: Thêm bảng lưu trữ events và settings vào src/daemon/db.ts**
Bổ sung bảng `activity_events` và `conversation_settings` vào SQLite.

- [ ] **Step 2: Nâng cấp WebSocket handshake trong src/daemon/index.ts**
Phản hồi `activity.ready` và `activity.page` khi extension gửi message `subscribe`.

- [ ] **Step 3: Bổ sung các routes continuous và immediate vào daemon**
Hỗ trợ kích hoạt continuous mode và chèn prompt ưu tiên cao.

---

### Task 5: Build và Xác minh Hoạt động Toàn diện

**Files:**
- Validate: `extension/dist/manifest.json`
- Validate: `src/daemon/index.ts`

- [ ] **Step 1: Run bun run build:extension**
Xác nhận toàn bộ extension dist được sinh ra đầy đủ, không thiếu file.

- [ ] **Step 2: Chạy kiểm thử toàn bộ endpoint của daemon**
Kiểm thử MCP (`/mcp`), Folder Picker, Events, và WebSocket stream.

- [ ] **Step 3: Xác minh kết nối từ Cloudflare Tunnel**
Xác nhận tunnel `https://chatmcp.bug.edu.vn` tiếp tục hoạt động trơn tru với các endpoint mới.
