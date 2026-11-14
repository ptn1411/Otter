# Quy trình code chuẩn: vòng lặp liên tục, test pass mới dừng

Ngày: 2026-10-31. Mục tiêu: khi xong một task thì tự làm tiếp task sau,
và chỉ dừng khi mọi test pass — hoặc khi bị blocked và cần người quyết.
Tài liệu này mô tả quy trình, không phải code. Phần lớn máy móc đã có sẵn
trong chatmcp (plan, hàng đợi bền, heartbeat/sweeper, injection outbox,
verify gate); quy trình này quy định cách dùng chúng theo một chuẩn duy nhất.

## 1. Năm nguyên tắc không thương lượng

1. **SQLite là sự thật duy nhất.** Mọi trạng thái task, kết quả test, lần thử
   đều ghi vào DB ngay khi xảy ra. Khởi động lại giữa chừng thì tiếp tục từ
   checkpoint, không làm lại task đã done, không làm mất task đang dở.
2. **Test là trọng tài duy nhất quyết "xong".** Không có "xong tạm", không có
   "để test sau". Task chỉ được đánh done khi test của nó pass.
3. **Xong là làm tiếp, không dừng chờ người.** Xong task này thì lấy ngay task
   tiếp theo đủ điều kiện. Vòng lặp chỉ dừng ở điều kiện dừng ở mục 5.
4. **Thất bại có giới hạn, có bằng chứng.** Mỗi task tối đa 3 vòng sửa. Hết
   3 vòng vẫn fail thì chuyển blocked kèm bằng chứng, không tự ý bỏ task,
   không tự ý sửa tiêu chí nghiệm thu cho dễ pass.
5. **Thay đổi nguy hiểm bị chặn.** Xóa file, ghi ngoài workspace, chạy lệnh
   hệ thống, gọi tool ghi DB khi chưa đủ cờ xác nhận — verify gate từ chối,
   chuyển blocked chờ người duyệt.

## 2. Một task muốn vào hàng đợi phải có đủ

- `title`: làm cái gì, trong một câu.
- `goal`/`details`: phạm vi rõ ràng, và quan trọng nhất: **không lan sang
  task khác**. Làm đúng phạm vi task, không tiện tay sửa thêm chỗ khác.
- **Tiêu chí nghiệm thu (acceptance criteria)**: viết trước khi code, dạng
  kiểm chứng được, ví dụ "gọi tool X với input Y trả về Z", "file A có hàm B".
  Task không có tiêu chí nghiệm thu thì không được đưa vào hàng đợi.
- **Test tương ứng**: mỗi tiêu chí nghiệm thu có ít nhất một check trong
  `scripts/test-*.ts`. Chưa có test thì viết test trước hoặc cùng lúc với code.
- `dependsOn`: danh sách task phải done trước. Task chỉ "ready" khi mọi
  dependsOn đều done.

## 3. Trạng thái của task

```
pending → queued → running → verifying → done
                          ↘ failed (còn vòng sửa) → running
                          ↘ blocked (hết vòng sửa / cần người / nguy hiểm)
```

- `failed` là trạng thái tạm trong vòng sửa, không phải kết thúc.
- `blocked` là trạng thái dừng có lý do, luôn kèm bằng chứng (mục 6).
- `done` là trạng thái cuối, chỉ đạt được qua cổng verify (mục 4, bước G4).

## 4. Pipeline của một task (G0–G6)

- **G0. Chuẩn bị.** Kiểm tra task đủ 5 mục ở mục 2. Thiếu thì trả về cho
  người bổ sung, không tự bịa tiêu chí nghiệm thu.
- **G1. Lấy việc.** `plan_next` chọn task ready có thứ tự sớm nhất, khóa task
  để không có hai worker cùng làm. Không có task ready nhưng còn task
  pending (đang chờ dependsOn) thì vòng lặp chờ, không tự ý làm sai thứ tự.
- **G2. Làm.** Worker implement đúng phạm vi. Dùng tool code đã có để tìm
  hiểu trước khi sửa: `code_search_text`, `code_list_files`,
  `code_find_symbol`, `code_outline`, `code_git_status`; đọc bằng `read_file`,
  sửa bằng `edit_file` (exact-match). Không đoán selector, không hardcode
  bằng chứng chưa kiểm chứng.
