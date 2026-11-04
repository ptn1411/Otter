# Quy Trình Tự Động Hóa Facebook Điều Khiển Trực Tiếp Bởi ChatGPT Web

Tài liệu này ghi lại toàn bộ quy trình kiểm thử, kiến trúc cầu nối và danh sách các công cụ (tools) đã được sử dụng để cho phép **ChatGPT Web** tự chủ phân tích nội dung, ra quyết định và điều khiển tương tác (Like, Comment, Đăng bài) trên Facebook một cách mượt mà và an toàn.

---

## 1. Kiến Trúc Cầu Nối Hệ Thống (End-to-End Pipeline)

Quy trình giao tiếp giữa máy chủ OpenAI tại Mỹ và trình duyệt Chrome chạy tài khoản Facebook tại máy cục bộ:

```
[ChatGPT Web / OpenAI Servers (US)]
              │
              ▼ (HTTPS OpenAPI Action Request)
[VPS Nginx Reverse Proxy: https://otter.gpt.io.vn]
              │
              ▼ (Tailscale Mesh VPN: 100.116.68.64 -> 100.66.170.39:1993)
[Otter Local Daemon: http://127.0.0.1:1993 (Windows)]
              │
              ▼ (WebSocket /api/activity/v1/stream)
[Otter Chrome Extension: background.js & content script]
              │
              ▼ (DOM Manipulation & Chrome DevTools Protocol Port 9222)
[GPM Browser Profile: Facebook Feed & ChatGPT Web Tabs]
```

---

## 2. Danh Sách Các Công Cụ (Tools Used)

### A. Nhóm Công Cụ OpenAPI do ChatGPT Web Trực Tiếp Gọi
Các công cụ này được định nghĩa trong `openapi.json` và đăng ký vào Custom GPT Actions của ChatGPT:

1. **`browser_read_page` (`POST /api/activity/v1/browser/read`)**:
   - **Mục đích**: Đọc toàn bộ cấu trúc trang của tab đang kích hoạt (Facebook).
   - **Cơ chế**: Thuật toán nén DOM của Alibaba Page Agent kết hợp bộ lọc trích xuất Facebook Feed chuyên biệt:
     - Tự động bóc tách tác giả bài viết, trạng thái thích (`ĐÃ THÍCH` / `CHƯA THÍCH`).
     - Tự động lọc sạch ký tự rác anti-scrape của Facebook (chuỗi font ẩn `r͏e͏p͏d͏n͏s͏t͏`, chuỗi SVG lặp `Facebook Facebook`).
     - Đánh dấu bài của chính tài khoản (`Nhân Văn Sùng`) để AI không tương tác nhầm.
     - Cung cấp mã `index` chính xác cho nút Thích (`likeIndex`) và nút Bình luận (`commentIndex`) ngay trong `summaryText`.
2. **`browser_click` (`POST /api/activity/v1/browser/click`)**:
   - **Mục đích**: Nhấp chuột vào phần tử theo chỉ số `index`.
   - **Tham số**: `{ "index": number }`.
   - **Ứng dụng**: Bấm nút Thích bài viết, bấm nút mở ô Bình luận.
3. **`browser_type` (`POST /api/activity/v1/browser/type`)**:
   - **Mục đích**: Gõ văn bản do chính ChatGPT Web tự soạn thảo vào ô nhập liệu (`div[role="textbox"]`, `[contenteditable="true"]`).
   - **Tham số**: `{ "index": number, "text": string, "pressEnter": boolean }`.
4. **`browser_scroll` (`POST /api/activity/v1/browser/scroll`)**:
   - **Mục đích**: Cuộn trang Feed lên/xuống để nạp thêm các bài viết mới.
   - **Tham số**: `{ "direction": "up" | "down", "amount": number }`.

---

### B. Nhóm Công Cụ MCP Server Chuyên Sâu Facebook (Backend Engine)
Được đăng ký trong `src/daemon/tools/fb-engage-tools.ts`, dùng cho các kịch bản chạy nền hoặc IDE Agent:

