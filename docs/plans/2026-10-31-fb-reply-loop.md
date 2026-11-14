# Plan: Vòng lặp trả lời bình luận Facebook (FB Reply Loop)

Ngày: 2026-10-31. Phạm vi: bản local `~/workspace/code/chatmcp/` trước,
đồng bộ lên `nam` sau khi người dùng duyệt plan này (chưa code gì trong
plan này — đây là plan chi tiết, viết trước rồi mới code, theo lựa chọn
của người dùng).

## 1. Mục tiêu, nói một câu

Người dùng ra lệnh một lần cho ChatGPT Web (qua Otter) kiểu “vào bài
này, đọc hết bình luận và trả lời từng cái”, hệ thống tự đi từng bình
luận một — mở bài, load hết bình luận, đọc, soạn câu trả lời riêng cho
từng bình luận, gửi, kiểm tra đã gửi thành công, rồi mới sang bình luận
tiếp theo — tới khi hết bình luận hoặc hết giới hạn thì dừng và báo cáo
đã trả lời bao nhiêu, còn lại bao nhiêu, cái nào bị bỏ qua và vì sao.

## 2. Hiện trạng đã khảo sát (code thật, ngày 2026-10-31)

### 2.1. Cái đã có, dùng được luôn — và đây là điểm quan trọng nhất

ChatGPT Web đã có thể điều khiển trình duyệt qua MCP, không cần viết
content script riêng cho Facebook:

- **Daemon tools** (`src/daemon/tools/browser.ts`): `browser_open`,
  `browser_read_page`, `browser_click` (theo index), `browser_type`
  (theo index, có `pressEnter`), `browser_select`, `browser_scroll`,
  `browser_back`. Mỗi tool đều kết thúc bằng lời nhắc “hãy gọi
  `browser_read_page` để xem lại trang”, tức là luồng làm việc đã được
  thiết kế theo kiểu đọc → hành động → đọc lại.
- **Browser bridge** (`src/daemon/browser-bridge.ts`): `execute(action,
  params, timeoutMs = 30000)` gửi `browser_action` qua WebSocket và chờ
  `browser_action_result`, timeout 30s / hành động.
- **Background** (`extension/src/background/background.ts`, hai chỗ
  dispatch giống nhau): map action `open / read_page / click / type /
  select / scroll / back` sang `BrowserController`. Thêm action mới thì
  phải thêm case ở cả hai chỗ này, cộng thêm method ở controller và
  tool ở daemon — ba chỗ, không được quên một chỗ.
- **BrowserController** (`extension/src/background/browser-controller.ts`):
  `openUrl`, `readPage` (quét DOM + Shadow DOM, tối đa 1000 phần tử,
  gắn badge số `[1]`, `[2]`… theo chuẩn Alibaba Page Agent),
  `clickElement` (chuỗi Pointer/Mouse W3C + hit-testing),
  `typeElement` (native value setter cho input/textarea,
  `execCommand insertText` cho contenteditable — đúng kiểu ô trả lời
  bình luận của Facebook), `scrollPage`, `goBack`.
- **Quyền**: manifest xin `host_permissions: ["<all_urls>"]` và điều
  khiển tab bằng `chrome.scripting.executeScript`, nên tab Facebook
  điều khiển được dù content script chỉ match `https://chatgpt.com/*`.
  Content script trên ChatGPT chỉ lo inject prompt, không liên quan tới
  tab Facebook.

### 2.2. Cái chưa có — và cái thiếu này quyết định kiến trúc

- **Không có công cụ đọc bình luận có cấu trúc.** `readPage` trả về
  danh sách phần tử tương tác đánh số, mỗi phần tử chỉ có `tagName`,
  `text` **cắt ở 70 ký tự**, `value` cắt ở 40 ký tự, `ariaLabel`,
  `href`, `inView`, cộng một `summaryText` tối đa 2000 ký tự. Với
  bình luận dài, ChatGPT chỉ thấy 70 ký tự đầu — không đủ để soạn câu
  trả lời tử tế, và không có tác giả / thời gian / “đã có trả lời của
  mình chưa” tách riêng từng bình luận.
- **Không có trạng thái phiên trả lời.** Không có bảng nào lưu “bài
  này đã trả lời bình luận nào rồi”, không có đếm, không có giới hạn,
  không có nút dừng phiên. Nếu ChatGPT tự nhớ trong hội thoại thì
  hết context là quên, và chạy lại từ đầu sẽ trả lời trùng.
