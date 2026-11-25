# PhoneCloud — Đặc tả giao thức

Kiểu chuẩn nằm ở `protocol/types.ts` (bản 1.2). Server và web vẫn là JavaScript. Trước khi thêm lệnh hoặc trường mới, sửa file kiểu đó rồi chạy `node protocol/check.js`.

Giao thức giữa 3 thành phần: **App Android** (điện thoại) ↔ **Server** (relay) ↔ **Web** (điều khiển).
Server không xử lý hình: chỉ chuyển tiếp theo phòng riêng của từng thiết bị.

## 1. REST API

| Endpoint | Phương thức | Mô tả |
|---|---|---|
| `/health` | GET | Trạng thái server: `{ok, devices, online}` |
| `/api/device/register` | POST | Điện thoại đăng ký. Body: `{name}`. Trả: `{status, device_id, password, key, ws_path, quality, fps}` |
| `/api/device/config?device_id=` | GET | Cấu hình mặc định: `{status, quality, fps, ws_path}` |
| `/api/control/connect` | POST | Web kiểm tra thông tin. Body: `{device_id, passwd}`. Trả: `{status, online, ws_path}` hoặc 401 |
| `/api/devices` | GET | Danh sách thiết bị + trạng thái online, quality, fps. Không trả password hay key |
| `/api/control/settings` | POST | Đổi chất lượng. Body: `{device_id, passwd, quality, fps}`. quality: 360/480/720/1080, fps: 15/24/30. Server phát `settings` tới điện thoại |

- `device_id`: 8 chữ số, hiển thị trên app và nhập ở web.
- `password`: 6 chữ số, người điều khiển nhập ở web.
- `key`: UUID bí mật, chỉ điện thoại giữ, dùng để xác thực vào phòng Socket.IO.
- Dữ liệu thiết bị lưu ở `server/devices.json`.

## 2. Socket.IO — vào phòng

Đường dẫn `/socket.io`, transport websocket/polling.

Sự kiện `join_room`:
- Điện thoại gửi: `{key, width, height}` (kích thước màn hình thật).
- Web gửi: `{device_id, passwd}`.
- Server trả `joined`: `{status: true, quality, fps, ...}` hoặc `{status: false, msg}`.
- Khi một điện thoại mới vào bằng cùng key, socket cũ của máy đó bị ngắt (một máy, một phiên).
- Server → điện thoại: `settings` `{quality, fps}` sau `POST /api/control/settings`.
- Khi điện thoại vào/rời phòng, server phát `device_status` `{online: bool}` cho phía web.

## 3. Luồng video (điện thoại → web)

| Sự kiện | Dữ liệu | Ghi chú |
|---|---|---|
| `video_meta` | JSON `{width, height, sps, pps}` | sps/pps là base64 (không kèm start code). Gửi khi encoder khởi động hoặc đổi định dạng |
| `screen` | Nhị phân | Xem định dạng frame bên dưới |
| `message` | JSON `{action, ...}` | Trạng thái phụ: `orientation`, `need_permission`, `encoder_error` |
| `result` | JSON `{taskId, status, data?, msg?}` | Kết quả của lệnh cần phản hồi |

**Định dạng frame `screen`:**
```
[1 byte cờ][8 byte PTS][dữ liệu H.264 Annex B]
```
- Cờ: bit 0 = 1 nếu là keyframe (IDR).
- PTS: micro giây, big-endian, tăng dần theo thời gian trình chiếu.
- Payload: H.264 Annex B (có start code 00 00 00 01), có thể kèm SPS/PPS/SEI — phía web tự lọc khi chuyển sang AVCC cho WebCodecs.

## 4. Luồng điều khiển (web → điện thoại)

| Sự kiện | Dữ liệu | Ghi chú |
|---|---|---|
| `stream` | `{status: bool}` | Bật/tắt quay màn hình |
| `command` | `{action, taskId, ...}` | Lệnh điều khiển, xem bảng dưới |

**Các action:**

| Action | Tham số | Phản hồi `result` |
|---|---|---|
| `pointerEvent` | `phase`: down/move/up, `x, y` (màn hình thật). Move có thể bị server bỏ khi điện thoại nghẽn; down/up thì không | không |
| `touchEvent` / `clickEvent` | `x, y` (tọa độ theo màn hình thật) | không |
| `swipeEvent` | `start_x, start_y, end_x, end_y, duration` (ms) | không |
| `wheelEvent` | `x, y, deltaY` | không |
| `keyEvent` | `keyName`: BACK, HOME, RECENTS, NOTIFICATIONS, ENTER, DEL, SPACE, TAB, ESCAPE | không |
| `setTextEvent` | `text` | không |
| `findElements` | `xpath` | có: mảng phần tử `{text, contentDesc, resourceId, className, bounds:[l,t,r,b], clickable, enabled, checked, focused}` |
| `clickElement` | `xpath` | có: `{done}` |
| `setTextElement` | `xpath, text` | có: `{done}` |
| `appEvent` | `command`: start/stop/clear/uninstall/openInfo, `packageName` | có |
| `clipboard` | `command`: get/set, `text` (khi set) | có |
| `screenshot` | — | có: `{pngBase64}` |
| `power` | — | không |
| `onSyncIFrame` | — | không (xin keyframe mới) |
| `timeSync` | — | có: `{time}` |

**Cú pháp selector (rút gọn kiểu XPath):**
- `//*[@text="OK"]`, `//android.widget.Button[@resource-id="com.app:id/btn"]`
- `//*[contains(@text,"Đăng")]`, `//*[@content-desc="Quay lại"]`, `//*[@class="..."]`
- Nhiều điều kiện: `//*[@text="OK" and @clickable="true"]`
- `//*` = mọi phần tử (dump cây giao diện, tối đa 100 phần tử)

## 5. Bảo mật

- Web phải biết `device_id` + `password`; điện thoại xác thực bằng `key` riêng.
- Server chỉ relay trong phòng của đúng thiết bị; phía web không gửi được lệnh sang máy khác.
- Khi chạy qua Internet công khai nên đặt server sau HTTPS (reverse proxy) để mã hóa đường truyền.
