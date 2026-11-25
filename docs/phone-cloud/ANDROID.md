# PhoneCloud — Tài liệu App Android (APK)

App Kotlin `vn.phonecloud.agent`, cài lên điện thoại cần điều khiển (Android 8.0+).
Không cần root, không cần ADB.

## Kiến trúc trong app

| File | Vai trò |
|---|---|
| `MainActivity.kt` | Màn hình chính: nhập server, đăng ký thiết bị, bật/tắt dịch vụ, mở trang cấp quyền, xem trạng thái |
| `AgentService.kt` | Dịch vụ nền (foreground): giữ kết nối, quay màn hình khi web bật stream, WakeLock |
| `ScreenEncoder.kt` | MediaProjection → VirtualDisplay → MediaCodec H.264; xuất frame theo giao thức |
| `SocketClient.kt` | Socket.IO client + điều phối lệnh (chạm, phím, app, clipboard, chụp màn hình) |
| `ControlAccessibilityService.kt` | Chạm/vuốt (dispatchGesture), phím hệ thống, tự động hóa cây giao diện |
| `Selector.kt` | Bộ chọn phần tử kiểu XPath rút gọn |
| `AgentIME.kt` | Bàn phím tự chế để gõ chữ từ xa |
| `BootReceiver.kt` | Tự chạy dịch vụ sau khi khởi động lại máy |
| `Prefs.kt` | Lưu địa chỉ server + thông tin thiết bị |

## Build APK

Cần Android Studio (khuyên dùng) hoặc Gradle + Android SDK 34 + JDK 17.

1. Mở thư mục `android/` bằng Android Studio, đợi Gradle sync.
   (Repo chưa kèm gradle wrapper — Android Studio tự tạo; hoặc chạy `gradle wrapper`.)
2. Build → Build App Bundle(s) / APK(s) → Build APK(s).
3. File ra: `app/build/outputs/apk/debug/app-debug.apk`.
4. Cài lên điện thoại: chép file sang máy rồi mở (cho phép "cài từ nguồn không xác định"),
   hoặc `adb install app-debug.apk`.

## Cài đặt lần đầu trên điện thoại

1. Mở app **PhoneCloud Agent**.
2. Nhập địa chỉ server, vd `http://100.111.68.103:3100` (Tailscale) hoặc IP LAN.
3. Bấm **Đăng ký thiết bị** → app hiện **ID + mật khẩu** (ghi lại để nhập ở web).
4. Cấp 4 quyền theo các nút trong app:
   - **Trợ năng (Accessibility)**: bật "PhoneCloud Control" — bắt buộc để chạm/vuốt/tự động hóa.
   - **Bàn phím**: bật + chọn "PhoneCloud Keyboard" — để gõ chữ từ xa (không chọn thì app fallback điền chữ qua Accessibility, kém hơn).
   - **Bỏ tối ưu pin**: để dịch vụ không bị hệ thống giết.
   - **Hiển thị trên app khác**: hỗ trợ mở app lên khi cần cấp quyền.
5. Bấm **Bật dịch vụ điều khiển** → đồng ý hộp thoại quay màn hình.
6. Trên web nhập ID + mật khẩu → Kết nối.

## Hành vi & giới hạn (giới hạn của Android, không phải lỗi app)

- **Quyền quay màn hình phải cấp lại** sau mỗi lần khởi động lại máy hoặc khi hệ thống thu hồi.
  Khi web yêu cầu xem mà chưa có quyền, app tự mở lên để người dùng bấm cấp lại
  (web nhận sự kiện `need_permission`).
- **Xóa dữ liệu app khác** (`appEvent clear`) cần quyền hệ thống — app thường không làm được, trả lỗi rõ ràng.
- **Đóng app** (`stop`) dùng `killBackgroundProcesses` — chỉ giết tiến trình nền, không phải force-stop.
- **Gỡ cài đặt** mở màn hình xác nhận trên máy, người dùng phải bấm đồng ý.
- **Đọc clipboard** bị Android 10+ hạn chế khi app không focus — chọn PhoneCloud Keyboard làm bàn phím mặc định sẽ đọc được tốt hơn.
- Chất lượng mặc định: chiều cao 720, 30fps, bitrate theo độ phân giải (720p ≈ 3 Mbps).
  Trang web gọi `POST /api/control/settings`; điện thoại nhận `settings` (hoặc `quality`/`fps` trong `joined`) rồi encode lại nếu đang phát.
- Dịch vụ nền chạy kiểu `dataSync` khi chỉ giữ kết nối. Chỉ chuyển sang `mediaProjection` ngay trước `getMediaProjection()`, sau khi người dùng đã đồng ý quay màn hình. Nhờ đó khởi động lại máy không bị crash vì khai báo nhầm kiểu dịch vụ.
