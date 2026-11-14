# Plan Dashboard — theo dõi plan code liên tục

Ngày: 2026-10-31. Làm theo lựa chọn của người dùng sau khi vòng lặp
Phases 1–7 đã xong.

## Mở ở đâu

Daemon đang chạy (mặc định cổng 1993) thì mở trình duyệt:

```
http://127.0.0.1:1993/plan-dashboard
```

Trang tự làm mới mỗi 5 giây (có thể tắt bằng checkbox). Nếu daemon cấu
hình `OTTER_API_KEY`, trang và API chịu cùng kiểm tra auth như các route
khác của daemon (không phải route public).

## Nhìn thấy gì

- Danh sách plan, mỗi plan có thanh tiến độ, số task success/failed/
  blocked/pending, và số task trong queue của daemon (pending/running
  trong bảng `tasks`).
- Bấm vào một plan để xem chi tiết: từng task theo thứ tự, trạng thái,
  số lần thử (attempt/max), heartbeat cuối, task đang chạy, task tiếp
  theo, và các prompt đang kẹt trong injection outbox của plan đó.
- Nút **Tạm dừng**, **Chạy tiếp**, **Hủy plan** (hủy hỏi xác nhận trước),
  và **Copy resume prompt** (lấy prompt khôi phục sau mất kết nối, copy
  vào clipboard và hiện ra để paste vào ChatGPT Web).

## API (dùng cho script hoặc tích hợp khác)

- `GET /api/plans` — danh sách plan kèm task counts và queue counts.
- `GET /api/plans/:id` — trạng thái đầy đủ + outbox của một plan.
- `GET /api/plans/:id/resume-prompt` — prompt khôi phục plan.
- `POST /api/plans/:id/pause` | `/resume` | `/cancel`.

## File liên quan

- `src/daemon/routes/plan-dashboard-routes.ts` — API + trang HTML
  (một file HTML duy nhất, không phụ thuộc JS/CSS ngoài, không cần build).
- `src/daemon/routes/index.ts`, `src/daemon/index.ts` — đăng ký route.
- `scripts/test-plan-dashboard.ts` — test gọi trực tiếp handler, không
  cần chạy server (11 check).

## Giới hạn

Dashboard đọc dữ liệu từ SQLite của daemon nên nó chỉ hiện đúng khi
daemon đang dùng cùng file DB đó (`OTTER_DB_PATH` hoặc
`~/.otter/storage.sqlite`). Nó chưa phải là panel trong extension
Chrome — muốn xem trong tab ChatGPT thì mở tab mới tới địa chỉ trên.
Chưa có tạo plan từ dashboard (tạo plan vẫn qua MCP tool `plan_create`).
