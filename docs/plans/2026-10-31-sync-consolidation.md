# Đồng bộ một chỗ — canonical layout & sync script (2026-10-31)

## Một chỗ duy nhất cho mỗi thứ

- **chatmcp là gốc duy nhất.** Mọi code Otter sống ở `~/workspace/code/chatmcp/` trên VM
  này và `~/code/chatmcp/` trên `nam`. Không còn bản copy rời rạc nào khác.
- **DB manager chỉ có một bản thật:** `chatmcp/tools/db-manager/`. Đường dẫn cũ
  `~/workspace/code/db-manager/` giờ là **symlink** trỏ tới đó, nên mở ở đường
  nào cũng là cùng một file — sửa một lần, cả hai đường cùng thấy.
- **Extension build output:** `extension/options.js` và `extension/dist/options.js`
  được build cùng lúc từ `extension/src/options/options.ts`; khi sync chỉ cần
  sync file nào đổi (thường chỉ `options.js`), đừng sync cả thư mục `dist/`.

## Sync sau mỗi lần update — một lệnh duy nhất

Dùng `~/workspace/sync_to_nam.sh` (bản durable, nằm ngoài repo nên không bị
mất khi VM thay mới):

```bash
~/workspace/sync_to_nam.sh src/daemon/tools/db-tools.ts
~/workspace/sync_to_nam.sh tools/db-manager/ extension/dist/options.js
~/workspace/sync_to_nam.sh --verify-only src/daemon/mcp.ts
```

Script tự làm những việc trước đây phải làm tay và hay quên:

1. `mkdir -p` thư mục cha trên `nam` trước (rsync không tự tạo thư mục cha
   cho file lẻ, ví dụ `extension/dist/`).
2. Rsync từng item riêng + retry tối đa 4 lần (đường tunnel qua proxy hay
   đứt sau vài chục giây; chuyển nguyên cây lớn luôn fail, chuyển lẻ + retry
   thì qua).
3. Đích là đường tuyệt đối `/home/nam/...`, không dùng `~/`.
4. Loại `__pycache__` và `node_modules`.
5. Verify bằng SHA-256 sau mỗi item (file: so hash trực tiếp; thư mục: so
   danh sách file + hash từng file). Chỉ in `OK` khi khớp, exit code khác 0
   nếu có item nào FAIL/DIFF.

Quy tắc sau này: **sửa code ở local → chạy test → chạy script sync → đọc
dòng OK**. Không copy tay bằng rsync rời, không giữ hai bản song song nữa.