- **Không có quy tắc soạn / bỏ qua / dừng.** Hiện không có chỗ nào
  quy định: bỏ qua bình luận của chính mình, bỏ qua bình luận đã trả
  lời, nghỉ bao lâu giữa hai lần gửi, dừng khi Facebook chặn, hay chế
  độ chỉ soạn không gửi.
- **Daemon không có LLM.** Đây là sự thật kiến trúc phải tôn trọng:
  người soạn câu trả lời là **ChatGPT Web** (nó gọi MCP tools), daemon
  chỉ giữ trạng thái và làm tay chân qua extension. Vì vậy không thể
  viết “daemon tự soạn trả lời” — daemon chỉ có thể lưu trữ, đếm,
  kiểm tra trùng, chặn vượt giới hạn, và cung cấp danh sách bình luận
  sạch cho ChatGPT soạn.

### 2.3. Kết luận kiến trúc

Vòng lặp này **không phải daemon tự chạy**, mà là **ChatGPT lái, daemon
ghi sổ**. ChatGPT vẫn là người đọc trang, bấm, gõ, quyết định nội dung
từng câu trả lời. Daemon thêm hai thứ: (1) một bộ công cụ phiên
(`fb_reply_*`) để ghi lại đã trả lời cái nào, còn bao nhiêu, dừng khi
nào; (2) một action đọc bình luận có cấu trúc để ChatGPT thấy đủ nội
dung. Đường API Facebook (`facebook-cli post comments read / post
comments add`) chỉ dùng để đối chiếu / đọc trước khi chạy, không phải
đường gửi chính, vì yêu cầu của người dùng là “vào trang tương tác”,
và vì gửi qua API trong Muse còn vướng duyệt từng lần ghi.

## 3. Nguyên tắc (không thương lượng)

1. **Một bình luận, một lần gửi, có kiểm chứng.** Chỉ sang bình luận
   tiếp theo sau khi đã đọc lại trang và thấy câu trả lời của mình
   xuất hiện dưới bình luận đó. Gửi mà không thấy hiện thì tính là
   fail, không tính là xong, không gửi lại ngay mà báo rõ.
2. **Không bao giờ gửi trùng.** Định danh bình luận bằng hash
   (tác giả + nội dung + thời gian, xem §8). Trước khi gửi phải hỏi
   tracker: hash này đã trả lời chưa? Đã rồi thì bỏ qua, không bấm
   gửi thêm lần nào nữa.
3. **Chỉ trả lời trên bài của mình / trang mình quản lý.** Không dùng
   vòng lặp này để spam bài của người khác, không trả lời hàng loạt
   vào bài không thuộc về mình.
4. **Người dùng duyệt trước khi gửi hàng loạt, trừ khi họ chọn rõ
   ràng chế độ tự gửi.** Mặc định của lần chạy đầu tiên là chế độ
   soạn trước (draft), xem lại, rồi mới gửi. Chế độ tự gửi chỉ bật
   khi người dùng nói rõ cho phiên đó.
5. **Nghỉ giữa các lần gửi, không gửi giống nhau.** Mỗi câu trả lời
   phải soạn riêng theo nội dung bình luận, không copy một câu chung.
   Giữa hai lần gửi cách nhau tối thiểu 5s, ngẫu nhiên 5–20s.
6. **Dừng an toàn khi bị chặn.** Thấy dấu hiệu chặn / lỗi (banner lỗi,
   nút gửi không bấm được, câu trả lời không hiện sau 2 lần thử, trang
   bắt xác minh) thì dừng cả phiên ngay, không thử tiếp, không đổi
   tài khoản, không tìm đường vòng.
7. **Không lưu / không dùng thông tin nhạy cảm của người bình luận.**
   Tracker chỉ lưu hash + excerpt tối đa 300 ký tự + trạng thái, đủ
   để chống trùng, không lưu hồ sơ người bình luận.

## 4. Kiến trúc