- **G3. Test hẹp.** Chạy test của chính task đó. Fail thì sửa rồi chạy lại.
  Tối đa **3 vòng sửa** cho một task. Mỗi vòng ghi log: lần thử, test nào
  fail, output fail, file vừa sửa. Hết 3 vòng vẫn fail → sang mục 6 (blocked).
- **G4. Cổng verify.** Sau khi test hẹp pass, kiểm tra thêm ba thứ trước khi
  đánh done:
  1. Verify gate: không có thay đổi nguy hiểm (mục 1.5). Có thì từ chối.
  2. Build: `bun build --target=bun` pass cho file vừa đổi (và `mcp.ts` nếu
     có đăng ký tool mới).
  3. Regression hẹp: chạy lại các test suite liên quan đến vùng code vừa đổi
     (ví dụ đổi fb-* thì chạy test fb-post + fb-reply + parser).
  Cả ba pass thì mới sang G5. Một cái fail thì quay lại G3, tính là một vòng sửa.
- **G5. Ghi sổ.** Đánh done, ghi vào DB: danh sách test đã pass, số lượng
  pass/fail, file đã đổi. Ghi xong mới được lấy task tiếp theo.
- **G6. Lấy tiếp.** Quay lại G1 ngay lập tức. Không dừng, không báo cáo giữa
  chừng, không chờ người bấm tiếp. Đây chính là "xong là làm tiếp".

## 5. Điều kiện dừng toàn vòng — phải đủ cả ba mới được dừng

Vòng lặp chỉ dừng khi đồng thời:

1. **Không còn task pending/queued/running/failed.** Mọi task đều done hoặc
   blocked (blocked thì dừng theo mục 6, không tính là xong).
2. **Cổng cuối (final gate) pass toàn bộ**, tức là chạy hết các suite hồi quy
   hiện có và tất cả đều pass:
   - `test-plan-phase1`, `test-continuous-loop`, `test-plan-dashboard`
   - `test-fb-post`, `test-fb-reply`, `test-fb-comment-parser`
   - `test-db-tools`, `test-code-tools`
   - (suite mới thêm vào sau này tự động vào danh sách này)
   Một suite fail thì chưa xong: quay lại vòng sửa ở task liên quan, không
   được dừng và báo "xong".
3. **Sync và verify lên `nam`.** Chạy `~/workspace/sync_to_nam.sh` cho mọi
   file đã đổi, đọc dòng OK cho từng file, chạy lại test chính trên `nam`.
   Sync fail hoặc hash lệch thì chưa xong.

Dừng mà thiếu một trong ba điều trên là dừng sai quy trình. Đặc biệt: **không
được dừng ở "xong task cuối" nếu final gate chưa chạy**, và không được dừng
ở "test hẹp pass" nếu regression hẹp hoặc final gate chưa pass.

## 6. Khi bị blocked: dừng đúng cách, không bỏ qua

Vòng lặp chuyển task sang blocked (và dừng phần việc đó) khi gặp một trong:

- Hết 3 vòng sửa mà test vẫn fail.
- Cần quyết định hoặc thông tin chỉ người mới có (token, đăng nhập, URL đích,
  chủ đề, chọn draft hay auto...).
- Verify gate chặn thay đổi nguy hiểm.
- 3 lượt liên tiếp không tiến triển: kết quả test không đổi, không thêm
  thông tin mới.

Khi blocked, phải ghi đủ bằng chứng để người xử lý trong một lần đọc:

- Task nào, đang ở bước nào.
- Test nào fail, output fail nguyên văn (đoạn liên quan).
- File nào vừa đổi, diff tóm tắt.
- Đã thử những gì trong 3 vòng sửa.
- Cần người quyết cái gì, và có những lựa chọn nào.

**Cấm:** tự bỏ task, tự hạ tiêu chí nghiệm thu, tự skip test fail, tự đoán
thông tin người chưa cho. Bỏ qua test chỉ được khi người phê duyệt rõ ràng,
và phải ghi lại phê duyệt đó vào DB.

## 7. Ngân sách và chống kẹt

