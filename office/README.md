# Nam — Phòng ban

Văn phòng isometric 3D của **Nam**. Sáu người ngồi đúng bàn của mình. Bảng trên tường và danh sách bên trái cho biết từng người đang làm gì, và cập nhật theo hợp đồng đang chạy.

## Chơi

- Kéo để xoay nhẹ, lăn chuột để zoom. Bấm một nhân vật để chọn bàn của họ.
- Tab **Dự án** để đàm phán và ký hợp đồng. Chỉ ký được khi còn slot.
- Tốc độ `||`, `1x`, `2x` ở góc phải. Một giây thật ở `1x` bằng 15 phút trong game. 00:00 trừ lương và thay hợp đồng hết hạn.
- Tab **Nhân sự**, **Xây dựng**, **Tài chính**, **Tập đoàn**, **Toàn cầu**, **Tiến trình** đều bấm được.
- Bánh răng: lưu, tải, hoặc reset. Bản lưu nằm trong `localStorage` của trình duyệt.

Thanh trên cùng đọc số thật từ Otter (cổng `1993`): token nhóm tool đang bật, số công cụ, phiên sống và bot A2A. Bấm số token để xem từng nhóm và trạng thái bot. Trang gọi `/otter/api/...` khi đứng riêng, và gọi thẳng `/api/...` khi được gắn trong dashboard Otter tại `/dashboard/#phong`. Khi Otter không trả lời, thanh hiện dấu gạch.

## Chạy local

```bash
npm install
npm run dev
```

Dev server dùng cổng `4317`. Bản production:

```bash
npm run build
npm run preview
```