```
Người dùng ra lệnh 1 lần (ChatGPT Web, qua Otter)
  → fb_reply_start { postUrl, mode: draft | auto, maxReplies, tone, skipRules }
        ↓
ChatGPT (bộ não, gọi MCP tools theo vòng lặp §5)
  ├─ browser_open(postUrl)
  ├─ browser_read_page / fb_read_comments   ← danh sách có cấu trúc
  ├─ fb_reply_next                           ← tracker: lấy bình luận
  │                                            chưa trả lời tiếp theo,
  │                                            chặn khi hết giới hạn
  ├─ browser_click (nút Trả lời) → browser_type (câu trả lời riêng)
  │   → browser_read_page (kiểm chứng đã hiện)
  ├─ fb_reply_mark_replied { commentKey }    ← ghi sổ, chống trùng
  └─ lặp lại tới khi hết bình luận / hết giới hạn / bị dừng
        ↓
Daemon (ghi sổ, không soạn câu trả lời)
  ├─ fb-reply.ts (logic thuần, test được không cần node_modules)
  ├─ tools/fb-reply-tools.ts (MCP tools fb_reply_*)
  ├─ bảng fb_reply_runs / fb_reply_comments (SQLite, §8)
  └─ routes /api/fb-replies (dashboard + tab Quản Lý xem / dừng / duyệt draft)
        ↓
Extension (tay chân, có sẵn + thêm 1 action)
  ├─ BrowserController.readComments() (mới, §7)
  ├─ background dispatch thêm case "read_comments" (2 chỗ)
  └─ các action cũ: open / read_page / click / type / scroll
```

## 5. Luồng một phiên, từng bước (runbook mà ChatGPT sẽ làm theo)

```
1. Start:  fb_reply_start(postUrl, mode, maxReplies, tone, skipRules)
           → tạo run, trạng thái running, trả về runId + giới hạn.
2. Mở:     browser_open(postUrl) → browser_read_page.
3. Load:   cuộn xuống (browser_scroll down) + bấm "Xem thêm bình luận"
           / "Xem thêm câu trả lời" nếu có → read_page lại.
           Lặp tới khi không còn nút load thêm, hoặc đã load đủ số
           bình luận cần cho phiên này.
4. Lấy danh sách: fb_read_comments → trả về bình luận có cấu trúc
           (key, tác giả, nội dung đầy đủ, thời gian, đã có trả lời
           của mình chưa, replyIndex).
5. Lọc:    bỏ qua bình luận của chính mình, bình luận đã có trả lời
           của mình, bình luận trống / chỉ có sticker (không có text),
           bình luận thuộc diện skipRules (ví dụ: spam, link lạ, nội
           dung cần người trả lời — các loại này ghi vào skipped kèm
           lý do, không gửi).
6. Với từng bình luận còn lại, theo đúng thứ tự từ trên xuống:
   a. fb_reply_next → tracker trả về bình luận tiếp theo + số còn lại
      / giới hạn. Hết giới hạn → dừng, sang bước 8.
   b. Soạn câu trả lời riêng: đúng ngôn ngữ bình luận, đúng tone đã
      chọn, ngắn gọn, trả lời đúng ý hỏi, không hứa hẹn gì ngoài khả
      năng thật (giá, giao hàng, bảo hành… nếu không chắc thì ghi
      skipped với lý do "cần người xác nhận", không bịa).
   c. Nếu mode = draft: lưu draft bằng fb_reply_save_draft, KHÔNG
      bấm gửi, sang bình luận tiếp theo.
   d. Nếu mode = auto: browser_click(replyIndex) → đọc lại trang để
      lấy index ô nhập mới → browser_type(index, câu trả lời,
      pressEnter=false) → bấm nút Gửi (browser_click nút Gửi, không
      dùng Enter mù vì ô bình luận Facebook Enter là xuống dòng) →
      chờ 3s → browser_read_page để kiểm chứng câu trả lời đã hiện.
   e. Kiểm chứng ok → fb_reply_mark_replied(key). Fail → thử lại tối
      đa 1 lần sau khi đọc lại trang; vẫn fail → fb_reply_mark_failed
      (key, lý do) và sang bình luận tiếp theo, không kẹt ở một cái.
   f. Nghỉ 5–20s ngẫu nhiên trước bình luận tiếp theo (ChatGPT tự
      chờ bằng cách không gọi tool ngay; tracker cũng chặn nếu lần
      gửi trước chưa đủ 5s).
7. Hết một đợt load: cuộn + load thêm, lặp từ bước 4, cho tới khi
   không còn bình luận mới nào (hai lần load liên tiếp không thêm
   bình luận mới) thì coi là hết.
8. Kết thúc: fb_reply_finish → trạng thái done/blocked/stopped + báo
   cáo: đã gửi/draft bao nhiêu, bỏ qua bao nhiêu (kèm lý do từng
   loại), fail bao nhiêu (kèm key để chạy lại tay), thời gian chạy.
```

Điểm mấu chốt của luồng: **index chỉ có giá trị trong lần đọc gần
nhất**. Sau mỗi click, cuộn, hoặc gửi, phải `browser_read_page` /
`fb_read_comments` lại rồi mới dùng index mới. Dùng index cũ sau khi
trang đổi là nguyên nhân sai bình luận, gửi nhầm chỗ.

## 6. Hai chế độ chạy

