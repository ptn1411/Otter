# Extension — Quản lý tổng (Management Center)

Ngày: 2026-10-31. Làm theo yêu cầu “extension xem và cấu hình được nhiều
tính năng hơn, quản lý mọi thứ trên extension”.

## Mở ở đâu

Bấm chuột phải vào icon Otter trên Chrome → **Options**, hoặc mở trang
Options của extension. Tab mới: **🎛️ Quản Lý Tổng** (tab thứ 5, sau
“Tập Lệnh Nhanh”).

Tab này dùng cùng máy chủ + token đang chọn ở tab “Kết Nối & Máy Chủ
MCP”, nên không cần cấu hình lại server cho riêng nó.

## Quản lý được những gì

- **Plans code liên tục** (từ API `/api/plans` của daemon): danh sách
  plan, thanh tiến độ, số task success/failed/blocked/pending. Mỗi plan
  có nút **Chạy tiếp / Tạm dừng / Hủy** (hủy hỏi xác nhận), nút **Chi
  tiết + Outbox** (xem từng task, task đang chạy, task tiếp theo, và các
  prompt đang kẹt trong injection outbox), nút **Copy resume prompt**.
- **Queue của daemon**: số task pending/running trong bảng `tasks`,
  trạng thái daemon online/offline.
- **Skills đã cài** (từ `/api/skills`): danh sách skill, ô tìm kiếm theo
  tên/mô tả, lọc ngay trên trang.
- **Thêm máy chủ mới**: form tên + API base + API key, thêm xong là
  chọn được ngay ở tab Kết Nối (dùng chung `server-registry`).
- **Cấu hình của chính tab Quản lý**, lưu trong `chrome.storage.local`:
  - Chu kỳ tự làm mới: 5 / 10 / 30 giây, hoặc tắt. Chỉ tự làm mới khi
    tab Quản Lý đang mở.
  - Thông báo khi có plan bị blocked hoặc vừa xong (dùng thông báo
    desktop sẵn có của extension, chỉ báo khi trạng thái mới xuất hiện,
    không báo lặp).
- **Mở nhanh**: Plan Dashboard (`/plan-dashboard` của daemon), Activity
  (`/activity`), ChatGPT Web.

## Những gì đã có sẵn, không làm lại

Tab Hướng Dẫn, Bản Quyền, Kết Nối & Máy Chủ MCP, Tập Lệnh Nhanh vẫn
giữ nguyên. Tab Quản Lý chỉ gom thêm phần xem/quản lý plans, queue,
outbox, skills và server mới vào một chỗ, thay vì phải gọi MCP tool hay
mở dashboard riêng cho từng việc.

## File liên quan

- `extension/options.html` — thêm tab + pane Quản Lý.
- `extension/src/options/options.ts` — logic tab Quản Lý (fetch API,
  render, action, polling, thông báo, thêm server), thêm key i18n
  `tab_manage` / `manage_*` cho cả tiếng Việt và tiếng Anh.
- `extension/options.js`, `extension/dist/*` — bản build từ
  `bun build.extension.ts` (đã build lại trong lần này, nên cả thư mục
  `extension/` và `extension/dist/` đều load được vào Chrome).

## Giới hạn

- Cần daemon đang chạy và extension chọn đúng server, nếu không tab sẽ
  báo “Không kết nối được daemon” thay vì hiện dữ liệu cũ.
- Chưa có tạo plan mới từ extension (tạo plan vẫn qua MCP tool
  `plan_create`), chưa sửa/xóa skill từ extension (chỉ xem + tìm).
- Chưa test trong Chrome thật (cần load extension đã build vào
  `chrome://extensions` rồi mở tab Quản Lý); logic đã kiểm tra bằng
  transpile, kiểm tra đủ ID trong HTML, và build thành công.
