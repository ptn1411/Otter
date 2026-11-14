# Mở Chrome theo profile — đã code (2026-10-31)

Người dùng: "làm có thể gọi mở chrome theo profile ra để làm".

## Vấn đề trước đây
Extension chỉ điều khiển được tab ChatGPT ĐÃ mở trong một profile.
Không có cách nào từ daemon/ChatGPT gọi mở đúng profile đó ra.
Mỗi profile = một login ChatGPT + một cấu hình server riêng trong
chrome.storage.local, nên mở sai profile là làm sai dự án/login.

## Đã code
- `src/daemon/chrome-profile.ts` (pure, không MCP/Zod):
  - Tìm user-data-dir theo OS (Linux `~/.config/google-chrome`,
    macOS `~/Library/Application Support/Google/Chrome`,
    Windows `%LOCALAPPDATA%\Google\Chrome\User Data`), hoặc
    `OTTER_CHROME_USER_DATA_DIR`, hoặc `OTTER_CHROME_PATH` cho
    binary Chrome tùy chọn.
  - Liệt kê profile từ `Local State` → `profile.info_cache`
    (thư mục, tên hiển thị, đường dẫn); fallback quét thư mục con
    có file `Preferences` nếu chưa có Local State.
  - Resolve profile theo: tên thư mục (`Profile 1`), tên hiển thị
    duy nhất (không phân biệt hoa thường, trùng tên thì bắt dùng
    tên thư mục), hoặc đường dẫn tuyệt đối trong user-data-dir.
    Đường dẫn ngoài user-data-dir bị từ chối.
  - Mở bằng spawn mảng args (không shell): 
    `--profile-directory=<dir> --no-first-run
    --no-default-browser-check <url>`, detached + unref, không
    kill Chrome đang chạy, không đóng tab user. URL chỉ http(s),
    mặc định `https://chatgpt.com`. Profile mới dạng `Profile N`
    được Chrome tự tạo khi `createIfMissing` (mặc định true).
  - Linux không có DISPLAY/WAYLAND_DISPLAY → lỗi rõ ràng, không
    mở headless giả.
- `src/daemon/tools/chrome-tools.ts`: `chrome_list_profiles`,
  `chrome_open_profile` (MCP tổng 144 → 146).
- `src/daemon/routes/chrome-routes.ts`: `GET /api/chrome/profiles`,
  `POST /api/chrome/open` (sau global auth, không public).
- Nối fleet B2: prompt dispatch của worker nay có câu "nếu chưa
  có tab ChatGPT nào nối với daemon này, gọi chrome_open_profile
  trước rồi mới làm". Hub không mở Chrome hộ worker.
- Extension tab Management: card "Mở Chrome theo profile" liệt
  kê profile từ daemon đang chọn, mỗi profile một nút Mở (gọi
  `POST /api/chrome/open` với chatgpt.com).

## Test 2026-10-31
- `bun scripts/test-chrome-profile.ts`: 18/18 pass (list,
  resolve đủ dạng, trùng tên, ngoài user-data-dir, URL
  javascript bị từ chối, mở bằng fake chrome binary và kiểm tra
  args `--profile-directory=Profile 1` + URL, không DISPLAY bị
  từ chối). Test dùng thư mục tạm, không cần Chrome thật.
- Live daemon hub 1993 (restart sau khi thêm code): MCP 146 tool,
  `GET /api/chrome/profiles` trả `profiles: []` (VM này không có
  `~/.config/google-chrome`), `chrome_open_profile` trả lỗi rõ
  "không có DISPLAY (VM headless)" — đúng hành vi, không mở giả.
- Hồi quy: test-fleet 16/16 vẫn pass.
- Extension build lại: `extension/dist/options.js` chứa
  manage-chrome-list.

## Chưa verify — nói rõ
- Chưa mở Chrome thật với profile thật: VM này headless, không
  có Chrome, không có màn hình. Bước này phải làm trên máy có
  màn hình (ví dụ `nam` hoặc máy user): gọi `chrome_list_profiles`
  rồi `chrome_open_profile` với profile thật, xem cửa sổ Chrome
  profile đó hiện ra và extension nối về daemon.
- Chưa bấm nút Management trong Chrome thật (mới build, chưa mở
  Options page thật).
- Trên Windows/macOS, đường dẫn Chrome và user-data-dir mới chỉ
  là code theo platform, chưa chạy trên máy thật (giống giới hạn
  chung của cross-platform đã ghi trước đó).

## Bổ sung: mở bằng GPM / trình duyệt user cung cấp đường dẫn (2026-10-31)
Người dùng hỏi: mở bằng GPM được chứ, dùng trình duyệt đó, mình
cung cấp đường dẫn, nó mở lên. Trả lời: được, đã code chế độ custom.
- `chrome_open_profile` thêm `browserPath` (hoặc env
  `OTTER_BROWSER_PATH`): có thì mở đúng file đó, profile (nếu có)
  truyền thẳng thành `--profile-directory`, KHÔNG tra Chrome Local
  State. `extraArgs` truyền thẳng dạng mảng, không qua shell.
- Extension Management: form "Mở bằng trình duyệt khác (ví dụ
  GPM)" nhập đường dẫn + profile tùy chọn + URL, gọi
  `POST /api/chrome/open` với `browserPath`.
- Test: test-chrome-profile 18 → 22 pass (custom launch kind=
  custom, args chứa profile + URL, không profile vẫn mở URL,
  đường dẫn không tồn tại bị từ chối rõ). Live hub daemon: gọi
  browserPath không tồn tại → lỗi rõ, daemon vẫn sống.
- Giới hạn thật về GPM, không được nhận đã xong: GPM là trình
  duyệt Chromium chống detect, profile GPM do app GPM quản lý.
  Mở file .exe của GPM sẽ mở app/trình duyệt GPM lên, nhưng chọn
  đúng một profile GPM theo ID thì phải qua GPM Local API của app
  đó — endpoint/port chưa được verify từ nguồn tin cậy trong repo
  này nên chưa code đường đó, không đoán port/endpoint. Nếu user
  chỉ cần mở GPM lên rồi tự chọn profile trong app thì chế độ
  custom đủ. Nếu cần chọn đúng profile GPM theo ID tự động, user
  cần cung cấp thêm: đường dẫn GPM thật trên máy đó + cách chọn
  profile (ID và Local API nếu có) để code tiếp, và bước đó phải
  test trên máy có GPM + màn hình thật (VM này không có).