| | Draft (mặc định lần đầu) | Auto (người dùng chọn rõ) |
|---|---|---|
| ChatGPT làm | Đọc + soạn, lưu draft | Đọc + soạn + gửi + kiểm chứng |
| Gửi lên Facebook | Không | Có, từng cái một |
| Người dùng duyệt | Duyệt draft ở dashboard / tab Quản Lý, rồi chạy phiên gửi từ draft đã duyệt | Không duyệt từng câu, chỉ duyệt trước toàn bộ phiên (post, tone, giới hạn) |
| Rủi ro | Thấp nhất | Cao hơn nếu tone / nội dung sai — vì vậy chỉ bật sau khi đã chạy draft thành công ít nhất một lần |
| Dùng khi nào | Bài quan trọng, lần chạy đầu, tone chưa chắc | Bài quen thuộc, bình luận chủ yếu là cảm ơn / hỏi đơn giản |

Phiên gửi từ draft: `fb_reply_start` với `fromRunId` của phiên draft,
chỉ gửi những draft đã được duyệt, không soạn lại, vẫn kiểm chứng sau
mỗi lần gửi như §5.

## 7. Action đọc bình luận có cấu trúc (phần code mới quan trọng nhất)

### 7.1. Vì sao không dùng `read_page` là đủ

`read_page` cắt text ở 70 ký tự, không phân biệt bình luận cha / trả
lời con, không cho biết bình luận nào đã có trả lời của mình. Soạn câu
trả lời từ 70 ký tự đầu là đoán mò, và gửi nhầm bình luận là rủi ro
thật. Vì vậy cần một action riêng, chỉ đọc, không bấm gì cả.

### 7.2. `fb_read_comments` trả về gì

```json
{
  "postUrl": "https://www.facebook.com/...",
  "comments": [
    {
      "key": "sha256(author + text + time)",
      "author": "Tên hiển thị",
      "authorIsMe": false,
      "text": "nội dung đầy đủ, không cắt",
      "time": "2 giờ (text như trang hiển thị)",
      "hasOwnReply": false,
      "replyIndex": 42,
      "parentKey": null
    }
  ],
  "hasMore": true,
  "totalSeen": 37
}
```

- `replyIndex` là index trong danh sách `__otter_elements` mà
  `readPage` đã thu thập (cùng một lần quét, cùng một danh sách),
  nên `browser_click(replyIndex)` dùng được ngay, nhưng **chỉ tới
  lần đọc trang tiếp theo**.
- `parentKey = null` là bình luận gốc, khác null là trả lời con.
  Mặc định chỉ trả lời bình luận gốc; trả lời con chỉ khi người dùng
  bật rõ `includeReplies: true`.
- `hasOwnReply`: dựa trên việc dưới bình luận đó đã có một trả lời
  của chính tài khoản đang đăng nhập hay chưa (nhận diện bằng tên /
  avatar của mình trên trang — cách nhận diện này phải xác minh ở
  Phase 0, vì Facebook đổi DOM thường xuyên; nếu không xác định được
  chắc chắn thì trả về `unknown` và để tracker + ChatGPT xử lý thận
  trọng: coi như chưa trả lời nhưng ghi chú "chưa xác minh", không
  tự kết luận đã trả lời).
- Giới hạn: tối đa 50 bình luận / lần gọi, để khỏi tràn context của
  ChatGPT. Bình luận dài thì excerpt 1000 ký tự + ghi chú “đã cắt”,
  và ChatGPT phải dựa trên excerpt đó, không bịa phần còn lại.

### 7.3. Chỗ nào cần sửa code để có action này

1. `BrowserController.readComments()` mới trong
   `extension/src/background/browser-controller.ts`: một lần
   `executeScript` quét vùng bình luận, gom theo từng bình luận
   (tác giả, text, thời gian, nút Trả lời gần nhất, trả lời con của
   mình), trả về JSON như §7.2. Selector của Facebook nằm gọn trong
   hàm này, để DOM đổi thì chỉ sửa một chỗ.
2. `background.ts`: thêm case `"read_comments"` ở cả hai chỗ dispatch
   (hiện code đang lặp lại switch ở hai hàm, phải sửa cả hai).
3. Daemon: `browserBridge.execute("read_comments")` + MCP tool
   `fb_read_comments` trong `src/daemon/tools/browser.ts` (hoặc file
   tool riêng, xem §9), trả về JSON gọn cho ChatGPT.
4. Không thêm content script cho Facebook: action này chạy qua
   `chrome.scripting.executeScript` như `readPage` đã làm, không cần
   match mới trong manifest.

