# Cẩm Nang Vận Hành & Kiến Trúc Tích Hợp Muse AI Agent (Otter MCP)

Tài liệu này ghi chú chi tiết toàn bộ quy trình, kiến trúc kỹ thuật và hướng dẫn vận hành hệ thống kết nối **Agent-to-Agent: ChatGPT Web ↔ Otter MCP Daemon ↔ Chrome Extension ↔ Muse AI**.

---

## 1. Kiến Trúc Tổng Thể (Architecture)

```mermaid
flowchart TD
    User["👤 Người dùng (ChatGPT Web / Custom GPT)"]
    Tunnel["🌐 Cloudflare Tunnel (https://your-tunnel.example.com)"]
    Daemon["🦦 Otter MCP Daemon (Bun/TS - Port 1993)"]
    Ext["🧩 Otter Chrome Extension (Background Service Worker)"]
    MuseTab["🌐 Tab Muse AI (https://muse.ai/thread/new)"]
    Storage["💾 Local Storage (storage/media/muse/)"]

    User -->|1. Ra lệnh & gọi tool ask_muse_agent| Tunnel
    Tunnel -->|2. Forward request| Daemon
    Daemon -->|3. browserBridge.execute('ask_muse') via WebSocket| Ext
    Ext -->|4. Mở tab trực quan & inject prompt qua React Setter| MuseTab
    MuseTab -->|5. Muse suy nghĩ, tạo code/video/ảnh| MuseTab
    Ext -->|6. Bắt DOM hoàn tất & tải Blob media thành Base64| MuseTab
    Ext -->|7. Trả payload (text + base64)| Daemon
    Daemon -->|8. Giải mã Base64 lưu file .mp4/.png/.webp| Storage
    Daemon -->|9. Trả kết quả + đường dẫn file trên máy| Tunnel
    Tunnel -->|10. Hiển thị hoàn chỉnh| User
```

---

## 2. Quy Trình Khởi Động & Vận Hành Chuẩn (Step-by-Step)

Hệ thống gồm 3 thành phần chính cần chạy:

### Bước 1: Mở Cloudflare Tunnel (Kết nối mạng công cộng cho ChatGPT)
Chạy lệnh trong terminal:
```bash
cloudflared tunnel run myapp
```
*Tác dụng:* Định tuyến domain công khai HTTPS về local port `1993`.

### Bước 2: Khởi động Otter Daemon
Chạy lệnh:
```bash
bun src/daemon/index.ts
```
*Tác dụng:* 
- Lắng nghe tại `http://127.0.0.1:1993`.
- Cung cấp MCP Endpoint (`/sse`, `/mcp`), REST API (`/api/activity/v1/muse/ask`), và WebSocket Bridge cho Extension.
- Tự động nạp OpenAPI schema (`/openapi.json`).

### Bước 3: Mở Trình Duyệt Chrome với Extension (Giao diện hiển thị trực quan)
Khởi động Chrome với profile đã đăng nhập tài khoản (ChatGPT + Muse):
```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --load-extension="%CD%\extension\dist" "https://chatgpt.com"
```
*(Hoặc dùng ChromiumCore của GPM Login nếu muốn dùng profile riêng).*

---

## 3. Cơ Chế Tự Động Hóa Kỹ Thuật (Deep-Dive)

### 3.1. Vượt rào React 18 Controlled Input (`getNativeValueSetter`)
Trang web Muse.ai được xây dựng bằng React 18. Nếu gán `textarea.value = text`, React Virtual DOM sẽ không bắt được sự thay đổi và nút Send sẽ bị disable.
Extension xử lý bằng cách:
```typescript
const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
if (setter) {
  setter.call(textarea, promptText);
}
textarea.dispatchEvent(new Event('input', { bubbles: true }));
textarea.dispatchEvent(new Event('change', { bubbles: true }));
```

### 3.2. Hiển thị trực quan (No-Headless, Active Tab)
- Khi có task mới, extension tạo tab với `{ url: "https://muse.ai/thread/new", active: true }`.
- Nếu tab đã tồn tại, tự động focus tab lên trước (`Page.bringToFront` / `chrome.tabs.update`) để người dùng xem trực tiếp Muse gõ phím và sinh kết quả.
- Giữ nguyên tab sau khi sinh xong (`keep_tab_open: true`) để người dùng kiểm tra lại hội thoại nếu muốn.

### 3.3. Tự động tải Video / Ảnh về máy tính
Khi Muse sinh xong video (`<video>`) hoặc ảnh (`<img>`):
1. **Extension chạy trong tab đã đăng nhập:** Gọi `fetch(blobUrl)` hoặc `fetch(mediaUrl)` để lấy nhị phân Blob (tránh lỗi 403 do thiếu cookie nếu tải từ bên ngoài).
2. **Chuyển sang Base64:** Dùng `FileReader.readAsDataURL()`.
3. **Daemon lưu file:** Otter Daemon nhận Base64, ghi trực tiếp ra ổ đĩa:
   ```
   storage/media/muse/muse_video_<timestamp>_1.mp4
   storage/media/muse/muse_image_<timestamp>_1.png
   ```
4. **Báo cáo lại ChatGPT:** ChatGPT nhận được cả nội dung giải thích và đường dẫn file vật lý trên máy để người dùng mở ngay.

---

## 4. Bảng Tra Cứu Công Cụ (Tool Cheat-Sheet)

| Tool Name | Tham số | Ý nghĩa |
| :--- | :--- | :--- |
| `ask_muse_agent` | `task` (bắt buộc) | Lời nhắc/nhiệm vụ gửi sang Muse (viết code, dựng kịch bản, tạo video, phân tích...) |
| | `new_thread` (mặc định: `true`) | Tạo cuộc trò chuyện mới để ngữ cảnh sạch sẽ |
| | `keep_tab_open` (mặc định: `true`) | Giữ tab mở trên màn hình để quan sát trực tiếp |

---

## 5. Xử Lý Sự Cố Nhanh (Troubleshooting)

1. **Muse báo lỗi "Tài khoản Muse trên trình duyệt chưa đăng nhập":**
   - Mở tab `https://muse.ai` trên Chrome, tiến hành đăng nhập Google/Email một lần duy nhất.
2. **ChatGPT báo không tìm thấy tool:**
   - Kiểm tra `https://your-tunnel.example.com/openapi.json` xem endpoint `/api/activity/v1/muse/ask` đã có chưa.
   - Vào Custom GPT > Edit Action > Update Schema từ URL.
3. **Muốn build lại Extension sau khi sửa code:**
   ```bash
   bun run build:extension
   ```
   Vào `chrome://extensions` bấm nút Reload (xoay vòng) tại Otter Extension.

