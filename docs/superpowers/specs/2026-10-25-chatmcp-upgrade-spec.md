# Specification: ChatMCP Complete Extension & Daemon Upgrade

**Date:** 2026-10-25  
**Status:** Approved  
**Author:** Antigravity AI  

---

## 1. Objective
Nâng cấp toàn bộ hệ thống `chatmcp` (`c:\Users\NAM\Code\rust\chatmcp`) tương thích 100% với kiến trúc 55 modules trích xuất từ `chatgpt-extension-clean`:
1. Tích hợp Chrome Extension đầy đủ tính năng: Tự động phê duyệt quyền tool (`approval-auto.js`), Live PTY Terminal (`terminal-panel.js` + `xterm`), Chọn thư mục dự án trên Windows (`folder-picker.js`), Kế hoạch câu hỏi Agent (`plan-overlay.js` + SFX), Quản lý đa server (`options.html` + `server-registry.js`).
2. Mở rộng daemon Bun (`src/daemon/index.ts` & modules) để đáp ứng trọn vẹn tập API REST & WebSocket theo chuẩn `/api/activity/v1` và `/api/local/system/folder-picker`.

---

## 2. Architecture & Components

### A. Chrome Extension (`extension/`)
- Cấu trúc: Tận dụng trọn bộ 55 script độc lập, 2 tệp âm thanh (`sounds/new_agent.mp3`, `sounds/sound_exe.mp3`), và vendor (`xterm`, `prism`).
- Manifest V3: Khai báo 37 content scripts chạy tuần tự tại `document_idle` trên `https://chatgpt.com/*`.
- Server Registry (`server-registry.js`):
  - Server mặc định 1: `http://127.0.0.1:9998` (localhost daemon).
  - Server mặc định 2: `https://chatmcp.bug.edu.vn` (Cloudflare Tunnel).
- Auto-Approval (`approval-auto.js`): Giám sát DOM, tự động click nút *"Cho phép cho cuộc trò chuyện này"* / *"Allow for this conversation"* khi ChatGPT yêu cầu cấp quyền gọi MCP tool.

### B. Backend Daemon (`src/daemon/`)
1. **Folder Picker API (`/api/local/system/folder-picker`):**
   - Method: `POST`
   - Chạy lệnh PowerShell `-Sta` gọi `[System.Windows.Forms.FolderBrowserDialog]` mở cửa sổ chọn thư mục native trên Windows và trả về `{ ok: true, path: "..." }`.
2. **Interactive Terminal Sessions (`/api/activity/v1/conversations/{id}/terminals`):**
   - Quản lý phiên terminal tương tác (PTY / Subprocess Streams).
   - `GET .../terminals`: Trả về danh sách phiên đang chạy.
   - `GET .../terminals/{sessionId}/live?afterSequence={seq}&waitMs=5000`: Long-polling trả về buffer ANSI text theo sequence.
   - `POST .../terminals/{sessionId}/input`: Nhận text/keystroke từ `xterm.js` và ghi vào stdin của tiến trình.
3. **Continuous Interaction Mode:**
   - `PUT .../conversations/{id}/continuous`: Lưu cờ bật/tắt continuous mode trong SQLite.
   - `POST .../conversations/{id}/continuous/extend`: Gia hạn thời gian chờ.
4. **Immediate Prompt Steer:**
   - `POST .../conversations/{id}/immediate`: Lưu tin nhắn can thiệp khẩn cấp vào hàng đợi.
   - `GET .../conversations/{id}/immediate`: Lấy danh sách lệnh chờ can thiệp.
   - `DELETE .../conversations/{id}/immediate/{msgId}`: Hủy lệnh can thiệp.
5. **Activity Events Log & WebSocket Stream:**
   - Khi extension gửi `{ type: "subscribe", conversationUrl, after }`, daemon phản hồi `{ type: "activity.ready", conversationId }` và `{ type: "activity.page", page: { conversationId, items: [...] } }`.
   - Lưu trữ nhật ký các lần chạy tool vào bảng `activity_events` trong SQLite `chatmcp-storage.sqlite`.

---

## 3. Verification & Acceptance Criteria
1. Copy toàn bộ assets sang `extension/`, build thành công và load vào Chrome `chrome://extensions`.
2. Khi mở `https://chatgpt.com`, nút chọn thư mục xuất hiện cạnh ô nhập liệu, bấm vào mở Windows Folder Picker.
3. Khi gọi MCP tool, popup quyền tự động được chấp thuận bởi `approval-auto.js`.
4. Mở cửa sổ Live Terminal xem log và gửi phím trực tiếp vào console.
5. Khởi động daemon không có bất kỳ lỗi linter/runtime nào.