## 8. Dữ liệu mới (migration trong `src/daemon/db.ts`)

```sql
-- Một lần chạy trả lời bình luận
CREATE TABLE IF NOT EXISTS fb_reply_runs (
  id TEXT PRIMARY KEY,
  post_url TEXT NOT NULL,
  mode TEXT CHECK(mode IN ('draft','auto')) NOT NULL DEFAULT 'draft',
  status TEXT CHECK(status IN
    ('running','paused','done','blocked','stopped')) NOT NULL DEFAULT 'running',
  max_replies INTEGER NOT NULL DEFAULT 20,
  tone TEXT,                    -- ví dụ: thân thiện, ngắn gọn
  skip_rules TEXT,              -- JSON: loại bình luận bỏ qua
  include_replies INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  draft_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER,         -- để chặn gửi nhanh hơn 5s
  blocked_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Một bình luận trong một lần chạy (chỉ hash + excerpt, không lưu hồ sơ)
CREATE TABLE IF NOT EXISTS fb_reply_comments (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES fb_reply_runs(id),
  comment_key TEXT NOT NULL,    -- sha256(author + text + time)
  author TEXT,
  excerpt TEXT,                 -- tối đa 300 ký tự
  status TEXT CHECK(status IN
    ('pending','drafted','sent','skipped','failed')) NOT NULL DEFAULT 'pending',
  draft_text TEXT,              -- câu trả lời đã soạn (draft hoặc đã gửi)
  skip_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(run_id, comment_key)   -- chống trùng ở tầng DB
);
```

Migration theo mẫu đã dùng ở các plan trước: `CREATE TABLE IF NOT
EXISTS`, cột mới thêm bằng `PRAGMA table_info` + `ALTER TABLE` chỉ
khi chưa có, chạy lại nhiều lần vẫn an toàn.

## 9. MCP tools mới (file mới `src/daemon/tools/fb-reply-tools.ts`)

- `fb_reply_start` `{ postUrl, mode?, maxReplies?, tone?,
  skipRules?, includeReplies?, fromRunId? }` → tạo run, chặn nếu
  đã có run đang `running` cho cùng post (một post một phiên tại một
  thời điểm).
- `fb_reply_next` `{ runId }` → trả về bình luận `pending` tiếp theo
  (theo thứ tự đã lưu) + số còn lại + kiểm tra giới hạn và khoảng
  cách 5s từ lần gửi trước. Hết giới hạn → trả về `limit_reached`
  và chuyển run sang `done`.
- `fb_reply_save_draft` `{ runId, commentKey, draftText }` → draft.
- `fb_reply_mark_replied` `{ runId, commentKey }` → sent, tăng
  `sent_count`, cập nhật `last_sent_at`. Chỉ chấp nhận khi bình luận
  đang ở trạng thái pending/drafted, và chỉ tăng đếm một lần nhờ
  UNIQUE ở DB.
- `fb_reply_mark_skipped` `{ runId, commentKey, reason }` →
  skipped + lý do.
- `fb_reply_mark_failed` `{ runId, commentKey, reason }` → failed.
- `fb_reply_status` `{ runId }` → run + đếm theo trạng thái + 10
  bình luận gần nhất.
- `fb_reply_stop` `{ runId, reason? }` → stopped, không gửi thêm.
- `fb_reply_resume` `{ runId }` → từ `paused` về `running`, tiếp tục
  từ bình luận pending tiếp theo (không làm lại cái đã sent).
- `fb_read_comments` (đi kèm §7) → danh sách có cấu trúc.

Logic thuần nằm ở `src/daemon/fb-reply.ts` (không phụ thuộc MCP/Zod
để test được không cần node_modules, theo mẫu `plan.ts`), tools chỉ
là lớp mỏng gọi vào đó — cùng một mẫu đã dùng cho plan tools.

## 10. Quy tắc soạn câu trả lời (ChatGPT phải tuân theo)

- Trả lời đúng ý bình luận, đúng ngôn ngữ của bình luận, ngắn gọn
  (1–3 câu cho bình luận đơn giản, dài hơn chỉ khi câu hỏi phức tạp).
- Không hứa giá / thời gian giao hàng / bảo hành nếu không có trong
  thông tin người dùng đã cung cấp cho phiên đó. Không chắc → bỏ qua
  với lý do “cần người xác nhận”, để người dùng trả lời tay.
- Không trả lời bình luận: chửi bới / kích động, link lạ, quảng cáo
  của người khác, thông tin cá nhân (số điện thoại, địa chỉ), khiếu
  nại cần xử lý riêng — tất cả ghi `skipped` kèm lý do, không tranh
  cãi, không xóa, không chặn ai từ vòng lặp này.
