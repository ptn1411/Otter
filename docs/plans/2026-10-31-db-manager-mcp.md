# DB Manager bên trong Otter (MCP wrapper cho Python CLI)

Ngày: 2026-10-31. Trạng thái: **đã code + test xong ở bản local** (chưa sync
lên `nam`, chưa gọi thử qua daemon thật đang chạy).

## Python code nằm ở đâu

Toàn bộ code Python được copy nguyên vẹn từ project standalone
`~/workspace/code/db-manager/` sang:

```
tools/db-manager/
├── PLAN.md, README.md      # plan + hướng dẫn của CLI gốc (đọc ở đó để biết
│                           #   chi tiết driver, safety classifier, SSH tunnel)
├── bin/dbm                 # entry script, chạy được ngay từ repo root:
│                           #   python3 tools/db-manager/bin/dbm --help
├── dbm/                    # package: cli, runner, safety, profiles, ssh,
│                           #   output, errors, drivers/ (sqlite, postgres,
│                           #   mysql, mongodb, redis, sqlserver-stub)
└── tests/                  # unittest chuẩn của CLI gốc (35 test)
```

Bản copy không đổi hành vi Python: `bin/dbm` tự chèn thư mục cha của nó
vào `sys.path` nên chạy từ repo root vẫn tìm đúng package `dbm`. Chỉ bỏ
`__pycache__` khi copy (file biên dịch, tự tạo lại). Bản gốc ở
`~/workspace/code/db-manager/` được giữ nguyên, không di chuyển.

## Wrapper MCP gọi Python như thế nào

`src/daemon/tools/db-tools.ts` là lớp mỏng, không có đường truy vấn riêng:

- Tìm CLI theo thứ tự: biến môi trường `DBM_CLI_PATH` (nếu đặt) →
  `tools/db-manager/bin/dbm` tính từ cwd (daemon chạy từ repo root) →
  đường dẫn tương đối từ file `db-tools.ts`.
- Chạy `python3 <cli> --json ...` bằng `spawnSync` của Node (chạy được
  trên Bun), timeout mặc định 30s, tối đa 120s (kẹp ở wrapper, CLI cũng
  nhận `--timeout`). Quá timeout hoặc exit khác 0 → trả lỗi gọn gồm
  stderr của CLI (cắt 2000 ký tự), không dump stack trace thô.
- Trả stdout của CLI về nguyên vẹn (dạng `--json` với các lệnh đọc, dạng
  text với `profile add/remove` và export ra file).
- Đăng ký ở `src/daemon/mcp.ts` ngay sau `registerFbPostTools` (mục 10e)
  và export ở `src/daemon/tools/index.ts`, đúng mẫu các tool khác.
- Không thêm dependency npm nào: chỉ dùng zod + MCP SDK mà repo đã có.

10 tool, map 1:1 sang subcommand CLI:

| Tool MCP | CLI tương ứng |
|---|---|
| `db_profile_add` | `profile add` |
| `db_profile_list` | `profile list` (+ `--json`) |
| `db_profile_show` | `profile show` (+ `--json`) |
| `db_profile_remove` | `profile remove --yes` (chỉ khi có cờ xác nhận, xem dưới) |
| `db_test` | `test` |
| `db_list_databases` | `dbs` |
| `db_list_tables` | `tables` |
| `db_describe_table` | `describe TABLE` |
| `db_query` | `query "STATEMENT"` |
| `db_export` | `export TABLE --format csv\|json [--output FILE]` |

Mọi tool đọc đều nhận `profile`, `limit` (mặc định 100, 0 = không giới
hạn nhưng phải đặt rõ) và `timeoutSecs` (mặc định 30, tối đa 120).
Cờ global `--profile/--json/--limit/--timeout` của CLI phải đứng TRƯỚC
subcommand (argparse) — wrapper đã xếp đúng thứ tự này.

## Hợp đồng an toàn (safety contract)

Giữ nguyên 100% luật của CLI Python, wrapper chỉ cộng thêm một lớp khóa
nữa ở phía MCP:

1. **Mặc định chỉ đọc.** `db_query` không có cờ viết thì CLI từ chối mọi
   câu viết ở chế độ safe (classifier tách comment, tách statement ngoài
   dấu nháy, nên `/* x */ DELETE …` hay chuỗi nhiều statement có chứa
   câu viết đều bị từ chối cả khối).
