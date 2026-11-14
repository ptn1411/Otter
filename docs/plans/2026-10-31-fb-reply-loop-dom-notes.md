# FB Reply Loop — DOM notes (quan sát thật, không đăng nhập)

Ngày: 2026-10-31. Nguồn: soi chỉ đọc (read-only) hai bài công khai qua
trình duyệt, không đăng nhập, không like, không bình luận, không trả lời.
Bài 1: link share `.../share/1A7oj5bKvD/` → chuyển về post có 6 bình luận.
Bài 2 (nhiều bình luận): link share `.../share/p/19kpihXyPB/` → bài trong
nhóm công khai, đã soi xong ngày 2026-10-31, kết quả ở §6.

## 1. Tường đăng nhập — đọc được, viết thì không

- Lúc mở link share, Facebook phủ một hộp thoại đăng nhập; bấm Đóng thì
  nội dung bài + bình luận hiện ra mà không cần đăng nhập.
- Cuối trang vẫn còn biểu ngữ mời đăng nhập / tạo tài khoản.
- **Kết luận quan trọng:** đọc bình luận không cần đăng nhập, nhưng mọi
  hành động viết đều bị chặn: bấm nút "Bình luận" ở cấp bài chỉ mở hộp
  thoại đăng nhập (có ô email + mật khẩu), không hiện ô nhập.
- Không thấy CAPTCHA, trang Access denied, hay thông báo giới hạn tốc độ
  trong lần soi này — chỉ có tường đăng nhập.

## 2. Cấu trúc bình luận đã xác minh (bài 1, 6 bình luận)

- Toàn bộ bài nằm trong một `dialog` tên "Bài viết của <tác giả>", bên
  trong là một `article` của bài.
- Mỗi bình luận và mỗi phản hồi là một `article` riêng, **nằm ngang hàng
  nhau** bên trong `article` của bài — không lồng nhau trong cây trợ năng.
  Thụt lề trên màn hình chỉ là cách hiển thị.
- Trong 6 bình luận quan sát được: 2 bình luận gốc + 4 phản hồi.
- Không thấy nút "Xem thêm bình luận" / "Xem thêm phản hồi" trong trạng
  thái này (cả 6 đã hiện ngay). Các nút liên quan duy nhất: "<N> bình
  luận" và nút sắp xếp "Phù hợp nhất" (collapsed, haspopup).

## 3. Accessible name — dấu hiệu phân biệt đáng tin cậy nhất

- Bình luận gốc: `Bình luận dưới tên <tác giả> vào <thời gian>`
- Phản hồi: `Phản hồi bình luận của <tác giả cha> dưới tên <tác giả> vào <thời gian>`
- Thời gian chỉ ở dạng tương đối ("5 phút", "2 phút", "28 phút"...),
  không có mốc tuyệt đối trong cây trợ năng.
- Tác giả **luôn tách từ accessible name**. Không lấy link đầu tiên
  trong article làm tác giả một cách mù quáng: với phản hồi, link đầu
  tiên có thể là tên người được nhắc tới (tác giả cha).
- Nội dung nằm sau tên tác giả trong cùng article; thời gian là link
  cuối trong article.
- Một số phản hồi có nút huy hiệu với văn bản "Tác giả" — đây là nhiễu,
  reader phải bỏ khi làm sạch nội dung (đã làm trong parser).

## 4. Nút Trả lời / ô nhập — CHƯA quan sát được (cần đăng nhập)

- Khi chưa đăng nhập, trong cây trợ năng và văn bản trang **không có
  chuỗi "Trả lời"** dưới từng bình luận; các nút ở cấp bài chỉ là
  "Thích" và "Bình luận".
- Vì vậy, với bài 1 ở trạng thái chưa đăng nhập: `replyIndex = null`,
  `replyControlsObserved = false`. Đây là hành vi đúng của reader, không
  phải lỗi reader.
- Để quan sát nút Trả lời / ô nhập / nút Gửi thật, **bắt buộc** phải
  chạy `fb_read_comments` trên tab trình duyệt đang đăng nhập Facebook
  (tức là Chrome của người dùng có extension Otter + daemon đang chạy),
  không thể soi từ trình duyệt chưa đăng nhập của VM này.
- Giả thuyết hiện tại (chưa xác minh, cần kiểm chứng khi đã đăng nhập):
  ô trả lời của Facebook là contenteditable, nút Gửi là nút riêng (Enter
  có thể chỉ xuống dòng, không gửi). Đừng code theo giả thuyết này cho
  tới khi quan sát được thật.