- Không dùng cùng một câu cho nhiều bình luận. Hai câu trả lời liên
  tiếp giống nhau quá 80% thì tracker cảnh báo và ChatGPT phải viết
  lại (kiểm tra đơn giản bằng so sánh text đã gửi gần nhất).
- Xưng hô và tone theo `tone` của phiên, mặc định: thân thiện, lịch
  sự, xưng “mình / shop” theo cách người dùng vẫn dùng — tone này do
  người dùng chốt khi start, ChatGPT không tự đổi giữa chừng.

## 11. An toàn, nhịp gửi, phát hiện chặn

- **Nhịp:** tối thiểu 5s, ngẫu nhiên 5–20s giữa hai lần gửi. Tracker
  chặn `fb_reply_next` nếu chưa đủ 5s từ `last_sent_at`.
- **Giới hạn mặc định:** 20 bình luận / phiên, 60 phút / phiên. Vượt
  thì `done` (hết giới hạn, không phải lỗi) và báo số còn lại để chạy
  phiên tiếp theo nếu muốn.
- **Thử lại:** mỗi bình luận tối đa 2 lần gửi (lần 2 sau khi đọc lại
  trang). Vẫn fail → `failed`, sang cái tiếp theo.
- **Dấu hiệu dừng ngay:** banner lỗi Facebook, trang bắt xác minh /
  đăng nhập lại, nút Gửi biến mất hoặc không bấm được sau 2 lần đọc
  lại trang, câu trả lời không hiện sau khi gửi, hoặc 3 bình luận
  liên tiếp fail → chuyển run sang `blocked` với lý do rõ ràng, dừng
  toàn bộ phiên, không thử tiếp.
- **Một tab điều khiển tại một thời điểm:** `BrowserController` vốn
  chỉ giữ một `controlledTabId`. Nếu người dùng đang dùng tab đó làm
  việc khác, vòng lặp phải dừng — không được điều khiển tab người
  dùng đang gõ. Trước khi start, kiểm tra tab điều khiển có phải là
  tab Facebook của phiên này không.
- **Dừng tay:** nút Dừng ở dashboard / tab Quản Lý gọi
  `fb_reply_stop`; ChatGPT đang giữa một lần gửi thì gửi xong lần đó
  (đã kiểm chứng) rồi dừng, không bỏ dở giữa chừng rồi gửi trùng
  ở lần sau.

## 12. Các phase thực hiện (thứ tự bắt buộc)

### Phase 0 — Khám phá DOM Facebook thật + đóng băng baseline (0.5 ngày)

- Mở một bài thật (bài của chính mình, có sẵn vài bình luận), ghi
  lại: vùng bình luận nằm ở đâu, nút “Xem thêm bình luận” / “Xem thêm
  câu trả lời” trông ra sao, nút Trả lời nằm ở đâu so với bình luận,
  ô nhập trả lời là contenteditable hay textarea, nút Gửi là gì
  (Enter có phải là gửi không — giả thuyết hiện tại: Enter là xuống
  dòng, phải bấm nút Gửi), dấu hiệu nào cho biết “đã có trả lời của
  mình”, banner chặn / lỗi trông ra sao.
- Deliverable: `docs/plans/2026-10-31-fb-reply-loop-dom-notes.md`
  (selector đã xác minh + mô tả bằng chữ, không lưu nội dung bình
  luận riêng tư của người khác). Nếu không xác định được selector ổn
  định cho “nút Trả lời của từng bình luận” và “ô nhập trả lời” thì
  dừng ở đây và báo lại, không code tiếp mù.
- Baseline: các test plan/dashboard/loop vẫn pass trước khi sửa.

### Phase 1 — Runbook cho ChatGPT, chưa code gì (0.5 ngày)

- Viết prompt runbook đầy đủ theo §5 + §10 thành một tài liệu
  (`docs/plans/2026-10-31-fb-reply-loop-runbook.md`) mà người dùng có
  thể dán vào ChatGPT Web để chạy ngay bằng tools browser có sẵn
  (chưa có tracker, chưa có `fb_read_comments`).
- Chạy thử tay trên một bài của chính mình có 3–5 bình luận test,
  ở chế độ draft (chỉ soạn, chưa gửi) để kiểm chứng: ChatGPT có làm
  đúng thứ tự không, có đọc lại trang sau mỗi bước không, có gửi
  nhầm bình luận không.
