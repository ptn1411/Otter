# FB Auto Post — đăng bài digest tin mới tự động (2026-10-31)

Chế độ: **auto** — người dùng đã chọn "Đăng tự động luôn" (không duyệt
trước). Daemon vẫn ghi sổ đầy đủ cho mọi lần đăng và hỗ trợ pause/stop,
giống tracker của FB Reply Loop.

## Pipeline

```
fb_post_start (targetUrl, maxPosts=1, digestSize=5, 60 phút)
  → fb_post_fetch_news (RSS, mặc định VnExpress + Tuổi Trẻ)
  → fb_post_next (trả về digestText + itemKeys)
  → [người gọi] đăng qua browser_open / browser_read_page /
      browser_type / browser_click trên tab Facebook đã đăng nhập
  → fb_post_mark_posted (chỉ SAU KHI đọc lại trang và thấy bài đã lên)
  → fb_post_finish
```

Một phiên mặc định đăng **1 bài digest gồm 5 tin mới nhất**. Digest chỉ
gồm tiêu đề + link + nguồn lấy từ RSS, không thêm sự kiện, con số hay
nhận định nào ngoài feed:

```
📰 Tin mới trong ngày — 31/10/2026

1. <tiêu đề tin 1>
🔗 <link tin 1>
Nguồn: vnexpress.net
...
```

## Nguồn tin (đã kiểm chứng live ngày 2026-10-31)

| Feed | URL mặc định | Kiểm chứng |
|---|---|---|
| VnExpress tin mới nhất | `https://vnexpress.net/rss/tin-moi-nhat.rss` | HTTP 200, 45 item |
| Tuổi Trẻ tin mới nhất | `https://tuoitre.vn/home.rss` | URL `tuoitre.vn/rss/tin-moi-nhat.rss` trả 301 về `home.rss`, HTTP 200, 50 item |

Feed có thể override theo từng phiên qua tham số `feeds` của
`fb_post_start` / `fb_post_fetch_news`. Fetch dùng `AbortSignal.timeout`
15s mỗi feed; feed hỏng chỉ ghi lỗi của feed đó, không crash phiên.
Parser RSS dùng regex, không thêm dependency: bóc CDATA, giải entity,
lược HTML trong description, bỏ item thiếu title/link, XML hỏng trả về
rỗng thay vì throw.

## Tools (đăng ký ở `mcp.ts` sau `registerFbReplyTools`)

- `fb_post_start` — tạo phiên auto (một đích chỉ một phiên running/paused).
- `fb_post_fetch_news` — fetch RSS, ghi tin, dedupe bằng sha256 của link.
- `fb_post_next` — digest tiếp theo + hướng dẫn bước đăng qua browser_*.
- `fb_post_mark_posted` — đánh dấu digest đã đăng (idempotent theo bài:
  gọi hai lần vẫn đếm 1 bài; đủ `maxPosts` thì phiên tự done).
- `fb_post_mark_failed` — kèm lý do; `blocked=true` (hoặc lý do nhắc tới
  bị chặn) thì phiên chuyển sang `blocked` và dừng đăng tiếp.
- `fb_post_mark_skipped`, `fb_post_status`, `fb_post_stop`,
  `fb_post_pause`, `fb_post_resume`, `fb_post_finish`.

## Bảng DB (`db.ts`)

- `fb_post_runs` — phiên (`mode` chỉ `auto`; `posted_count` đếm theo số
  bài digest, không phải số item).
- `fb_post_items` — từng tin, `UNIQUE(run_id, item_key)` chống đăng trùng
  tin trong một phiên (item_key = sha256 của link).
- `fb_post_digests` — mỗi bài đã đăng một dòng, `UNIQUE(run_id,
  digest_hash)` chống đếm trùng khi gọi mark_posted hai lần.

Thứ tự item theo SQLite `rowid` (thứ tự ghi thật) — bài học từ
fb-reply.ts: `created_at` trùng mili-giây và id chứa hex ngẫu nhiên làm
thứ tự nhảy lung tung. Feed tin vốn sắp mới nhất trước, nên thứ tự ghi
này cũng là mới nhất trước. Giới hạn khác: tối thiểu 30s giữa hai lần
đăng, tối đa 60 phút/phiên.

## Test

`bun scripts/test-fb-post.ts` — **38/38 pass**, không cần node_modules,
không cần mạng (parser dùng chuỗi RSS mẫu): start/defaults/chặn trùng,
record idempotent, digest đủ title+link/không trùng/có ngày + nguồn,
mark_posted idempotent theo bài, mark_failed blocked, mark_skipped,
pause/resume/stop, hết thời gian phiên, rate-limit, persistence khi mở
lại DB. Các suite cũ vẫn pass: `test-fb-reply.ts` 12/12,
`test-fb-comment-parser.ts` 19/19.

## CHƯA KIỂM CHỨNG — đọc trước khi chạy auto thật

**Bước bấm nút Đăng trên tab Facebook đã đăng nhập CHƯA BAO GIỜ được
quan sát.** Mọi lần soi DOM trước đây đều ở trạng thái chưa đăng nhập,
khi đó Facebook không hiện ô soạn bài hay nút Đăng. Vì vậy:

- Không có selector nào của ô soạn bài / nút Đăng được hardcode trong
  code này, và không được đoán index phần tử.
- Đường đăng duy nhất là các tool browser_* chung (`browser_open`,
  `browser_read_page`, `browser_type`, `browser_click`); `fb_post_next`
  trả kèm hướng dẫn tìm index thật từ `browser_read_page` trước khi gõ.
- Trước lần chạy auto thật đầu tiên, bắt buộc phải: mở tab Facebook đã
  đăng nhập với extension mới đã load, đọc `browser_read_page` để xác
  định đúng index ô soạn bài và nút Đăng ở đích đăng đó, đăng thử một
  digest, đọc lại trang để thấy bài hiện lên rồi mới gọi
  `fb_post_mark_posted`. Chỉ sau khi bước này pass thì auto mới được
  coi là đã kiểm chứng.
- Chưa có lịch chạy tự động theo giờ trong ngày: hiện tại phiên được
  tạo bằng tool gọi tay. Muốn chạy mỗi sáng cần thêm một lịch gọi
  `fb_post_start` + `fb_post_fetch_news` (cron của Muse hoặc heartbeat
  của daemon) — chưa làm trong đợt này.
- Từ khóa chặn (`blocked`, `checkpoint`, `bị chặn`...) trong
  `fb-post.ts` là heuristic, không phải wording đã quan sát của
  Facebook; cờ `blocked` tường minh của `fb_post_mark_failed` mới là
  tín hiệu chặn đáng tin.
