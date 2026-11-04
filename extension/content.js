function le(){let e=new WeakSet;function t(c){return(c||"").replace(/\s+/g," ").trim().toLowerCase()}function o(c){let d=(c.textContent||"").replace(/\s+/g," ").trim(),r=/(?:cho phép|yêu cầu sử dụng) chatgpt sử dụng\s+([a-zA-Z0-9_\-\.]+)/i.exec(d);if(r?.[1])return r[1].trim();let u=/(?:allow|permission for) chatgpt to use\s+([a-zA-Z0-9_\-\.]+)/i.exec(d);if(u?.[1])return u[1].trim();let g=/(?:allow|cho phép)\s+([a-zA-Z0-9_\-\.]+)\?/i.exec(d);if(g?.[1])return g[1].trim();return null}function n(c){let d=document.querySelectorAll('[role^="menuitem"], [role="option"], [data-radix-collection-item], button'),r=t(c);for(let u of d){if(!u.isConnected||u.offsetParent===null)continue;let g=t(u.getAttribute("aria-label")||u.textContent);if(g.includes("allow "+r+" for this conversation")||g.includes("cho phép "+r+" cho cuộc trò chuyện này")||g.includes("cho phép "+r+" trong cuộc trò chuyện này")||g.includes("cho phép "+r+" cho cuộc hội thoại này")||g.includes("always allow")||g.includes("luôn cho phép")||g.includes(r)&&(g.includes("for this conversation")||g.includes("cho cuộc trò chuyện này")))return u}return null}async function i(c){if(e.has(c))return;let d=(c.textContent||"").replace(/\s+/g," ").trim(),r=o(c);if(!(!!r||/(?:cho phép|allow|always allow|luôn cho phép|nói chuyện với|talk to|otter\.gpt\.io\.vn)/i.test(d)))return;e.add(c),console.log(`[Otter Auto-Approval] Detected tool/action confirmation: "${r||d.slice(0,50)}"`);let g=c.querySelector('button[aria-haspopup="menu"], button[data-state]');if(g&&r){g.click(),await new Promise((y)=>setTimeout(y,120));let _=n(r);if(_){_.click(),console.log(`[Otter Auto-Approval] ✅ Auto-approved "${r}" for this conversation.`);return}}let h=Array.from(c.querySelectorAll("button"));for(let _ of h){let y=t(_.textContent);if(y.includes("always allow")||y.includes("luôn cho phép")){_.click(),console.log('[Otter Auto-Approval] ✅ Clicked "Always allow" button to prevent future interruptions.');return}}for(let _ of h){let y=t(_.textContent);if(y==="cho phép"||y==="allow"||y.includes("cho phép lần này")||y.includes("allow this time")){_.click(),console.log("[Otter Auto-Approval] ✅ Clicked allow button directly.");return}}}function a(){let c=document.querySelectorAll('[role="alert"], [role="dialog"], [role="alertdialog"], [data-radix-dialog-content], [data-state="open"]');for(let d of c)i(d)}let l=null;new MutationObserver(()=>{if(l)return;l=setTimeout(()=>{l=null,a()},150)}).observe(document.body,{childList:!0,subtree:!0}),a(),console.log("[Otter Auto-Approval] Active & listening for tool permission modals")}var W={vi:{activating:"Đang xác thực...",activating_request:"Đang gửi yêu cầu kích hoạt bản quyền tới máy chủ...",activity_connected:"Đã kết nối",activity_connecting:"Đang kết nối...",activity_continuous:"Tương tác liên tục (Continuous)",activity_empty:"Chưa có sự kiện nào trong cuộc trò chuyện này.",activity_mcp_config:"\uD83D\uDD0C Cấu hình MCP Servers",activity_offline:"Ngoại tuyến",activity_open_term:"\uD83D\uDCBB Mở Live Terminal PTY",activity_title:"Otter Active",app_description:"Bộ điều khiển trình duyệt Agentic AI và bộ công cụ tự động hóa cho ChatGPT Web (nén DOM, Live Terminal, Automation HUD)",app_name:"Otter — Agentic AI Browser Controller",btn_activate_key:"⚡ Kích hoạt bản quyền ngay",btn_copied:"✓ Đã sao chép!",btn_copied_short:"✓ Đã chép",btn_copy:"Sao chép",btn_google_signin_claim:"Đăng nhập Google Nhận 30 Ngày & Bật Thông Báo",btn_open_chatgpt:"\uD83D\uDE80 Mở ChatGPT Web",btn_open_docs:"\uD83C\uDF10 Xem tài liệu & Video hướng dẫn",btn_recheck:"\uD83D\uDD04 Kiểm tra kết nối",btn_refresh_status:"\uD83D\uDD04 Làm mới bản quyền",btn_test_noti:"\uD83D\uDD14 Bật & Thử nghiệm thông báo",cat_bookmarks:"Kho Bookmark Cá Nhân",cat_browser:"Trình duyệt Web",cat_cbm:"Codebase Memory",cat_desktop:"Desktop & CUA",cat_facebook:"Facebook & Bán Hàng",cat_media:"Video & Âm thanh",cat_terminal:"Dòng lệnh & Terminal",cat_vps:"Quản trị VPS SSH",checking_daemon:"Đang kiểm tra kết nối tới http://127.0.0.1:1993...",cmd_add_command:"+ Thêm lệnh",cmd_autocomplete_header:"⚡ Otter Commands (gõ /...)",cmd_autocomplete_nav:"↵ chọn • ↑↓ duyệt",cmd_badge_custom:"Cá nhân",cmd_close:"Đóng",cmd_confirm_delete:"Bạn có chắc muốn xóa tập lệnh này?",cmd_create_title:"✨ TẠO TẬP LỆNH SLASH MỚI:",cmd_del_btn:"Xóa",cmd_delete_confirm:"Bạn có chắc muốn xóa tập lệnh {slash}?",cmd_delete_tooltip:"Xóa tập lệnh này",cmd_empty:"Chưa có tập lệnh tùy chỉnh nào. Bạn có thể yêu cầu AI tạo trong ô chat hoặc thêm ngay bằng form trên.",cmd_error_fields:"Vui lòng nhập đầy đủ Lệnh slash, Tiêu đề và Prompt mẫu.",cmd_hint_esc:"Nhấn Esc để đóng",cmd_hint_tip:"\uD83D\uDCA1 Mẹo: Bấm ⭐ Ghim để đưa lệnh ra thanh Quick Action Chips 1-chạm",cmd_insert_cmd:"Chèn lệnh →",cmd_missing_fields:"Vui lòng nhập đầy đủ Lệnh tắt, Tiêu đề và Prompt mẫu.",cmd_modal_title:"Danh Mục Lệnh Otter MCP",cmd_my_category:"Tập lệnh của tôi",cmd_no_match:"Không tìm thấy lệnh nào phù hợp với từ khóa",cmd_pin_btn:"⭐ Ghim",cmd_pin_btn_pinned:"⭐ Đã ghim",cmd_pin_btn_unpinned:"☆ Ghim",cmd_pin_checkbox:"Ghim ra thanh phím tắt nhanh (⭐ Quick Action Chips)",cmd_pin_tooltip_pinned:"Bỏ ghim khỏi thanh phím tắt",cmd_pin_tooltip_unpinned:"Ghim ra thanh phím tắt (Quick Action Chips)",cmd_pinned_badge:"⭐ Đã ghim",cmd_pinned_category:"⭐ CÁC LỆNH ĐÃ GHIM (QUICK ACTION CHIPS)",cmd_placeholder_prompt:"Nội dung prompt mẫu sẽ tự động điền vào ô chat...",cmd_placeholder_slash:"/lenh-tat",cmd_placeholder_title:"Tiêu đề lệnh (ví dụ: Audit RAM VPS)",cmd_quick_chips_label:"⚡ LỆNH NHANH:",cmd_save_command:"Lưu tập lệnh",cmd_saving:"Đang lưu...",cmd_search_placeholder:"\uD83D\uDD0D Tìm nhanh câu lệnh (hoặc gõ /browse, /test, /vps...)...",cmd_unpin_btn:"Bỏ ghim",commands_add_btn:"+ Thêm lệnh",commands_desc:"Bạn có thể yêu cầu AI tự tạo lệnh mới trong cuộc trò chuyện, hoặc tự thêm bằng tay bên dưới. Bấm ⭐ để ghim lệnh ra thanh phím tắt nhanh 1-chạm:",commands_title:"Tập lệnh của tôi & Lệnh nhanh (Custom Slash Commands):",community_desc:"Tham gia giao lưu, hỏi đáp và nhận hỗ trợ kỹ thuật tại",community_link:"Nhóm Facebook Hỗ trợ Otter",community_title:"Cộng đồng Facebook & Hỗ trợ kỹ thuật:",confirm_restore_all:"Bạn có chắc muốn khôi phục toàn bộ kịch bản bán hàng và bình luận về mặc định ban đầu của Otter?",connect_auth_success:"✅ Kết nối & xác thực thành công! Cài đặt đã được lưu.",connect_failed:"❌ Không thể kết nối tới server (HTTP lỗi hoặc sai token): {message}",daemon_offline:"\uD83D\uDD34 Chưa phát hiện Otter Daemon. Vui lòng chạy lệnh ở Bước 1 bên dưới để khởi động.",daemon_online:"\uD83D\uDFE2 Otter Daemon đang hoạt động tốt trên máy tính này (Port 1993).",desc:"Otter kết nối ChatGPT với máy tính của bạn để duyệt web thông minh, chạy lệnh terminal và tự động hóa tác vụ. Tiện ích chỉ truyền lệnh thao tác, tuyệt đối không lưu trữ dữ liệu cá nhân.",error_connect:"Lỗi kết nối: {message}",error_prefix:"Lỗi: {message}",error_restore:"Lỗi khôi phục: {message}",error_save_comment:"Lỗi khi lưu bình luận: {message}",error_save_intent:"Lỗi khi lưu ý định: {message}",error_save_phase:"Lỗi khi lưu giai đoạn: {message}",export_doc_title:"Cuộc trò chuyện Otter",export_exported_at:"Thời gian xuất",export_success:"Đã xuất cuộc trò chuyện ra Markdown thành công!",export_total_turns:"Tổng số lượt chat",gift_desc:"Đăng nhập tài khoản Google trên hệ thống máy chủ Otter để nhận mã kích hoạt 30 ngày dùng thử PRO hoàn toàn miễn phí, kèm tính năng nhận thông báo Web Push trực tiếp trên trình duyệt khi tác vụ hoàn thành.",gift_title:"Đăng nhập Google nhận ngay 30 ngày dùng thử PRO",guide_daemon_status_title:"Trạng thái Otter Daemon trên máy tính:",guide_step1_desc:"Mở Terminal/PowerShell trên máy tính của bạn và dán một dòng lệnh dưới đây để tự động kéo binary, cài đặt và chạy ngầm cùng Windows/macOS/Linux:",guide_step1_title:"Bước 1: Khởi động Otter Daemon (Chỉ 1 dòng lệnh)",guide_step2_desc:"Tiện ích Otter tự động kết nối tới máy chủ nội bộ http://127.0.0.1:1993. Nếu bạn muốn điều khiển máy tính này từ xa khi đang ở ngoài đường, hãy dùng đường link Cloudflare TryCloudflare Tunnel được tạo tự động trong quá trình cài đặt.",guide_step2_title:"Bước 2: Kết nối Tiện ích Chrome với máy tính",guide_step3_desc:"Truy cập https://chatgpt.com. Thanh công cụ thông minh của Otter sẽ tự động xuất hiện ở góc trên bên phải khung chat, giúp AI có thể duyệt web, bấm chuột, gõ phím, chạy terminal và tạo video.",guide_step3_title:"Bước 3: Mở ChatGPT và trải nghiệm",lic_activate_desc:"Nếu bạn đã có mã bản quyền (nhận qua email sau khi đăng nhập Google hoặc mua gói PRO), hãy nhập vào đây để kích hoạt cho máy tính này:",lic_activate_success:"Kích hoạt bản quyền thành công!",lic_activate_title:"Kích Hoạt Bản Quyền Bằng Mã Key",lic_active:"\uD83D\uDFE2 Đang hoạt động (Hợp lệ)",lic_card_title:"Gói Dịch Vụ & Bản Quyền Hiện Tại",lic_customer_default:"Khách hàng Otter",lic_customer_label:"Khách hàng / Email:",lic_daemon_unreachable:"Không thể kết nối daemon ({message})",lic_email_label:"Email đã đăng ký:",lic_expired:"\uD83D\uDD34 Đã hết hạn",lic_expires_label:"Thời hạn bản quyền:",lic_key_label:"Mã License Key (ví dụ: OTTER-PRO-... hoặc mã offline):",lic_lifetime:"Vĩnh viễn (Lifetime)",lic_not_linked:"Chưa liên kết",lic_status_label:"Trạng thái giấy phép:",lic_support_code_label:"Mã thiết bị (Support Code):",lic_unlicensed:"\uD83D\uDFE1 Chưa kích hoạt bản quyền",listener_none:"Chưa có",listener_paused:"\uD83D\uDD34 Đang tạm dừng",listener_running:"\uD83D\uDFE2 Đang chạy (chu kỳ 5s)",load_cmd_failed:"Không thể tải danh sách tập lệnh: {message}",load_mcp_failed:"Không thể tải danh sách MCP: {message}",manage_blocked_reason:"lý do: {reason}",manage_browser_open_failed:"❌ Không mở được trình duyệt: {message}",manage_browser_opened:"✅ Đã gọi mở trình duyệt {path} (pid {pid}). Đợi cửa sổ trình duyệt hiện ra rồi làm việc trong đó.",manage_confirm_cancel:"Bạn có chắc muốn hủy plan này?",manage_current_task:"Task đang chạy:",manage_desc:"Dùng máy chủ đang chọn ở tab “Kết Nối & Máy Chủ MCP”. Trang tự làm mới khi tab này đang mở.",manage_doctor_fail:"có mục fail",manage_empty_plans:"Chưa có plan nào. Tạo plan bằng MCP tool plan_create rồi quay lại đây.",manage_empty_skills:"Chưa có skill nào.",manage_enter_browser:"❌ Nhập đường dẫn tới file trình duyệt (trên máy chạy daemon).",manage_enter_fleet:"❌ Nhập đủ Node ID, Goal và ít nhất 1 task.",manage_enter_goal:"❌ Nhập mục tiêu.",manage_exported:"✅ Đã export {count} server. Giữ file như giữ mật khẩu (có token).",manage_fleet_copied:"✓ Đã copy lệnh fleet_dispatch — dán vào tab ChatGPT của hub để chạy.",manage_fleet_failed:"Không tải được fleet ({message}). Daemon này có phải hub không, và đã chọn đúng daemon ở tab Kết Nối chưa?",manage_imported:"✅ Import xong: {imported} mới, {skipped} bỏ qua (trùng/không hợp lệ). Chọn server mới ở tab Kết Nối để dùng.",manage_links_title:"Mở nhanh",manage_loading:"Đang tải...",manage_next_task:"Task tiếp theo:",manage_no_daemon:"Không kết nối được daemon.",manage_no_outbox:"Không có prompt kẹt trong outbox.",manage_no_page_loops:"Chưa có phiên page-loop nào. Start một phiên ở form dưới.",manage_no_profiles:"Chưa thấy profile Chrome nào trên máy chạy daemon ({dir}). Mở Chrome bằng tay một lần để tạo profile Default.",manage_no_workers:"Chưa có worker nào đăng ký. Đăng ký bằng MCP tool fleet_register từ tab ChatGPT của hub, hoặc POST /api/fleet/nodes với token.",manage_open_profile_btn:"\uD83D\uDE80 Mở profile này",manage_outbox_attempts:"(thử {count} lần)",manage_page_loop_failed:"Không tải được page-loop ({message}).",manage_page_loop_turns:"lượt {turn}/{max} · epoch {epoch}",manage_page_started:"✅ Đã start phiên {id}.",manage_page_stopped:"✅ Đã dừng phiên.",manage_plans_title:"Plans code liên tục",manage_profile_failed:"Không tải được profile Chrome ({message}). Máy chạy daemon có Chrome và màn hình không?",manage_profile_open_failed:"❌ Không mở được profile {directory}: {message}",manage_profile_opened:"✅ Đã gọi mở Chrome profile {directory} (pid {pid}). Đợi cửa sổ Chrome hiện ra rồi làm việc trong đó.",manage_refresh_btn:"\uD83D\uDD04 Làm mới",manage_resume_btn:"▶️ Tiếp tục",manage_resume_copied:"✓ Đã copy resume prompt!",manage_resume_prompt:"✅ Resume prompt (zero-risk: copy gửi tay): {prompt}",manage_resumed:"✅ Đã resume phiên.",manage_server_add_btn:"+ Thêm máy chủ",manage_server_added:"✅ Đã thêm máy chủ. Chọn máy chủ mới ở tab Kết Nối để dùng.",manage_server_invalid:"Vui lòng nhập tên và URL máy chủ hợp lệ.",manage_server_title:"Thêm máy chủ mới",manage_skills_title:"Skills đã cài",manage_stop_btn:"\uD83D\uDED1 Dừng",manage_title:"Quản lý tổng — Plans, Queue, Skills & Extension",manage_tool_code_desc:"Tìm kiếm, liệt kê, symbol, outline, git status — không cần index.",manage_tool_code_name:"Không gian code",manage_tool_db_desc:"Mặc định chỉ đọc; ghi cần cả allowWrite và confirmWrite.",manage_tool_db_name:"Quản lý Database (Python)",manage_tool_fb_post_desc:"Chế độ auto, 1 bài/phiên từ RSS.",manage_tool_fb_post_name:"Facebook · Đăng bài tin mới",manage_tool_fb_reply_desc:"ChatGPT soạn, daemon ghi sổ; mặc định draft.",manage_tool_fb_reply_name:"Facebook · Trả lời bình luận",manage_tool_ide_desc:"Gửi và nhận task cho worker.",manage_tool_ide_name:"Hàng đợi task IDE/Giano",manage_tool_loop_desc:"Vòng lặp code chuẩn: test pass mới done, 3 lần fail thì block, cổng cuối bắt buộc.",manage_tool_loop_name:"Bộ điều khiển vòng lặp",manage_tool_plans_desc:"Vòng lặp code theo plan, daemon là nguồn thật.",manage_tool_plans_name:"Plans code liên tục",manage_tools_desc:"Các tool MCP do daemon đăng ký (xem MCP_INSTRUCTIONS.md mục 4). Agent gọi qua MCP, không cần cấu hình thêm ở extension.",manage_tools_title:"Nhóm công cụ MCP",manage_zero_risk_copy:"✅ Zero-risk: copy prompt này gửi tay: {prompt}",mcp_none:"Chưa cấu hình server nào trong <code>mcp_config.json</code>.",note_local_desc:"Toàn bộ cài đặt, tên trợ lý và thư mục làm việc được bảo mật trực tiếp trên chính chiếc máy tính này, không đồng bộ ra bên ngoài.",note_local_title:"Lưu trữ trên máy:",note_switch_desc:"Nếu muốn điều khiển một máy tính khác, bạn chỉ cần bấm vào tên máy tính ở góc bảng điều khiển để chọn. Mỗi tab trình duyệt có thể chọn điều khiển một máy riêng biệt.",note_switch_title:"Chuyển đổi thiết bị:",noti_desc:"Otter sẽ gửi thông báo trực tiếp lên góc màn hình máy tính của bạn khi: AI hoàn thành một tác vụ phức tạp, bản quyền sắp hết hạn, hoặc nhận được tin nhắn thông báo quan trọng.",noti_enabled:"✅ Đã bật thông báo trên trình duyệt thành công!",noti_title:"Thông Báo Trình Duyệt Desktop",open_dashboard_link:"Mở Bảng theo dõi hoạt động trực tiếp (Port 1993)",panel_add_server:"➕ Thêm máy chủ MCP mới:",panel_added_success:"✅ Đã thêm '{name}' thành công!",panel_confirm_delete_server:"Bạn có chắc muốn xóa máy chủ '{name}' khỏi mcp_config.json?",panel_connecting:"Đang kết nối...",panel_daemon_unreachable:"Không kết nối được Otter daemon ({base}).",panel_enter_name_url:"Vui lòng nhập tên và URL!",panel_error_prefix:"Lỗi: {message}",panel_mcp_header:"Máy Chủ MCP (mcp_config.json)",panel_no_servers:"Chưa cấu hình MCP Server ngoài nào.",panel_node_label:"Node (daemon cho tab này)",panel_offline:"offline",panel_refresh:"\uD83D\uDD04 Làm mới",panel_save_connect:"+ Lưu & Kết nối",panel_server_name_placeholder:"Tên server (vd: gpmlogin)",panel_server_url_placeholder:"URL (vd: http://127.0.0.1:9495/mcp)",panel_token_placeholder:"Bearer token (tùy chọn)",picker_commands_btn:"\uD83D\uDCA1 Lệnh mẫu",picker_commands_title:"Mở danh mục câu lệnh mẫu chuẩn của Otter MCP (hoặc gõ / trong ô chat)",picker_error_file:"❌ Lỗi chọn file",picker_error_folder:"❌ Lỗi chọn thư mục",picker_file_btn:"\uD83D\uDCC4 Chọn file",picker_file_prefix:"File: ",picker_file_title:"Mở cửa sổ chọn file máy tính gốc",picker_files_count:"files",picker_files_prefix:"Files: ",picker_folder_btn:"\uD83D\uDCC1 Chọn thư mục dự án",picker_folder_prefix:"Thư mục: ",picker_folder_title:"Mở cửa sổ chọn thư mục máy tính gốc",picker_opening_file:"⏳ Đang mở chọn file...",picker_opening_folder:"⏳ Đang mở chọn thư mục...",plan_cancel:"Hủy bỏ",plan_continue:"Tiếp tục",plan_title:"\uD83D\uDCA1 Otter Agent Plan",plugin_label:"Tên trợ lý AI trên ChatGPT",plugin_placeholder:"Ví dụ: Otter Assistant",plugin_save_btn:"Lưu tên trợ lý",restore_success:"✅ Đã khôi phục kịch bản về mặc định thành công!",save_btn:"Kiểm tra kết nối và lưu",save_comment_btn:"\uD83D\uDCBE Lưu bình luận",save_comment_success:"Đã lưu kịch bản bình luận thành công!",save_error:"❌ Lỗi",save_intent_btn:"\uD83D\uDCBE Lưu ý định",save_intent_success:"Đã lưu ý định thành công!",save_phase_btn:"\uD83D\uDCBE Lưu bước này",save_phase_success:"Đã lưu giai đoạn thành công!",saved:"✓ Đã lưu",saving:"⏳ Đang lưu...",server_label:"Máy tính nhận lệnh điều khiển",sidepanel_checking:"Đang kiểm tra...",sidepanel_logs_title:"Daemon Status",sidepanel_offline:"Kết nối: Ngoại tuyến",sidepanel_online:"Kết nối: Sẵn sàng",sidepanel_open_activity:"Mở Daemon Activity",sidepanel_open_chatgpt:"Mở tab ChatGPT",sidepanel_open_options:"Mở Management Center",sidepanel_open_plan_dashboard:"Mở Plan Dashboard",sidepanel_refresh_status:"Kiểm tra lại trạng thái",sidepanel_scheduler_desc:"Lịch FB được quản lý trong Management Center (Options) và qua MCP tools — Side Panel bản này chưa liệt kê lịch trực tiếp vì chưa có HTTP route cho lịch FB. Bấm nút dưới để mở Management Center.",sidepanel_scheduler_title:"Lịch Hẹn Giờ Đăng Bài Nhóm",sidepanel_suite:"Otter Suite",sidepanel_tab_logs:"Nhật ký",sidepanel_tab_scheduler:"Lịch FB",sidepanel_tab_terminal:"Terminal",sidepanel_terminal_desc:"Terminal PTY thật vẫn chạy trong trang ChatGPT (TerminalPanel). Side Panel bản này không giả lập xterm — bấm nút dưới để mở tab ChatGPT và dùng Live Terminal trong trang.",sidepanel_terminal_title:"Live Terminal",sub_title:"Trợ lý AI Otter / Bảng điều khiển & Cài đặt",tab_commands:"⚡ Tập Lệnh Nhanh",tab_fb_sales:"\uD83D\uDCAC Kịch Bản Bán Hàng & FB",tab_guide:"\uD83D\uDCD6 Hướng Dẫn Cấu Hình",tab_license:"\uD83D\uDC8E Gói Đang Dùng & Bản Quyền",tab_manage:"\uD83C\uDF9B️ Quản Lý Tổng",tab_manual:"\uD83D\uDCDA Cẩm Nang Lệnh Chi Tiết",tab_settings:"\uD83D\uDD0C Kết Nối & Máy Chủ MCP",term_clear:"Xóa màn hình",term_connected:`[Otter Terminal Connected]
Ready to receive commands.
`,term_copied:"Đã chép!",term_copy:"Sao chép",term_placeholder:"Nhập lệnh hoặc phím và nhấn Enter...",term_title:"Otter Live Terminal (PTY)",title:"\uD83E\uDDA6 Otter Assistant",token_label:"Mã khóa xác thực bảo mật (API Key / Token)",token_placeholder:"Bắt buộc khi kết nối qua Cloudflare Tunnel / Internet (Bỏ trống nếu chạy local)",tpl_cancel:"Hủy",tpl_default_label:"Mặc định",tpl_insert:"Chèn vào Chat",tpl_modal_title:"Điền tham số",tpl_placeholder:"Nhập {name}...",tunnel_ready:"Sẵn sàng kết nối từ xa",update_close:"Đóng",update_current_version:"Phiên bản hiện tại: v{version}",update_default_changelog:"Bản cập nhật mới với nhiều tính năng và cải thiện hiệu năng.",update_download:"Tải Bản Mới (.zip)",update_snooze:"Nhắc lại sau",update_title:"Otter Có Bản Cập Nhật"},en:{activating:"Authenticating...",activating_request:"Sending license activation request to server...",activity_connected:"Connected",activity_connecting:"Connecting...",activity_continuous:"Continuous Mode",activity_empty:"No events recorded in this conversation yet.",activity_mcp_config:"\uD83D\uDD0C External MCP Servers",activity_offline:"Offline",activity_open_term:"\uD83D\uDCBB Open Live Terminal PTY",activity_title:"Otter Active",app_description:"Agentic AI Browser Controller & Desktop Automation Suite for ChatGPT Web (Page Agent DOM Compression, Live Terminal, Automation HUD)",app_name:"Otter — Agentic AI Browser Controller",btn_activate_key:"⚡ Activate License Now",btn_copied:"✓ Copied!",btn_copied_short:"✓ Copied",btn_copy:"Copy",btn_google_signin_claim:"Sign in with Google for 30-Day Trial & Push Notifications",btn_open_chatgpt:"\uD83D\uDE80 Open ChatGPT Web",btn_open_docs:"\uD83C\uDF10 Documentation & Video Guide",btn_recheck:"\uD83D\uDD04 Recheck Connection",btn_refresh_status:"\uD83D\uDD04 Refresh License",btn_test_noti:"\uD83D\uDD14 Enable & Test Notifications",cat_bookmarks:"Personal Bookmarks",cat_browser:"Web Browser Automation",cat_cbm:"Codebase Memory Graph",cat_desktop:"Desktop & CUA",cat_facebook:"Facebook & Sales",cat_media:"Video & Audio Synthesis",cat_terminal:"Terminal & Shell PTY",cat_vps:"Remote VPS SSH Management",checking_daemon:"Checking connection to http://127.0.0.1:1993...",cmd_add_command:"+ Add Command",cmd_autocomplete_header:"⚡ Otter Commands (type /...)",cmd_autocomplete_nav:"↵ select • ↑↓ navigate",cmd_badge_custom:"Custom",cmd_close:"Close",cmd_confirm_delete:"Are you sure you want to delete this command?",cmd_create_title:"✨ CREATE NEW SLASH COMMAND:",cmd_del_btn:"Delete",cmd_delete_confirm:"Are you sure you want to delete command {slash}?",cmd_delete_tooltip:"Delete this command",cmd_empty:"No custom commands yet. You can ask AI to create them in chat or add manually above.",cmd_error_fields:"Please fill in Slash Command, Title, and Template Prompt.",cmd_hint_esc:"Press Esc to close",cmd_hint_tip:"\uD83D\uDCA1 Tip: Click ⭐ Pin to add command to 1-click Quick Action Chips",cmd_insert_cmd:"Insert Command →",cmd_missing_fields:"Please fill in Slash Command, Title and Prompt template.",cmd_modal_title:"Otter MCP Command Palette",cmd_my_category:"My Custom Commands",cmd_no_match:"No commands matched keyword",cmd_pin_btn:"⭐ Pin",cmd_pin_btn_pinned:"⭐ Pinned",cmd_pin_btn_unpinned:"☆ Pin",cmd_pin_checkbox:"Pin to 1-click Quick Action Chips (⭐)",cmd_pin_tooltip_pinned:"Unpin from quick action bar",cmd_pin_tooltip_unpinned:"Pin to 1-click Quick Action Chips",cmd_pinned_badge:"⭐ Pinned",cmd_pinned_category:"⭐ PINNED COMMANDS (QUICK ACTION CHIPS)",cmd_placeholder_prompt:"Template prompt to be auto-inserted into chat...",cmd_placeholder_slash:"/custom-cmd",cmd_placeholder_title:"Command title (e.g. Audit VPS RAM)",cmd_quick_chips_label:"⚡ QUICK ACTIONS:",cmd_save_command:"Save Command",cmd_saving:"Saving...",cmd_search_placeholder:"\uD83D\uDD0D Quick search commands (or type /browse, /test, /vps...)...",cmd_unpin_btn:"Unpin",commands_add_btn:"+ Add Command",commands_desc:"You can ask AI to create new slash commands during conversations, or add them manually below. Click ⭐ to pin commands to the 1-click Quick Action Chips bar:",commands_title:"My Custom Commands & Quick Action Chips:",community_desc:"Join community discussions, Q&A, and technical support at",community_link:"Otter Facebook Support Group",community_title:"Facebook Community & Tech Support:",confirm_restore_all:"Are you sure you want to restore all sales and comment scripts to Otter defaults?",connect_auth_success:"✅ Connected & authenticated successfully! Settings saved.",connect_failed:"❌ Cannot connect to server (HTTP error or wrong token): {message}",daemon_offline:"\uD83D\uDD34 Otter Daemon not detected. Please run the 1-line command in Step 1 below to start.",daemon_online:"\uD83D\uDFE2 Otter Daemon is running smoothly on this computer (Port 1993).",desc:"Otter connects ChatGPT to your local computer for web browsing, terminal execution, and automation tasks. Only instructions are sent; private conversations are never stored.",error_connect:"Connection error: {message}",error_prefix:"Error: {message}",error_restore:"Restore error: {message}",error_save_comment:"Error saving comment: {message}",error_save_intent:"Error saving intent: {message}",error_save_phase:"Error saving phase: {message}",export_doc_title:"Otter Conversation",export_exported_at:"Exported at",export_success:"Conversation exported to Markdown successfully!",export_total_turns:"Total turns",gift_desc:"Sign in with Google on Otter's official website to receive a free 30-day PRO activation key and enable Web Push notifications directly in your browser upon task completion.",gift_title:"Sign in with Google to get 30-Day PRO Trial",guide_daemon_status_title:"Otter Daemon Status on Computer:",guide_step1_desc:"Open Terminal/PowerShell on your machine and paste the command below to auto-download, install, and run as background daemon on Windows/macOS/Linux:",guide_step1_title:"Step 1: Start Otter Daemon (1-Line Command)",guide_step2_desc:"Otter Extension automatically connects to local daemon http://127.0.0.1:1993. If you want remote control over the Internet, use the TryCloudflare Tunnel link generated automatically.",guide_step2_title:"Step 2: Connect Chrome Extension",guide_step3_desc:"Visit https://chatgpt.com. Otter's smart toolbar will appear at the top-right of the chat box, enabling AI to browse the web, click, type, run terminal, and create videos.",guide_step3_title:"Step 3: Open ChatGPT & Start Automating",lic_activate_desc:"If you already have a license key (received via email after Google Sign-in or purchasing PRO), enter it below to activate for this machine:",lic_activate_success:"License activated successfully!",lic_activate_title:"Activate License Key",lic_active:"\uD83D\uDFE2 Active (Valid)",lic_card_title:"Current Subscription & License",lic_customer_default:"Otter Customer",lic_customer_label:"Customer / Email:",lic_daemon_unreachable:"Cannot connect to daemon ({message})",lic_email_label:"Registered Email:",lic_expired:"\uD83D\uDD34 Expired",lic_expires_label:"Expiration Date:",lic_key_label:"License Key (e.g., OTTER-PRO-... or offline key):",lic_lifetime:"Lifetime",lic_not_linked:"Not linked",lic_status_label:"License Status:",lic_support_code_label:"Device Support Code:",lic_unlicensed:"\uD83D\uDFE1 Unlicensed",listener_none:"None",listener_paused:"\uD83D\uDD34 Paused",listener_running:"\uD83D\uDFE2 Running (5s cycle)",load_cmd_failed:"Failed to load command list: {message}",load_mcp_failed:"Failed to load MCP list: {message}",manage_blocked_reason:"reason: {reason}",manage_browser_open_failed:"❌ Could not open browser: {message}",manage_browser_opened:"✅ Requested opening browser {path} (pid {pid}). Wait for the browser window to appear, then work in it.",manage_confirm_cancel:"Are you sure you want to cancel this plan?",manage_current_task:"Task running:",manage_desc:"Uses the server selected in the “Connection & MCP” tab. This tab auto-refreshes while open.",manage_doctor_fail:"has failing checks",manage_empty_plans:"No plans yet. Create one with the plan_create MCP tool, then come back here.",manage_empty_skills:"No skills installed.",manage_enter_browser:"❌ Enter the browser file path (on the daemon machine).",manage_enter_fleet:"❌ Enter Node ID, Goal and at least 1 task.",manage_enter_goal:"❌ Enter a goal.",manage_exported:"✅ Exported {count} servers. Treat the file like a password (it contains tokens).",manage_fleet_copied:"✓ fleet_dispatch command copied — paste into the hub ChatGPT tab to run.",manage_fleet_failed:"Failed to load fleet ({message}). Is this daemon a hub, and did you pick the right daemon in the Connection tab?",manage_imported:"✅ Import done: {imported} new, {skipped} skipped (duplicate/invalid). Pick the new server in the Connection tab.",manage_links_title:"Quick links",manage_loading:"Loading...",manage_next_task:"Next task:",manage_no_daemon:"Cannot reach the daemon.",manage_no_outbox:"No prompts stuck in outbox.",manage_no_page_loops:"No page-loop sessions yet. Start one in the form below.",manage_no_profiles:"No Chrome profiles found on the daemon machine ({dir}). Open Chrome manually once to create a Default profile.",manage_no_workers:"No workers registered. Register with MCP tool fleet_register from the hub ChatGPT tab, or POST /api/fleet/nodes with a token.",manage_open_profile_btn:"\uD83D\uDE80 Open this profile",manage_outbox_attempts:"(tried {count} times)",manage_page_loop_failed:"Failed to load page-loops ({message}).",manage_page_loop_turns:"turn {turn}/{max} · epoch {epoch}",manage_page_started:"✅ Session {id} started.",manage_page_stopped:"✅ Session stopped.",manage_plans_title:"Continuous-coding plans",manage_profile_failed:"Failed to load Chrome profiles ({message}). Does the daemon machine have Chrome and a screen?",manage_profile_open_failed:"❌ Could not open profile {directory}: {message}",manage_profile_opened:"✅ Requested opening Chrome profile {directory} (pid {pid}). Wait for the Chrome window to appear, then work in it.",manage_refresh_btn:"\uD83D\uDD04 Refresh",manage_resume_btn:"▶️ Resume",manage_resume_copied:"✓ Resume prompt copied!",manage_resume_prompt:"✅ Resume prompt (zero-risk: copy and send manually): {prompt}",manage_resumed:"✅ Session resumed.",manage_server_add_btn:"+ Add server",manage_server_added:"✅ Server added. Pick it in the Connection tab to use it.",manage_server_invalid:"Please enter a valid server name and URL.",manage_server_title:"Add a new server",manage_skills_title:"Installed skills",manage_stop_btn:"\uD83D\uDED1 Stop",manage_title:"Management Center — Plans, Queue, Skills & Extension",manage_tool_code_desc:"Search, list, symbols, outline, git status — no index needed.",manage_tool_code_name:"Code workspace",manage_tool_db_desc:"Read-only by default; writes need allowWrite + confirmWrite.",manage_tool_db_name:"Database manager (Python)",manage_tool_fb_post_desc:"Auto mode, 1 digest post per run from RSS.",manage_tool_fb_post_name:"Facebook · Auto-post daily news",manage_tool_fb_reply_desc:"ChatGPT drafts, daemon tracks; draft by default.",manage_tool_fb_reply_name:"Facebook · Reply to comments",manage_tool_ide_desc:"Dispatch and collect worker tasks.",manage_tool_ide_name:"IDE/Giano task queue",manage_tool_loop_desc:"Standard coding loop: tests pass before done, 3 strikes block, enforced final gate.",manage_tool_loop_name:"Loop controller",manage_tool_plans_desc:"Plan-driven coding loop; daemon is the source of truth.",manage_tool_plans_name:"Continuous-coding plans",manage_tools_desc:"MCP tools registered by the daemon (see MCP_INSTRUCTIONS.md section 4). The agent calls them over MCP; no extra setup here.",manage_tools_title:"MCP tool groups",manage_zero_risk_copy:"✅ Zero-risk: copy this prompt and send manually: {prompt}",mcp_none:"No external servers configured in <code>mcp_config.json</code>.",note_local_desc:"All settings, assistant names, and workspace folders are securely stored on this local computer and never synced externally.",note_local_title:"Local Storage:",note_switch_desc:"To control another machine, click the computer name in the control panel. Each browser tab can control a different computer.",note_switch_title:"Device Switching:",noti_desc:"Otter will send notifications to your desktop corner when: AI completes complex tasks, license is nearing expiration, or system updates arrive.",noti_enabled:"✅ Desktop notifications enabled successfully!",noti_title:"Browser Desktop Notifications",open_dashboard_link:"Open Live Activity Dashboard (Port 1993)",panel_add_server:"➕ Add new MCP server:",panel_added_success:"✅ Added '{name}' successfully!",panel_confirm_delete_server:"Are you sure you want to remove server '{name}' from mcp_config.json?",panel_connecting:"Connecting...",panel_daemon_unreachable:"Cannot reach Otter daemon ({base}).",panel_enter_name_url:"Please enter a name and URL!",panel_error_prefix:"Error: {message}",panel_mcp_header:"MCP Servers (mcp_config.json)",panel_no_servers:"No external MCP servers configured.",panel_node_label:"Node (daemon for this tab)",panel_offline:"offline",panel_refresh:"\uD83D\uDD04 Refresh",panel_save_connect:"+ Save & Connect",panel_server_name_placeholder:"Server name (e.g. gpmlogin)",panel_server_url_placeholder:"URL (e.g. http://127.0.0.1:9495/mcp)",panel_token_placeholder:"Bearer token (optional)",picker_commands_btn:"\uD83D\uDCA1 Templates",picker_commands_title:"Open Otter MCP command templates (or type / in chat)",picker_error_file:"❌ File select error",picker_error_folder:"❌ Folder select error",picker_file_btn:"\uD83D\uDCC4 Select File",picker_file_prefix:"File: ",picker_file_title:"Open native computer file selection window",picker_files_count:"files",picker_files_prefix:"Files: ",picker_folder_btn:"\uD83D\uDCC1 Select Project Folder",picker_folder_prefix:"Folder: ",picker_folder_title:"Open native computer folder selection window",picker_opening_file:"⏳ Opening file dialog...",picker_opening_folder:"⏳ Opening folder dialog...",plan_cancel:"Cancel",plan_continue:"Continue",plan_title:"\uD83D\uDCA1 Otter Agent Plan",plugin_label:"AI Assistant Name on ChatGPT",plugin_placeholder:"e.g., Otter Assistant",plugin_save_btn:"Save Assistant Name",restore_success:"✅ Script restored to defaults successfully!",save_btn:"Test Connection & Save",save_comment_btn:"\uD83D\uDCBE Save comment",save_comment_success:"Comment script saved successfully!",save_error:"❌ Error",save_intent_btn:"\uD83D\uDCBE Save intent",save_intent_success:"Intent saved successfully!",save_phase_btn:"\uD83D\uDCBE Save this step",save_phase_success:"Phase saved successfully!",saved:"✓ Saved",saving:"⏳ Saving...",server_label:"Target Computer Server",sidepanel_checking:"Checking...",sidepanel_logs_title:"Daemon Status",sidepanel_offline:"Connected: Offline",sidepanel_online:"Connected: Ready",sidepanel_open_activity:"Open Daemon Activity",sidepanel_open_chatgpt:"Open ChatGPT tab",sidepanel_open_options:"Open Management Center",sidepanel_open_plan_dashboard:"Open Plan Dashboard",sidepanel_refresh_status:"Check status again",sidepanel_scheduler_desc:"FB schedules are managed in the Management Center (Options) and via MCP tools — this Side Panel does not list schedules directly because there is no HTTP route for FB schedules yet. Click below to open the Management Center.",sidepanel_scheduler_title:"FB Group Posting Schedule",sidepanel_suite:"Otter Suite",sidepanel_tab_logs:"Logs",sidepanel_tab_scheduler:"FB Scheduler",sidepanel_tab_terminal:"Terminal",sidepanel_terminal_desc:"The real PTY terminal still runs in the ChatGPT page (TerminalPanel). This Side Panel does not emulate xterm — click below to open the ChatGPT tab and use Live Terminal there.",sidepanel_terminal_title:"Live Terminal",sub_title:"Otter AI Assistant / Dashboard & Settings",tab_commands:"⚡ Custom Commands",tab_fb_sales:"\uD83D\uDCAC FB Sales Playbook",tab_guide:"\uD83D\uDCD6 Setup Guide",tab_license:"\uD83D\uDC8E Active Plan & License",tab_manage:"\uD83C\uDF9B️ Management Center",tab_manual:"\uD83D\uDCDA Command Handbook",tab_settings:"\uD83D\uDD0C Connection & MCP",term_clear:"Clear Screen",term_connected:`[Otter Terminal Connected]
Ready to receive commands.
`,term_copied:"Copied!",term_copy:"Copy Output",term_placeholder:"Enter command or keys and press Enter...",term_title:"Otter Live Terminal (PTY)",title:"\uD83E\uDDA6 Otter Assistant",token_label:"Security Token (API Key / Token)",token_placeholder:"Required when connecting via Cloudflare Tunnel / Internet (Leave empty for local)",tpl_cancel:"Cancel",tpl_default_label:"Default",tpl_insert:"Insert into Chat",tpl_modal_title:"Fill in parameters",tpl_placeholder:"Enter {name}...",tunnel_ready:"Ready for remote connection",update_close:"Close",update_current_version:"Current version: v{version}",update_default_changelog:"A new update with features and performance improvements.",update_download:"Download New Version (.zip)",update_snooze:"Remind me later",update_title:"Otter Update Available"}};var M="vi",z=!1,ce=new Set,de=[];function pe(){return M}function vt(e){if(M===e&&z)return;if(M=e,z=!0,typeof chrome<"u"&&chrome.storage?.local)chrome.storage.local.set({language:e});ue(e)}function I(e){de.push(e)}function ue(e){for(let t of de)try{t(e)}catch{}}function je(e){return e?.toLowerCase().startsWith("vi")?"vi":"en"}function We(){try{if(typeof chrome<"u"&&chrome.i18n?.getUILanguage)return chrome.i18n.getUILanguage()}catch{}return}function Qe(e){try{if(typeof chrome<"u"&&chrome.i18n?.getMessage){let t=chrome.i18n.getMessage(e);if(typeof t==="string"&&t)return t}}catch{}return null}function s(e,t){let o;if(!z)o=Qe(e)??void 0;if(o===void 0)o=W[M]?.[e]??W.en[e];if(o===void 0){if(!ce.has(e))ce.add(e),console.warn(`[Otter i18n] Missing translation key: ${e}`);o=e}if(t)for(let[n,i]of Object.entries(t))o=o.replace(new RegExp(`\\{${n}\\}`,"g"),String(i));return o}function Ye(e=M){return e==="vi"?"vi-VN":"en-US"}function me(e,t,o=M){return new Intl.DateTimeFormat(Ye(o),t).format(e)}async function he(){try{if(typeof chrome<"u"&&chrome.storage?.local){let e=await chrome.storage.local.get("language");if(e?.language==="vi"||e?.language==="en")M=e.language,z=!0;else z=!1,M=je(We()??(typeof navigator<"u"?navigator.language:void 0))}}catch{}try{if(typeof chrome<"u"&&chrome.storage?.onChanged)chrome.storage.onChanged.addListener((e,t)=>{if(t==="local"&&e.language){let o=e.language.newValue;if(o==="vi"||o==="en")M=o,z=!0,ue(o)}})}catch{}return M}var q=null,F=null;function Xe(){let e=document.querySelector("#prompt-textarea")||document.querySelector('[data-testid="composer-text-input"]')||document.querySelector('[data-testid="prompt-textarea"]');if(e)return e;let t=document.querySelector("form [contenteditable='true'], form textarea");if(t)return t;let o=Array.from(document.querySelectorAll("[contenteditable='true']"));if(o.length>0)return o[o.length-1];return document.querySelector("textarea[tabindex='0']")}function G(e){let t=Xe();if(!t)return;if(t.focus(),t.isContentEditable||t.getAttribute("contenteditable")==="true"){let o=t.innerText.trim(),n=o?`
${e}`:e,i=window.getSelection();if(i)i.selectAllChildren(t),i.collapseToEnd();if(!document.execCommand("insertText",!1,n))t.innerText=o?`${o}
${e}`:e,t.dispatchEvent(new InputEvent("input",{bubbles:!0}));else t.dispatchEvent(new InputEvent("input",{bubbles:!0}))}else if(t instanceof HTMLTextAreaElement){let o=t.value.trim();t.value=o?`${o}
${e}`:e,t.dispatchEvent(new Event("input",{bubbles:!0})),t.dispatchEvent(new Event("change",{bubbles:!0}))}}async function ge(){try{let e=await chrome.runtime.sendMessage({type:"pick-folder",initialPath:q||F});if(e?.ok&&e.path)return q=e.path,G(`${s("picker_folder_prefix")}"${e.path}"`),e.path}catch(e){console.error("[Otter FolderPicker] Error:",e)}return null}async function _e(){try{let e=await chrome.runtime.sendMessage({type:"pick-file",initialPath:q||F,multiple:!0});if(e?.ok&&(e.path||e.paths&&e.paths.length>0)){let t=e.paths&&e.paths.length>0?e.paths:[e.path];F=t[0];let o=t.map((n)=>`"${n}"`).join(", ");return G(t.length>1?`${s("picker_files_prefix")}${o}`:`${s("picker_file_prefix")}${o}`),t}}catch(e){console.error("[Otter FilePicker] Error:",e)}return null}function fe(){function e(){document.querySelectorAll("#otter-folder-picker-bar, #chatmcp-folder-picker-bar").forEach((c)=>c.remove())}async function t(c){c.disabled=!0;let d=c.textContent;c.textContent=s("picker_opening_folder");try{let r=await chrome.runtime.sendMessage({type:"pick-folder",initialPath:q||F});if(r?.ok&&r.path){q=r.path;let u=r.path.split(/[/\\]/).filter(Boolean).pop()||r.path;c.textContent=`\uD83D\uDCC1 ${u}`,c.title=`${s("picker_folder_prefix")}${r.path}`,c.style.borderColor="#10a37f",c.style.color="#10a37f",c.dataset.active="true",G(`${s("picker_folder_prefix")}"${r.path}"`)}else c.textContent=d}catch(r){console.error("[Otter FolderPicker] Error:",r),c.textContent=s("picker_error_folder"),setTimeout(()=>{c.textContent=d},2000)}finally{c.disabled=!1}}async function o(c){c.disabled=!0;let d=c.textContent;c.textContent=s("picker_opening_file");try{let r=await chrome.runtime.sendMessage({type:"pick-file",initialPath:q||F,multiple:!0});if(r?.ok&&(r.path||r.paths&&r.paths.length>0)){let u=r.paths&&r.paths.length>0?r.paths:[r.path];F=u[0];let g=u[0].split(/[/\\]/).filter(Boolean).pop()||u[0];c.textContent=u.length>1?`\uD83D\uDCC4 (${u.length}) ${s("picker_files_count")}`:`\uD83D\uDCC4 ${g}`,c.title=u.join(`
`),c.style.borderColor="#10a37f",c.style.color="#10a37f",c.dataset.active="true";let h=u.map((_)=>`"${_}"`).join(", ");G(u.length>1?`${s("picker_files_prefix")}${h}`:`${s("picker_file_prefix")}${h}`)}else c.textContent=d}catch(r){console.error("[Otter FilePicker] Error:",r),c.textContent=s("picker_error_file"),setTimeout(()=>{c.textContent=d},2000)}finally{c.disabled=!1}}function n(c,d){let r=document.createElement("button");return r.type="button",r.textContent=c,r.title=d,r.style.cssText=`
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border: 1px solid #444;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.05);
      color: #e0e0e0;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      backdrop-filter: blur(8px);
      user-select: none;
      line-height: 1.4;
    `,r.onmouseenter=()=>{r.style.background="rgba(255, 255, 255, 0.12)",r.style.borderColor="#666"},r.onmouseleave=()=>{r.style.background="rgba(255, 255, 255, 0.05)",r.style.borderColor=r.dataset.active==="true"?"#10a37f":"#444"},r}function i(){e()}function a(){i(),setTimeout(i,50),setTimeout(i,150),setTimeout(i,300),setTimeout(i,600),setTimeout(i,1200)}document.addEventListener("click",(c)=>{let d=c.target;if(!d)return;let r=d.closest("a, button, [role='button']");if(!r)return;let u=r.getAttribute("href")||"",g=(r.getAttribute("aria-label")||"").toLowerCase(),h=(r.getAttribute("data-testid")||"").toLowerCase(),_=(r.textContent||"").toLowerCase();if(u==="/"||u.startsWith("/c/")||h.includes("new-chat")||h.includes("create-new-chat")||h.includes("conversation")||g.includes("new chat")||g.includes("đoạn chat mới")||_.includes("new chat")||_.includes("đoạn chat mới"))a()},!0),window.addEventListener("keydown",(c)=>{if((c.ctrlKey||c.metaKey)&&(c.key==="o"||c.key==="O"))a()}),window.addEventListener("otter:urlchange",a),window.addEventListener("chatmcp:urlchange",a),window.addEventListener("popstate",a),document.addEventListener("focusin",(c)=>{let d=c.target;if(d&&(d.id==="prompt-textarea"||d.getAttribute("contenteditable")==="true"))i()},!0);let l=null;new MutationObserver(()=>{if(l)return;l=setTimeout(()=>{l=null,i()},300)}).observe(document.body,{childList:!0,subtree:!0}),setInterval(i,2000),I(()=>{document.querySelectorAll("#otter-folder-picker-bar, #chatmcp-folder-picker-bar").forEach((c)=>c.remove()),i()}),a(),console.log("[Otter Folder & File Picker] Robust Event Handlers Initialized")}function Q(e){let t=/\{\{\s*([^}]+)\s*\}\}/g,o=[],n;while((n=t.exec(e))!==null){let i=n[1].trim(),a=n[0];if(i.includes(":")){let[l,p]=i.split(":",2),c=l.trim(),d=p.split(",").map((r)=>r.trim()).filter(Boolean);o.push({name:c,type:"select",options:d,defaultValue:d[0]||"",rawPlaceholder:a})}else if(i.includes("|")){let[l,p]=i.split("|",2);o.push({name:l.trim(),type:"text",defaultValue:p.trim(),rawPlaceholder:a})}else o.push({name:i,type:"text",rawPlaceholder:a})}return o}function be(e,t){let o=Q(e),n=e;for(let i of o){let a=t[i.name]!==void 0&&t[i.name]!==""?t[i.name]:i.defaultValue??"";n=n.replace(i.rawPlaceholder,a)}return n}function E(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}function ye(e,t,o){let n=new Set,i=t.filter((h)=>{if(n.has(h.name))return!1;return n.add(h.name),!0}),a=document.getElementById("otter-variable-modal");if(a)a.remove();let l=document.createElement("div");l.id="otter-variable-modal",l.style.cssText=`
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 100000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;let p=document.createElement("div");p.style.cssText=`
    background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a;
    border-radius: 12px; padding: 20px; width: 440px; max-width: 90vw;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  `,p.innerHTML=`
    <h3 style="margin: 0 0 14px 0; font-size: 16px; color: #89b4fa; display: flex; align-items: center; gap: 8px;">
      <span>⚡</span> ${E(s("tpl_modal_title"))}: ${E(e)}
    </h3>
    <form id="otter-var-form" style="display: flex; flex-direction: column; gap: 12px;">
      ${i.map((h)=>`
        <div>
          <label style="display: block; font-size: 13px; color: #a6adc8; margin-bottom: 4px; font-weight: 500;">
            ${E(h.name)} ${h.defaultValue?`<span style="color: #6c7086;">(${E(s("tpl_default_label"))}: ${E(h.defaultValue)})</span>`:""}
          </label>
          ${h.type==="select"?`
            <select name="${E(h.name)}" style="width: 100%; padding: 8px 10px; border-radius: 6px; background: #313244; color: #cdd6f4; border: 1px solid #45475a;">
              ${(h.options||[]).map((_)=>`<option value="${E(_)}">${E(_)}</option>`).join("")}
            </select>
          `:`
            <input type="text" name="${E(h.name)}" value="${E(h.defaultValue||"")}" placeholder="${E(s("tpl_placeholder",{name:h.name}))}"
              style="width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; background: #313244; color: #cdd6f4; border: 1px solid #45475a;" />
          `}
        </div>
      `).join("")}
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
        <button type="button" id="otter-var-cancel" style="padding: 7px 14px; border-radius: 6px; background: transparent; color: #a6adc8; border: 1px solid #45475a; cursor: pointer;">${E(s("tpl_cancel"))}</button>
        <button type="submit" style="padding: 7px 16px; border-radius: 6px; background: #89b4fa; color: #11111b; font-weight: 600; border: none; cursor: pointer;">${E(s("tpl_insert"))}</button>
      </div>
    </form>
  `,l.appendChild(p),document.body.appendChild(l);let c=p.querySelector("input, select");if(c)c.focus();let d=p.querySelector("#otter-var-form"),r=p.querySelector("#otter-var-cancel"),u=()=>{l.remove(),window.removeEventListener("keydown",g)},g=(h)=>{if(h.key==="Escape")u()};window.addEventListener("keydown",g),l.onclick=(h)=>{if(h.target===l)u()},r.onclick=()=>u(),d.onsubmit=(h)=>{h.preventDefault();let _=new FormData(d),y={};for(let C of i)y[C.name]=_.get(C.name)||"";u(),o(y)}}function xe(e,t=s("export_doc_title")){let o=me(new Date),n=[];n.push(`# ${t}`),n.push(`> *${s("export_exported_at")}:* ${o} | *${s("export_total_turns")}:* ${e.length}`),n.push(""),n.push("---"),n.push("");for(let i of e){let l=i.role.toLowerCase()==="user"?"### \uD83D\uDC64 User":"### \uD83E\uDD16 Assistant";n.push(l),n.push(""),n.push(i.content.trim()),n.push(""),n.push("---"),n.push("")}return n.push("*(Được xuất bản tự động bởi Otter — Agentic AI Suite)*"),n.join(`
`)}var Ze=[".markdown",'[data-message-content="true"]',".whitespace-pre-wrap"];function Je(e){for(let t of Ze)try{let o=e.querySelector(t),n=o?.innerText||o?.textContent||"";if(n.trim())return n.trim()}catch{}return(e.innerText||e.textContent||"").trim()}function et(e){let t=e.getAttribute?.("data-message-author-role");if(t)return t;return e.querySelector?.("[data-message-author-role]")?.getAttribute?.("data-message-author-role")||"assistant"}function tt(e=document){if(typeof document>"u"&&!e)return[];let t=[],o=['[data-testid="conversation-turn"]',"[data-message-author-role]","article"],n=[];for(let i of o){try{n=Array.from(e.querySelectorAll?.(i)||[])}catch{n=[]}if(n.length>0)break}if(n.length===0){let i=Array.from(e.querySelectorAll?.("h4")||[]).filter((a)=>{let l=a.innerText||a.textContent||"";return l.includes("Bạn đã nói")||l.includes("ChatGPT đã nói")||l.includes("You said")||l.includes("ChatGPT said")});for(let a of i){let p=(a.textContent||"").includes("Bạn đã nói")||(a.textContent||"").includes("You said")?"user":"assistant",c=a.parentElement;if(c){let d=c.cloneNode(!0);d.querySelectorAll("h4, button").forEach((u)=>u.remove());let r=d.innerText?.trim()||"";if(r)t.push({role:p,content:r})}}return t}for(let i of n){let a=Je(i);if(!a)continue;t.push({role:et(i),content:a})}return t}function ve(){if(typeof document>"u")return{title:s("export_doc_title"),markdown:xe([],s("export_doc_title"))};let e=document.title.replace(/\s*-\s*ChatGPT.*$/i,"").trim()||s("export_doc_title"),t=tt(document),o=xe(t,e);return{title:e,markdown:o}}function nt(e){return e.replace(/[\\/:*?"<>|]+/g,"-").replace(/\s+/g," ").trim()||"otter-chat"}function ke(e,t){let o=nt(e),n=new Blob([t],{type:"text/markdown;charset=utf-8"}),i=URL.createObjectURL(n),a=document.createElement("a");a.href=i,a.download=o.endsWith(".md")?o:`${o}.md`,document.body.appendChild(a),a.click(),document.body.removeChild(a),URL.revokeObjectURL(i)}function Ce(e){if(typeof document>"u")return;let t=document.getElementById("otter-export-toast");if(t)t.remove();let o=document.createElement("div");o.id="otter-export-toast",o.textContent=e||s("export_success"),o.style.cssText=`
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #10b981; color: #fff; padding: 10px 16px; border-radius: 8px;
    font-size: 13px; font-weight: 600; z-index: 100002;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); font-family: system-ui, sans-serif;
  `,document.body.appendChild(o),setTimeout(()=>o.remove(),3000)}var ot=['div#prompt-textarea[contenteditable="true"]','#prompt-textarea[contenteditable="true"]','div.ProseMirror[contenteditable="true"]','textarea[data-id="prompt-textarea"]','textarea[placeholder*="Send a message"]','textarea[aria-label="Message ChatGPT"]',"#prompt-textarea",".ProseMirror"],it=['form button[type="submit"]','button[type="submit"]','button[aria-label*="Gửi"]','button[aria-label*="Send"]','button[data-testid="send-button"]','button[data-testid*="send"]','button[data-testid*="composer-send"]','[data-testid="send-button"]'],at=['button[data-testid="stop-button"]','[data-testid="stop-button"]','button[aria-label="Stop generating"]','button[aria-label*="Ngừng"]','button[aria-label*="Dừng"]','button[aria-label*="Stop"]'];function Te(){for(let e of at)try{let t=document.querySelector(e);if(t&&(t.offsetWidth||t.offsetHeight))return!0}catch{}return!!document.querySelector(".result-streaming")}function Y(){for(let e of ot)try{let t=document.querySelector(e);if(t&&(t.offsetWidth||t.offsetHeight))return t}catch{}return null}function rt(){let e=document.querySelector("form");if(e){let t=e.querySelector('button[type="submit"]');if(t)return t}for(let t of it)try{let o=document.querySelector(t);if(o)return o}catch{}return null}async function X(e=4000){let t=Y(),o=t?.closest("form")||document.querySelector("form"),n=(l)=>{if(!l)return!0;return l.hasAttribute("disabled")||l.getAttribute("aria-disabled")==="true"||l.getAttribute("data-disabled")==="true"||l.classList.contains("disabled")},i=Date.now(),a=null;while(Date.now()-i<e){if(a=(o?o.querySelector('button[type="submit"]'):null)||rt(),a&&!n(a)){if(await new Promise((l)=>setTimeout(l,100)),typeof chrome<"u"&&chrome.runtime?.sendMessage)try{if((await chrome.runtime.sendMessage({type:"submit-chatgpt-main-world"}).catch(()=>null))?.ok)return console.log("[Otter Injector] ✅ Đã kích hoạt lệnh gửi thành công qua Main World!"),!0}catch{}try{a.focus(),a.dispatchEvent(new PointerEvent("pointerdown",{bubbles:!0,cancelable:!0})),a.dispatchEvent(new MouseEvent("mousedown",{bubbles:!0,cancelable:!0})),a.dispatchEvent(new PointerEvent("pointerup",{bubbles:!0,cancelable:!0})),a.dispatchEvent(new MouseEvent("mouseup",{bubbles:!0,cancelable:!0})),a.click()}catch{}if(o&&typeof o.requestSubmit==="function")try{o.requestSubmit(a)}catch{}return console.log("[Otter Injector] ✅ Đã tự động kích hoạt gửi (Send) vào ChatGPT!"),!0}await new Promise((l)=>setTimeout(l,100))}if(t)return console.warn("[Otter Injector] Không thấy nút Send bật sáng sau timeout, fallback gửi phím Enter..."),t.focus(),t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:!0,cancelable:!0})),!0;return!1}async function we(e,t=!0,o){console.log("[Otter Injector] Đang chuẩn bị chèn prompt vào ChatGPT...",{textLength:e.length,shouldSubmit:t});let n=o?.generationTimeoutMs??600000,i=0;while(Te()&&i<n)await new Promise((p)=>setTimeout(p,500)),i+=500;if(Te())return console.error("[Otter Injector] Hết timeout chờ generate, không chèn chồng prompt."),!1;let a=Y(),l=0;while(!a&&l<1e4)await new Promise((p)=>setTimeout(p,500)),l+=500,a=Y();if(!a)return console.error("[Otter Injector] Không tìm thấy ô nhập liệu prompt của ChatGPT"),!1;if(a.focus(),await new Promise((p)=>setTimeout(p,50)),a.tagName.toLowerCase()==="textarea"){let p=a,c=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value")?.set;if(c)c.call(p,e);else p.value=e;p.dispatchEvent(new Event("input",{bubbles:!0})),p.dispatchEvent(new Event("change",{bubbles:!0}))}else{let p=!1;try{a.focus();let c=new DataTransfer;c.setData("text/plain",e);let d=new ClipboardEvent("paste",{clipboardData:c,bubbles:!0,cancelable:!0});if(a.dispatchEvent(d),await new Promise((u)=>setTimeout(u,50)),(a.innerText||a.textContent||"").trim().length>0)p=!0}catch{p=!1}if(!p)try{a.focus(),p=document.execCommand("insertText",!1,e),await new Promise((c)=>setTimeout(c,30))}catch{p=!1}if(!p)try{a.dispatchEvent(new InputEvent("beforeinput",{bubbles:!0,cancelable:!0,inputType:"insertText",data:e})),a.innerText=e,a.dispatchEvent(new InputEvent("input",{bubbles:!0,inputType:"insertText",data:e})),p=!0}catch{p=!1}a.dispatchEvent(new InputEvent("input",{bubbles:!0,data:e,inputType:"insertText"})),a.dispatchEvent(new Event("input",{bubbles:!0})),a.dispatchEvent(new Event("change",{bubbles:!0}))}if(console.log("[Otter Injector] Đã chèn văn bản thành công vào editor"),t)return await X();return!0}var st=[{id:"browser-read",slash:"/browse",icon:"\uD83C\uDF10",categoryKey:"cat_browser",title:{vi:"Đọc trang web đang mở",en:"Read active web page"},description:{vi:"Quét cấu trúc DOM nén và liệt kê danh sách các phần tử tương tác trên tab web",en:"Scan compressed DOM structure and list interactive elements on active web tab"},promptTemplate:{vi:"Đọc trang web đang mở, phân tích cấu trúc DOM và cho tôi biết các phần tử có thể tương tác.",en:"Read the active web page, analyze the DOM structure and show me interactive elements."}},{id:"browser-open",slash:"/open",icon:"\uD83C\uDF10",categoryKey:"cat_browser",title:{vi:"Mở trang web mới",en:"Open new web page"},description:{vi:"Mở địa chỉ URL trên trình duyệt và tự động đọc cấu trúc trang",en:"Open URL in browser and inspect page content"},promptTemplate:{vi:"Mở trang web https://... và phân tích cấu trúc nội dung trang.",en:"Open website https://... and analyze the page content."}},{id:"browser-click",slash:"/click",icon:"\uD83D\uDDB1️",categoryKey:"cat_browser",title:{vi:"Bấm chuột vào phần tử web",en:"Click web element"},description:{vi:"Bấm vào phần tử theo chỉ số [index] sau khi quét trang",en:"Click element by numeric index after DOM scan"},promptTemplate:{vi:"Bấm chuột vào phần tử [1] trên trang web đang mở.",en:"Click element [1] on the active web page."}},{id:"term-exec",slash:"/term",icon:"\uD83D\uDCBB",categoryKey:"cat_terminal",title:{vi:"Chạy lệnh console / shell",en:"Run console / shell command"},description:{vi:"Mở phiên Live Terminal và thực thi lệnh PowerShell hoặc Bash",en:"Open Live Terminal session and execute command in PowerShell or Bash"},promptTemplate:{vi:"Mở Live Terminal và chạy lệnh: ",en:"Open Live Terminal and run command: "}},{id:"term-test",slash:"/test",icon:"\uD83E\uDDEA",categoryKey:"cat_terminal",title:{vi:"Chạy Unit Test dự án",en:"Run project unit tests"},description:{vi:"Thực thi bộ kiểm thử tự động của dự án bằng bun test",en:"Execute automated unit test suite with bun test"},promptTemplate:{vi:"Mở Terminal và chạy toàn bộ unit test của dự án bằng lệnh: bun test",en:"Open Terminal and run all project unit tests using command: bun test"}},{id:"term-git",slash:"/git",icon:"\uD83C\uDF3F",categoryKey:"cat_terminal",title:{vi:"Kiểm tra Git Status",en:"Check Git status"},description:{vi:"Xem trạng thái thay đổi mã nguồn và các file chưa commit",en:"View modified working tree and uncommitted files"},promptTemplate:{vi:"Chạy lệnh git status --short và cho tôi biết các thay đổi gần nhất.",en:"Run git status --short and show me recent uncommitted changes."}},{id:"term-claude",slash:"/claude",icon:"\uD83C\uDFAD",categoryKey:"cat_terminal",title:{vi:"Sai bảo Claude Code CLI",en:"Dispatch task to Claude Code CLI"},description:{vi:"Chạy Claude Code CLI trên máy để lập trình chuyên sâu hoặc refactor",en:"Run Claude Code CLI locally to write or refactor code"},promptTemplate:{vi:"Dùng công cụ 'agent_run_claude' trên máy tính để thực thi nhiệm vụ lập trình: [Mô tả chi tiết việc cần code hoặc refactor]",en:"Use 'agent_run_claude' tool locally to execute coding task: [Describe coding/refactoring task]"}},{id:"term-gemini",slash:"/gemini",icon:"✨",categoryKey:"cat_terminal",title:{vi:"Sai bảo Gemini Antigravity CLI",en:"Dispatch task to Gemini Antigravity CLI"},description:{vi:"Chạy Gemini Antigravity CLI (agy) để kiểm thử, review logic hoặc audit an toàn",en:"Run Gemini Antigravity CLI (agy) locally for testing, logic review, or security audit"},promptTemplate:{vi:"Dùng công cụ 'agent_run_gemini' trên máy tính để review kiến trúc, audit bảo mật và chạy kiểm thử cho: [Tên module/tính năng]",en:"Use 'agent_run_gemini' tool locally to review architecture, security audit, and run tests for: [Module/Feature]"}},{id:"term-codex",slash:"/codex",icon:"\uD83E\uDDE0",categoryKey:"cat_terminal",title:{vi:"Sai bảo OpenAI Codex CLI",en:"Dispatch task to OpenAI Codex CLI"},description:{vi:"Chạy OpenAI Codex CLI (codex-cli) để phân tích, lập kế hoạch hoặc sinh mã khung",en:"Run OpenAI Codex CLI locally for analysis, planning, or code scaffolding"},promptTemplate:{vi:"Dùng công cụ 'agent_run_codex' trên máy tính để phân tích yêu cầu, thiết kế kiến trúc và sinh mã cho: [Nhiệm vụ cụ thể]",en:"Use 'agent_run_codex' tool locally to analyze requirements, design architecture, and scaffold code for: [Specific task]"}},{id:"term-pipeline",slash:"/pipeline",icon:"⚡",categoryKey:"cat_terminal",title:{vi:"Quy trình liên hoàn 3 AI (Codex -> Claude -> Gemini)",en:"Multi-Agent Pipeline (Codex -> Claude -> Gemini)"},description:{vi:"Chạy tự động liên hoàn: Codex lên spec, Claude viết code, Gemini audit & test",en:"Autonomous pipeline: Codex plans, Claude codes, Gemini reviews & tests"},promptTemplate:{vi:`Dùng công cụ 'agent_orchestrate_pipeline' để chạy quy trình liên hoàn 3 AI cho: [Tên tính năng]