- Chấp nhận khi: chạy draft xong không sai bình luận nào, và runbook
  đã sửa hết lỗi gặp trong lần chạy thử đó. Phase này đã cho ra giá
  trị dùng được ngay, dù chưa có code mới.

### Phase 2 — Tracker phiên ở daemon (1 ngày)

- `src/daemon/fb-reply.ts` + `src/daemon/tools/fb-reply-tools.ts` +
  migration §8 + đăng ký tools trong `mcp.ts`.
- Test mới `scripts/test-fb-reply.ts` trên DB tạm: start chặn run
  trùng, next tôn trọng giới hạn, mark_replied idempotent (gọi hai
  lần chỉ đếm một), resume bỏ qua cái đã sent, stop chặn next tiếp
  theo, khoảng cách 5s bị chặn.
- Chấp nhận khi test pass và ChatGPT chạy lại runbook Phase 1 nhưng
  lần này có gọi `fb_reply_*` thì không còn trả lời trùng khi chạy
  lại cùng một bài.

### Phase 3 — Action đọc bình luận có cấu trúc (1–1.5 ngày)

- `BrowserController.readComments()` + case `read_comments` ở cả hai
  chỗ dispatch trong `background.ts` + MCP tool `fb_read_comments`.
- Chấp nhận khi: trên bài thật, `fb_read_comments` trả về đúng tác
  giả + nội dung đầy đủ (không cắt 70 ký tự) + replyIndex dùng được
  ngay bằng `browser_click`, và phân biệt được bình luận gốc / trả
  lời con. Nếu `hasOwnReply` không xác định chắc chắn được thì trả
  `unknown` theo §7.2, không đoán.

### Phase 4 — Chế độ gửi + kiểm chứng + duyệt draft (1 ngày)

- Nối runbook với tracker: draft → duyệt → gửi từ draft đã duyệt
  (§6), kiểm chứng sau mỗi lần gửi (§5 bước 6d–6e), thử lại tối đa
  1 lần, fail thì ghi failed và đi tiếp.
- Dashboard (`/plan-dashboard` hoặc route riêng
  `/api/fb-replies`): xem run, duyệt/từ chối từng draft, bấm Dừng.
  Tab Quản Lý: thêm mục phiên FB đang chạy (tiến độ, nút Dừng).
- Chấp nhận khi: chạy auto trên bài test 5 bình luận, gửi đủ 5,
  kiểm chứng đủ 5, chạy lại lần nữa thì gửi 0 (toàn bộ đã sent).

### Phase 5 — An toàn, nhịp gửi, phát hiện chặn, resume (0.5–1 ngày)

- Chặn 5s ở tracker, giới hạn 20 / 60 phút, dừng khi gặp dấu hiệu
  chặn (§11), một phiên / một post, kiểm tra tab điều khiển trước
  khi start.
- Resume sau mất kết nối: run còn trong DB, extension reconnect
  (backoff đã có), ChatGPT gọi `fb_reply_resume` + `fb_reply_status`
  rồi tiếp tục từ pending tiếp theo.
- Chấp nhận khi: giả lập chặn (3 fail liên tiếp) thì run chuyển
  blocked và không gửi thêm; ngắt extension giữa phiên rồi resume
  thì không gửi trùng.

### Phase 6 — Test + rollout (0.5–1 ngày)

- Test tự động: `scripts/test-fb-reply.ts` (logic daemon, DB tạm).
- Test tay bắt buộc trên bài thật của chính mình (không thay bằng
  test tự động): (a) draft 5 bình luận không sai, (b) duyệt + gửi 5,
  chạy lại gửi 0, (c) bình luận dài > 70 ký tự vẫn soạn đúng ý,
  (d) load thêm bình luận giữa chừng vẫn không sót, không trùng,
  (e) bấm Dừng giữa chừng thì dừng hẳn, (f) bình luận cần người xác
  nhận thì bị skipped chứ không bịa câu trả lời.
- Build extension (`bun build.extension.ts`), cập nhật tài liệu,
  đồng bộ lên `nam` bằng rsync chia nhỏ với wrapper bền
  `~/workspace/ssh_to_nam.sh` (không dùng `/tmp/ssh_to_nam.sh`, và
  `mkdir -p extension/dist` trên `nam` trước nếu cần), kiểm chứng
  hash + chạy lại test trên `nam`.
- Rollout: mặc định **draft**, mặc định **tắt**. Chế độ auto chỉ bật
  theo từng phiên khi người dùng nói rõ, và lần đầu tiên luôn là
  draft.

## 13. Những gì KHÔNG làm trong plan này

