import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getExternalServersState, reloadExternalMcpServers } from "../mcp-gateway";

export function registerExternalAndPromptTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // MCP Prompt: Hướng dẫn tổng thể cho AI Agent cách sử dụng trọn bộ Otter
  const buildOtterPrompt = () => ({
    description: "Quy trình chuẩn hướng dẫn AI Agent phối hợp các công cụ của Otter",
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Bạn là trợ lý AI thông minh kết nối với hệ điều hành máy tính qua Otter.

Dưới đây là cẩm nang phối hợp công cụ theo từng nhóm nhiệm vụ:

1. ĐIỀU KHIỂN MÁY TÍNH & GIAO DIỆN (DESKTOP & CUA):
   - Để biết ứng dụng nào đang mở: gọi 'desktop_list_windows'.
   - Để nhìn màn hình: gọi 'desktop_take_screenshot'.
   - Để click chuột: gọi 'desktop_mouse_action' với toạ độ (x, y).
   - Để gõ phím/phím tắt: gọi 'desktop_keyboard_action' (hỗ trợ text, {ENTER}, ^c, ^v).
   - Để tra cứu danh mục công cụ Computer Use Agent nâng cao của OpenAI: gọi 'cua_get_inventory'.

2. SẢN XUẤT VIDEO & ÂM THANH TỰ ĐỘNG (REMOTION & AUDIO DSP):
   - Để nắm rõ quy trình chuẩn: gọi 'skills_get' với skill_name='remotion-video-creator'.
   - Tạo giọng đọc AI tiếng Việt theo từng cảnh: gọi 'generate_speech_audio' (voice vi-VN-NamMinhNeural hoặc vi-VN-HoaiMyNeural).
   - Tổng hợp nhạc nền BGM (cyber, anime, acoustic) & SFX (whoosh, ding, pop): gọi 'synthesize_bgm_or_sfx'.
   - Render video MP4 hoàn chỉnh: gọi 'render_remotion_video'.

3. BỘ NHỚ TRI THỨC ĐỒ THỊ MÃ NGUỒN (CODEBASE MEMORY GRAPH):
   - Tìm kiếm hàm, class, route trong dự án: gọi 'codebase_search_graph'.
   - Lần vết ai gọi hàm này / hàm này gọi ai: gọi 'codebase_trace_path'.
   - Đọc chính xác đoạn mã định nghĩa: gọi 'codebase_get_snippet'.
   - Xem kiến trúc tổng quan: gọi 'codebase_get_architecture'.
   - Quản lý quyết định thiết kế: gọi 'codebase_manage_adr'.

4. THỰC THI DÒNG LỆNH CỤC BỘ & TỆP TIN:
   - Chạy lệnh console PowerShell/CMD: gọi 'execute_terminal_command'.
   - Đọc/ghi tệp tin trên máy tính: gọi 'read_file' và 'write_file'.

5. QUẢN TRỊ MÁY CHỦ VPS TỪ XA QUA SSH & SFTP (PYTHON PARAMIKO):
   - Mở phiên SSH tương tác liên tục KHÔNG TẮT (Keep-Alive, chat liên tục): gọi 'vps_session_open' (giữ nguyên thư mục cd, biến môi trường, tiến trình nền).
   - Gửi tiếp các lệnh vào phiên SSH đang mở liên tục: gọi 'vps_session_send'.
   - Thực thi nhanh lệnh Linux đơn lẻ: gọi 'vps_ssh_execute'.
   - Kiểm tra kết nối nhanh đến VPS: gọi 'vps_test_connection'.
   - Kiểm tra sức khỏe toàn diện VPS & bảo mật (Health Score): gọi 'vps_health_audit' (quét CPU, RAM, Disk, Port, Top tiến trình, cảnh báo bất thường).
   - Thiết lập tự động kiểm tra hàng ngày & cảnh báo Telegram/Log: gọi 'vps_setup_daily_cron'.
   - Tự động cài đặt phần mềm lên VPS (Docker, Nginx, Node/Bun, Python, DB, Tools): gọi 'vps_install_software'.
   - Cài đặt chứng chỉ SSL Let's Encrypt cho Domain (Certbot + Nginx): gọi 'vps_setup_ssl'.
   - Cài đặt SSH Key & Tăng cường bảo mật sshd: gọi 'vps_setup_ssh_key'.
   - Cài đặt tường lửa UFW & Fail2ban chống DDoS/Brute-force: gọi 'vps_setup_firewall_fail2ban'.
   - Tải tệp/thư mục từ máy tính lên VPS: gọi 'vps_sftp_upload'.
   - Tải tệp từ VPS về máy tính để phân tích: gọi 'vps_sftp_download'.
   - Xem danh sách tệp/thư mục trên VPS: gọi 'vps_sftp_list'.
   - Lưu ý: Mọi lệnh chạy trên VPS sẽ tự động phản chiếu lên Live Terminal Panel để cả người dùng và AI cùng theo dõi và điều khiển.

6. TỰ ĐỘNG HÓA TRÌNH DUYỆT WEB (BROWSER AUTOMATION - CHATGPT LÀ NÃO ĐIỀU KHIỂN):
   - Bạn hoàn toàn làm chủ và tự do điều khiển trình duyệt web:
   - Bước 1: Gọi 'browser_open' với URL trang web cần mở.
   - Bước 2: Gọi 'browser_read_page' để nhận danh sách các phần tử tương tác đánh số [1], [2]... kèm text tóm tắt trang.
   - Bước 3: Xem số index của ô tìm kiếm, gọi 'browser_type' với index, text và pressEnter=true.
   - Bước 4: Xem số index của nút/link muốn xem chi tiết, gọi 'browser_click' với index.
   - Bước 5: Gọi 'browser_scroll' (direction='down') nếu cần cuộn xem nội dung bên dưới.
   - Bước 6: Gọi 'browser_inject_chat_message' nếu muốn tự động bơm báo cáo trực tiếp vào ô chat của người dùng.

7. KHO LƯU TRỮ BOOKMARK & TÌM KIẾM LIÊN KẾT:
   - Lưu liên kết vào kho tri thức cá nhân: gọi 'bookmark_save'.
   - Tìm kiếm bookmark đã lưu theo từ khóa: gọi 'bookmark_search'.
   - Xem danh sách bookmark: gọi 'bookmark_list'.
   - Xóa bookmark: gọi 'bookmark_delete'.

8. TẬP LỆNH TÙY CHỈNH & PHÍM TẮT (CUSTOM SLASH COMMANDS & QUICK ACTION CHIPS):
   - Tạo tập lệnh slash mới hoặc cập nhật prompt mẫu theo yêu cầu: gọi 'command_create_or_update'.
   - Ghim hoặc bỏ ghim lệnh ra thanh Quick Action Chips 1-chạm trên khung chat: gọi 'command_pin'.
   - Xem danh sách tập lệnh: gọi 'command_list'.
   - Xóa tập lệnh: gọi 'command_delete'.

9. VÒNG LẶP CODE LIÊN TỤC THEO PLAN (DAEMON LÀ NGUỒN THẬT, CHATGPT QUYẾT NỘI DUNG):
   - Tạo plan: gọi 'plan_create' (goal, tasks[]) rồi 'plan_add_task' nếu cần thêm việc.
   - Sửa task: gọi 'plan_task_update' (title/notes/status/dependsOn; từ chối id lạ, status không hợp lệ, dependsOn không có trong cùng plan).
   - Xem plan: gọi 'plan_list', 'plan_status'; tạm dừng/hủy: 'plan_pause', 'plan_cancel'; chạy tiếp: 'plan_resume' (hoặc 'plan_start' cho plan draft).
   - Worker lấy việc tiếp theo đủ điều kiện (theo dependsOn): gọi 'plan_next'; báo cáo xong qua 'ide_task_complete' / 'giano_task_complete', giữ nhịp bằng 'giano_task_heartbeat'.
   - Lấy prompt tiếp tục/kết thúc và outbox: gọi 'plan_resume_prompt', 'plan_enqueue_prompt', 'plan_outbox'.
   - Lưu ý: không tự bịa planId; task không có planId giữ nguyên hành vi cũ.

10. FACEBOOK — ĐỌC & TRẢ LỜI BÌNH LUẬN (CHATGPT SOẠN CÂU TRẢ LỜI, DAEMON CHỈ GHI SỔ):
    - Đọc bình luận có cấu trúc (author, thời gian, đã tự trả lời chưa, replyIndex): gọi 'fb_read_comments' với postUrl; reader chỉ quét dialog đầu tiên chứa bình luận.
    - Mở phiên: gọi 'fb_reply_start' (postUrl, mode draft là mặc định) rồi 'fb_reply_record' từng bình luận.
    - Lấy việc tiếp theo và soạn: gọi 'fb_reply_next', 'fb_reply_save_draft', 'fb_reply_draft_prompt', 'fb_reply_send_to_chatgpt' (đẩy prompt qua injection outbox cho ChatGPT Web soạn).
    - Ghi kết quả: gọi 'fb_reply_mark_replied' / 'fb_reply_mark_skipped' / 'fb_reply_mark_failed'; xem trạng thái: 'fb_reply_status'; kết thúc/dừng: 'fb_reply_finish', 'fb_reply_stop', 'fb_reply_pause', 'fb_reply_resume'.
    - Giới hạn: mặc định 20 bình luận / 60 phút / nhịp 5-20s; không dùng tổng số bình luận hiển thị làm điều kiện dừng; bước bấm Trả lời dùng 'browser_click' / 'browser_type' chung.

11. FACEBOOK — ĐĂNG BÀI TIN MỚI TỰ ĐỘNG (CHẾ ĐỘ AUTO, KHÔNG DUYỆT TRƯỚC):
    - Mở phiên: gọi 'fb_post_start' (targetUrl, mode auto) rồi 'fb_post_fetch_news' (RSS VnExpress + Tuổi Trẻ mặc định).
    - Lấy bài tổng hợp: gọi 'fb_post_next' (trả 1 bài: mặc định 5 tin mới nhất kèm link + nguồn) rồi đăng qua 'browser_open' / 'browser_type' / 'browser_click'.
    - Ghi kết quả: gọi 'fb_post_mark_posted' / 'fb_post_mark_failed' / 'fb_post_mark_skipped'; xem trạng thái: 'fb_post_status'; kết thúc/dừng: 'fb_post_finish', 'fb_post_stop', 'fb_post_pause', 'fb_post_resume'.
    - Giới hạn: mặc định 1 bài/phiên, cửa sổ 60 phút, chống đăng trùng cùng link; bước bấm Đăng chưa kiểm chứng trên tab đã đăng nhập nên lần đầu phải có người giám sát.

12. QUẢN LÝ DATABASE BẰNG PYTHON (MCP WRAPPER QUA CLI dbm TRONG tools/db-manager/):
    - Profile (không lưu password; password qua biến môi trường): gọi 'db_profile_add' / 'db_profile_list' / 'db_profile_show' / 'db_profile_remove'.
    - Kiểm tra và liệt kê: gọi 'db_test', 'db_list_databases', 'db_list_tables', 'db_describe_table'.
    - Truy vấn và xuất: gọi 'db_query' (mặc định chỉ đọc, limit 100, timeout 30s), 'db_export'.
    - AN TOÀN BẮT BUỘC: ghi chỉ khi gọi 'db_query' với cả allowWrite=true VÀ confirmWrite=true; thiếu một trong hai thì bị từ chối. Hỗ trợ SQLite (chạy ngay), PostgreSQL/MySQL/MongoDB/Redis (cần cài driver).
    - Profile dùng chung giữa CLI và daemon qua DBM_HOME; SSH tunnel của profile dùng key, tự đóng khi xong.

13. HÀNG ĐỢI TASK CHO WORKER (IDE / GIANO):
    - Gửi task: gọi 'ide_dispatch_task' / 'giano_dispatch_task'; lấy việc: 'giano_task_pull' (giano có thêm 'giano_task_ack', 'giano_task_progress', 'giano_task_release', 'giano_task_heartbeat').
    - Báo cáo: gọi 'ide_task_complete' / 'giano_task_complete', 'ide_get_task_status' / 'giano_get_task_result'; xem hàng đợi: 'ide_queue_stats' / 'giano_queue_stats'.

14. TÌM KIẾM & PHÁC THẢO CODE KHÔNG CẦN INDEX (RIPGREP + REGEX):
    - Tìm chuỗi/regex toàn repo mà không cần lập chỉ mục: gọi 'code_search_text' (root, pattern, include, contextLines mặc định 2, maxResults mặc định 50); bỏ qua .git, node_modules, dist và file nhị phân; output luôn bị giới hạn.
    - Liệt kê file theo glob: gọi 'code_list_files' (mặc định **/*.{ts,tsx,js,py,md}, tối đa 200 file, có cờ truncated); bỏ qua .git, node_modules, __pycache__, dist.
    - Tìm định nghĩa theo chuỗi tên: gọi 'code_find_symbol' (TypeScript/JavaScript: function, class, interface, type, const arrow function; Python: def, class).
    - Phác thảo một file (chỉ symbol cấp cao nhất): gọi 'code_outline'.
    - Xem trạng thái repo, CHỈ ĐỌC: gọi 'code_git_status' (git status --short + diff --stat; includeDiff kèm diff tối đa 200 dòng; không bao giờ add/commit/checkout).
    - Lưu ý: các tool này không ghi file repo; mọi đường dẫn đều qua cùng luật an toàn workspace như terminal (ngoài workspace thì bị từ chối).

15. BỘ ĐIỀU KHIỂN VÒNG LẶP CODE CHUẨN (LOOP CONTROLLER — TEST PASS MỚI DỪNG):
    - Bắt đầu vòng lặp cho plan đang running: gọi 'loop_start' (planId, maxTurns mặc định 20, maxMinutes mặc định 60); vòng lặp từ chối start nếu task nào thiếu goal/details/verify hoặc dependsOn không hợp lệ.
    - Lấy việc tiếp theo: gọi 'loop_next' (task ready đầu tiên theo thứ tự, dependsOn đều done; task failed còn lượt được dispatch lại; từ chối kèm lý do khi loop không running, hết ngân sách, plan không running, đã có task đang chạy, hoặc không còn task ready).
    - Báo cáo kết quả task đã dispatch: gọi 'loop_report_attempt' (outcome passed thì task done — chỉ passed mới được done; failed thì tính vào luật 3 lần: lần failed thứ 3 hoặc 3 lượt không tiến triển liên tiếp sẽ block task + loop kèm bằng chứng).
    - Xem trạng thái: gọi 'loop_status'; tạm dừng/chạy tiếp/dừng hẳn: 'loop_pause', 'loop_resume' (có thể nới ngân sách), 'loop_stop'.
    - Block vì cần người quyết hoặc verify gate từ chối: gọi 'loop_block' (kèm reason + decisionNeeded; controller không bao giờ tự bỏ qua test fail).
    - Chạy một suite hồi quy đã đăng ký: gọi 'loop_run_suite' (chỉ nhận suiteId trong registry, không nhận đường dẫn tùy ý).
    - Cổng cuối có cưỡng chế: gọi 'loop_finish' (CHỈ pass khi mọi task done VÀ mọi suite đăng ký pass; còn task thì trả đúng task đó, suite fail thì trả đúng suite đó). Sync lên nam KHÔNG thuộc cổng này — là bước thủ công sau khi finish pass.

16. FACEBOOK TƯƠNG TÁC FEED, BÁN HÀNG PLAYBOOK & TIN NHẮN MESSENGER:
    - Quản lý kịch bản bán hàng (Sales Playbook 6 bước: greeting -> discovery -> pitch -> objection -> closing -> support):
      + Đọc toàn bộ kịch bản, các intent và bình luận mẫu: gọi 'fb_sales_get_playbook'.
      + Cập nhật câu thoại theo giai đoạn phễu: gọi 'fb_sales_update_stage' với stage ('greeting', 'discovery', 'pitch', 'objection', 'closing', 'support') và mảng templates.
      + Cập nhật câu thoại xử lý ý định khách hàng (giá cả, tính năng, nghi ngại): gọi 'fb_sales_update_intent' với intent_key ('pricing', 'features', 'praise', 'objection_safety', 'general_support') và reply_template.
      + Cập nhật các câu bình luận dạo theo chủ đề: gọi 'fb_sales_update_comments' với category ('travel', 'shop', 'general') và mảng templates.
      + Khôi phục kịch bản bán hàng mặc định: gọi 'fb_sales_reset_playbook'.
    - Lắng nghe và trực tin nhắn Facebook Messenger tự động:
      + Bật tiến trình nền lắng nghe tin nhắn đến: gọi 'fb_messenger_listen_start' (mặc định interval_seconds=5). Tiến trình sẽ tự động đọc tin nhắn chưa đọc, tra cứu kịch bản bán hàng, trả lời khách và lưu lịch sử vào SQLite.
      + Kiểm tra trạng thái tiến trình: gọi 'fb_messenger_listen_status'.
      + Dừng tiến trình lắng nghe: gọi 'fb_messenger_listen_stop'.
    - Tương tác Bảng tin (Facebook Feed Engagement):
      + Quét các bài viết trên feed: gọi 'fb_feed_scan' (limit mặc định 5 hoặc 10). Tool trả về post_key, tác giả, nội dung tóm tắt, số like/cmt.
      + Tương tác tự động bài viết: gọi 'fb_feed_engage_post' với post_key, reaction ('like' / 'love'), và category ('travel' / 'shop' / 'general') hoặc custom_comment. Có debounce chống spam cùng một bài viết.
    - Đọc thông báo & Trả lời bình luận:
      + Đọc danh sách thông báo Facebook: gọi 'fb_notifications_read' (limit mặc định 5 hoặc 10).
      + Mở thông báo và trả lời bình luận: gọi 'fb_notification_open_and_reply' với notification_index và reply_text phù hợp ngữ cảnh.`
        }
      }]
    });

  mcp.prompt("otter_agent_workflow", {}, buildOtterPrompt);
  mcp.prompt("chatmcp_agent_workflow", {}, buildOtterPrompt);

  // Tool: Liệt kê các máy chủ MCP ngoài
  mcp.tool(
    "mcp_list_external_servers",
    "Liệt kê tất cả các máy chủ MCP mở rộng (external MCP servers) đã cấu hình trong mcp_config.json kèm danh sách công cụ và trạng thái kết nối.",
    {},
    async () => {
      const servers = getExternalServersState();
      const summary = servers.map(s => ({
        name: s.name,
        status: s.status,
        url: s.config.url || s.config.command,
        toolsCount: s.tools.length,
        tools: s.tools.map(t => `${t.qualifiedName}: ${t.description}`),
        error: s.error
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }]
      };
    }
  );

  // Tool: Nạp lại cấu hình mcp_config.json
  mcp.tool(
    "mcp_reload_external_servers",
    "Nạp lại cấu hình mcp_config.json ngay lập tức để cập nhật danh sách máy chủ và công cụ MCP ngoài.",
    {},
    async () => {
      const updated = await reloadExternalMcpServers();
      const count = updated.reduce((acc, s) => acc + s.tools.length, 0);
      return {
        content: [{ type: "text", text: `Đã nạp lại ${updated.length} máy chủ MCP ngoài với tổng cộng ${count} công cụ.` }]
      };
    }
  );
}