- Bước 1 (Codex): Phân tích yêu cầu và thiết kế kiến trúc chi tiết.
- Bước 2 (Claude): Triển khai mã nguồn và viết unit test theo thiết kế của Bước 1.
- Bước 3 (Gemini): Rà soát an ninh, audit bảo mật và chạy bun test kiểm thử toàn diện.`,en:`Use 'agent_orchestrate_pipeline' tool to run a 3-agent pipeline for: [Feature Name]
- Step 1 (Codex): Analyze requirements and design detailed architecture.
- Step 2 (Claude): Implement source code and unit tests based on Step 1.
- Step 3 (Gemini): Security audit and run comprehensive bun test.`}},{id:"desktop-screen",slash:"/screen",icon:"\uD83D\uDDA5️",categoryKey:"cat_desktop",title:{vi:"Chụp ảnh màn hình máy tính",en:"Capture desktop screenshot"},description:{vi:"Chụp ảnh toàn màn hình desktop và kiểm tra các cửa sổ đang mở",en:"Capture full desktop screenshot and inspect active windows"},promptTemplate:{vi:"Chụp ảnh màn hình máy tính và liệt kê danh sách các cửa sổ ứng dụng đang mở.",en:"Take a full desktop screenshot and list all visible application windows."}},{id:"desktop-cua",slash:"/cua",icon:"\uD83E\uDD16",categoryKey:"cat_desktop",title:{vi:"Tra cứu công cụ OpenAI CUA",en:"OpenAI CUA tools catalog"},description:{vi:"Xem danh mục 61 công cụ Computer Use Agent trong bin/cua",en:"Inspect 61 Computer Use Agent tools in bin/cua"},promptTemplate:{vi:"Tra cứu danh mục công cụ OpenAI Computer Use Agent trong bin/cua để thao tác giao diện.",en:"Query OpenAI Computer Use Agent tool definitions in bin/cua to automate UI."}},{id:"codebase-arch",slash:"/codebase",icon:"\uD83E\uDDE0",categoryKey:"cat_cbm",title:{vi:"Phân tích kiến trúc Codebase",en:"Analyze Codebase Architecture"},description:{vi:"Xem đồ thị kiến trúc tổng quan hệ thống và các module bằng Codebase Memory",en:"Inspect system architecture graph and modules via Codebase Memory"},promptTemplate:{vi:"Phân tích đồ thị kiến trúc tổng quan của dự án bằng Codebase Memory Graph.",en:"Analyze project architecture overview using Codebase Memory Graph."}},{id:"codebase-trace",slash:"/trace",icon:"\uD83D\uDD0D",categoryKey:"cat_cbm",title:{vi:"Lần vết hàm 2 chiều",en:"Bidirectional Call Graph Trace"},description:{vi:"Lần vết Call Graph hai chiều (inbound/outbound) của hàm trong mã nguồn",en:"Trace inbound and outbound Call Graph paths for a symbol"},promptTemplate:{vi:"Lần vết luồng gọi hàm [tên_hàm] hai chiều trong Codebase Memory và cho tôi biết các điểm gọi.",en:"Trace function [symbol_name] bidirectionally in Codebase Memory and show call sites."}},{id:"voice-gen",slash:"/voice",icon:"\uD83C\uDF99️",categoryKey:"cat_media",title:{vi:"Tạo giọng đọc AI thuyết minh",en:"Generate AI voiceover"},description:{vi:"Tạo file âm thanh giọng đọc tiếng Việt chuẩn truyền hình bằng Edge-TTS",en:"Generate broadcast-quality AI speech audio file with Edge-TTS"},promptTemplate:{vi:'Tạo file giọng đọc AI thuyết minh tiếng Việt chuẩn bằng Edge-TTS với nội dung: "..."',en:'Generate high quality AI voiceover audio using Edge-TTS with content: "..."'}},{id:"video-remotion",slash:"/video",icon:"\uD83C\uDFAC",categoryKey:"cat_media",title:{vi:"Tạo video ngắn Remotion",en:"Create Remotion video"},description:{vi:"Biên tập video hoạt họa, typography và âm thanh hoàn chỉnh bằng Remotion",en:"Compose motion graphics, typography and audio into video via Remotion"},promptTemplate:{vi:"Tạo video ngắn hoàn chỉnh bằng Remotion từ kịch bản sau: ",en:"Create a complete Remotion video from the following script: "}},{id:"vps-session",slash:"/vps",icon:"\uD83D\uDE80",categoryKey:"cat_vps",title:{vi:"Mở phiên SSH Keep-Alive",en:"Open SSH Keep-Alive session"},description:{vi:"Kết nối phiên SSH bền vững không ngắt để theo dõi và chạy lệnh trên VPS",en:"Establish persistent keep-alive SSH session to run remote commands on VPS"},promptTemplate:{vi:"Mở phiên SSH Keep-Alive kết nối VPS [user]@[host]:22 và kiểm tra tài nguyên CPU, RAM, ổ đĩa.",en:"Open SSH Keep-Alive session to VPS [user]@[host]:22 and inspect CPU, RAM, disk usage."}},{id:"bm-save",slash:"/bookmark",icon:"\uD83D\uDD16",categoryKey:"cat_bookmarks",title:{vi:"Lưu trang web vào Bookmark",en:"Save page to Bookmarks"},description:{vi:"Lưu lại liên kết, tiêu đề và tóm tắt trang web vào kho tri thức cá nhân",en:"Save URL link, title and summary into personal knowledge base"},promptTemplate:{vi:"Lưu bookmark trang web này vào kho tri thức cá nhân với URL: https://... và tag: ",en:"Save this website bookmark to personal knowledge base with URL: https://... and tags: "}},{id:"bm-search",slash:"/find",icon:"\uD83D\uDD0D",categoryKey:"cat_bookmarks",title:{vi:"Tìm kiếm Bookmark liên quan",en:"Search saved Bookmarks"},description:{vi:"Tìm kiếm các bài viết, liên kết hay video đã lưu theo từ khóa liên quan",en:"Search saved articles, links and videos by keywords"},promptTemplate:{vi:"Tìm kiếm trong kho bookmark các liên kết liên quan đến từ khóa: ",en:"Search personal bookmarks for links matching keyword: "}},{id:"bm-list",slash:"/bookmarks",icon:"\uD83D\uDCDA",categoryKey:"cat_bookmarks",title:{vi:"Xem tất cả Bookmark đã lưu",en:"View all saved Bookmarks"},description:{vi:"Xem danh sách các trang web đã đánh dấu bookmark gần đây nhất",en:"View list of most recently saved bookmarks"},promptTemplate:{vi:"Xem danh sách các bookmark đã lưu trong kho tri thức cá nhân gần đây nhất.",en:"Show recently saved bookmarks in personal knowledge base."}},{id:"fb-sales",slash:"/fb-sales",icon:"\uD83C\uDFAF",categoryKey:"cat_facebook",title:{vi:"Thiết lập kịch bản bán hàng FB",en:"Setup Facebook Sales Playbook"},description:{vi:"Xem và cập nhật kịch bản phễu 6 bước, ý định mua hàng và bình luận dạo",en:"View and update 6-stage funnel, customer intents, and comment templates"},promptTemplate:{vi:`Hãy giúp tôi cấu hình và tối ưu kịch bản bán hàng trên Facebook:
1. Gọi tool 'fb_sales_get_playbook' để lấy toàn bộ kịch bản 6 giai đoạn (greeting, discovery, pitch, objection, closing, support), các ý định khách hàng (intents: pricing, features, objection_safety...) và bình luận dạo.
2. Dựa vào sản phẩm/dịch vụ của tôi: [Điền tên sản phẩm/dịch vụ của bạn tại đây]
3. Dùng tool 'fb_sales_update_stage' để cập nhật câu thoại mẫu phù hợp cho từng giai đoạn trong phễu bán hàng.
4. Dùng tool 'fb_sales_update_intent' để tối ưu câu giải đáp giá cả, tính năng và xử lý thắc mắc bảo mật.
5. Dùng tool 'fb_sales_update_comments' để cập nhật câu bình luận dạo tự nhiên khi đi tương tác feed.`,en:`Help me configure and optimize the Facebook sales playbook:
1. Call tool 'fb_sales_get_playbook' to view the 6-stage funnel and customer intents.
2. Based on my product/service: [Enter your product/service here]
3. Use 'fb_sales_update_stage' to update reply templates for each funnel stage.
4. Use 'fb_sales_update_intent' to optimize pricing, features, and objection handling.
5. Use 'fb_sales_update_comments' to update smart comment templates for feed engagement.`}},{id:"fb-listen",slash:"/fb-listen",icon:"\uD83D\uDCAC",categoryKey:"cat_facebook",title:{vi:"Trực & Tự động trả lời Messenger",en:"Messenger Auto-Reply Listener"},description:{vi:"Bật worker nền lắng nghe tin nhắn Messenger và trả lời theo kịch bản phễu",en:"Start background worker to listen for Messenger chats and reply using playbook"},promptTemplate:{vi:`Hãy quản lý chế độ tự động lắng nghe và trực tin nhắn Messenger:
1. Gọi tool 'fb_messenger_listen_status' để kiểm tra xem daemon có đang lắng nghe tin nhắn hay không.
2. Nếu chưa bật hoặc cần đổi chu kỳ, gọi 'fb_messenger_listen_start' với interval_seconds=5 để bắt đầu tự động đọc tin nhắn đến, tra cứu kịch bản sales trong SQLite, trả lời khách và lưu lịch sử hội thoại.
3. Nếu tôi yêu cầu dừng trực, hãy gọi tool 'fb_messenger_listen_stop'.`,en:`Manage Facebook Messenger auto-reply listening mode:
1. Call tool 'fb_messenger_listen_status' to check if the listener is running.
2. If inactive, call 'fb_messenger_listen_start' with interval_seconds=5 to auto-reply using sales playbook.
3. To stop listening, call 'fb_messenger_listen_stop'.`}},{id:"fb-feed",slash:"/fb-feed",icon:"\uD83D\uDCF1",categoryKey:"cat_facebook",title:{vi:"Quét Feed & Tương tác bài viết FB",en:"Scan Feed & Engage Posts"},description:{vi:"Quét bảng tin và tự động thả like/love kèm bình luận dạo theo kịch bản",en:"Scan feed and auto-like/comment according to sales comment playbook"},promptTemplate:{vi:`Hãy quét Bảng tin Facebook và tương tác bài viết an toàn:
1. Nếu bạn có tool 'fb_feed_scan', hãy gọi 'fb_feed_scan' với limit=5 để quét các bài viết trên feed (lấy post_key, tác giả, nội dung).
2. Phân loại nội dung từng bài viết (du lịch, kinh doanh, đời sống...).
3. Với mỗi bài phù hợp, gọi tool 'fb_feed_engage_post' để like/love và bình luận.
4. Báo cáo lại danh sách các bài viết đã tương tác thành công.

