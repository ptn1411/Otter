# 🦦 HƯỚNG DẪN KẾT NỐI CHATGPT VỚI OTTER CONTROLLER

Tài liệu này hướng dẫn từng bước cách tích hợp **ChatGPT Web** (hoặc bất kỳ LLM nào) với **Otter Daemon** để AI trực tiếp thao tác trên máy tính và tự động hóa trình duyệt web.

---

## 1. CƠ CHẾ HOẠT ĐỘNG CỦA OTTER

Otter vận hành với mô hình song song cực kỳ mạnh mẽ:
1. **ChatGPT (AI Brain):** Tiếp nhận yêu cầu của người dùng, phân tích mục tiêu và gọi các Tool (Actions / MCP) của Otter.
2. **Otter Daemon (Port 1993):** Lắng nghe yêu cầu từ ChatGPT qua HTTPS Tunnel (`otter.gpt.io.vn` hoặc Cloudflare Tunnel) và điều phối công việc.
3. **Otter Chrome Extension:** Bắt sóng WebSocket 24/7 trực tiếp từ Daemon, sử dụng thuật toán nén DOM của Alibaba Page Agent để đọc nội dung trang web mà không gây tràn token.

---

## 2. BƯỚC 1: PHƠI BÀY CỔNG 1993 RA INTERNET BẰNG TUNNEL

Vì ChatGPT Web chạy trên máy chủ đám mây của OpenAI, nó cần một địa chỉ HTTPS công khai để gọi về `localhost:1993` của bạn:

### Lựa chọn 1: Dùng Cloudflare Tunnel (Khuyên dùng)
Chạy lệnh với cờ `--config NUL`:
```bash
cloudflared tunnel --config NUL --url http://127.0.0.1:1993
```
*(Nếu cài qua HyperHost: `& "C:\Program Files\HyperHost\cloudflared.exe" tunnel --config NUL --url http://127.0.0.1:1993`)*

Bạn sẽ nhận được một đường link HTTPS công khai tạm thời, ví dụ:  
`https://random-subdomain.trycloudflare.com`

*(Nếu bạn có domain riêng, ví dụ `https://otter.gpt.io.vn`, chỉ cần trỏ domain đó về `http://127.0.0.1:1993`)*

### Lựa chọn 2: Dùng ngrok
```bash
ngrok http 1993
```

---

## 3. BƯỚC 2: CẤU HÌNH ACTIONS TRÊN CHATGPT

1. Mở ChatGPT, vào **Explore GPTs** > Bấm **Create** (Tạo GPT mới).
2. Chuyển sang tab **Configure** (Cấu hình):
   - **Name:** `Otter Assistant`
   - **Description:** `Điều khiển máy tính cục bộ và tự động hóa trình duyệt web với Otter.`
   - **Instructions:**
     ```text
     Bạn là Otter Assistant có toàn quyền điều khiển máy tính và trình duyệt của người dùng qua Otter API:
     - Khi người dùng yêu cầu đọc hoặc thao tác trên trang web (ví dụ: Google, YouTube, báo điện tử), hãy gọi NGAY action browserReadPage mà KHÔNG hỏi người dùng link hay ảnh chụp màn hình.
     - Sau khi nhận được DOM nén và danh sách interactive elements, hãy phân tích và gọi browserClick hoặc browserType tương ứng nếu cần.
     - Luôn xác nhận kết quả rõ ràng và súc tích.
     ```
3. Kéo xuống mục **Actions** > Bấm **Create new action**.
4. Mở file [`openapi.json`](openapi.json), đảm bảo dòng `servers.url` là địa chỉ HTTPS của bạn (mặc định đã là `https://otter.gpt.io.vn`).
5. Dán toàn bộ nội dung `openapi.json` vào ô **Schema**.
6. ChatGPT sẽ tự động nhận diện đầy đủ các công cụ:
   - `browserReadPage`: Đọc cấu trúc trang hiện tại (0 tham số).
   - `browserClick`: Click vào phần tử theo index.
   - `browserType`: Gõ văn bản vào ô nhập liệu.
   - `executeTerminalCommand`: Thực thi lệnh PowerShell/CMD.
   - `readFile` & `writeFile`: Đọc và ghi tệp.

---

## 4. BƯỚC 3: KÍCH HOẠT ĐIỀU KHIỂN TRÊN TRÌNH DUYỆT

1. Mở bất kỳ trang web nào bạn muốn điều khiển (ví dụ `google.com`).
2. Bấm vào biểu tượng **Otter** trên thanh công cụ tiện ích.
3. Tab sẽ xuất hiện viền sáng ngọc lục bảo và banner:
   ```text
   🦦 Otter Active • Sẵn sàng cho ChatGPT Web điều khiển
   ```
4. Sang ChatGPT Web, mention `@Otter Assistant` hoặc chat trực tiếp:
   > *"Đọc trang web hiện tại và tìm kiếm từ khóa 'Otter tool use' giúp tôi."*
5. ChatGPT sẽ tự động gọi `browserReadPage`, phân tích thanh tìm kiếm, gọi `browserType` và trả kết quả cho bạn!
