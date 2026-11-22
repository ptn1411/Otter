# Task: Otter tự gỡ codebase-memory daemon kẹt rendezvous rồi gọi lại một lần

> Đã làm ngày 2026-11-22 trong `src/daemon/cbm.ts` và `tests/cbm-stale-daemon.test.ts`.

Viết ngày 2026-11-22. Repo: `C:\Users\NAM\Code\rust\chatmcp` (origin `https://github.com/ptn1411/Otter`). File này đủ để sửa, không cần transcript chat.

## Bối cảnh

`codebase_list_projects` trả `isError=true`. Otter không tính sai schema. CLI `codebase-memory-mcp` thoát mã 1 và in stderr:

```text
codebase-memory-mcp: CBM daemon endpoint is held by pid 7436 but that process answered no rendezvous within 30000 ms; the daemon runtime is likely dead — stop that process, then retry
```

Lúc chẩn đoán (2026-11-22):

- PID 7436 vẫn sống: `"C:\Users\NAM\AppData\Local\Programs\codebase-memory-mcp\codebase-memory-mcp.exe" --cbm-daemon-internal`, mở lúc 17:21, khoảng 16 MB. Process còn đó nhưng không trả lời rendezvous, nên mọi lệnh CLI cùng kẹt 30 giây rồi fail.
- PID kia là tiến trình CLI do Otter spawn, không phải daemon.

Đường gọi hiện tại:

1. `src/daemon/tools/codebase.ts` — `codebase_list_projects` gọi `invokeCbm("list_projects", { detail })`.
2. `src/daemon/cbm.ts` hàm `invokeCbm` (khoảng dòng 66–136) spawn:

```text
codebase-memory-mcp cli --quiet --json <toolName> <jsonArgs>
```

3. stdout rỗng và exit khác 0 thì trả nguyên stderr, bọc thành `codebase-memory error (exit N):`. Không có nhánh dừng daemon rồi thử lại.

Mọi tool đồ thị đi qua `invokeCbm`: `codebase_list_projects`, `codebase_index_repository`, `codebase_search_graph`, `codebase_trace_path`, `codebase_get_snippet`, `codebase_get_architecture`, `codebase_manage_adr`. Sửa một chỗ trong `invokeCbm` là phủ hết. `code_list_files`, `code_search_text`, `read_file` không đi qua daemon này, để nguyên.

## Mục tiêu

Khi CLI báo đúng lỗi "endpoint is held by pid N … answered no rendezvous", Otter xác minh PID đó là daemon nội bộ của codebase-memory, dừng đúng process đó, rồi chạy lại **đúng một lần** cùng lệnh CLI. Lần gọi sau dùng daemon mới và trả kết quả bình thường.

## Việc cần làm

Sửa `src/daemon/cbm.ts`. Tách phần spawn hiện tại thành một hàm nội bộ, ví dụ `runCbmCli`, để lần đầu và lần retry dùng chung.

1. Nhận diện lỗi trên **stderr của lần spawn**, trước khi bọc thành câu trả lời cho MCP. Regex đủ chặt:

```text
endpoint is held by pid (\d+) but that process answered no rendezvous
```

Không hardcode PID 7436. PID trong thông báo chỉ là ví dụ của lần kẹt này.

2. Trước khi kill, đọc command line của PID và bắt buộc cả hai điều kiện:

- tên process là `codebase-memory-mcp` / `codebase-memory-mcp.exe`
- command line chứa `--cbm-daemon-internal`

Windows: `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"`. Unix: `/proc/<pid>/cmdline`. Thiếu một điều kiện thì không kill, trả lỗi gốc.

3. Dừng process đã xác minh. Windows: `Stop-Process -Id <pid> -Force`. Unix: `process.kill`. Process đã thoát giữa lúc đọc command line thì coi như đã gỡ, được phép retry.

4. Retry đúng một lần, cùng binary, cùng args. Retry vẫn lỗi thì trả lỗi của lần hai, kèm một câu là đã dừng daemon PID nào. Không retry lần ba.

5. Khóa single-flight trong module: nhiều `invokeCbm` đồng thời chỉ một lần được kill và chờ nhau. Daemon Otter đang có hàng chục phiên MCP. Không khóa thì cùng một PID bị kill đua.

6. Log một dòng, ví dụ `[Codebase Memory] stale daemon pid 7436 did not rendezvous; stopped it and retrying once`.

7. Lỗi khác (thiếu binary, args sai, project chưa index) giữ nguyên hành vi cũ: `isError` và không đụng process nào.

## Ngoài phạm vi

- Không sửa binary `codebase-memory-mcp` trong task này. Bug gốc nằm ở daemon nội bộ giữ lock mà không trả lời rendezvous. Task này chỉ là lớp tự hồi trong Otter. Trước khi thêm flag timeout riêng, chạy `codebase-memory-mcp cli --help` đã. Chưa thấy flag thì đừng bịa.
- Không đổi schema tool, không đổi `src/daemon/tools/codebase.ts` nếu `invokeCbm` đã gánh recovery.
- Không restart daemon Otter như một bước của patch. Process đang chạy vẫn giữ `cbm.ts` cũ cho đến khi Otter được khởi động lại. Sau khi restart, lần gọi kế tiếp tự gỡ daemon đang kẹt nếu stderr vẫn khớp.
- Không kill PID bằng tay trong lúc viết patch, trừ bước kiểm thử bên dưới.

## Kiểm thử

1. Tách hàm parse PID và hàm "command line có phải daemon nội bộ không" để test được không cần spawn thật.
2. stderr khớp regex nhưng command line là process khác: không kill, không retry.
3. stderr khớp, command line đúng `--cbm-daemon-internal`: kill một lần, CLI lần hai được gọi đúng một lần.
4. Hai `invokeCbm` chồng nhau trên cùng một PID: chỉ một lần kill.
5. Trên máy này, sau khi nạp code mới: gọi `codebase_list_projects` với `detail=identity`. Kỳ vọng danh sách project, không còn câu rendezvous. Gọi ngay lần nữa: không log thêm một lần kill. Rồi gọi `codebase_search_graph` với một `name_pattern` nhỏ để xác nhận daemon mới phục vụ tool đồ thị.