⚠️ LƯU Ý DỰ PHÒNG: Nếu bạn không tìm thấy tool fb_feed_scan trong danh sách Actions khả dụng, hãy GỌI NGAY tool executeTerminalCommand với lệnh sau để chạy tự động toàn bộ quy trình:
command: "bun scripts/fb-feed-auto-engage.ts --max 5"`,en:`Scan Facebook Feed and engage posts safely:
1. If tool 'fb_feed_scan' is available, call it with limit=5 to scan the latest posts on Feed.
2. Classify each post content (travel, shop, general...).
3. For each suitable post, call 'fb_feed_engage_post' with post_key, reaction, and category or custom_comment.
4. Report back the engaged posts.

⚠️ FALLBACK: If tools fb_feed_scan and fb_feed_engage_post are not found in your available Actions, IMMEDIATELY call executeTerminalCommand with:
command: "bun scripts/fb-feed-auto-engage.ts --max 5"`}},{id:"fb-notif",slash:"/fb-notif",icon:"\uD83D\uDD14",categoryKey:"cat_facebook",title:{vi:"Đọc thông báo & Trả lời bình luận",en:"Read Notifications & Reply"},description:{vi:"Đọc danh sách thông báo Facebook, mở bài viết và trả lời comment của khách",en:"Read recent notifications, open posts, and reply to customer comments"},promptTemplate:{vi:`Hãy kiểm tra thông báo Facebook mới nhất và phản hồi cho khách:
1. Gọi tool 'fb_notifications_read' với limit=5 để đọc danh sách thông báo gần đây.
2. Phân tích các thông báo liên quan đến khách bình luận hỏi mua hàng, tư vấn hoặc trao đổi trên bài viết.
3. Với thông báo cần trả lời, gọi tool 'fb_notification_open_and_reply':
   - notification_index: số thứ tự của thông báo (bắt đầu từ 0)
   - reply_text: câu trả lời lịch sự, đúng kịch bản giải đáp thắc mắc của khách.