1. **`fb_feed_scan`**:
   - Quét cấu trúc feed, bóc tách tác giả, thời gian, nội dung bài viết.
   - Tính toán mã băm duy nhất `post_key = hash(author + snippet)`.
   - Tra cứu cơ sở dữ liệu SQLite (`fb_feed_engagements`) để chống tương tác trùng lặp vĩnh viễn.
   - Tự động phân loại nội dung vào 5 nhóm ngữ cảnh: *Doanh nghiệp/Shop*, *Bạn bè/Cá nhân*, *Cảm xúc/Tâm trạng*, *Hài hước/Giải trí*, *Cộng đồng/Xã hội*.
2. **`fb_feed_engage_post`**:
   - Thực thi tương tác Like / Love và gõ bình luận theo tham số.
   - Ghi nhận lịch sử tương tác vào SQLite để loại trừ trong các vòng quét sau.
3. **`fb_feed_history`**:
   - Truy vấn danh sách các bài viết đã tương tác trong quá khứ kèm mốc thời gian và câu bình luận.
4. **`fb_post_create` & `fb_post_reply`**:
   - Đăng bài viết mới hoặc đọc và tự động trả lời bình luận trong bài viết.

---

### C. Bộ Script Kiểm Thử & Chẩn Đoán (Diagnostic & Verification Scripts)
Các công cụ được viết bằng Bun + TypeScript để kiểm soát và xác minh qua Chrome CDP (Port 9222):

| File Script | Chức Năng Chính |
| :--- | :--- |
| `scripts/chatgpt-agent-prompt.ts` | Gửi prompt vào ProseMirror editor của tab ChatGPT Web và tự động bấm nút Send. |
| `scripts/inspect-chatgpt.ts` | Kết nối qua CDP đọc realtime phản hồi của ChatGPT Web để theo dõi chuỗi suy luận. |
| `scripts/monitor-chatgpt-run.ts` | Vòng lặp giám sát phản hồi và tự động click "Always Allow" khi ChatGPT hiển thị dialog xác nhận Action. |
| `scripts/find-organic-posts.ts` | Cuộn trang và quét các bài viết tự nhiên (organic), lọc bỏ bài quảng cáo ("Được tài trợ"). |
| `scripts/check-fb-comment.ts` | Kiểm tra nội dung văn bản thực tế trong ô bình luận `div[role="textbox"]` của Facebook. |
| `scripts/submit-comment.ts` | Kích hoạt chuỗi sự kiện phím `Enter` (keydown/keypress/keyup) để xuất bản bình luận. |
| `scripts/verify-published.ts` | Quét DOM Facebook để xác minh câu bình luận đã hiển thị công khai dưới tên tài khoản. |

---

## 3. Quy Trình Các Bước Thực Hiện Thực Tế

### Bước 1: Khởi động Hạ tầng & Thiết lập Đường truyền
1. Khởi chạy Otter Daemon cục bộ:
   ```powershell
   bun src/daemon/index.ts
   ```
2. Mở trình duyệt GPM Profile `64b20c37-715c-4f4c-897c-fbbac828e8bf` với remote debugging port `9222`, nạp extension từ `extension/dist`.
3. Kiểm tra kết nối mạng qua Tailscale giữa VPS (`100.116.68.64`) và máy Windows (`100.66.170.39:1993`).

### Bước 2: Cấu hình Nginx Reverse Proxy trên VPS
Sửa cấu hình `/etc/nginx/sites-available/otter.gpt.io.vn` trên VPS để forward các request từ OpenAPI Action của ChatGPT về máy Windows:
```nginx
location /api/activity/ {
    proxy_pass http://100.66.170.39:1993/api/activity/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization "Bearer otter_0290632192c9e96c990bca627915cbece207a3fcc66ec01d";
    proxy_read_timeout 300s;
    proxy_connect_timeout 60s;
}
```
Reload Nginx: `nginx -t && systemctl reload nginx`.

### Bước 3: Gửi Yêu Cầu Cho ChatGPT Web
Gửi câu lệnh vào ChatGPT Web:
> *"Tôi đã tối ưu hóa dữ liệu feed hoàn toàn sạch sẽ cho bạn rồi. Bạn hãy gọi browser_read_page để đọc bài viết 'PURELAC - 8 NĂM CHĂM BỤNG NHỎ, TRỌN NIỀM TIN' của PureLac Việt Nam. Bạn hãy tự mình thực hiện: 1. Bấm Thích bài viết, 2. Bấm vào nút Bình luận, 3. Tự soạn 1 câu chúc mừng kỷ niệm 8 năm thật tự nhiên, thân thiện và gõ bình luận bằng browser_type. Sau khi hoàn tất hãy báo cáo lại toàn bộ quá trình bạn đã quyết định và thực hiện nhé!"*