- Mỗi task: tối đa 3 vòng sửa, mỗi vòng có giới hạn thời gian hợp lý.
- Mỗi plan: ngân sách mặc định 20 lượt / 60 phút (theo plan page-loop),
  có thể siết xuống 10 lượt / 30 phút cho lần chạy đầu tiên.
- Hết ngân sách thì dừng an toàn: ghi checkpoint đầy đủ, báo người số task
  đã done, task đang dở ở bước nào, và cách tiếp tục (resume từ checkpoint).
- Không gửi lệnh khi người dùng đang gõ (chế độ trang web). Không lưu toàn
  bộ hội thoại, chỉ hash + excerpt khi cần đối chiếu.

## 8. Vai trò trong vòng lặp

| Vai trò | Việc | Không làm |
|---|---|---|
| ChatGPT Web (worker) | Quyết nội dung code, sửa theo output test | Không tự đánh done, không tự đổi tiêu chí |
| Daemon | Giữ trạng thái, chọn task tiếp theo, cổng verify, hàng đợi bền | Không tự quyết nội dung code |
| Test suite | Trọng tài duy nhất quyết pass/fail | Không bị sửa cho dễ pass |
| Người | Quyết khi blocked, duyệt thay đổi nguy hiểm | Không cần bấm tiếp từng task |

## 9. Ánh xạ vào tool hiện có

- Quản lý plan: `plan_create`, `plan_add_task`, `plan_list`, `plan_status`,
  `plan_pause`, `plan_resume`, `plan_start`, `plan_cancel`, `plan_next`,
  `plan_resume_prompt`, `plan_task_update`.
- Hiểu code trước khi sửa: `code_search_text`, `code_list_files`,
  `code_find_symbol`, `code_outline`, `code_git_status`, `read_file`.
- Sửa: `edit_file` (exact-match, không sửa mù).
- Chạy tiếp sau gián đoạn: `plan_next` + `plan_resume_prompt` (kèm checkpoint
  trong DB) để worker tiếp tục đúng task dở.
- Kết thúc vòng: `sync_to_nam.sh` + chạy lại test chính trên `nam` + báo cáo.

## 10. Khởi động lại giữa chừng

- Daemon khởi động lại: hàng đợi bền + heartbeat/sweeper khôi phục task
  running quá hạn thành failed để vòng sửa tiếp tục, không mất việc.
- VM thay mới: code và DB test nằm trong repo đã sync lên `nam`; khởi động
  lại daemon, chạy `plan_next` để lấy task dở, không làm lại task done.
- Tunnel/daemon chết (đã gặp ngày 2026-10-31): khôi phục daemon + tunnel
  trước, verify `/activity` 200 rồi mới chạy tiếp vòng lặp.

## 11. Cái còn thiếu để chạy thật trên ChatGPT Web

Quy trình này chạy được ngay ở tầng daemon/MCP khi worker báo xong qua MCP
(tín hiệu hoàn thành đã có). Trên trang ChatGPT Web, để "xong là làm tiếp"
một cách tự động hoàn toàn thì còn thiếu **page-loop driver**: turn watcher
(đợi lượt trả lời ổn định) + turn reader (đọc lượt assistant) để daemon biết
task xong mà không cần worker báo. Phần đó hiện mới có plan
(`docs/plans/2026-10-31-chatgpt-page-loop.md`), chưa code. Khi driver xong,
quy trình này gắn vào driver mà không đổi nguyên tắc: vẫn test pass mới done,
vẫn final gate, vẫn blocked có bằng chứng.

## 12. Checklist vận hành mỗi lần chạy

1. Plan đủ task, mỗi task đủ 5 mục (mục 2). Thiếu thì bổ sung trước.
2. Chạy G1–G6 cho từng task, không dừng giữa chừng.
3. Task fail thì sửa trong 3 vòng, ghi log từng vòng.
4. Hết vòng sửa thì blocked + bằng chứng, không bỏ qua.
5. Hết task thì chạy final gate (mục 5.2). Fail thì quay lại sửa.
6. Final gate pass thì sync `nam` + verify hash + chạy lại test chính.
7. Báo cáo: task done, test pass, file đổi, việc blocked (nếu có).