4. Báo cáo kết quả thông báo nào đã được trả lời xong.`,en:`Check Facebook notifications and reply to customer comments:
1. Call tool 'fb_notifications_read' with limit=5 to inspect recent notifications.
2. Identify customer comments or inquiries.
3. For each notification needing response, call 'fb_notification_open_and_reply' with notification_index and reply_text.
4. Report the processed notifications.`}},{id:"fb-reply",slash:"/fb-reply",icon:"\uD83D\uDCAC",categoryKey:"cat_facebook",title:{vi:"Tự động đọc & Trả lời bình luận bài viết FB",en:"Auto Read & Reply Facebook Post Comments"},description:{vi:"Mở link bài viết, đọc bình luận, tự phục hồi nếu lệch link, like và tự suy luận trả lời theo ngữ cảnh",en:"Open post link, read comments, auto-recover if redirected, like and reply contextually"},promptTemplate:{vi:`Hãy tự động mở bài viết Facebook, đọc tất cả bình luận, like và trả lời bình luận theo quy trình tự động hoàn toàn:
1. URL bài viết: [DÁN LINK BÀI VIẾT TẠI ĐÂY - ví dụ: https://www.facebook.com/share/p/17tu5cAG8h/]
2. Mở bài viết: Gọi tool 'browser_open' mở URL bài viết. (Lưu ý: Với bài viết trong nhóm, Facebook tự động chuyển hướng link chia sẻ sang đường dẫn nhóm /groups/.../permalink/..., đây là cùng một bài viết đích, hãy tiếp tục xử lý bình thường).
3. Đọc bình luận: Gọi tool 'fb_read_comments' với 'postUrl' là URL bài viết ở trên để lấy danh sách bình luận kèm likeIndex và replyIndex.
4. QUY TẮC TỰ PHỤC HỒI KHI LỆCH LINK (BẮT BUỘC):
   - Trong quá trình click nếu bị điều hướng nhầm sang trang cá nhân, bảng tin feed, hãy gọi 'browser_open' mở lại URL bài viết gốc và gọi 'fb_read_comments' với postUrl để lấy lại chỉ số mới nhất rồi tiếp tục.
5. Vòng lặp tương tác tự động 100% (TỰ ĐỘNG XÁC NHẬN, KHÔNG DỪNG CHỜ DUYỆT):
   - Thả cảm xúc: Nếu likeIndex khác null và isLiked=false, gọi 'browser_click' vào likeIndex để like bình luận.
   - Bấm trả lời: Gọi 'browser_click' vào replyIndex của bình luận.
   - Soạn và gửi nội dung: Dựa vào nội dung bình luận của người dùng, tự suy luận câu trả lời lịch sự, hữu ích và hợp ngữ cảnh, sau đó gọi 'browser_type' (targetIndex=-1 hoặc theo index ô nhập) với text và pressEnter=true (submit=true) để gửi đi luôn. Lưu ý: Facebook gửi bình luận bằng phím Enter, không có nút Gửi riêng, không cần tìm nút Gửi!
   - TỰ ĐỘNG GỬI TẤT CẢ: Tuyệt đối KHÔNG bỏ qua, KHÔNG dừng lại chờ người dùng xác nhận tay. Hãy tự động gửi và ghi nhận tiến độ.
   - Lặp lại cho các bình luận tiếp theo (hoặc bấm 'Xem thêm bình luận' nếu có).
6. Báo cáo tổng kết: Chụp ảnh màn hình bằng chứng và liệt kê danh sách các bình luận đã được like và trả lời thành công.`,en:`Automatically open Facebook post, read all comments, like and reply to each comment:
1. Post URL: [PASTE POST URL HERE - e.g. https://www.facebook.com/share/p/17tu5cAG8h/]
2. Open post: Call 'browser_open' with the post URL. (Note: For group posts, Facebook redirects share links to /groups/.../permalink/..., which is the canonical post; continue processing normally).
3. Read comments: Call 'fb_read_comments' with 'postUrl' set to the post URL to get structured comments, likeIndex, and replyIndex.
4. AUTO-RECOVERY RULE ON WRONG NAVIGATION (MANDATORY):
   - If a click accidentally navigates away from the post (e.g. author profile or feed), immediately call 'browser_open' to return to the original post URL and call 'fb_read_comments' with postUrl to re-index interactive elements.
5. Comment processing loop 100% AUTOMATED (AUTO-CONFIRM, DO NOT WAIT FOR MANUAL APPROVAL):
   - React/Like: If likeIndex is not null and isLiked=false, call 'browser_click' on likeIndex.
   - Click Reply: Call 'browser_click' on replyIndex.
   - Compose & Send: Generate a helpful, context-aware reply, then call 'browser_type' (targetIndex=-1 or input box index) with pressEnter=true to send immediately. Note: Facebook submits comments with Enter key, no separate Send button!
   - AUTO-SEND ALL: Do NOT skip, do NOT stop to wait for human confirmation. Auto-confirm and send all replies!
   - Repeat for all pending comments (expand more comments if available).
6. Final Report: Capture screenshot proof and list all answered comments.`}},{id:"export-markdown",slash:"/export",icon:"\uD83D\uDCC4",categoryKey:"cat_browser",title:{vi:"Xuất cuộc trò chuyện ra Markdown",en:"Export conversation to Markdown"},description:{vi:"Xuất toàn bộ lượt chat hiện tại ra file Markdown và tải xuống",en:"Export all turns of the current chat to a Markdown file and download it"},promptTemplate:{vi:"Xuất cuộc trò chuyện hiện tại ra file Markdown.",en:"Export the current conversation to a Markdown file."},action:"export-markdown"}];function Me(e=pe()){return st.map((t)=>({id:t.id,slash:t.slash,icon:t.icon,category:s(t.categoryKey),title:t.title[e]||t.title.vi,description:t.description[e]||t.description.vi,promptTemplate:t.promptTemplate[e]||t.promptTemplate.vi,action:t.action}))}var Z=Me("vi");I((e)=>{Z=Me(e),U()});var L=[],A=new Set(["browser-read","term-exec"]);async function Pe(e="http://127.0.0.1:1993"){try{if(typeof chrome<"u"&&chrome.storage?.local){let t=await chrome.storage.local.get(["otter_custom_commands","otter_pinned_standard_ids"]);if(Array.isArray(t.otter_custom_commands))L=t.otter_custom_commands;if(Array.isArray(t.otter_pinned_standard_ids))A=new Set(t.otter_pinned_standard_ids)}}catch{}try{let t=await fetch(`${e}/api/commands`);if(t.ok){let o=await t.json();if(Array.isArray(o.items)){if(L=o.items.map((n)=>({id:n.id,slash:n.slash,icon:n.icon||"⚡",category:n.category||"Tập lệnh của tôi",title:n.title,description:n.description||"",promptTemplate:n.promptTemplate,isPinned:Boolean(n.isPinned),isCustom:!0})),typeof chrome<"u"&&chrome.storage?.local)chrome.storage.local.set({otter_custom_commands:L})}}}catch{}U()}function J(){let e=new Set(L.map((p)=>p.slash.toLowerCase())),t=Z.filter((p)=>!e.has(p.slash.toLowerCase())),o=L.filter((p)=>p.isPinned),n=["/fb-feed","/fb-reply","/fb-listen","/fb-sales","/fb-notif","/browse","/term"];o.sort((p,c)=>{let d=n.indexOf(p.slash),r=n.indexOf(c.slash);if(d!==-1&&r!==-1)return d-r;if(d!==-1)return-1;if(r!==-1)return 1;return 0});let i=t.filter((p)=>A.has(p.id)).map((p)=>({...p,isPinned:!0})),a=L.filter((p)=>!p.isPinned),l=t.filter((p)=>!A.has(p.id));return[...o,...i,...a,...l]}var k=!1;function lt(){if(document.getElementById("otter-radial-custom-styles"))return;let e=document.createElement("style");e.id="otter-radial-custom-styles",e.textContent=`
    .otter-satellite-item {
      cursor: pointer !important;
    }
    .otter-satellite-item:hover {
      transform: translate(var(--sat-x), var(--sat-y)) scale(1.18) !important;
      border-color: #10b981 !important;
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.9), 0 8px 24px rgba(0,0,0,0.8) !important;
      z-index: 10025 !important;
    }
    .otter-satellite-item:hover .otter-sat-badge {
      border-color: #34d399 !important;
      color: #ffffff !important;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.6) !important;
    }
  `,document.head.appendChild(e)}function Ee(e,t,o,n,i,a="bottom"){lt();let l=document.createElement("div");l.className="otter-satellite-item",l.setAttribute("data-x",String(o)),l.setAttribute("data-y",String(n)),l.style.setProperty("--sat-x",`${o}px`),l.style.setProperty("--sat-y",`${n}px`),l.title=t.title,l.style.cssText=`
    position: absolute;
    width: 42px;
    height: 42px;
    left: -21px;
    top: -21px;
    border-radius: 50%;
    background: #18181b;
    border: 2px solid rgba(16, 185, 129, 0.7);
    color: #f4f4f5;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.7);
    cursor: pointer;
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    opacity: ${k?"1":"0"};
    transform: ${k?`translate(${o}px, ${n}px) scale(1)`:"translate(0px, 0px) scale(0.2)"};
    pointer-events: ${k?"auto":"none"};
    user-select: none;
    z-index: 10005;
    --sat-x: ${o}px;
    --sat-y: ${n}px;
  `;let p=document.createElement("span");p.className="otter-sat-badge",p.textContent=t.label;let c=a==="top"?"bottom: 100%; margin-bottom: 5px;":"top: 100%; margin-top: 5px;";p.style.cssText=`
    position: absolute;
    ${c}
    left: 50%;
    transform: translateX(-50%);
    background: rgba(15, 15, 18, 0.95);
    border: 1px solid rgba(16, 185, 129, 0.6);
    color: #34d399;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 6px;
    white-space: nowrap;
    pointer-events: auto;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.8);
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    transition: all 0.2s ease;
    z-index: 10010;
  `,l.appendChild(document.createTextNode(t.icon)),l.appendChild(p),l.onclick=(d)=>{d.preventDefault(),d.stopPropagation();let r=document.getElementById("otter-radial-toggle");if(r)r.click();t.action()},e.appendChild(l)}function U(){let e=K();if(!e)return;let t=e.closest("form"),o=e.closest("#composer-background")||e.closest('[data-testid="composer-container"]')||e.closest('div[class*="composer"]')||e.closest('div[class*="overflow-hidden"]'),n=t||o&&o.parentElement||e.parentElement;if(!n)return;document.querySelectorAll("#otter-quick-chips, #otter-folder-picker-bar, #chatmcp-folder-picker-bar").forEach((m)=>m.remove());let i=document.getElementById("otter-radial-menu-container");if(document.getElementById("otter-radial-toggle")&&i&&i.parentElement===n)return;if(!i||i.parentElement!==n){if(i)i.remove();if(i=document.createElement("div"),i.id="otter-radial-menu-container",i.style.cssText=`
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      padding: 2px 4px;
      z-index: 10001;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `,o&&o.parentElement===n)n.insertBefore(i,o);else n.insertBefore(i,n.firstChild)}let l=document.getElementById("otter-radial-backdrop");if(l)l.remove();i.innerHTML=`
    <button type="button" id="otter-radial-toggle" title="${s("cmd_quick_chips_label")}" style="
      width: 42px;
      height: 42px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.3);
      background: ${k?"linear-gradient(135deg, #ef4444 0%, #dc2626 100%)":"linear-gradient(135deg, #10b981 0%, #059669 100%)"};
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: ${k?"0 4px 16px rgba(239, 68, 68, 0.6)":"0 4px 14px rgba(16, 185, 129, 0.5)"};
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      position: relative;
      z-index: 10005;
      outline: none;
      user-select: none;
      font-size: 19px;
    ">
      <span id="otter-radial-toggle-icon" style="display:inline-block; transition:transform 0.3s ease; transform: ${k?"rotate(90deg)":"rotate(0deg)"};">${k?"✕":"⚡"}</span>
    </button>

    <span id="otter-radial-label" style="
      font-size: 12px;
      font-weight: 600;
      color: #34d399;
      cursor: pointer;
      user-select: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      opacity: ${k?"0":"0.95"};
      pointer-events: ${k?"none":"auto"};
      transition: opacity 0.2s ease;
    ">
      ${s("cmd_quick_chips_label")}
    </span>

    <div id="otter-radial-satellites" style="
      position: absolute;
      left: 21px;
      top: 21px;
      width: 0;
      height: 0;
      pointer-events: none;
      z-index: 10005;
    "></div>
  `;let p=i.querySelector("#otter-radial-satellites"),c=i.querySelector("#otter-radial-toggle"),d=i.querySelector("#otter-radial-label"),r=[{id:"tool-folder",icon:"\uD83D\uDCC1",label:"Thư mục",title:s("picker_folder_title"),action:()=>ge()},{id:"tool-file",icon:"\uD83D\uDCC4",label:"File",title:s("picker_file_title"),action:()=>_e()},{id:"tool-commands",icon:"\uD83D\uDCA1",label:"Lệnh mẫu",title:s("picker_commands_title"),action:()=>Le()},{id:"tool-add",icon:"➕",label:"Thêm",title:s("cmd_add_command"),action:()=>{Le(),setTimeout(()=>{let m=document.getElementById("otter-palette-add-btn");if(m)m.click()},50)}}],u=J().filter((m)=>m.isPinned);if(u.length===0)u=Z.slice(0,4).map((m)=>({...m,isPinned:!0}));let g=u.map((m)=>({id:m.id,icon:m.icon,label:m.slash,title:`${m.title}: ${m.description||m.promptTemplate}`,action:()=>V(m,"",!0)})),h=95,_=-145,y=-35;r.forEach((m,v)=>{let f=(r.length===1?-90:_+v*((y-_)/(r.length-1)))*Math.PI/180,S=Math.round(h*Math.cos(f)),P=Math.round(h*Math.sin(f));Ee(p,m,S,P,v,"bottom")});let C=g.length>8,w=C?-165:-155,T=C?-15:-25;g.forEach((m,v)=>{let f=(g.length===1?-90:w+v*((T-w)/(g.length-1)))*Math.PI/180,S=v%2===1,P=C?S?245:185:185,N=C?S?"top":"bottom":"top",B=Math.round(P*Math.cos(f)),H=Math.round(P*Math.sin(f));Ee(p,m,B,H,r.length+v,N)});function x(m){k=m;let v=document.getElementById("otter-radial-toggle-icon");if(c)c.style.background=k?"linear-gradient(135deg, #ef4444 0%, #dc2626 100%)":"linear-gradient(135deg, #10b981 0%, #059669 100%)",c.style.boxShadow=k?"0 4px 16px rgba(239, 68, 68, 0.6)":"0 4px 14px rgba(16, 185, 129, 0.5)";if(v)v.textContent=k?"✕":"⚡",v.style.transform=k?"rotate(90deg)":"rotate(0deg)";if(d)d.style.opacity=k?"0":"0.95",d.style.pointerEvents=k?"none":"auto";p.querySelectorAll(".otter-satellite-item").forEach((f,S)=>{let P=f.getAttribute("data-x")||"0",N=f.getAttribute("data-y")||"0";if(k)f.style.opacity="1",f.style.pointerEvents="auto",f.style.transform=`translate(${P}px, ${N}px) scale(1)`,f.style.transitionDelay=`${S*20}ms`;else f.style.opacity="0",f.style.pointerEvents="none",f.style.transform="translate(0px, 0px) scale(0.2)",f.style.transitionDelay="0ms"})}if(c.onclick=(m)=>{m.preventDefault(),m.stopPropagation(),x(!k)},d.onclick=(m)=>{m.preventDefault(),m.stopPropagation(),x(!k)},!window._otterRadialEscBound)window._otterRadialEscBound=!0,window.addEventListener("keydown",(m)=>{if(m.key==="Escape"&&k)x(!1)});if(!window._otterRadialClickOutsideBound)window._otterRadialClickOutsideBound=!0,document.addEventListener("pointerdown",(m)=>{if(!k)return;let v=m.target;if(!v)return;if(!v.closest("#otter-radial-menu-container"))x(!1)});if(k)x(!0)}function K(){let e=document.querySelector("#prompt-textarea")||document.querySelector('[data-testid="composer-text-input"]')||document.querySelector('[data-testid="prompt-textarea"]');if(e)return e;let t=document.querySelector("form [contenteditable='true'], form textarea");if(t)return t;let o=Array.from(document.querySelectorAll("[contenteditable='true']"));if(o.length>0)return o[o.length-1];return document.querySelector("textarea[tabindex='0']")}function Se(e,t="",o=!1){let n=K();if(!n)return;if(n.focus(),n.isContentEditable||n.getAttribute("contenteditable")==="true"){let i=n.innerText||n.textContent||"";if(t&&i.endsWith(t))i=i.slice(0,i.length-t.length);let a=i.trim()?`${i.trim()}