## 5. Reader đã code theo quan sát này

- `BrowserController.readComments()` (extension/src/background/browser-controller.ts):
  quét các `article`, chỉ nhận article có aria-label khớp mẫu VN (hoặc
  EN fallback best-effort), tách tác giả / tác giả cha / thời gian /
  strategy, làm sạch nội dung, tìm nút "Trả lời"/"Reply" trong cùng
  article (nếu có), gán `parentKey` cho phản hồi theo bình luận gốc
  gần nhất trước nó theo thứ tự document.
- Trả về thêm chẩn đoán để lần sau Facebook đổi DOM vẫn sửa được nhanh:
  `articlesFound`, `unmatchedSamples` (tối đa 3 aria-label không khớp,
  cắt 80 ký tự, không lấy nội dung bình luận), `loadMoreButtons`,
  `loginWall`, `replyControlsObserved`, `matchedByAriaLabel`,
  `strategy` cho từng bình luận.
- `replyIndex` chỉ có giá trị với danh sách `__otter_elements` mà chính
  lần gọi `fb_read_comments` đó vừa lưu (thứ tự document). Sau mỗi
  click/cuộn phải gọi lại rồi mới dùng index mới — không trộn với
  index của `browser_read_page` (thứ tự viewport đã sort).
- Parser thuần mirror ở `src/daemon/fb-comment-parser.ts` + test
  `scripts/test-fb-comment-parser.ts` (19 check): các mẫu VN, tên chứa
  "vào", EN fallback, trường hợp không khớp trả null, và drift check
  (extension vẫn chứa mẫu VN đã xác minh).

## 6. Bài 2 — nhiều bình luận (soi ngày 2026-10-31, nhóm công khai)

- Link share chuyển về một bài trong nhóm công khai, nút tổng số hiển
  thị "401 bình luận", nhưng bộ đếm phân trang của bài gốc ban đầu là
  "3/180". Trang hiển thị cả hai con số, không giải thích vì sao khác
  nhau — vì vậy **không được tin tổng số trên nút làm điều kiện dừng**.
  Điều kiện dừng đúng: hết nút "Xem thêm bình luận", hoặc hai lần
  load liên tiếp không thêm bình luận mới (tracker dedupe theo key).
- Ban đầu bài gốc chỉ hiện 3 bình luận gốc. **Cuộn chậm không làm tăng
  số bình luận của bài gốc** — nó load thêm các "Bài viết khác" phía
  dưới, mỗi bài cũng hiện 3 bình luận ban đầu. Đây là lý do reader
  phải giới hạn phạm vi vào dialog của bài gốc (xem §5, đã sửa):
  quét toàn trang sẽ trộn bình luận của bài khác vào.
- Nút tải thêm của bài gốc là "Xem thêm bình luận": một lần bấm tăng
  bộ đếm từ 3/180 lên 6/180 (thêm 3 bình luận gốc), nút vẫn còn sau đó
  → phải bấm lặp, mỗi lần bấm + đọc lại + ghi nhận, tới khi hết.
- Nút mở phản hồi: "Xem 1 phản hồi", "Xem tất cả 4 phản hồi",
  "Xem tất cả 2 phản hồi" — phản hồi chỉ hiện sau khi mở các nút này,
  reader trả về chúng ở trường `replyExpansionButtons` riêng.
- Mẫu accessible name giữ nguyên như bài 1 (VN gốc + VN phản hồi),
  đã kiểm chứng lại trên bài này — parser không cần sửa cho bài 2.
- Vẫn không thấy nút "Trả lời" hay ô nhập bình luận khi chưa đăng
  nhập (tìm "Trả lời" / "Viết bình luận" không có kết quả). Kết luận
  về bước bấm Trả lời vẫn giữ nguyên như §4: cần tab đã đăng nhập.

## 7. Việc còn lại sau file này

- [x] Kết quả soi bài 2 (nhiều bình luận): tổng số, load-more / phân
      trang khi cuộn, mẫu accessible name có giữ nguyên không.
- [ ] Chạy `fb_read_comments` trên tab đã đăng nhập Facebook để quan
      sát nút Trả lời / ô nhập / nút Gửi thật, rồi mới code bước
      click Reply + gõ + gửi + kiểm chứng.
- [ ] Chạy vòng lặp đầy đủ trên bài test của chính người dùng ở chế
      độ draft trước, rồi mới auto.