- Không tự động thích / chia sẻ / kết bạn / nhắn tin riêng hàng loạt.
  Chỉ trả lời bình luận trên bài đã chỉ định.
- Không xóa / ẩn / chặn bình luận hay người bình luận từ vòng lặp.
- Không dùng API Facebook để gửi hàng loạt thay cho trình duyệt
  (đường chính là trình duyệt, đúng yêu cầu “vào trang tương tác”).
- Không lưu hồ sơ, không phân tích cảm xúc / phân loại người bình
  luận, không dùng bình luận để theo dõi ai.
- Không chạy nhiều phiên cùng lúc trên cùng một tab điều khiển.
- Không tự đổi tài khoản, không vượt qua xác minh / checkpoint của
  Facebook bằng mọi cách.

## 14. Rủi ro và cách giảm

- **Facebook đổi DOM:** selector gom trong `readComments()` một chỗ
  + Phase 0 xác minh trước khi code + `hasOwnReply = unknown` khi
  không chắc, thay vì đoán.
- **Trả lời nhầm bình luận:** index chỉ dùng trong lần đọc gần nhất
  + đọc lại trang sau mỗi bước + kiểm chứng câu trả lời đã hiện
  dưới đúng bình luận trước khi mark_replied.
- **Trả lời trùng:** UNIQUE (run_id, comment_key) ở DB + tracker
  chặn ở `fb_reply_next` + chạy lại cùng bài thì gửi 0.
- **Bị Facebook chặn:** nhịp 5–20s, câu trả lời riêng từng cái,
  giới hạn 20 / phiên, dừng ngay khi thấy dấu hiệu chặn, không thử
  tiếp.
- **ChatGPT bịa thông tin:** quy tắc §10 — không chắc thì skipped
  “cần người xác nhận”, không hứa giá / giao hàng / bảo hành khi
  không có dữ liệu.
- **Hết context giữa chừng:** run lưu trong DB nên resume được từ
  pending tiếp theo, không cần nhớ trong hội thoại.

## 15. Ước lượng (thô, cho một người làm)

| Phase | Việc | Ước lượng |
|---|---|---|
| 0 | DOM Facebook thật + baseline | 0.5 ngày |
| 1 | Runbook cho ChatGPT, chưa code | 0.5 ngày |
| 2 | Tracker phiên ở daemon | 1 ngày |
| 3 | Action đọc bình luận có cấu trúc | 1–1.5 ngày |
| 4 | Chế độ gửi + kiểm chứng + duyệt draft | 1 ngày |
| 5 | An toàn, nhịp gửi, phát hiện chặn, resume | 0.5–1 ngày |
| 6 | Test + rollout + sync `nam` | 0.5–1 ngày |
| **Tổng** | | **5–7 ngày** |

Phase 1 đã dùng được ngay mà chưa cần code, nên nếu muốn thử sớm thì
có thể dừng ở Phase 1, chạy draft trên bài test, rồi mới quyết có
làm tiếp Phase 2–6 hay không.

## 16. Câu hỏi cần chốt trước khi code (không cần trả lời ngay trong plan này)

1. Tone trả lời mặc định là gì (thân thiện ngắn gọn? xưng “shop” hay
   “mình”?), và có danh sách câu hỏi nào luôn phải để người trả lời
   (ví dụ: giá sỉ, bảo hành, khiếu nại) không?
2. Chế độ mặc định lần đầu là draft — bạn có đồng ý không, hay muốn
   thử auto luôn trên bài test ít bình luận?
3. Giới hạn 20 bình luận / phiên có phù hợp không, hay bài của bạn
   thường có nhiều hơn và muốn tăng lên sau khi đã chạy thử thành
   công?
4. Có cần trả lời cả bình luận con (trả lời trong thread) ngay từ
   đầu không, hay chỉ trả lời bình luận gốc trước? Khuyến nghị: chỉ
   bình luận gốc trước.

## 17. Trạng thái

- [ ] Phase 0 — DOM Facebook thật + baseline
- [ ] Phase 1 — Runbook cho ChatGPT, chưa code
- [ ] Phase 2 — Tracker phiên ở daemon
- [ ] Phase 3 — Action đọc bình luận có cấu trúc
- [ ] Phase 4 — Chế độ gửi + kiểm chứng + duyệt draft
- [ ] Phase 5 — An toàn, nhịp gửi, phát hiện chặn, resume
- [ ] Phase 6 — Test + rollout

Plan này chỉ là tài liệu, chưa code gì. Khi người dùng duyệt thì bắt
đầu từ Phase 0, không nhảy thẳng sang code tracker hay reader.