${e}`:e,l=window.getSelection();if(l)l.selectAllChildren(n),l.collapseToEnd();try{let p=new DataTransfer;p.setData("text/plain",a);let c=new ClipboardEvent("paste",{clipboardData:p,bubbles:!0,cancelable:!0});n.dispatchEvent(c)}catch{document.execCommand("insertText",!1,a)}n.dispatchEvent(new InputEvent("input",{bubbles:!0,inputType:"insertText",data:a})),n.dispatchEvent(new Event("change",{bubbles:!0}))}else if(n instanceof HTMLTextAreaElement){let i=n.value||"";if(t&&i.endsWith(t))i=i.slice(0,i.length-t.length);let a=i.trim()?`${i.trim()}
${e}`:e,l=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value")?.set;if(l)l.call(n,a);else n.value=a;n.dispatchEvent(new Event("input",{bubbles:!0})),n.dispatchEvent(new Event("change",{bubbles:!0}))}if(o)X().catch(()=>{})}function V(e,t="",o=!1){if(e.action==="export-markdown"){let{title:a,markdown:l}=ve();ke(a,l),Ce();return}let n=()=>{if(e.isCustom)fetch(`http://127.0.0.1:1993/api/commands/${e.id}/use`,{method:"POST"}).catch(()=>{})},i=Q(e.promptTemplate);if(i.length===0){Se(e.promptTemplate,t,o),n();return}ye(e.title,i,(a)=>{Se(be(e.promptTemplate,a),t,!0),n()})}var O=null;function Le(){if(O)O.remove(),O=null;let e=document.createElement("div");e.id="otter-command-palette-overlay",e.style.cssText=`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    z-index: 100002;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    animation: otter-fade-in 0.15s ease-out;
  `;let t=document.createElement("div");t.style.cssText=`
    background: #18181b;
    border: 1px solid #333338;
    border-radius: 14px;
    width: 600px;
    max-width: 92vw;
    max-height: 80vh;
    box-shadow: 0 20px 45px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(16, 185, 129, 0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #f4f4f5;
  `;let o=document.createElement("div");o.style.cssText=`
    padding: 14px 18px;
    border-bottom: 1px solid #27272a;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #202024;
  `,o.innerHTML=`
    <div style="display:flex; align-items:center; gap:8px;">
      <span style="font-size:18px;">\uD83E\uDDA6</span>
      <strong style="font-size:14px; color:#ffffff;">${s("cmd_modal_title")}</strong>
      <span style="font-size:11px; background:#10b981; color:#000; padding:2px 6px; border-radius:9999px; font-weight:700;">PRO</span>
    </div>
    <div style="display:flex; align-items:center; gap:8px;">
      <button id="otter-palette-add-btn" style="background:#059669; border:none; border-radius:6px; color:#fff; font-size:11px; font-weight:600; padding:4px 9px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; transition:background 0.15s ease;">
        <span>${s("cmd_add_command")}</span>
      </button>
      <button id="otter-palette-close" style="background:none; border:none; color:#a1a1aa; font-size:18px; cursor:pointer; padding:0 4px; line-height:1;" title="${s("cmd_close")} (Esc)">&times;</button>
    </div>
  `;let n=document.createElement("div");n.id="otter-create-form",n.style.cssText=`
    display: none;
    padding: 12px 18px;
    background: #141416;
    border-bottom: 1px solid #27272a;
    flex-direction: column;
    gap: 8px;
  `,n.innerHTML=`
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong style="font-size:12px; color:#34d399;">${s("cmd_create_title")}</strong>
      <button id="otter-create-cancel" style="background:none; border:none; color:#a1a1aa; font-size:11px; cursor:pointer;">${s("cmd_close")}</button>
    </div>
    <div style="display:grid; grid-template-columns: 60px 130px 1fr; gap:6px;">
      <input id="otter-new-icon" type="text" placeholder="⚡" value="⚡" style="background:#27272a; border:1px solid #3f3f46; border-radius:6px; color:#fff; padding:6px; font-size:12px; text-align:center;">
      <input id="otter-new-slash" type="text" placeholder="${s("cmd_placeholder_slash")}" style="background:#27272a; border:1px solid #3f3f46; border-radius:6px; color:#34d399; font-weight:700; padding:6px 8px; font-size:12px;">
      <input id="otter-new-title" type="text" placeholder="${s("cmd_placeholder_title")}" style="background:#27272a; border:1px solid #3f3f46; border-radius:6px; color:#fff; padding:6px 8px; font-size:12px;">
    </div>
    <textarea id="otter-new-prompt" placeholder="${s("cmd_placeholder_prompt")}" rows="2" style="width:100%; box-sizing:border-box; background:#27272a; border:1px solid #3f3f46; border-radius:6px; color:#fff; padding:6px 8px; font-size:12px; font-family:monospace; resize:vertical;"></textarea>
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <label style="display:flex; align-items:center; gap:6px; font-size:11px; color:#d1d5db; cursor:pointer;">
        <input id="otter-new-pin" type="checkbox" checked style="accent-color:#10b981;">
        <span>${s("cmd_pin_checkbox")}</span>
      </label>
      <button id="otter-create-submit" style="background:#10b981; border:none; border-radius:6px; color:#000; font-weight:700; font-size:11px; padding:6px 12px; cursor:pointer;">${s("cmd_save_command")}</button>
    </div>
    <div id="otter-create-msg" style="font-size:11px; display:none;"></div>
  `;let i=document.createElement("div");i.style.cssText="padding: 10px 18px; border-bottom: 1px solid #27272a; background: #18181b;";let a=document.createElement("input");a.placeholder=s("cmd_search_placeholder"),a.style.cssText=`
    width: 100%;
    box-sizing: border-box;
    background: #27272a;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    color: #fff;
    padding: 8px 12px;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s ease;
  `,a.onfocus=()=>a.style.borderColor="#10b981",a.onblur=()=>a.style.borderColor="#3f3f46",i.appendChild(a);let l=document.createElement("div");l.style.cssText=`
    flex: 1;
    overflow-y: auto;
    padding: 10px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `;function p(_=""){l.innerHTML="";let y=_.toLowerCase().trim(),w=J().filter((x)=>x.title.toLowerCase().includes(y)||x.slash.toLowerCase().includes(y)||x.category.toLowerCase().includes(y)||x.description.toLowerCase().includes(y));if(w.length===0){l.innerHTML=`<div style="text-align:center; padding:30px; color:#71717a; font-size:13px;">${s("cmd_no_match")} "${D(_)}".</div>`;return}let T={};for(let x of w){let m=x.isPinned?s("cmd_pinned_category"):x.category;if(!T[m])T[m]=[];T[m].push(x)}for(let[x,m]of Object.entries(T)){let v=document.createElement("div");v.style.cssText="font-size: 11px; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;",v.textContent=x,l.appendChild(v);for(let b of m){let f=document.createElement("div");f.style.cssText=`
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-radius: 8px;
          background: #202024;
          border: 1px solid #2d2d32;
          cursor: pointer;
          transition: all 0.12s ease;
        `,f.onmouseenter=()=>{f.style.background="#2a2a30",f.style.borderColor="#10b981"},f.onmouseleave=()=>{f.style.background="#202024",f.style.borderColor="#2d2d32"},f.onclick=()=>{V(b,"",!0),e.remove(),O=null};let S=b.isPinned||A.has(b.id);f.innerHTML=`
          <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
            <span style="font-size:18px; line-height:1;">${b.icon}</span>
            <div style="min-width:0;">
              <div style="display:flex; align-items:center; gap:6px;">
                <strong style="font-size:13px; color:#ffffff;">${D(b.title)}</strong>
                <code style="background:#27272a; color:#34d399; font-size:11px; padding:1px 5px; border-radius:4px; font-family:monospace;">${D(b.slash)}</code>
                ${b.isCustom?`<span style="font-size:9px; background:#059669; color:#fff; padding:1px 4px; border-radius:3px;">${s("cmd_badge_custom")}</span>`:""}
              </div>
              <div style="font-size:11px; color:#9ca3af; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">${D(b.description||b.promptTemplate)}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <button type="button" class="otter-pin-toggle-btn" title="${S?s("cmd_pin_tooltip_pinned"):s("cmd_pin_tooltip_unpinned")}" style="
              background: ${S?"rgba(234, 179, 8, 0.2)":"transparent"};
              border: 1px solid ${S?"#eab308":"#3f3f46"};
              color: ${S?"#eab308":"#71717a"};
              border-radius: 6px;
              cursor: pointer;
              font-size: 11px;
              padding: 3px 8px;
              display: inline-flex;
              align-items: center;
              gap: 3px;
              user-select: none;
            ">
              <span>${S?s("cmd_pin_btn_pinned"):s("cmd_pin_btn_unpinned")}</span>
            </button>
            ${b.isCustom?`
              <button type="button" class="otter-delete-cmd-btn" title="${s("cmd_delete_tooltip")}" style="
                background: transparent;
                border: 1px solid #3f3f46;
                color: #ef4444;
                border-radius: 6px;
                cursor: pointer;
                font-size: 11px;
                padding: 3px 6px;
              ">\uD83D\uDDD1️</button>
            `:""}
            <span style="font-size:11px; color:#10b981; font-weight:600; margin-left:4px; white-space:nowrap;">${s("cmd_insert_cmd")}</span>
          </div>
        `;let P=f.querySelector(".otter-pin-toggle-btn");if(P)P.onclick=async(B)=>{if(B.preventDefault(),B.stopPropagation(),b.isCustom){let H=!b.isPinned;await fetch(`http://127.0.0.1:1993/api/commands/${b.id}/pin`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pinned:H})}).catch(()=>{}),b.isPinned=H;let se=L.find((Ve)=>Ve.id===b.id);if(se)se.isPinned=H;if(typeof chrome<"u"&&chrome.storage?.local)chrome.storage.local.set({otter_custom_commands:L})}else{if(A.has(b.id))A.delete(b.id);else A.add(b.id);if(typeof chrome<"u"&&chrome.storage?.local)chrome.storage.local.set({otter_pinned_standard_ids:Array.from(A)})}p(a.value),U()};let N=f.querySelector(".otter-delete-cmd-btn");if(N&&b.isCustom)N.onclick=async(B)=>{if(B.preventDefault(),B.stopPropagation(),confirm(s("cmd_delete_confirm",{slash:b.slash}))){if(await fetch(`http://127.0.0.1:1993/api/commands/${b.id}`,{method:"DELETE"}).catch(()=>{}),L=L.filter((H)=>H.id!==b.id),typeof chrome<"u"&&chrome.storage?.local)chrome.storage.local.set({otter_custom_commands:L});p(a.value),U()}};l.appendChild(f)}}}let c=o.querySelector("#otter-palette-add-btn"),d=n.querySelector("#otter-create-cancel"),r=n.querySelector("#otter-create-submit"),u=n.querySelector("#otter-create-msg");if(c&&d&&r)c.onclick=()=>{if(n.style.display=n.style.display==="flex"?"none":"flex",n.style.display==="flex")n.querySelector("#otter-new-slash")?.focus()},d.onclick=()=>{n.style.display="none"},r.onclick=async()=>{let _=n.querySelector("#otter-new-icon").value.trim()||"⚡",y=n.querySelector("#otter-new-slash").value.trim(),C=n.querySelector("#otter-new-title").value.trim(),w=n.querySelector("#otter-new-prompt").value.trim(),T=n.querySelector("#otter-new-pin").checked;if(!y||!C||!w){if(u)u.style.display="block",u.style.color="#ef4444",u.textContent=s("cmd_error_fields");return}r.disabled=!0,r.textContent=s("cmd_saving");try{let m=await(await fetch("http://127.0.0.1:1993/api/commands",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({icon:_,slash:y,title:C,promptTemplate:w,isPinned:T})})).json();if(m.ok&&m.command){if(await Pe(),n.style.display="none",p(a.value),U(),u)u.style.display="none"}else throw Error(m.error||"Không thể lưu tập lệnh.")}catch(x){if(u)u.style.display="block",u.style.color="#ef4444",u.textContent=`Lỗi: ${x.message}`}finally{r.disabled=!1,r.textContent=s("cmd_save_command")}};a.oninput=()=>{p(a.value)},p();let g=document.createElement("div");g.style.cssText=`
    padding: 10px 18px;
    background: #121215;
    border-top: 1px solid #27272a;
    font-size: 11px;
    color: #71717a;
    display: flex;
    justify-content: space-between;
    align-items: center;
  `,g.innerHTML=`
    <span>${s("cmd_hint_tip")}</span>
    <span>${s("cmd_hint_esc")}</span>
  `,t.appendChild(o),t.appendChild(n),t.appendChild(i),t.appendChild(l),t.appendChild(g),e.appendChild(t),document.body.appendChild(e),O=e,setTimeout(()=>a.focus(),50),e.onclick=(_)=>{if(_.target===e)e.remove(),O=null},o.querySelector("#otter-palette-close")?.addEventListener("click",()=>{e.remove(),O=null});let h=(_)=>{if(_.key==="Escape")e.remove(),O=null,window.removeEventListener("keydown",h)};window.addEventListener("keydown",h)}class Ae{popup=null;activeIndex=0;currentMatches=[];currentPrefix="";init(){document.addEventListener("input",(e)=>this.handleInput(e),!0),document.addEventListener("keydown",(e)=>this.handleKeyDown(e),!0)}getComposerText(){let e=K();if(!e)return"";return e.isContentEditable||e.getAttribute("contenteditable")==="true"?e.innerText||e.textContent||"":e.value||""}handleInput(e){let o=this.getComposerText().match(/(?:^|\s)\/([a-zA-Z0-9_\-]*)$/);if(o){this.currentPrefix=o[0].trim();let n=o[1].toLowerCase();if(this.currentMatches=J().filter((i)=>i.slash.slice(1).toLowerCase().startsWith(n)||i.title.toLowerCase().includes(n)).slice(0,7),this.currentMatches.length>0)this.showPopup();else this.hidePopup()}else this.hidePopup()}handleKeyDown(e){if(!this.popup)return;if(e.key==="ArrowDown")e.preventDefault(),this.activeIndex=(this.activeIndex+1)%this.currentMatches.length,this.updateSelection();else if(e.key==="ArrowUp")e.preventDefault(),this.activeIndex=(this.activeIndex-1+this.currentMatches.length)%this.currentMatches.length,this.updateSelection();else if(e.key==="Enter"||e.key==="Tab"){if(this.currentMatches[this.activeIndex]){e.preventDefault(),e.stopPropagation();let t=this.currentMatches[this.activeIndex];V(t,this.currentPrefix),this.hidePopup()}}else if(e.key==="Escape")e.preventDefault(),this.hidePopup()}showPopup(){let e=K();if(!e)return;if(!this.popup)this.popup=document.createElement("div"),this.popup.id="otter-slash-autocomplete",this.popup.style.cssText=`
        position: fixed;
        width: 360px;
        background: #18181b;
        border: 1px solid #3f3f46;
        border-radius: 10px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(16, 185, 129, 0.35);
        z-index: 100001;
        overflow: hidden;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #fff;
        display: flex;
        flex-direction: column;
      `,document.body.appendChild(this.popup);let t=e.getBoundingClientRect(),o=Math.min(this.currentMatches.length*48+36,280),n=Math.max(10,t.top-o-8),i=Math.min(Math.max(12,t.left),window.innerWidth-380);this.popup.style.top=`${n}px`,this.popup.style.left=`${i}px`,this.activeIndex=0,this.renderItems()}renderItems(){if(!this.popup)return;let e=`
      <div style="padding:6px 10px; background:#202024; border-bottom:1px solid #2d2d32; font-size:11px; color:#a1a1aa; display:flex; justify-content:space-between; align-items:center;">
        <span>${s("cmd_autocomplete_header")}</span>
        <span>${s("cmd_autocomplete_nav")}</span>
      </div>
      <div id="otter-slash-list" style="display:flex; flex-direction:column; padding:4px;">
    `;this.currentMatches.forEach((o,n)=>{let i=n===this.activeIndex,a=o.isPinned||A.has(o.id);e+=`
        <div class="otter-slash-item" data-idx="${n}" style="
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 6px;
          cursor: pointer;
          background: ${i?"#27272a":"transparent"};
          border-left: 3px solid ${i?"#10b981":"transparent"};
          transition: background 0.1s ease;
        ">
          <span style="font-size:16px;">${o.icon}</span>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:6px;">
              <code style="color:#34d399; font-weight:700; font-size:12px;">${D(o.slash)}</code>
              ${a?`<span style="font-size:10px;" title="${s("cmd_pin_btn_pinned")}">⭐</span>`:""}
              <span style="font-size:12px; color:#ffffff; font-weight:500;">${D(o.title)}</span>
              ${o.isCustom?`<span style="font-size:9px; background:#059669; color:#fff; padding:1px 4px; border-radius:3px;">${s("cmd_badge_custom")}</span>`:""}
            </div>
            <div style="font-size:11px; color:#9ca3af; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${D(o.description||o.promptTemplate)}</div>
          </div>
        </div>
      `}),e+="</div>",this.popup.innerHTML=e,this.popup.querySelectorAll(".otter-slash-item").forEach((o,n)=>{o.onclick=()=>{let i=this.currentMatches[n];if(i)V(i,this.currentPrefix),this.hidePopup()},o.onmouseenter=()=>{this.activeIndex=n,this.updateSelection()}})}updateSelection(){if(!this.popup)return;this.popup.querySelectorAll(".otter-slash-item").forEach((t,o)=>{let n=o===this.activeIndex;t.style.background=n?"#27272a":"transparent",t.style.borderLeft=`3px solid ${n?"#10b981":"transparent"}`})}hidePopup(){if(this.popup)this.popup.remove(),this.popup=null}}function Ie(){new Ae().init(),Pe(),setInterval(()=>{U()},1500),console.log("[Otter Command Palette] Initialized with Slash Commands, Custom Commands & Quick Action Chips")}function D(e){if(!e)return"";return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}var ee={30:"#484f58",31:"#ff7b72",32:"#7ee787",33:"#f2cc60",34:"#58a6ff",35:"#bc8cff",36:"#39c5cf",37:"#d2a8ff",90:"#8b949e",91:"#ffa198",92:"#56d364",93:"#e3b341",94:"#79c0ff",95:"#d2a8ff",96:"#56d4dd",97:"#ffffff"},Oe={40:"#161b22",41:"#b62324",42:"#238636",43:"#9e6a03",44:"#1f6feb",45:"#8957e5",46:"#1b7c83",47:"#6e7681"};function ct(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}class te{pending="";fgColor=null;bgColor=null;bold=!1;dim=!1;italic=!1;underline=!1;reset(){this.pending="",this.fgColor=null,this.bgColor=null,this.bold=!1,this.dim=!1,this.italic=!1,this.underline=!1}toHtml(e){let t=this.pending+e;this.pending="";let o=t.match(/\x1b(?:\[[0-9;?]*)?$/);if(o)this.pending=o[0],t=t.slice(0,t.length-o[0].length);if(!t)return"";let n=/\x1b\[([0-9;?]*)m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]/g,i=0,a="",l;while((l=n.exec(t))!==null){let c=t.slice(i,l.index);if(c)a+=this.renderStyledText(c);if(i=n.lastIndex,l[1]!==void 0)this.processSgr(l[1])}let p=t.slice(i);if(p)a+=this.renderStyledText(p);return a}renderStyledText(e){let t=e.replace(/\r\n/g,`
`).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,"");if(!t)return"";let o=[];if(this.fgColor)o.push(`color:${this.fgColor}`);if(this.bgColor)o.push(`background-color:${this.bgColor}`);if(this.bold)o.push("font-weight:600");if(this.dim)o.push("opacity:0.7");if(this.italic)o.push("font-style:italic");if(this.underline)o.push("text-decoration:underline");let n=ct(t);if(o.length>0)return`<span style="${o.join(";")}">${n}</span>`;return n}processSgr(e){let t=e===""?[0]:e.split(";").map(Number);for(let o=0;o<t.length;o++){let n=t[o];if(n===0)this.fgColor=null,this.bgColor=null,this.bold=!1,this.dim=!1,this.italic=!1,this.underline=!1;else if(n===1)this.bold=!0;else if(n===2)this.dim=!0;else if(n===3)this.italic=!0;else if(n===4)this.underline=!0;else if(n===22)this.bold=!1,this.dim=!1;else if(n===23)this.italic=!1;else if(n===24)this.underline=!1;else if(n===39)this.fgColor=null;else if(n===49)this.bgColor=null;else if(ee[n])this.fgColor=ee[n];else if(Oe[n])this.bgColor=Oe[n];else if(n===38&&t[o+1]===5){let i=t[o+2];this.fgColor=ee[i]||null,o+=2}else if(n===38&&t[o+1]===2){let i=t[o+2],a=t[o+3],l=t[o+4];this.fgColor=`rgb(${i},${a},${l})`,o+=4}}}}class ne{conversationId;container;preOutput;inputField;statusBadge;isOpen=!1;currentSessionId=null;currentSequence=0;pollingActive=!1;ansiParser=new te;constructor(e){this.conversationId=e;this.container=document.createElement("div"),this.container.id="otter-terminal-panel",this.container.className="chatmcp-terminal-panel",this.container.style.cssText=`
      position: fixed;
      right: 24px;
      bottom: 24px;
      width: 680px;
      height: 440px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 12px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
      display: none;
      flex-direction: column;
      z-index: 999999;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      overflow: hidden;
      backdrop-filter: blur(12px);
    `;let t=document.createElement("div");t.style.cssText=`
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      user-select: none;
      cursor: move;
    `;let o=document.createElement("div");o.style.cssText="display: flex; align-items: center; gap: 8px;",this.statusBadge=document.createElement("span"),this.statusBadge.style.cssText=`
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #238636;
      box-shadow: 0 0 6px #238636;
    `;let n=document.createElement("strong");n.textContent=s("term_title"),n.style.cssText="font-size: 13px; color: #e6edf3;",o.appendChild(this.statusBadge),o.appendChild(n);let i=document.createElement("div");i.style.cssText="display: flex; gap: 8px;";let a=document.createElement("button");a.textContent=s("term_copy"),a.style.cssText=`
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      cursor: pointer;
    `,a.onclick=()=>{navigator.clipboard.writeText(this.preOutput.innerText||""),a.textContent=s("term_copied"),setTimeout(()=>a.textContent=s("term_copy"),1500)};let l=document.createElement("button");l.textContent=s("term_clear"),l.style.cssText=`
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      cursor: pointer;
    `,l.onclick=()=>{this.clearOutput()};let p=document.createElement("button");p.textContent="✕",p.style.cssText=`
      background: transparent;
      border: none;
      color: #8b949e;
      font-size: 14px;
      cursor: pointer;
      padding: 2px 6px;
    `,p.onclick=()=>this.hide(),i.appendChild(a),i.appendChild(l),i.appendChild(p),t.appendChild(o),t.appendChild(i),this.preOutput=document.createElement("pre"),this.preOutput.style.cssText=`
      flex: 1;
      margin: 0;
      padding: 12px;
      overflow-y: auto;
      color: #e6edf3;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-all;
    `,this.appendOutput(`\x1B[90m${s("term_connected")}\x1B[0m`);let c=document.createElement("div");c.style.cssText=`
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: #161b22;
      border-top: 1px solid #30363d;
    `;let d=document.createElement("span");d.textContent="$",d.style.color="#7ee787",d.style.fontWeight="bold",this.inputField=document.createElement("input"),this.inputField.type="text",this.inputField.placeholder=s("term_placeholder"),I(()=>{n.textContent=s("term_title"),a.textContent=s("term_copy"),l.textContent=s("term_clear"),this.inputField.placeholder=s("term_placeholder")}),this.inputField.style.cssText=`
      flex: 1;
      background: transparent;
      border: none;
      color: #e6edf3;
      font-family: inherit;
      font-size: 12px;
      outline: none;
    `,this.inputField.addEventListener("keydown",async(r)=>{if(r.key==="Enter"){let u=this.inputField.value;this.inputField.value="",await this.sendInput(u+`\r
`)}}),c.appendChild(d),c.appendChild(this.inputField),this.container.appendChild(t),this.container.appendChild(this.preOutput),this.container.appendChild(c),document.body.appendChild(this.container),this.setupDraggable(t)}setupDraggable(e){let t=!1,o=0,n=0,i=0,a=0;e.onmousedown=(l)=>{t=!0,o=l.clientX,n=l.clientY;let p=this.container.getBoundingClientRect();i=p.left,a=p.top;let c=(r)=>{if(!t)return;let u=r.clientX-o,g=r.clientY-n;this.container.style.left=`${i+u}px`,this.container.style.top=`${a+g}px`,this.container.style.right="auto",this.container.style.bottom="auto"},d=()=>{t=!1,document.removeEventListener("mousemove",c),document.removeEventListener("mouseup",d)};document.addEventListener("mousemove",c),document.addEventListener("mouseup",d)}}show(){this.isOpen=!0,this.container.style.display="flex",this.inputField.focus(),this.loadTerminals()}hide(){this.isOpen=!1,this.container.style.display="none",this.pollingActive=!1}toggle(){if(this.isOpen)this.hide();else this.show()}clearOutput(){this.preOutput.replaceChildren(),this.ansiParser.reset()}appendOutput(e){let t=this.ansiParser.toHtml(e);if(!t)return;let o=document.createElement("template");o.innerHTML=t,this.preOutput.appendChild(o.content),this.preOutput.scrollTop=this.preOutput.scrollHeight}async loadTerminals(){try{let e=await chrome.runtime.sendMessage({type:"terminal-list",conversationId:this.conversationId});if(e?.ok&&Array.isArray(e.terminals)&&e.terminals.length>0)this.currentSessionId=e.terminals[0].id,this.startLivePolling()}catch(e){console.error("[Otter Terminal] Failed to load terminals:",e)}}async startLivePolling(){if(this.pollingActive||!this.currentSessionId)return;this.pollingActive=!0;while(this.isOpen&&this.pollingActive&&this.currentSessionId)try{let e=await chrome.runtime.sendMessage({type:"terminal-output",conversationId:this.conversationId,sessionId:this.currentSessionId,afterSequence:this.currentSequence,waitMs:5000});if(e?.ok&&e.result?.events){for(let t of e.result.events)if(t.sequence>this.currentSequence)this.currentSequence=t.sequence,this.appendOutput(t.data)}}catch{await new Promise((e)=>setTimeout(e,2000))}this.pollingActive=!1}async sendInput(e){if(!this.currentSessionId)return;try{await chrome.runtime.sendMessage({type:"terminal-input",conversationId:this.conversationId,sessionId:this.currentSessionId,text:e})}catch(t){console.error("[Otter Terminal] Input error:",t)}}}class oe{host;shadow;constructor(){this.host=document.createElement("div"),this.host.id="otter-plan-overlay",this.shadow=this.host.attachShadow({mode:"closed"}),document.body.appendChild(this.host)}showQuestion(e,t){this.shadow.innerHTML=`
      <style>
        .overlay {
          position: fixed;
          top: 80px;
          right: 32px;
          width: 360px;
          background: #1c2128;
          border: 1px solid #388bfd;
          border-radius: 12px;
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
          padding: 16px;
          z-index: 1000000;
          font-family: system-ui, sans-serif;
          color: #f0f6fc;
          animation: slideIn 0.3s ease-out;
        }
        @keyframes slideIn {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          color: #58a6ff;
          font-weight: 600;
          font-size: 13px;
        }
        .question {
          font-size: 14px;
          margin-bottom: 14px;
          line-height: 1.5;
        }
        .options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .btn {
          background: #21262d;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 8px 12px;
          color: #c9d1d9;
          font-size: 12px;
          cursor: pointer;
          text-align: left;
          transition: all 0.2s;
        }
        .btn:hover {
          background: #30363d;
          border-color: #58a6ff;
          color: #fff;
        }
        .dismiss {
          position: absolute;
          top: 10px;
          right: 10px;
          background: none;
          border: none;
          color: #8b949e;
          cursor: pointer;
          font-size: 14px;
        }
      </style>
      <div class="overlay">
        <button class="dismiss" id="dismiss-btn">✕</button>
        <div class="header">
          <span>${s("plan_title")}</span>
        </div>
        <div class="question">${e.question}</div>
        <div class="options" id="options-container"></div>
      </div>
    `;let o=this.shadow.getElementById("options-container"),n=this.shadow.getElementById("dismiss-btn");n.onclick=()=>this.hide();let i=e.options||[s("plan_continue"),s("plan_cancel")];for(let a of i){let l=document.createElement("button");l.className="btn",l.textContent=a,l.onclick=()=>{t(a),this.hide()},o.appendChild(l)}}hide(){this.shadow.innerHTML=""}}class ie{conversationId;onOpenTerminal;panel;triggerBtn;statusDot;statusText;serverLabel;eventsList;continuousToggle;isOpen=!1;apiBase="http://127.0.0.1:1993";mcpSection;mcpBadge;mcpServerListContainer;isMcpSectionOpen=!1;currentState="offline";currentServerName="Localhost (1993)";constructor(e,t){this.conversationId=e;this.onOpenTerminal=t;this.triggerBtn=document.createElement("button"),this.triggerBtn.id="otter-activity-trigger",this.triggerBtn.className="chatmcp-activity-trigger",this.triggerBtn.textContent="⚡ Otter",this.triggerBtn.title="Mở bảng hoạt động & điều khiển Otter",this.triggerBtn.style.cssText=`
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      background: #10a37f;
      color: #000;
      font-weight: 600;
      font-size: 12px;
      padding: 8px 14px;
      border-radius: 9999px;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(16, 163, 127, 0.4);
      transition: all 0.2s ease;
      font-family: system-ui, sans-serif;
    `,this.triggerBtn.onclick=()=>this.toggle(),document.body.appendChild(this.triggerBtn),this.panel=document.createElement("div"),this.panel.id="otter-activity-panel",this.panel.className="chatmcp-activity-panel",this.panel.style.cssText=`
      position: fixed;
      top: 0;
      right: -380px;
      width: 380px;
      height: 100vh;
      background: #171717;
      border-left: 1px solid #333;
      box-shadow: -8px 0 32px rgba(0, 0, 0, 0.6);
      z-index: 100000;
      display: flex;
      flex-direction: column;
      font-family: system-ui, sans-serif;
      color: #fff;
      transition: right 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      backdrop-filter: blur(16px);
    `;let o=document.createElement("div");o.style.cssText=`
      padding: 16px;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #1e1e1e;
    `;let n=document.createElement("div");n.style.cssText="display: flex; align-items: center; gap: 8px;",this.statusDot=document.createElement("span"),this.statusDot.style.cssText=`
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10a37f;
    `;let i=document.createElement("div");this.statusText=document.createElement("strong"),this.statusText.textContent=`\uD83E\uDDA6 ${s("activity_title")}`,this.statusText.style.cssText="font-size: 13px; display: block;",this.serverLabel=document.createElement("span"),this.serverLabel.textContent="Localhost (1993)",this.serverLabel.style.cssText="font-size: 11px; color: #888;",i.appendChild(this.statusText),i.appendChild(this.serverLabel),n.appendChild(this.statusDot),n.appendChild(i);let a=document.createElement("button");a.textContent="✕",a.style.cssText=`
      background: none;
      border: none;
      color: #888;
      font-size: 16px;
      cursor: pointer;
      padding: 4px;
    `,a.onclick=()=>this.hide(),o.appendChild(n),o.appendChild(a);let l=document.createElement("div");l.style.cssText=`
      padding: 12px 16px;
      border-bottom: 1px solid #2a2a2a;
      background: #141414;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;let p=document.createElement("label");p.style.cssText="display: flex; align-items: center; justify-content: space-between; font-size: 12px; cursor: pointer;",p.innerHTML=`<span>${s("activity_continuous")}</span>`,this.continuousToggle=document.createElement("input"),this.continuousToggle.type="checkbox",this.continuousToggle.onchange=()=>this.toggleContinuous(this.continuousToggle.checked),p.appendChild(this.continuousToggle);let c=document.createElement("label");c.style.cssText="display: flex; align-items: center; justify-content: space-between; font-size: 12px; gap: 8px;",c.innerHTML=`<span>${s("panel_node_label")}</span>`;let d=document.createElement("select");d.style.cssText="background: #252525; border: 1px solid #3a3a3a; color: #fff; border-radius: 6px; padding: 5px; font-size: 12px; max-width: 220px;",d.onchange=async()=>{try{await chrome.runtime.sendMessage({type:"set-tab-server",serverId:d.value}),await chrome.runtime.sendMessage({type:"tab-connect",conversationUrl:location.href,conversationId:this.conversationId})}catch(m){console.error("[Otter ActivityPanel] Failed to switch node:",m)}},c.appendChild(d),l.appendChild(c),(async()=>{try{let m=await chrome.runtime.sendMessage({type:"get-servers"}),v=m?.servers||[];for(let b of v){let f=document.createElement("option");if(f.value=b.id,f.textContent=`${b.name} (${b.apiBase})`,b.id===m?.current)f.selected=!0;d.appendChild(f)}}catch{}})();let r=document.createElement("button");r.textContent=s("activity_open_term"),r.style.cssText=`
      background: #252525;
      border: 1px solid #3a3a3a;
      color: #58a6ff;
      border-radius: 6px;
      padding: 7px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    `,r.onclick=()=>{this.onOpenTerminal(),this.hide()};let u=document.createElement("button");u.style.cssText=`
      background: #252525;
      border: 1px solid #3a3a3a;
      color: #10a37f;
      border-radius: 6px;
      padding: 7px 10px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
    `,u.innerHTML=`<span>${s("activity_mcp_config")}</span>`,this.mcpBadge=document.createElement("span"),this.mcpBadge.textContent="0",this.mcpBadge.style.cssText="font-size: 10px; padding: 2px 7px; border-radius: 10px; background: rgba(16, 163, 127, 0.2); color: #10a37f; font-weight: 600;",u.appendChild(this.mcpBadge),u.onclick=()=>this.toggleMcpSection(),I(()=>{this.statusText.textContent=`\uD83E\uDDA6 ${s("activity_title")}`,this.updateStatus(this.currentState,this.currentServerName),r.textContent=s("activity_open_term");let m=u.querySelector("span");if(m)m.textContent=s("activity_mcp_config");let v=p.querySelector("span");if(v)v.textContent=s("activity_continuous")}),l.appendChild(p),l.appendChild(r),l.appendChild(u),this.mcpSection=document.createElement("div"),this.mcpSection.style.cssText=`
      display: none;
      background: #191919;
      border-bottom: 1px solid #2a2a2a;
      padding: 12px 14px;
      font-size: 12px;
      flex-direction: column;
      gap: 10px;
      max-height: 340px;
      overflow-y: auto;
    `;let g=document.createElement("div");g.style.cssText="display: flex; justify-content: space-between; align-items: center; font-weight: 600; color: #ccc;",g.innerHTML=`<span>${s("panel_mcp_header")}</span>`;let h=document.createElement("button");h.textContent=s("panel_refresh"),h.style.cssText="background: none; border: none; color: #58a6ff; font-size: 11px; cursor: pointer; padding: 2px 4px;",h.onclick=()=>this.fetchMcpServers(!0),g.appendChild(h),this.mcpSection.appendChild(g),this.mcpServerListContainer=document.createElement("div"),this.mcpServerListContainer.style.cssText="display: flex; flex-direction: column; gap: 6px;",this.mcpSection.appendChild(this.mcpServerListContainer);let _=document.createElement("div");_.style.cssText=`
      background: #141414;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
    `,_.innerHTML=`<span style="font-size: 11px; font-weight: 600; color: #aaa;">${s("panel_add_server")}</span>`;let y=document.createElement("input");y.placeholder=s("panel_server_name_placeholder"),y.style.cssText="background: #202020; border: 1px solid #333; color: #fff; padding: 6px 8px; border-radius: 4px; font-size: 11px;";let C=document.createElement("input");C.placeholder=s("panel_server_url_placeholder"),C.style.cssText="background: #202020; border: 1px solid #333; color: #fff; padding: 6px 8px; border-radius: 4px; font-size: 11px;";let w=document.createElement("input");w.placeholder=s("panel_token_placeholder"),w.style.cssText="background: #202020; border: 1px solid #333; color: #fff; padding: 6px 8px; border-radius: 4px; font-size: 11px;";let T=document.createElement("button");T.textContent=s("panel_save_connect"),T.style.cssText="background: #10a37f; border: none; color: #000; font-weight: 600; padding: 6px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-top: 2px;";let x=document.createElement("div");x.style.cssText="font-size: 11px; min-height: 14px;",T.onclick=async()=>{let m=y.value.trim(),v=C.value.trim(),b=w.value.trim();if(!m||!v){x.style.color="#f85149",x.textContent=s("panel_enter_name_url");return}T.disabled=!0,x.style.color="#58a6ff",x.textContent=s("panel_connecting"),await this.addMcpServer(m,v,b,x),T.disabled=!1,y.value="",C.value="",w.value=""},_.appendChild(y),_.appendChild(C),_.appendChild(w),_.appendChild(T),_.appendChild(x),this.mcpSection.appendChild(_),this.eventsList=document.createElement("div"),this.eventsList.style.cssText=`
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `,this.eventsList.innerHTML=`<p style="color: #666; font-size: 12px; text-align: center; margin-top: 40px;">${s("activity_empty")}</p>`,this.panel.appendChild(o),this.panel.appendChild(l),this.panel.appendChild(this.mcpSection),this.panel.appendChild(this.eventsList),document.body.appendChild(this.panel),this.fetchMcpServers()}toggleMcpSection(){if(this.isMcpSectionOpen=!this.isMcpSectionOpen,this.mcpSection.style.display=this.isMcpSectionOpen?"flex":"none",this.isMcpSectionOpen)this.fetchMcpServers()}async fetchMcpServers(e=!1){try{if(e)await fetch(`${this.apiBase}/api/mcp/reload`,{method:"POST"}).catch(()=>{});let t=await fetch(`${this.apiBase}/api/mcp/servers`);if(!t.ok)throw Error(`HTTP ${t.status}`);let n=(await t.json()).servers||[],i=0;for(let a of n)i+=a.toolsCount||0;if(this.mcpBadge.textContent=`${n.length} (${i} tools)`,n.length>0)this.mcpBadge.style.background="rgba(16, 163, 127, 0.25)",this.mcpBadge.style.color="#10a37f";else this.mcpBadge.style.background="#333",this.mcpBadge.style.color="#888";if(n.length===0){this.mcpServerListContainer.innerHTML=`<span style="color:#777;font-size:11px;">${s("panel_no_servers")}</span>`;return}this.mcpServerListContainer.innerHTML="";for(let a of n){let l=a.status==="connected",p=document.createElement("div");p.style.cssText=`
          background: #202020;
          border: 1px solid #2d2d2d;
          border-radius: 6px;
          padding: 8px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        `;let c=document.createElement("div");c.style.cssText="overflow: hidden; padding-right: 6px;",c.innerHTML=`
          <div style="font-weight: 600; color: #fff; display: flex; align-items: center; gap: 6px;">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${l?"#10a37f":"#f85149"};"></span>
            ${a.name}
            <span style="font-size: 10px; color: ${l?"#10a37f":"#f85149"}; font-weight: normal;">
              ${l?`(${a.toolsCount} tools)`:"(Lỗi kết nối)"}
            </span>
          </div>
          <div style="font-size: 10px; color: #777; margin-top: 2px; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">
            ${a.url}
          </div>
        `;let d=document.createElement("button");d.textContent="\uD83D\uDDD1️",d.title=`Xóa máy chủ ${a.name}`,d.style.cssText="background: none; border: none; cursor: pointer; font-size: 13px; opacity: 0.6; padding: 2px 4px;",d.onmouseenter=()=>{d.style.opacity="1"},d.onmouseleave=()=>{d.style.opacity="0.6"},d.onclick=async()=>{if(confirm(s("panel_confirm_delete_server",{name:a.name})))await this.deleteMcpServer(a.name)},p.appendChild(c),p.appendChild(d),this.mcpServerListContainer.appendChild(p)}}catch(t){this.mcpBadge.textContent=s("panel_offline"),this.mcpBadge.style.color="#f85149",this.mcpServerListContainer.innerHTML=`<span style="color:#f85149;font-size:11px;">${s("panel_daemon_unreachable",{base:this.apiBase})}</span>`}}async addMcpServer(e,t,o,n){try{let i=await fetch(`${this.apiBase}/api/mcp/servers/add`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:e,url:t,token:o})}),a=await i.json();if(i.ok&&a.status==="ok")n.style.color="#10a37f",n.textContent=s("panel_added_success",{name:e}),await this.fetchMcpServers(),setTimeout(()=>{n.textContent=""},3000);else throw Error(a.error||"Thêm server thất bại")}catch(i){n.style.color="#f85149",n.textContent=s("panel_error_prefix",{message:i.message})}}async deleteMcpServer(e){try{await fetch(`${this.apiBase}/api/mcp/servers/delete`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:e})}),await this.fetchMcpServers()}catch(t){console.error("[Otter ActivityPanel] Failed to delete server:",t)}}show(){this.isOpen=!0,this.panel.style.right="0"}hide(){this.isOpen=!1,this.panel.style.right="-380px"}toggle(){if(this.isOpen)this.hide();else this.show()}updateStatus(e,t,o){if(this.currentState=e,this.currentServerName=t,this.serverLabel.textContent=t,e==="connected")this.statusDot.style.background="#10a37f",this.statusText.textContent=s("activity_connected");else if(e==="connecting")this.statusDot.style.background="#e3b341",this.statusText.textContent=s("activity_connecting");else this.statusDot.style.background="#f85149",this.statusText.textContent=s("activity_offline")}setEvents(e){if(!e||e.length===0){this.eventsList.innerHTML=`<p style="color: #666; font-size: 12px; text-align: center; margin-top: 40px;">${s("activity_empty")}</p>`;return}this.eventsList.innerHTML="";for(let t of e){let o=document.createElement("div");o.style.cssText=`
        background: #202020;
        border: 1px solid #2d2d2d;
        border-radius: 8px;
        padding: 10px;
        font-size: 12px;
      `,o.innerHTML=`
        <div style="font-weight: 600; color: #10a37f; margin-bottom: 4px;">${t.title||t.type}</div>
        <div style="color: #aaa; word-break: break-all;">${t.description||JSON.stringify(t.payload||"")}</div>
      `,this.eventsList.appendChild(o)}}async toggleContinuous(e){try{await chrome.runtime.sendMessage({type:"continuous-set",conversationId:this.conversationId,enabled:e})}catch(t){console.error("[Otter ActivityPanel] Failed to toggle continuous:",t)}}}function ae(e){let t=2166136261,o=16777619;for(let n=0;n<e.length;n++){let i=e.charCodeAt(n);t=Math.imul(t^i,16777619),o=Math.imul(o^i,2246822507)}return`turn_${(t>>>0).toString(16)}${(o>>>0).toString(16)}`}function dt(e){return e.trim().slice(0,500)}function He(e){let t=e.trim().split(/\r?\n/).map((o)=>o.trim()).filter(Boolean);return t.length>0&&(t[t.length-1]==="OTTER-DONE"||t[t.length-1].endsWith("OTTER-DONE"))}function $e(e){let t=e.trim().split(/\r?\n/).map((o)=>o.trim()).filter(Boolean);return t.length>0&&(t[t.length-1]==="OTTER-CHECKPOINT"||t[t.length-1].endsWith("OTTER-CHECKPOINT"))}var pt=['[data-chatgpt-search-unit-key*="assistant"] > div:not([data-conversation-role])','[data-content-search-unit-key*="assistant"] > div:not([data-conversation-role])','[data-conversation-role="assistant"] ~ div','[data-message-author-role="assistant"]','article[data-message-author-role="assistant"]','[data-testid="conversation-turn"] [data-message-author-role="assistant"]',"article"],ut=[".markdown",'[data-message-content="true"]',".prose"],mt=['[data-testid*="reasoning"]','[class*="reasoning"]','[class*="thinking"]'],ht=['button[aria-label*="Dừng"]','button[aria-label*="dừng"]','button[aria-label*="Stop"]','button[data-testid="stop-button"]','[data-testid="stop-button"]','button[aria-label="Stop generating"]'];function De(e){return(e?.innerText||e?.textContent||"").trim()}function Be(e,t){for(let o of t)try{let n=e?.querySelector?.(o),i=n?De(n):"";if(i)return i}catch{}return""}function gt(e,t,o){let n=e.filter((a)=>{if(a.turnId&&t.has(a.turnId))return!1;if(!a.turnId&&o.has(ae(a.text)))return!1;return!0});if(n.length===0)return{turn:null,reason:"no_new_turn"};let i=n[n.length-1];if(!i.turnId&&n.length>1){if(new Set(n.map((l)=>ae(l.text))).size>1)return{turn:null,reason:"ambiguous_no_id"}}return{turn:i,reason:"ok"}}function Re(e,t,o){let n=[],i=[],a="";for(let c of pt)try{let d=Array.from(e.querySelectorAll?.(c)||[]);if(n.push({component:`turn:${c}`,matched:d.length,total:d.length}),d.length===0)continue;if(a=c,i=d.map((r)=>{let u=Be(r,ut),g=Be(r,mt),h=u||De(r),_=u&&g?"mixed":u?"prose":"reasoning";return{turnId:r.getAttribute?.("data-turn-id")||r.closest?.("[data-turn-id]")?.getAttribute?.("data-turn-id")||r.closest?.("[data-chatgpt-search-message-ids]")?.getAttribute?.("data-chatgpt-search-message-ids")?.split(" ")[0]||r.closest?.("[data-turn-key]")?.getAttribute?.("data-turn-key")||null,text:h,kind:_,selectorUsed:c}}).filter((r)=>r.text.length>0),i.length>0)break}catch{}if(i.length===0)return{turn:null,reason:"unreadable",uiVariants:n};let l=gt(i,t,o);if(!l.turn)return{turn:null,reason:l.reason,uiVariants:n};let p=l.turn;return{turn:{turnId:p.turnId,kind:p.kind,text:p.text,textHash:ae(p.text),excerpt:dt(p.text),selectorUsed:p.selectorUsed,uiVariants:n.slice(0,40)},reason:"ok",uiVariants:n.slice(0,40)}}function Ne(e){for(let t of ht)try{let o=e.querySelector?.(t);if(o&&(o.offsetWidth||o.offsetHeight))return!0}catch{}try{if(e.querySelector?.(".result-streaming"))return!0}catch{}return!1}function ze(e,t){if(e.generating)return"generating";if(e.generationEndedAt===null)return"waiting";if(e.mcpActivityAt!==null&&t-e.mcpActivityAt<5000)return"tool_paused";if(t-e.generationEndedAt>=5000&&t-e.lastDomChangeAt>=2000)return"settled";return"waiting"}class re{loopId;callbacks;observer=null;timer=null;seenTurnIds=new Set;seenHashes=new Set;lastDomChangeAt=Date.now();generationEndedAt=null;lastGenerating=!1;lastUserTypingAt=0;reportedForCurrentTurn=!1;stopped=!1;constructor(e,t){this.loopId=e;this.callbacks=t}get userTypingRecently(){return Date.now()-this.lastUserTypingAt<1e4}start(){this.stopped=!1;let e=()=>{this.lastUserTypingAt=Date.now(),this.callbacks.onUserTyping()};document.addEventListener("keydown",e,!0),this._markTyping=e,this.observer=new MutationObserver(()=>{this.lastDomChangeAt=Date.now()});let t=document.querySelector("main")||document.body;if(t)this.observer.observe(t,{childList:!0,subtree:!0,characterData:!0});this.timer=setInterval(()=>this.tick(),500)}stop(){if(this.stopped=!0,this.observer)this.observer.disconnect(),this.observer=null;if(this.timer)clearInterval(this.timer),this.timer=null;if(this._markTyping)document.removeEventListener("keydown",this._markTyping,!0)}tick(){if(this.stopped)return;let e=Date.now(),t=Ne(document);if(this.lastGenerating&&!t)this.generationEndedAt=e;if(t)this.reportedForCurrentTurn=!1;if(this.lastGenerating=t,ze({generating:t,generationEndedAt:this.generationEndedAt,lastDomChangeAt:this.lastDomChangeAt,mcpActivityAt:null},e)!=="settled"||this.reportedForCurrentTurn)return;if(this.userTypingRecently)return;this.reportedForCurrentTurn=!0;let{turn:n,reason:i}=Re(document,this.seenTurnIds,this.seenHashes);if(!n){this.callbacks.onUnreadable(i);return}if(n.turnId)this.seenTurnIds.add(n.turnId);this.seenHashes.add(n.textHash),this.callbacks.onSettledTurn(n)}}async function qe(){if(window!==window.top)return;try{let t=(typeof chrome<"u"&&chrome.runtime?.getManifest?chrome.runtime.getManifest():null)?.version||"2.0.0";try{if(typeof chrome<"u"&&chrome.storage?.local){let a=await chrome.storage.local.get(["otter_update_snooze","otter_dismissed_version"]);if(a?.otter_update_snooze&&Date.now()<a.otter_update_snooze)return}}catch{}let o=`https://license.gpt.io.vn/api/version?component=extension&client_version=${encodeURIComponent(t)}`,n=await fetch(o,{method:"GET",headers:{Accept:"application/json"}});if(!n.ok)return;let i=await n.json();if(i.update_available)_t(i,t)}catch(e){console.debug("[Otter Update] Check error:",e)}}function _t(e,t){if(document.getElementById("otter-update-banner"))return;let o=document.createElement("div");o.id="otter-update-banner",o.innerHTML=`
    <style>
      #otter-update-banner {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.96);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(56, 189, 248, 0.4);
        border-radius: 16px;
        padding: 16px 20px;
        color: #f8fafc;
        font-family: system-ui, -apple-system, sans-serif;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(56, 189, 248, 0.2);
        max-width: 380px;
        animation: otterSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes otterSlideIn {
        from { transform: translateY(30px) scale(0.95); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
      }
      .otter-up-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }
      .otter-up-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 750;
        color: #fff;
      }
      .otter-up-badge {
        font-size: 11px;
        background: rgba(56, 189, 248, 0.2);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.4);
        padding: 1px 7px;
        border-radius: 999px;
        font-weight: 700;
      }
      .otter-up-close {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 16px;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 6px;
        line-height: 1;
      }
      .otter-up-close:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
      }
      .otter-up-desc {
        font-size: 12.5px;
        line-height: 1.5;
        color: #cbd5e1;
        margin-bottom: 12px;
      }
      .otter-up-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .otter-up-btn-primary {
        background: linear-gradient(135deg, #10b981, #059669);
        color: #022c22;
        font-size: 12.5px;
        font-weight: 700;
        border: none;
        padding: 8px 14px;
        border-radius: 8px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        text-decoration: none;
        box-shadow: 0 2px 10px rgba(16, 185, 129, 0.3);
      }
      .otter-up-btn-primary:hover {
        background: #34d399;
      }
      .otter-up-btn-secondary {
        background: rgba(255, 255, 255, 0.08);
        color: #94a3b8;
        font-size: 12px;
        font-weight: 600;
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 8px 12px;
        border-radius: 8px;
        cursor: pointer;
      }
      .otter-up-btn-secondary:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.15);
      }
    </style>
    <div class="otter-up-header">
      <div class="otter-up-title">
        <span>\uD83E\uDDA6</span>
        <span>${s("update_title")}</span>
        <span class="otter-up-badge">v${j(e.version)}</span>
      </div>
      <button class="otter-up-close" id="otter-up-btn-close" title="${s("update_close")}">✕</button>
    </div>
    <div class="otter-up-desc">
      ${j(e.changelog||s("update_default_changelog"))}
      <div style="font-size:11px; color:#94a3b8; margin-top:4px;">${s("update_current_version",{version:j(t)})}</div>
    </div>
    <div class="otter-up-actions">
      <a href="${j(e.download_url||"https://otter.gpt.io.vn/otter-extension.zip")}" target="_blank" download class="otter-up-btn-primary" id="otter-up-btn-download">
        <span>⚡</span> <span>${s("update_download")}</span>
      </a>
      <button class="otter-up-btn-secondary" id="otter-up-btn-snooze">${s("update_snooze")}</button>
    </div>
  `,document.body.appendChild(o),document.getElementById("otter-up-btn-close")?.addEventListener("click",()=>{o.remove()}),document.getElementById("otter-up-btn-snooze")?.addEventListener("click",async()=>{try{if(typeof chrome<"u"&&chrome.storage?.local)await chrome.storage.local.set({otter_update_snooze:Date.now()+86400000})}catch{}o.remove()})}function j(e){if(!e)return"";return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}class Fe{_isLeader=!1;get isLeader(){return this._isLeader}promote(){this._isLeader=!0}demote(){this._isLeader=!1}runIfLeader(e){if(this._isLeader)e()}}var ft=new Fe;async function Ue(e){if(typeof navigator>"u"||!navigator.locks){console.warn("[Otter Coordinator] navigator.locks unavailable; staying passive (not leader).");return}navigator.locks.request("otter:session-leader",async()=>{if(ft.promote(),console.log("[Otter Coordinator] Tab này đã được bầu làm Leader Tab điều phối!"),e)e();return new Promise(()=>{})}).catch((t)=>{console.warn("[Otter Coordinator] Lock request aborted:",t)})}console.log("[Otter Content] Injecting into ChatGPT Web...");window.addEventListener("unhandledrejection",(e)=>{if(e.reason?.message?.includes("Extension context invalidated")||String(e.reason).includes("Extension context invalidated"))e.preventDefault()});function Ge(){let e=location.pathname.match(/\/c\/([a-f0-9-]+)/i);return e?e[1]:"default"}function R(e){if(!chrome.runtime?.id)return Promise.resolve(null);try{return chrome.runtime.sendMessage(e).catch((t)=>null)}catch(t){return Promise.resolve(null)}}async function Ke(){await he();let e=Ge(),t=location.href;le(),fe(),Ie(),Ue(()=>{console.log("[Otter] Leader tab activated.")});let o=new ne(e),n=new oe,i=new ie(e,()=>{o.show()});qe();let a=null,l=(d)=>{a?.stop(),a=new re(d,{onSettledTurn:(r)=>{R({type:"chatgpt_turn",loopId:d,conversationId:e,turnId:r.turnId,turnHash:r.textHash,excerpt:r.excerpt,isDoneMarker:He(r.text),isCheckpointMarker:$e(r.text),selectorUsed:r.selectorUsed,uiVariants:r.uiVariants,settledAt:Date.now()})},onUnreadable:(r)=>{R({type:"page_loop_status",loopId:d,status:"blocked",reason:`turn_${r}`})},onUserTyping:()=>{R({type:"page_loop_status",loopId:d,status:"paused_user_typing"})}}),a.start()};R({type:"tab-connect",conversationUrl:t,conversationId:e});try{chrome.runtime.onMessage.addListener((d)=>{switch(d.type){case"server-status":i.updateStatus(d.state,d.serverName,d.message);break;case"activity-page":i.setEvents(d.items);break;case"terminal-broadcast":o.appendOutput(d.output);break;case"inject-prompt":{(async()=>{let r=!1,u="";for(let g=0;g<3;g++){try{r=await we(d.text,d.autoSubmit??!0,d.generationTimeoutMs?{generationTimeoutMs:d.generationTimeoutMs}:void 0)}catch(h){u=h?.message??String(h),r=!1}if(r)break;if(g<2)await new Promise((h)=>setTimeout(h,5000))}if(d.injectionId)R({type:"inject-result",injectionId:d.injectionId,ok:r,error:r?void 0:u||"inject failed after 3 attempts"})})();break}case"page_loop_start":{if(d.loopId)l(d.loopId);break}case"page_loop_stop":{a?.stop(),a=null;break}case"plan-show":n.showQuestion(d.plan,(r)=>{R({type:"immediate-send",conversationId:e,content:`User selected choice: ${r}`})});break}})}catch{}let p=location.href,c=setInterval(()=>{if(!chrome.runtime?.id){clearInterval(c);return}if(location.href!==p)p=location.href,window.dispatchEvent(new CustomEvent("otter:urlchange",{detail:{url:location.href}})),window.dispatchEvent(new CustomEvent("chatmcp:urlchange",{detail:{url:location.href}})),R({type:"tab-connect",conversationUrl:location.href,conversationId:Ge()})},300);console.log("[Otter Content] ✅ Fully booted & running with TypeScript architecture")}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",Ke);else Ke();
