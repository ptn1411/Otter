# Otter PhoneCloud — Điều khiển điện thoại Android từ xa & AI Mobile Automation

Tính năng **PhoneCloud** đã được nâng cấp và hợp nhất trực tiếp vào **Otter Daemon** (chung cổng `1993`, chung SQLite `~/.otter/storage.sqlite`, hỗ trợ Tailscale & Cloudflare Quick Tunnel).

## Kiến trúc hợp nhất trong Otter

- **Relay & SQLite Engine**: `src/daemon/phone-cloud.ts` (tương thích 100% dây giao thức Engine.IO v4 / Socket.IO v4 của PhoneCloud 1.3.0, hỗ trợ cả HTTP polling + WebSocket upgrade cho Android `io.socket:socket.io-client:2.1.0` lẫn pure WebSocket cho WebCodecs).
- **Bộ 20 công cụ MCP (`phone_*`)**: `src/daemon/tools/phone-tools.ts` (nhóm `phone`, điều khiển trực tiếp In-Process Zero-Hop không cần nhập lại mật khẩu khi máy đã đăng ký trên Otter; đồng thời hỗ trợ tham số `api` cho Relay ngoài).
- **Dashboard Live Studio**: `dashboard/src/tabs/PhoneCloudTab.tsx` + `dashboard/src/lib/phonecloud-client.ts` (giải mã H.264 phần cứng WebCodecs, chạm/vuốt/cuộn trực tiếp trên `<canvas>`, Dump giao diện Accessibility, Clipboard, mở App và chạy Macro).
- **Ứng dụng Otter Phone (Android APK)**: `tools/phone-cloud/android/` (`applicationId: vn.otter.phone`, bản cài đặt chính thức tại `https://otter.gpt.io.vn/otter-phone.apk`, quay màn hình MediaProjection H.264 + `Otter Phone Control` + bàn phím `Otter Keyboard`).
- **Hợp đồng kiểu giao thức**: `tools/phone-cloud/protocol/types.ts` và tài liệu chi tiết tại `docs/phone-cloud/`.

## Hướng dẫn cài App Otter Phone và ghép nối với Otter

1. Tải trực tiếp gói cài đặt đã ký số tại **`https://otter.gpt.io.vn/otter-phone.apk`** (hoặc tự build bằng lệnh `bun run build:apk` từ thư mục gốc dự án) rồi cài lên điện thoại Android 8.0+.
2. Mở **Otter Dashboard** (`/dashboard` → mục **PhoneCloud (Android)**) để sao chép địa chỉ Server:
   - Qua Tailscale: `http://<ip-tailscale>:1993`
   - Qua Cloudflare Quick Tunnel (4G/5G mọi nơi): `https://<ten-tunnel>.trycloudflare.com`
   - Qua mạng LAN: `http://<ip-lan>:1993`
3. Mở app **Otter Phone** trên điện thoại:
   - Dán địa chỉ Otter Server vào ô Server → bấm **Đăng ký thiết bị**.
   - Cấp đủ quyền: **Trợ năng (Otter Phone Control)**, **Bàn phím Otter Keyboard**, **Bỏ tối ưu pin**, **Hiển thị trên ứng dụng khác**.
   - Bấm **Bật điều khiển** → xác nhận quay màn hình.
4. Trên **Otter Dashboard → PhoneCloud (Android)**, bấm **Điều khiển** ở dòng thiết bị để xem màn hình trực tiếp, hoặc dùng lệnh `/phone` trên AI Agent để tự động hóa bằng 20 công cụ `phone_*`.
