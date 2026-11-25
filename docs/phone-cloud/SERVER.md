# PhoneCloud — Tài liệu Server

Server relay viết bằng Node.js (Express + Socket.IO), file chính: `server/server.js`.

## Chạy

```bash
cd server
npm install
node server.js          # cổng mặc định 3100
PORT=8080 node server.js
```

Server đồng thời phục vụ trang web điều khiển trong thư mục `../web` (mở `/` là thấy).

## Thành phần

- **REST**: đăng ký thiết bị, cấu hình, kiểm tra kết nối, danh sách thiết bị (chi tiết ở `PROTOCOL.md`).
- **Socket.IO relay**: mỗi thiết bị một phòng `dev:<device_id>`.
  - Điện thoại vào bằng `key`; web vào bằng `device_id` + `password`.
  - Chuyển tiếp: `video_meta`, `screen`, `message`, `result` (điện thoại → web);
    `command`, `stream` (web → điện thoại).
  - Theo dõi online/offline, phát `device_status` cho phía web.
- **Lưu trữ**: `server/devices.json` (tự tạo khi có thiết bị đăng ký đầu tiên). Có thể trỏ file khác bằng biến `DATA_FILE`.
- **Chất lượng**: `POST /api/control/settings` lưu `quality`/`fps` của máy và phát socket event `settings` cho đúng điện thoại đang online.

## Giới hạn mặc định

- `maxHttpBufferSize` 4 MB. `perMessageDeflate` và nén HTTP của Socket.IO tắt, vì nén H.264 tốn CPU và không nhỏ thêm.
- Frame delta bị bỏ khi buffer gửi của một người xem dài hơn 3 gói. Keyframe luôn được gửi và được nhớ lại để người xem mới có hình ngay, không phải chờ điện thoại encode lại.
- `GET /health` thêm `frames` (fps đã chuyển), `dropped` (số frame bị bỏ mỗi giây) và `mbps`.
- CORS mở `*` cho Socket.IO (tiện khi web chạy ở domain khác).
- Chưa có HTTPS tích hợp: khi đưa ra Internet, đặt sau reverse proxy (Nginx/Caddy/Cloudflare Tunnel).

## Chạy bền trên máy nam (systemd)

Tạo `/etc/systemd/system/phonecloud.service`:

```ini
[Unit]
Description=PhoneCloud relay server
After=network.target

[Service]
WorkingDirectory=/home/nam/code/phone-cloud/server
ExecStart=/usr/bin/node server.js
Environment=PORT=3100
Restart=always
User=nam

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now phonecloud
curl http://127.0.0.1:3100/health
```

Điện thoại + máy điều khiển vào qua Tailscale: `http://100.111.68.103:3100`.