### Bước 4: Chuỗi Xử Lý Tự Động Của ChatGPT Web
1. **Đọc trang**: ChatGPT Web gọi `browser_read_page`. Nhận về danh sách phần tử và bài viết `PureLac Việt Nam` (Trạng thái: `CHƯA THÍCH`).
2. **Suy luận & Tự sửa lỗi**:
   - ChatGPT Web tự phân tích danh sách index và nhận định: nút Thích chính xác là `index=24` (tự động bỏ qua `index=21` do phát hiện đó là nút Gửi tin nhắn).
3. **Thực thi Bấm Thích**:
   - ChatGPT Web gọi `browser_click({ index: 24 })`. Trạng thái chuyển thành `ĐÃ THÍCH`.
4. **Mở ô Bình luận**:
   - ChatGPT Web gọi `browser_click({ index: 25 })`.
5. **Sáng tạo & Gõ Bình luận**:
   - ChatGPT Web tự suy nghĩ câu bình luận phù hợp với bài kỷ niệm 8 năm của PureLac:
     > *"Chúc mừng PureLac tròn 8 năm! Chúc thương hiệu ngày càng phát triển và tiếp tục mang đến nhiều giá trị tốt đẹp cho mọi gia đình nhé! 🎉"*
   - ChatGPT Web gọi `browser_type` gõ trực tiếp câu này vào ô nhập.
6. **Xác minh lại**:
   - ChatGPT Web tự gọi lại `browser_read_page` để kiểm tra kết quả, thấy câu bình luận đã nằm trong ô nhập và báo cáo lại chi tiết cho người dùng.

### Bước 5: Nghiệm thu Thực tế Trên Facebook
- **Bài 1 (PureLac Việt Nam)**:
  - Nút Thích: Đã chuyển sang `ĐÃ THÍCH`.
  - Bình luận: *"Chúc mừng PureLac tròn 8 năm! Chúc thương hiệu ngày càng phát triển..."* đã hiển thị công khai trên bài viết.
- **Bài 2 (Du Lịch Việt Nam)**:
  - Thời gian xử lý của ChatGPT Web: Chỉ **21 giây**.
  - Nút Thích: Đã click `index: 32`, chuyển sang trạng thái `ĐÃ THÍCH` ("Gỡ Thích khỏi bài viết của Du Lịch Việt Nam").
  - Khung bình luận: Đã click mở `index: 33`.
  - Soạn & đăng bình luận: ChatGPT Web tự sáng tạo câu:
    > *"Cảnh đẹp quá, nhìn thôi đã muốn xách ba lô lên và đi khám phá rồi! Chúc Du Lịch Việt Nam ngày càng có thêm nhiều hành trình thú vị nhé! 🌿"*
  - Bình luận đã được xuất bản và xác nhận hiển thị công khai trên DOM Facebook.
- **Tính năng Nhắn tin Messenger (Trò chuyện với Phạm Thành Nam)**:
  - Nhận diện khung chat: ChatGPT Web gọi `browser_read_page`, tự động bóc tách hội thoại Messenger với Phạm Thành Nam (`ptn1411`).
  - Đọc hiểu tin nhắn: Nhận diện chính xác tin nhắn của Nam là *"hải ni"*.
  - Tự soạn tin nhắn trả lời:
    > *"Chào Nam! Chúc bạn một ngày mới thật vui vẻ, nhiều năng lượng và mọi việc đều thuận lợi nhé! 😊"*
  - Gõ và gửi qua `browser_type`: Đã gửi thành công và xác nhận hiển thị trong lịch sử tin nhắn lúc 06:22.

---
Nếu dự án giúp ích cho công việc nghiên cứu hoặc phòng thủ của bạn, bạn có thể ủng hộ để duy trì tài liệu, test và các workflow mới. Mọi khoản đóng góp đều hoàn toàn tự nguyện.

- Ngân hàng: **TPBank**
- Chủ tài khoản: **PHAM THANH NAM**
- Số tài khoản: **69238686888**

<p align="center">
  <img src="https://raw.githubusercontent.com/ptn1411/skill/main/qr-sepay.png" alt="QR SePay TPBank" width="300">
</p>

