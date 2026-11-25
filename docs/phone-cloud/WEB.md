# PhoneCloud — Tài liệu Web (thư viện điều khiển)

Thư viện web tự viết thay viewrp-js, gồm 2 phần:

- `web/phonecloud.js` — core `PhoneCloudClient` (JavaScript thuần, dùng trực tiếp trong trang HTML).
- `web/PhoneCloudView.jsx` — React component bọc core (nhúng vào app React).
- `web/index.html` — trang điều khiển demo đầy đủ tính năng (server tự phục vụ).

## Yêu cầu trình duyệt

- WebCodecs (`VideoDecoder`): Chrome/Edge bản mới. Firefox/Safari chưa hỗ trợ đầy đủ.
- Nạp socket.io-client từ chính server: `<script src="<api>/socket.io/socket.io.js">`.

## PhoneCloudClient

```js
const client = new PhoneCloudClient({
  api: 'http://100.111.68.103:3100',
  deviceId: '12345678',
  password: '123456',
  canvas: document.getElementById('screen'),
  codec: 'avc1.64001E',                    // tùy chọn, mặc định High Profile
  hardwareAcceleration: 'prefer-hardware', // no-preference | prefer-hardware | prefer-software
  onEvent: (ev) => {},     // message/result/device_status/error/video_meta
  onConnect: (ok, info) => {},
});
await client.connect();
```

### Phương thức

| Phương thức | Mô tả |
|---|---|
| `connect()` / `disconnect()` | Kết nối/ngắt (kiểm tra REST trước, rồi Socket.IO) |
| `setStream(on)` | Bật/tắt luồng hình |
| `requestKeyFrame()` | Xin keyframe mới (khi hình vỡ) |
| `tap(x, y)` | Chạm tại tọa độ màn hình thật |
| `swipe(x1, y1, x2, y2, durationMs)` | Vuốt |
| `wheel(x, y, deltaY)` | Cuộn |
| `key(name)` | Phím: BACK, HOME, RECENTS, ENTER, DEL, SPACE, TAB, ESCAPE |
| `setText(text)` | Gõ chữ vào ô đang focus |
| `findElements(xpath)` | Promise → mảng phần tử khớp selector |
| `clickElement(xpath)` | Promise → bấm phần tử đầu tiên khớp |
| `setTextElement(xpath, text)` | Promise → điền chữ vào phần tử khớp |
| `appStart(pkg)` / `appStop(pkg)` / `appClear(pkg)` / `appUninstall(pkg)` | Promise → thao tác app |
| `clipboardGet()` / `clipboardSet(text)` | Promise → clipboard điện thoại |
| `power()` | Mở hộp thoại nguồn |
| `screenshot()` | Promise → `{pngBase64}` chụp từ điện thoại |

Trang `index.html` thêm chọn chất lượng (360/480/720/1080), fps (15/24/30), nút **Áp dụng chất lượng** (`POST /api/control/settings`) và **Máy đang có** (điền ID từ `GET /api/devices`). ID và mật khẩu lần kết nối gần nhất được nhớ trên trình duyệt.

Trang còn có thanh thống kê trực tiếp, dump cây giao diện (bấm dòng để chạm), điền chữ vào phần tử, clipboard, thông tin / xóa dữ liệu / gỡ app, chụp từ điện thoại, toàn màn hình, khung ngang, và ô kịch bản (`tap`, `swipe`, `wait`, `key`, `text`, `find`, `click`, `app`, `shot`).

| `getStats()` | `{fps, bitrateMbps, frames, keyframes, totalMB, decodeQueue, width, height}` trong 1 giây gần nhất |
| `setQuality(quality, fps)` | Promise → lưu và đẩy chất lượng |
| `PhoneCloudClient.listDevices(api)` | Promise → mảng máy, không có mật khẩu |
| `appInfo(pkg)` | Promise → mở trang thông tin app |
| `canvasScreenshot()` | Chụp ngay từ canvas (không hỏi điện thoại) |

### Tương tác trực tiếp trên canvas

Client tự gắn sự kiện lên canvas: bấm chuột = chạm, kéo = vuốt, lăn chuột = cuộn,
gõ phím (Enter/Backspace/Escape/ký tự) gửi sang điện thoại. Tọa độ tự quy đổi
từ kích thước hiển thị sang kích thước màn hình thật của điện thoại.

### Giải mã video

- Nhận `video_meta` (SPS/PPS) → dựng `avcC` → cấu hình `VideoDecoder` (codec lấy từ SPS).
- Nhận frame `screen` (Annex B) → chuyển AVCC → decode → vẽ lên canvas.
- Tự đổi kích thước canvas theo độ phân giải luồng.

## PhoneCloudView (React)

```jsx
import PhoneCloudView from './PhoneCloudView';

<PhoneCloudView
  api="http://100.111.68.103:3100"
  dataDevice={{ device_id: '12345678', passwd: '123456' }}
  codec="avc1.64001E"
  hardwareAcceleration="prefer-hardware"
  autoResize
  showDeviceId
  onSyncEvent={(ev) => console.log(ev)}
  evtIsConnect={(ok) => console.log(ok)}
  ref={viewRef}
/>
// viewRef.current.tap(x,y), .findElements(xpath), .appStart(pkg), .screenshot()...
```

Props: `api`, `dataDevice {device_id, passwd}`, `codec`, `hardwareAcceleration`,
`maxWidth`, `autoResize`, `showDeviceId`, `style`, `onSyncEvent`, `evtIsConnect`.
Ref phơi bày toàn bộ phương thức điều khiển của core.