2. **Viết cần hai cờ cùng lúc.** Chỉ khi caller truyền CẢ HAI
   `allowWrite=true` VÀ `confirmWrite=true` thì wrapper mới thêm
   `--write --yes` cho CLI. Thiếu một trong hai → wrapper từ chối ngay
   mà không spawn CLI. Hai cờ này chỉ được đặt khi NGƯỜI DÙNG đã duyệt
   rõ ràng câu lệnh đó — mô tả tool ghi rõ điều này, không được suy ra
   tự động từ ngữ cảnh.
3. **Xóa profile cũng cần xác nhận.** `db_profile_remove` không có
   `confirmRemove=true` thì từ chối, vì MCP không có stdin tương tác để
   gõ YES như CLI.
4. **Không password qua MCP.** Wrapper không in/log/echo password hay
   connection string. Profile chỉ lưu TÊN biến môi trường chứa password
   (`passwordEnv`); CLI tự đọc biến đó hoặc hỏi getpass. TypeScript ở
   đây không xử lý password.
5. **`--dry-run` (tùy chọn của `db_query`)** chỉ in trước câu lệnh, không
   thực thi — dùng để xem trước câu viết.
6. **Không đường vòng.** Wrapper không có query path riêng: mọi câu lệnh
   đều đi qua CLI và classifier của nó. Không thêm engine, không đổi
   luật safe mode.

## Profiles dùng chung qua DBM_HOME

Wrapper truyền nguyên môi trường của daemon sang tiến trình Python
(`env: process.env`), không đặt lại `DBM_HOME` và không tạo thêm nơi
lưu profile nào khác. Hệ quả:

- Profile tạo bằng CLI standalone (`tools/db-manager/bin/dbm profile
  add ...`) thì MCP tool thấy ngay, và ngược lại — cùng một file
  `profiles.json` (mặc định `~/.config/dbm/`, hoặc `$DBM_HOME/` nếu đặt).
- Password vẫn lấy từ biến môi trường của daemon (tên biến ghi trong
  profile) — muốn MCP dùng được profile có password thì biến đó phải có
  trong môi trường lúc daemon chạy.
- SSH tunnel (profile có `ssh`) vẫn do CLI mở/đóng bằng `ssh -L`
  key-only (`BatchMode=yes`), chết theo tiến trình CLI khi lệnh xong.

## Test

`bun scripts/test-db-tools.ts` (chạy từ repo root, dùng DBM_HOME tạm và
SQLite file tạm, không chạm profiles thật, không cần DB server):

1. CLI đã copy chạy được từ cây chatmcp (`--help`, `info`).
2. Profile add/list/show qua wrapper.
3. tables/describe/query qua wrapper trả đúng dòng (kể cả tên UTF-8).
4. DROP qua handler `db_query` KHÔNG cờ → bị từ chối, bảng vẫn còn.
5. DROP chỉ có `allowWrite` (thiếu `confirmWrite`) → bị từ chối.
6. DROP có CẢ HAI cờ → thực thi thật, bảng mất (đường write cố ý,
   không phải đường chết).
7. `db_profile_remove` không cờ → từ chối, có cờ → xóa.
8. Đủ 10 tool `db_*` đăng ký trên mock MCP server.

Kết quả lúc viết doc này: **18/18 pass**. Bộ unittest Python gốc chạy
từ vị trí mới cũng pass: **35/35**. Các suite cũ không hỏng:
`test-fb-post`, `test-fb-reply`, `test-fb-comment-parser` vẫn pass;
`bun build --target=bun` thành công cho `mcp.ts` và `db-tools.ts`.

Lưu ý về test: `db-tools.ts` import zod + MCP SDK giống mọi file
`tools/*` khác nên test dùng đúng hai dependency repo đã cài (không
thêm dependency mới); riêng đường spawn Python thì không cần npm.

## CHƯA kiểm chứng

- PostgreSQL/MySQL/MongoDB/Redis với server thật (kế thừa giới hạn của
  CLI gốc: chỉ SQLite được test end-to-end ở đây; driver khác báo rõ
  gói pip cần cài khi thiếu).
- SSH tunnel thật qua MCP (CLI gốc mới test mock subprocess).
- SQL Server ngoài mức stub.
- Gọi tool `db_*` qua daemon MCP đang chạy thật (mới test đăng ký trên
  mock server + spawn CLI trực tiếp, chưa qua MCP client thật).
- Chưa sync lên `nam`.
