/**
 * Otter Command Palette & Slash Commands for ChatGPT Web
 * Provides quick access to standard MCP command templates via a modal popup and "/" slash commands.
 */

import { t, getLanguage, onLanguageChange, Language } from "../i18n";
import { parseTemplateVariables, renderTemplate, showVariablePromptModal } from "./template-engine";
import { exportCurrentChatToMarkdown, downloadMarkdownFile, showExportToast } from "./export-markdown";
import { triggerPickFolder, triggerPickFile } from "./folder-picker";
import { submitChatGPTComposer, findPromptComposer } from "./chatgpt-injector";

export interface CommandItem {
  id: string;
  slash: string;
  icon: string;
  category: string;
  title: string;
  description: string;
  promptTemplate: string;
  isPinned?: boolean;
  isCustom?: boolean;
  /** Special action handled by insertCommandPrompt instead of inserting text. */
  action?: string;
}

export interface CommandDefinition {
  id: string;
  slash: string;
  icon: string;
  categoryKey: string;
  title: Record<Language, string>;
  description: Record<Language, string>;
  promptTemplate: Record<Language, string>;
  action?: string;
}

export const COMMAND_DEFINITIONS: CommandDefinition[] = [
  // 1. Trình duyệt Web (Browser Automation)
  {
    id: "browser-read",
    slash: "/browse",
    icon: "🌐",
    categoryKey: "cat_browser",
    title: {
      vi: "Đọc trang web đang mở",
      en: "Read active web page"
    },
    description: {
      vi: "Quét cấu trúc DOM nén và liệt kê danh sách các phần tử tương tác trên tab web",
      en: "Scan compressed DOM structure and list interactive elements on active web tab"
    },
    promptTemplate: {
      vi: "Đọc trang web đang mở, phân tích cấu trúc DOM và cho tôi biết các phần tử có thể tương tác.",
      en: "Read the active web page, analyze the DOM structure and show me interactive elements."
    }
  },
  {
    id: "browser-open",
    slash: "/open",
    icon: "🌐",
    categoryKey: "cat_browser",
    title: {
      vi: "Mở trang web mới",
      en: "Open new web page"
    },
    description: {
      vi: "Mở địa chỉ URL trên trình duyệt và tự động đọc cấu trúc trang",
      en: "Open URL in browser and inspect page content"
    },
    promptTemplate: {
      vi: "Mở trang web https://... và phân tích cấu trúc nội dung trang.",
      en: "Open website https://... and analyze the page content."
    }
  },
  {
    id: "browser-click",
    slash: "/click",
    icon: "🖱️",
    categoryKey: "cat_browser",
    title: {
      vi: "Bấm chuột vào phần tử web",
      en: "Click web element"
    },
    description: {
      vi: "Bấm vào phần tử theo chỉ số [index] sau khi quét trang",
      en: "Click element by numeric index after DOM scan"
    },
    promptTemplate: {
      vi: "Bấm chuột vào phần tử [1] trên trang web đang mở.",
      en: "Click element [1] on the active web page."
    }
  },

  // 2. Dòng lệnh & Terminal PTY
  {
    id: "term-exec",
    slash: "/term",
    icon: "💻",
    categoryKey: "cat_terminal",
    title: {
      vi: "Chạy lệnh console / shell",
      en: "Run console / shell command"
    },
    description: {
      vi: "Mở phiên Live Terminal và thực thi lệnh PowerShell hoặc Bash",
      en: "Open Live Terminal session and execute command in PowerShell or Bash"
    },
    promptTemplate: {
      vi: "Mở Live Terminal và chạy lệnh: ",
      en: "Open Live Terminal and run command: "
    }
  },
  {
    id: "term-test",
    slash: "/test",
    icon: "🧪",
    categoryKey: "cat_terminal",
    title: {
      vi: "Chạy Unit Test dự án",
      en: "Run project unit tests"
    },
    description: {
      vi: "Thực thi bộ kiểm thử tự động của dự án bằng bun test",
      en: "Execute automated unit test suite with bun test"
    },
    promptTemplate: {
      vi: "Mở Terminal và chạy toàn bộ unit test của dự án bằng lệnh: bun test",
      en: "Open Terminal and run all project unit tests using command: bun test"
    }
  },
  {
    id: "term-git",
    slash: "/git",
    icon: "🌿",
    categoryKey: "cat_terminal",
    title: {
      vi: "Kiểm tra Git Status",
      en: "Check Git status"
    },
    description: {
      vi: "Xem trạng thái thay đổi mã nguồn và các file chưa commit",
      en: "View modified working tree and uncommitted files"
    },
    promptTemplate: {
      vi: "Chạy lệnh git status --short và cho tôi biết các thay đổi gần nhất.",
      en: "Run git status --short and show me recent uncommitted changes."
    }
  },
  {
    id: "term-claude",
    slash: "/claude",
    icon: "🎭",
    categoryKey: "cat_terminal",
    title: {
      vi: "Sai bảo Claude Code CLI",
      en: "Dispatch task to Claude Code CLI"
    },
    description: {
      vi: "Chạy Claude Code CLI trên máy để lập trình chuyên sâu hoặc refactor",
      en: "Run Claude Code CLI locally to write or refactor code"
    },
    promptTemplate: {
      vi: "Dùng công cụ 'agent_run_claude' trên máy tính để thực thi nhiệm vụ lập trình: [Mô tả chi tiết việc cần code hoặc refactor]",
      en: "Use 'agent_run_claude' tool locally to execute coding task: [Describe coding/refactoring task]"
    }
  },
  {
    id: "term-gemini",
    slash: "/gemini",
    icon: "✨",
    categoryKey: "cat_terminal",
    title: {
      vi: "Sai bảo Gemini Antigravity CLI",
      en: "Dispatch task to Gemini Antigravity CLI"
    },
    description: {
      vi: "Chạy Gemini Antigravity CLI (agy) để kiểm thử, review logic hoặc audit an toàn",
      en: "Run Gemini Antigravity CLI (agy) locally for testing, logic review, or security audit"
    },
    promptTemplate: {
      vi: "Dùng công cụ 'agent_run_gemini' trên máy tính để review kiến trúc, audit bảo mật và chạy kiểm thử cho: [Tên module/tính năng]",
      en: "Use 'agent_run_gemini' tool locally to review architecture, security audit, and run tests for: [Module/Feature]"
    }
  },
  {
    id: "term-codex",
    slash: "/codex",
    icon: "🧠",
    categoryKey: "cat_terminal",
    title: {
      vi: "Sai bảo OpenAI Codex CLI",
      en: "Dispatch task to OpenAI Codex CLI"
    },
    description: {
      vi: "Chạy OpenAI Codex CLI (codex-cli) để phân tích, lập kế hoạch hoặc sinh mã khung",
      en: "Run OpenAI Codex CLI locally for analysis, planning, or code scaffolding"
    },
    promptTemplate: {
      vi: "Dùng công cụ 'agent_run_codex' trên máy tính để phân tích yêu cầu, thiết kế kiến trúc và sinh mã cho: [Nhiệm vụ cụ thể]",
      en: "Use 'agent_run_codex' tool locally to analyze requirements, design architecture, and scaffold code for: [Specific task]"
    }
  },
  {
    id: "term-pipeline",
    slash: "/pipeline",
    icon: "⚡",
    categoryKey: "cat_terminal",
    title: {
      vi: "Quy trình liên hoàn 3 AI (Codex -> Claude -> Gemini)",
      en: "Multi-Agent Pipeline (Codex -> Claude -> Gemini)"
    },
    description: {
      vi: "Chạy tự động liên hoàn: Codex lên spec, Claude viết code, Gemini audit & test",
      en: "Autonomous pipeline: Codex plans, Claude codes, Gemini reviews & tests"
    },
    promptTemplate: {
      vi: "Dùng công cụ 'agent_orchestrate_pipeline' để chạy quy trình liên hoàn 3 AI cho: [Tên tính năng]\n- Bước 1 (Codex): Phân tích yêu cầu và thiết kế kiến trúc chi tiết.\n- Bước 2 (Claude): Triển khai mã nguồn và viết unit test theo thiết kế của Bước 1.\n- Bước 3 (Gemini): Rà soát an ninh, audit bảo mật và chạy bun test kiểm thử toàn diện.",
      en: "Use 'agent_orchestrate_pipeline' tool to run a 3-agent pipeline for: [Feature Name]\n- Step 1 (Codex): Analyze requirements and design detailed architecture.\n- Step 2 (Claude): Implement source code and unit tests based on Step 1.\n- Step 3 (Gemini): Security audit and run comprehensive bun test."
    }
  },

  // 3. Màn hình & Desktop CUA
  {
    id: "desktop-screen",
    slash: "/screen",
    icon: "🖥️",
    categoryKey: "cat_desktop",
    title: {
      vi: "Chụp ảnh màn hình máy tính",
      en: "Capture desktop screenshot"
    },
    description: {
      vi: "Chụp ảnh toàn màn hình desktop và kiểm tra các cửa sổ đang mở",
      en: "Capture full desktop screenshot and inspect active windows"
    },
    promptTemplate: {
      vi: "Chụp ảnh màn hình máy tính và liệt kê danh sách các cửa sổ ứng dụng đang mở.",
      en: "Take a full desktop screenshot and list all visible application windows."
    }
  },
  {
    id: "desktop-cua",
    slash: "/cua",
    icon: "🤖",
    categoryKey: "cat_desktop",
    title: {
      vi: "Tra cứu công cụ OpenAI CUA",
      en: "OpenAI CUA tools catalog"
    },
    description: {
      vi: "Xem danh mục 61 công cụ Computer Use Agent trong bin/cua",
      en: "Inspect 61 Computer Use Agent tools in bin/cua"
    },
    promptTemplate: {
      vi: "Tra cứu danh mục công cụ OpenAI Computer Use Agent trong bin/cua để thao tác giao diện.",
      en: "Query OpenAI Computer Use Agent tool definitions in bin/cua to automate UI."
    }
  },

  // 4. Codebase Memory Graph
  {
    id: "codebase-arch",
    slash: "/codebase",
    icon: "🧠",
    categoryKey: "cat_cbm",
    title: {
      vi: "Phân tích kiến trúc Codebase",
      en: "Analyze Codebase Architecture"
    },
    description: {
      vi: "Xem đồ thị kiến trúc tổng quan hệ thống và các module bằng Codebase Memory",
      en: "Inspect system architecture graph and modules via Codebase Memory"
    },
    promptTemplate: {
      vi: "Phân tích đồ thị kiến trúc tổng quan của dự án bằng Codebase Memory Graph.",
      en: "Analyze project architecture overview using Codebase Memory Graph."
    }
  },
  {
    id: "codebase-trace",
    slash: "/trace",
    icon: "🔍",
    categoryKey: "cat_cbm",
    title: {
      vi: "Lần vết hàm 2 chiều",
      en: "Bidirectional Call Graph Trace"
    },
    description: {
      vi: "Lần vết Call Graph hai chiều (inbound/outbound) của hàm trong mã nguồn",
      en: "Trace inbound and outbound Call Graph paths for a symbol"
    },
    promptTemplate: {
      vi: "Lần vết luồng gọi hàm [tên_hàm] hai chiều trong Codebase Memory và cho tôi biết các điểm gọi.",
      en: "Trace function [symbol_name] bidirectionally in Codebase Memory and show call sites."
    }
  },

  // 5. Video & Giọng đọc AI
  {
    id: "voice-gen",
    slash: "/voice",
    icon: "🎙️",
    categoryKey: "cat_media",
    title: {
      vi: "Tạo giọng đọc AI thuyết minh",
      en: "Generate AI voiceover"
    },
    description: {
      vi: "Tạo file âm thanh giọng đọc tiếng Việt chuẩn truyền hình bằng Edge-TTS",
      en: "Generate broadcast-quality AI speech audio file with Edge-TTS"
    },
    promptTemplate: {
      vi: "Tạo file giọng đọc AI thuyết minh tiếng Việt chuẩn bằng Edge-TTS với nội dung: \"...\"",
      en: "Generate high quality AI voiceover audio using Edge-TTS with content: \"...\""
    }
  },
  {
    id: "video-remotion",
    slash: "/video",
    icon: "🎬",
    categoryKey: "cat_media",
    title: {
      vi: "Tạo video ngắn Remotion",
      en: "Create Remotion video"
    },
    description: {
      vi: "Biên tập video hoạt họa, typography và âm thanh hoàn chỉnh bằng Remotion",
      en: "Compose motion graphics, typography and audio into video via Remotion"
    },
    promptTemplate: {
      vi: "Tạo video ngắn hoàn chỉnh bằng Remotion từ kịch bản sau: ",
      en: "Create a complete Remotion video from the following script: "
    }
  },

  // 6. Quản trị VPS qua SSH
  {
    id: "vps-session",
    slash: "/vps",
    icon: "🚀",
    categoryKey: "cat_vps",
    title: {
      vi: "Mở phiên SSH Keep-Alive",
      en: "Open SSH Keep-Alive session"
    },
    description: {
      vi: "Kết nối phiên SSH bền vững không ngắt để theo dõi và chạy lệnh trên VPS",
      en: "Establish persistent keep-alive SSH session to run remote commands on VPS"
    },
    promptTemplate: {
      vi: "Mở phiên SSH Keep-Alive kết nối VPS [user]@[host]:22 và kiểm tra tài nguyên CPU, RAM, ổ đĩa.",
      en: "Open SSH Keep-Alive session to VPS [user]@[host]:22 and inspect CPU, RAM, disk usage."
    }
  },

  // 7. Kho Bookmark & Tìm kiếm Tri thức Cá nhân
  {
    id: "bm-save",
    slash: "/bookmark",
    icon: "🔖",
    categoryKey: "cat_bookmarks",
    title: {
      vi: "Lưu trang web vào Bookmark",
      en: "Save page to Bookmarks"
    },
    description: {
      vi: "Lưu lại liên kết, tiêu đề và tóm tắt trang web vào kho tri thức cá nhân",
      en: "Save URL link, title and summary into personal knowledge base"
    },
    promptTemplate: {
      vi: "Lưu bookmark trang web này vào kho tri thức cá nhân với URL: https://... và tag: ",
      en: "Save this website bookmark to personal knowledge base with URL: https://... and tags: "
    }
  },
  {
    id: "bm-search",
    slash: "/find",
    icon: "🔍",
    categoryKey: "cat_bookmarks",
    title: {
      vi: "Tìm kiếm Bookmark liên quan",
      en: "Search saved Bookmarks"
    },
    description: {
      vi: "Tìm kiếm các bài viết, liên kết hay video đã lưu theo từ khóa liên quan",
      en: "Search saved articles, links and videos by keywords"
    },
    promptTemplate: {
      vi: "Tìm kiếm trong kho bookmark các liên kết liên quan đến từ khóa: ",
      en: "Search personal bookmarks for links matching keyword: "
    }
  },
  {
    id: "bm-list",
    slash: "/bookmarks",
    icon: "📚",
    categoryKey: "cat_bookmarks",
    title: {
      vi: "Xem tất cả Bookmark đã lưu",
      en: "View all saved Bookmarks"
    },
    description: {
      vi: "Xem danh sách các trang web đã đánh dấu bookmark gần đây nhất",
      en: "View list of most recently saved bookmarks"
    },
    promptTemplate: {
      vi: "Xem danh sách các bookmark đã lưu trong kho tri thức cá nhân gần đây nhất.",
      en: "Show recently saved bookmarks in personal knowledge base."
    }
  },

  // 8. Facebook & Bán hàng (Facebook Marketing & Sales Automation)
  {
    id: "fb-sales",
    slash: "/fb-sales",
    icon: "🎯",
    categoryKey: "cat_facebook",
    title: {
      vi: "Thiết lập kịch bản bán hàng FB",
      en: "Setup Facebook Sales Playbook"
    },
    description: {
      vi: "Xem và cập nhật kịch bản phễu 6 bước, ý định mua hàng và bình luận dạo",
      en: "View and update 6-stage funnel, customer intents, and comment templates"
    },
    promptTemplate: {
      vi: "Hãy giúp tôi cấu hình và tối ưu kịch bản bán hàng trên Facebook:\n1. Gọi tool 'fb_sales_get_playbook' để lấy toàn bộ kịch bản 6 giai đoạn (greeting, discovery, pitch, objection, closing, support), các ý định khách hàng (intents: pricing, features, objection_safety...) và bình luận dạo.\n2. Dựa vào sản phẩm/dịch vụ của tôi: [Điền tên sản phẩm/dịch vụ của bạn tại đây]\n3. Dùng tool 'fb_sales_update_stage' để cập nhật câu thoại mẫu phù hợp cho từng giai đoạn trong phễu bán hàng.\n4. Dùng tool 'fb_sales_update_intent' để tối ưu câu giải đáp giá cả, tính năng và xử lý thắc mắc bảo mật.\n5. Dùng tool 'fb_sales_update_comments' để cập nhật câu bình luận dạo tự nhiên khi đi tương tác feed.",
      en: "Help me configure and optimize the Facebook sales playbook:\n1. Call tool 'fb_sales_get_playbook' to view the 6-stage funnel and customer intents.\n2. Based on my product/service: [Enter your product/service here]\n3. Use 'fb_sales_update_stage' to update reply templates for each funnel stage.\n4. Use 'fb_sales_update_intent' to optimize pricing, features, and objection handling.\n5. Use 'fb_sales_update_comments' to update smart comment templates for feed engagement."
    }
  },
  {
    id: "fb-listen",
    slash: "/fb-listen",
    icon: "💬",
    categoryKey: "cat_facebook",
    title: {
      vi: "Trực & Tự động trả lời Messenger",
      en: "Messenger Auto-Reply Listener"
    },
    description: {
      vi: "Bật worker nền lắng nghe tin nhắn Messenger và trả lời theo kịch bản phễu",
      en: "Start background worker to listen for Messenger chats and reply using playbook"
    },
    promptTemplate: {
      vi: "Hãy quản lý chế độ tự động lắng nghe và trực tin nhắn Messenger:\n1. Gọi tool 'fb_messenger_listen_status' để kiểm tra xem daemon có đang lắng nghe tin nhắn hay không.\n2. Nếu chưa bật hoặc cần đổi chu kỳ, gọi 'fb_messenger_listen_start' với interval_seconds=5 để bắt đầu tự động đọc tin nhắn đến, tra cứu kịch bản sales trong SQLite, trả lời khách và lưu lịch sử hội thoại.\n3. Nếu tôi yêu cầu dừng trực, hãy gọi tool 'fb_messenger_listen_stop'.",
      en: "Manage Facebook Messenger auto-reply listening mode:\n1. Call tool 'fb_messenger_listen_status' to check if the listener is running.\n2. If inactive, call 'fb_messenger_listen_start' with interval_seconds=5 to auto-reply using sales playbook.\n3. To stop listening, call 'fb_messenger_listen_stop'."
    }
  },
  {
    id: "fb-feed",
    slash: "/fb-feed",
    icon: "📱",
    categoryKey: "cat_facebook",
    title: {
      vi: "Quét Feed & Tương tác bài viết FB",
      en: "Scan Feed & Engage Posts"
    },
    description: {
      vi: "Quét bảng tin và tự động thả like/love kèm bình luận dạo theo kịch bản",
      en: "Scan feed and auto-like/comment according to sales comment playbook"
    },
    promptTemplate: {
      vi: "Hãy quét Bảng tin Facebook và tương tác bài viết an toàn:\n1. Nếu bạn có tool 'fb_feed_scan', hãy gọi 'fb_feed_scan' với limit=5 để quét các bài viết trên feed (lấy post_key, tác giả, nội dung).\n2. Phân loại nội dung từng bài viết (du lịch, kinh doanh, đời sống...).\n3. Với mỗi bài phù hợp, gọi tool 'fb_feed_engage_post' để like/love và bình luận.\n4. Báo cáo lại danh sách các bài viết đã tương tác thành công.\n\n⚠️ LƯU Ý DỰ PHÒNG: Nếu bạn không tìm thấy tool fb_feed_scan trong danh sách Actions khả dụng, hãy GỌI NGAY tool executeTerminalCommand với lệnh sau để chạy tự động toàn bộ quy trình:\ncommand: \"bun scripts/fb-feed-auto-engage.ts --max 5\"",
      en: "Scan Facebook Feed and engage posts safely:\n1. If tool 'fb_feed_scan' is available, call it with limit=5 to scan the latest posts on Feed.\n2. Classify each post content (travel, shop, general...).\n3. For each suitable post, call 'fb_feed_engage_post' with post_key, reaction, and category or custom_comment.\n4. Report back the engaged posts.\n\n⚠️ FALLBACK: If tools fb_feed_scan and fb_feed_engage_post are not found in your available Actions, IMMEDIATELY call executeTerminalCommand with:\ncommand: \"bun scripts/fb-feed-auto-engage.ts --max 5\""
    }
  },
  {
    id: "fb-notif",
    slash: "/fb-notif",
    icon: "🔔",
    categoryKey: "cat_facebook",
    title: {
      vi: "Đọc thông báo & Trả lời bình luận",
      en: "Read Notifications & Reply"
    },
    description: {
      vi: "Đọc danh sách thông báo Facebook, mở bài viết và trả lời comment của khách",
      en: "Read recent notifications, open posts, and reply to customer comments"
    },
    promptTemplate: {
      vi: "Hãy kiểm tra thông báo Facebook mới nhất và phản hồi cho khách:\n1. Gọi tool 'fb_notifications_read' với limit=5 để đọc danh sách thông báo gần đây.\n2. Phân tích các thông báo liên quan đến khách bình luận hỏi mua hàng, tư vấn hoặc trao đổi trên bài viết.\n3. Với thông báo cần trả lời, gọi tool 'fb_notification_open_and_reply':\n   - notification_index: số thứ tự của thông báo (bắt đầu từ 0)\n   - reply_text: câu trả lời lịch sự, đúng kịch bản giải đáp thắc mắc của khách.\n4. Báo cáo kết quả thông báo nào đã được trả lời xong.",
      en: "Check Facebook notifications and reply to customer comments:\n1. Call tool 'fb_notifications_read' with limit=5 to inspect recent notifications.\n2. Identify customer comments or inquiries.\n3. For each notification needing response, call 'fb_notification_open_and_reply' with notification_index and reply_text.\n4. Report the processed notifications."
    }
  },
  {
    id: "fb-reply",
    slash: "/fb-reply",
    icon: "💬",
    categoryKey: "cat_facebook",
    title: {
      vi: "Tự động đọc & Trả lời bình luận bài viết FB",
      en: "Auto Read & Reply Facebook Post Comments"
    },
    description: {
      vi: "Mở link bài viết, đọc bình luận, tự phục hồi nếu lệch link, like và tự suy luận trả lời theo ngữ cảnh",
      en: "Open post link, read comments, auto-recover if redirected, like and reply contextually"
    },
    promptTemplate: {
      vi: `Hãy tự động mở bài viết Facebook, đọc tất cả bình luận, like và trả lời bình luận theo quy trình tự động hoàn toàn:
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
6. Báo cáo tổng kết: Chụp ảnh màn hình bằng chứng và liệt kê danh sách các bình luận đã được like và trả lời thành công.`,
      en: `Automatically open Facebook post, read all comments, like and reply to each comment:
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
6. Final Report: Capture screenshot proof and list all answered comments.`
    }
  },
  {
    id: "export-markdown",
    slash: "/export",
    icon: "📄",
    categoryKey: "cat_browser",
    title: {
      vi: "Xuất cuộc trò chuyện ra Markdown",
      en: "Export conversation to Markdown"
    },
    description: {
      vi: "Xuất toàn bộ lượt chat hiện tại ra file Markdown và tải xuống",
      en: "Export all turns of the current chat to a Markdown file and download it"
    },
    promptTemplate: {
      vi: "Xuất cuộc trò chuyện hiện tại ra file Markdown.",
      en: "Export the current conversation to a Markdown file."
    },
    action: "export-markdown"
  }
];

export function getStandardCommands(lang: Language = getLanguage()): CommandItem[] {
  return COMMAND_DEFINITIONS.map(def => ({
    id: def.id,
    slash: def.slash,
    icon: def.icon,
    category: t(def.categoryKey),
    title: def.title[lang] || def.title.vi,
    description: def.description[lang] || def.description.vi,
    promptTemplate: def.promptTemplate[lang] || def.promptTemplate.vi,
    action: def.action
  }));
}

export let STANDARD_COMMANDS: CommandItem[] = getStandardCommands("vi");

onLanguageChange((lang) => {
  STANDARD_COMMANDS = getStandardCommands(lang);
  renderQuickActionChips();
});

export let customCommands: CommandItem[] = [];
export let pinnedStandardIds: Set<string> = new Set(["browser-read", "term-exec"]);

export async function loadCustomAndPinnedCommands(apiBase = "http://127.0.0.1:1993") {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(["otter_custom_commands", "otter_pinned_standard_ids"]);
      if (Array.isArray(stored.otter_custom_commands)) {
        customCommands = stored.otter_custom_commands;
      }
      if (Array.isArray(stored.otter_pinned_standard_ids)) {
        pinnedStandardIds = new Set(stored.otter_pinned_standard_ids);
      }
    }
  } catch {}

  try {
    const res = await fetch(`${apiBase}/api/commands`);
    if (res.ok) {
      const data: any = await res.json();
      if (Array.isArray(data.items)) {
        customCommands = data.items.map((cmd: any) => ({
          id: cmd.id,
          slash: cmd.slash,
          icon: cmd.icon || "⚡",
          category: cmd.category || "Tập lệnh của tôi",
          title: cmd.title,
          description: cmd.description || "",
          promptTemplate: cmd.promptTemplate,
          isPinned: Boolean(cmd.isPinned),
          isCustom: true
        }));
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ otter_custom_commands: customCommands });
        }
      }
    }
  } catch {}

  renderQuickActionChips();
}

export function getAllCommands(): CommandItem[] {
  // Loại bỏ các lệnh chuẩn nếu đã có lệnh tùy chỉnh trùng slash (tránh lặp /fb-sales, /fb-listen, /fb-reply)
  const customSlashes = new Set(customCommands.map(c => c.slash.toLowerCase()));
  const filteredStandard = STANDARD_COMMANDS.filter(c => !customSlashes.has(c.slash.toLowerCase()));

  const customPinned = customCommands.filter(c => c.isPinned);
  
  // Sắp xếp các lệnh pinned tùy chỉnh theo thứ tự nghiệp vụ logic
  const preferredOrder = ["/fb-feed", "/fb-reply", "/fb-listen", "/fb-sales", "/fb-notif", "/browse", "/term"];
  customPinned.sort((a, b) => {
    const idxA = preferredOrder.indexOf(a.slash);
    const idxB = preferredOrder.indexOf(b.slash);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return 0;
  });

  const standardPinned = filteredStandard.filter(c => pinnedStandardIds.has(c.id)).map(c => ({ ...c, isPinned: true }));
  const customUnpinned = customCommands.filter(c => !c.isPinned);
  const standardUnpinned = filteredStandard.filter(c => !pinnedStandardIds.has(c.id));

  return [...customPinned, ...standardPinned, ...customUnpinned, ...standardUnpinned];
}

let isRadialOpen = false;

function ensureRadialStyles() {
  if (document.getElementById("otter-radial-custom-styles")) return;
  const style = document.createElement("style");
  style.id = "otter-radial-custom-styles";
  style.textContent = `
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
  `;
  document.head.appendChild(style);
}

function createSatelliteElement(
  container: HTMLElement, 
  item: { id: string; icon: string; label: string; title: string; action: () => void }, 
  x: number, 
  y: number, 
  staggerIdx: number,
  badgePos: "top" | "bottom" = "bottom"
) {
  ensureRadialStyles();
  const sat = document.createElement("div");
  sat.className = "otter-satellite-item";
  sat.setAttribute("data-x", String(x));
  sat.setAttribute("data-y", String(y));
  sat.style.setProperty("--sat-x", `${x}px`);
  sat.style.setProperty("--sat-y", `${y}px`);
  sat.title = item.title;
  sat.style.cssText = `
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
    opacity: ${isRadialOpen ? "1" : "0"};
    transform: ${isRadialOpen ? `translate(${x}px, ${y}px) scale(1)` : "translate(0px, 0px) scale(0.2)"};
    pointer-events: ${isRadialOpen ? "auto" : "none"};
    user-select: none;
    z-index: 10005;
    --sat-x: ${x}px;
    --sat-y: ${y}px;
  `;

  // Nhãn gợi ý luôn luôn hiển thị rõ ràng, sáng đẹp
  const badge = document.createElement("span");
  badge.className = "otter-sat-badge";
  badge.textContent = item.label;
  
  const badgePosCss = badgePos === "top"
    ? "bottom: 100%; margin-bottom: 5px;"
    : "top: 100%; margin-top: 5px;";

  badge.style.cssText = `
    position: absolute;
    ${badgePosCss}
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
  `;

  sat.appendChild(document.createTextNode(item.icon));
  sat.appendChild(badge);

  sat.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const toggleBtn = document.getElementById("otter-radial-toggle") as HTMLButtonElement | null;
    if (toggleBtn) {
      toggleBtn.click();
    }
    item.action();
  };

  container.appendChild(sat);
}

export function renderQuickActionChips() {
  const composer = findPromptComposer();
  if (!composer) return;

  const form = composer.closest<HTMLElement>("form");
  const composerBox =
    composer.closest<HTMLElement>("#composer-background") ||
    composer.closest<HTMLElement>('[data-testid="composer-container"]') ||
    composer.closest<HTMLElement>('div[class*="composer"]') ||
    composer.closest<HTMLElement>('div[class*="overflow-hidden"]');

  const mountParent = form || (composerBox && composerBox.parentElement) || composer.parentElement;
  if (!mountParent) return;

  // Xóa các thanh ngang legacy (chips cũ & picker bar cũ)
  document.querySelectorAll("#otter-quick-chips, #otter-folder-picker-bar, #chatmcp-folder-picker-bar").forEach(el => el.remove());

  let radialContainer = document.getElementById("otter-radial-menu-container") as HTMLElement;
  const existingToggle = document.getElementById("otter-radial-toggle");
  if (existingToggle && radialContainer && radialContainer.parentElement === mountParent) {
    // Đã render rồi và nằm đúng vị trí trong DOM -> không hủy và vẽ lại để tránh mất tương tác/click event
    return;
  }

  if (!radialContainer || radialContainer.parentElement !== mountParent) {
    if (radialContainer) radialContainer.remove();
    radialContainer = document.createElement("div");
    radialContainer.id = "otter-radial-menu-container";
    radialContainer.style.cssText = `
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      padding: 2px 4px;
      z-index: 10001;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    if (composerBox && composerBox.parentElement === mountParent) {
      mountParent.insertBefore(radialContainer, composerBox);
    } else {
      mountParent.insertBefore(radialContainer, mountParent.firstChild);
    }
  }

  // Dọn sạch backdrop cũ nếu có
  const oldBackdrop = document.getElementById("otter-radial-backdrop");
  if (oldBackdrop) oldBackdrop.remove();

  // Cấu trúc HTML bên trong radialContainer
  radialContainer.innerHTML = `
    <button type="button" id="otter-radial-toggle" title="${t("cmd_quick_chips_label")}" style="
      width: 42px;
      height: 42px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.3);
      background: ${isRadialOpen ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)" : "linear-gradient(135deg, #10b981 0%, #059669 100%)"};
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: ${isRadialOpen ? "0 4px 16px rgba(239, 68, 68, 0.6)" : "0 4px 14px rgba(16, 185, 129, 0.5)"};
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      position: relative;
      z-index: 10005;
      outline: none;
      user-select: none;
      font-size: 19px;
    ">
      <span id="otter-radial-toggle-icon" style="display:inline-block; transition:transform 0.3s ease; transform: ${isRadialOpen ? "rotate(90deg)" : "rotate(0deg)"};">${isRadialOpen ? "✕" : "⚡"}</span>
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
      opacity: ${isRadialOpen ? "0" : "0.95"};
      pointer-events: ${isRadialOpen ? "none" : "auto"};
      transition: opacity 0.2s ease;
    ">
      ${t("cmd_quick_chips_label")}
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
  `;

  const satellitesContainer = radialContainer.querySelector<HTMLElement>("#otter-radial-satellites")!;
  const toggleBtn = radialContainer.querySelector<HTMLButtonElement>("#otter-radial-toggle")!;
  const labelSpan = radialContainer.querySelector<HTMLElement>("#otter-radial-label")!;

  // Danh sách nút Inner Orbit (R = 92px, các công cụ hệ thống)
  const innerItems = [
    {
      id: "tool-folder",
      icon: "📁",
      label: "Thư mục",
      title: t("picker_folder_title"),
      action: () => triggerPickFolder()
    },
    {
      id: "tool-file",
      icon: "📄",
      label: "File",
      title: t("picker_file_title"),
      action: () => triggerPickFile()
    },
    {
      id: "tool-commands",
      icon: "💡",
      label: "Lệnh mẫu",
      title: t("picker_commands_title"),
      action: () => openCommandModal()
    },
    {
      id: "tool-add",
      icon: "➕",
      label: "Thêm",
      title: t("cmd_add_command"),
      action: () => {
        openCommandModal();
        setTimeout(() => {
          const addBtn = document.getElementById("otter-palette-add-btn");
          if (addBtn) addBtn.click();
        }, 50);
      }
    }
  ];

  // Danh sách nút Outer Orbit (các lệnh pinned)
  let pinned = getAllCommands().filter(c => c.isPinned);
  if (pinned.length === 0) {
    pinned = STANDARD_COMMANDS.slice(0, 4).map(c => ({ ...c, isPinned: true }));
  }

  const outerItems = pinned.map(cmd => ({
    id: cmd.id,
    icon: cmd.icon,
    label: cmd.slash,
    title: `${cmd.title}: ${cmd.description || cmd.promptTemplate}`,
    action: () => insertCommandPrompt(cmd, "", false)
  }));

  // Render Inner Orbit (R = 95px, Arc: -145 deg -> -35 deg, nhãn badge ở phía dưới)
  const rInner = 95;
  const startInner = -145;
  const endInner = -35;
  innerItems.forEach((item, idx) => {
    const angleDeg = innerItems.length === 1 
      ? -90 
      : startInner + idx * ((endInner - startInner) / (innerItems.length - 1));
    const angleRad = (angleDeg * Math.PI) / 180;
    const x = Math.round(rInner * Math.cos(angleRad));
    const y = Math.round(rInner * Math.sin(angleRad));

    createSatelliteElement(satellitesContainer, item, x, y, idx, "bottom");
  });

  // Render Outer Orbit (Các lệnh pinned: R=185px hướng nhãn lên trên, không bao giờ đè lên inner)
  const isOuterMultiTier = outerItems.length > 8;
  const startOuter = isOuterMultiTier ? -165 : -155;
  const endOuter = isOuterMultiTier ? -15 : -25;

  outerItems.forEach((item, idx) => {
    const angleDeg = outerItems.length === 1 
      ? -90 
      : startOuter + idx * ((endOuter - startOuter) / (outerItems.length - 1));
    const angleRad = (angleDeg * Math.PI) / 180;
    
    // Nút chẵn: R=185, nút lẻ: R=245 (chỉ khi có trên 8 lệnh)
    const isOdd = idx % 2 === 1;
    const rCurrent = isOuterMultiTier 
      ? (isOdd ? 245 : 185)
      : 185;
    const badgePos = isOuterMultiTier ? (isOdd ? "top" : "bottom") : "top";

    const x = Math.round(rCurrent * Math.cos(angleRad));
    const y = Math.round(rCurrent * Math.sin(angleRad));

    createSatelliteElement(satellitesContainer, item, x, y, innerItems.length + idx, badgePos);
  });

  function setRadialOpen(open: boolean) {
    isRadialOpen = open;
    const icon = document.getElementById("otter-radial-toggle-icon");
    if (toggleBtn) {
      toggleBtn.style.background = isRadialOpen 
        ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)" 
        : "linear-gradient(135deg, #10b981 0%, #059669 100%)";
      toggleBtn.style.boxShadow = isRadialOpen 
        ? "0 4px 16px rgba(239, 68, 68, 0.6)" 
        : "0 4px 14px rgba(16, 185, 129, 0.5)";
    }
    if (icon) {
      icon.textContent = isRadialOpen ? "✕" : "⚡";
      icon.style.transform = isRadialOpen ? "rotate(90deg)" : "rotate(0deg)";
    }
    if (labelSpan) {
      labelSpan.style.opacity = isRadialOpen ? "0" : "0.95";
      labelSpan.style.pointerEvents = isRadialOpen ? "none" : "auto";
    }

    const satellites = satellitesContainer.querySelectorAll<HTMLElement>(".otter-satellite-item");
    satellites.forEach((sat, idx) => {
      const x = sat.getAttribute("data-x") || "0";
      const y = sat.getAttribute("data-y") || "0";
      if (isRadialOpen) {
        sat.style.opacity = "1";
        sat.style.pointerEvents = "auto";
        sat.style.transform = `translate(${x}px, ${y}px) scale(1)`;
        sat.style.transitionDelay = `${idx * 20}ms`;
      } else {
        sat.style.opacity = "0";
        sat.style.pointerEvents = "none";
        sat.style.transform = "translate(0px, 0px) scale(0.2)";
        sat.style.transitionDelay = "0ms";
      }
    });
  }

  toggleBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setRadialOpen(!isRadialOpen);
  };

  labelSpan.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setRadialOpen(!isRadialOpen);
  };

  // Đóng bằng phím Escape
  if (!(window as any)._otterRadialEscBound) {
    (window as any)._otterRadialEscBound = true;
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isRadialOpen) {
        setRadialOpen(false);
      }
    });
  }

  // Đóng khi click ra ngoài mà KHÔNG CẦN BACKDROP (không chặn chuột, không làm mờ màn hình)
  if (!(window as any)._otterRadialClickOutsideBound) {
    (window as any)._otterRadialClickOutsideBound = true;
    document.addEventListener("pointerdown", (e) => {
      if (!isRadialOpen) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest("#otter-radial-menu-container")) {
        setRadialOpen(false);
      }
    });
  }

  // Áp dụng trạng thái hiện tại (nếu vừa rerender khi đang mở)
  if (isRadialOpen) {
    setRadialOpen(true);
  }
}




/**
 * Điền prompt mẫu vào ô soạn thảo của ChatGPT Web
 * Hỗ trợ ProseMirror, ContentEditable và Textarea
 */
export function insertPromptIntoComposer(text: string, slashPrefix = "", autoSubmit = false) {
  const composer = findPromptComposer();
  if (!composer) return;

  composer.focus();

  if (composer.isContentEditable || composer.getAttribute("contenteditable") === "true") {
    let current = composer.innerText || composer.textContent || "";
    if (slashPrefix && current.endsWith(slashPrefix)) {
      current = current.slice(0, current.length - slashPrefix.length);
    }

    const insertString = current.trim() ? `${current.trim()}\n${text}` : text;

    // Chọn toàn bộ nội dung để thay thế
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(composer);
      sel.collapseToEnd();
    }

    // Ưu tiên DataTransfer Clipboard Event (chuẩn nhất cho ProseMirror của ChatGPT)
    try {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", insertString);
      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true
      });
      composer.dispatchEvent(pasteEvent);
    } catch {
      document.execCommand("insertText", false, insertString);
    }

    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: insertString }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (composer instanceof HTMLTextAreaElement) {
    let current = composer.value || "";
    if (slashPrefix && current.endsWith(slashPrefix)) {
      current = current.slice(0, current.length - slashPrefix.length);
    }
    const insertString = current.trim() ? `${current.trim()}\n${text}` : text;

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(composer, insertString);
    } else {
      composer.value = insertString;
    }
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (autoSubmit) {
    submitChatGPTComposer().catch(() => {});
  }
}

/**
 * Chèn một lệnh vào ô chat, xử lý đúng 3 trường hợp (revised Folderloom plan):
 * - action "export-markdown": xuất file, không chèn text.
 * - promptTemplate có biến {{ }}: mở modal nhập biến rồi mới chèn template đã render (và autoSubmit nếu người dùng bấm Áp dụng).
 * - còn lại: chèn thẳng promptTemplate (và autoSubmit nếu được yêu cầu).
 * Đây là điểm chèn duy nhất mà quick chips, modal lệnh và slash autocomplete
 * đều phải dùng (thay cho việc gọi thẳng insertPromptIntoComposer).
 */
export function insertCommandPrompt(cmd: CommandItem, slashPrefix = "", autoSubmit = false) {
  if (cmd.action === "export-markdown") {
    const { title, markdown } = exportCurrentChatToMarkdown();
    downloadMarkdownFile(title, markdown);
    showExportToast();
    return;
  }

  const trackUse = () => {
    if (cmd.isCustom) {
      fetch(`http://127.0.0.1:1993/api/commands/${cmd.id}/use`, { method: "POST" }).catch(() => {});
    }
  };

  const variables = parseTemplateVariables(cmd.promptTemplate);
  if (variables.length === 0) {
    insertPromptIntoComposer(cmd.promptTemplate, slashPrefix, autoSubmit);
    trackUse();
    return;
  }

  showVariablePromptModal(cmd.title, variables, (values) => {
    insertPromptIntoComposer(renderTemplate(cmd.promptTemplate, values), slashPrefix, false);
    trackUse();
  });
}

/**
 * Quản lý Popover Modal danh mục lệnh mẫu
 */
let modalOverlay: HTMLElement | null = null;

export function openCommandModal() {
  if (modalOverlay) {
    modalOverlay.remove();
    modalOverlay = null;
  }

  const overlay = document.createElement("div");
  overlay.id = "otter-command-palette-overlay";
  overlay.style.cssText = `
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
  `;

  const modal = document.createElement("div");
  modal.style.cssText = `
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
  `;

  // Header
  const header = document.createElement("div");
  header.style.cssText = `
    padding: 14px 18px;
    border-bottom: 1px solid #27272a;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #202024;
  `;
  header.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span style="font-size:18px;">🦦</span>
      <strong style="font-size:14px; color:#ffffff;">${t("cmd_modal_title")}</strong>
      <span style="font-size:11px; background:#10b981; color:#000; padding:2px 6px; border-radius:9999px; font-weight:700;">PRO</span>
    </div>
    <div style="display:flex; align-items:center; gap:8px;">
      <button id="otter-palette-add-btn" style="background:#059669; border:none; border-radius:6px; color:#fff; font-size:11px; font-weight:600; padding:4px 9px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; transition:background 0.15s ease;">
        <span>${t("cmd_add_command")}</span>
      </button>
      <button id="otter-palette-close" style="background:none; border:none; color:#a1a1aa; font-size:18px; cursor:pointer; padding:0 4px; line-height:1;" title="${t("cmd_close")} (Esc)">&times;</button>
    </div>
  `;

  // Inline Creation Form
  const createForm = document.createElement("div");
  createForm.id = "otter-create-form";
  createForm.style.cssText = `
    display: none;
    padding: 12px 18px;
    background: #141416;
    border-bottom: 1px solid #27272a;
    flex-direction: column;
    gap: 8px;
  `;
  createForm.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong style="font-size:12px; color:#34d399;">${t("cmd_create_title")}</strong>
      <button id="otter-create-cancel" style="background:none; border:none; color:#a1a1aa; font-size:11px; cursor:pointer;">${t("cmd_close")}</button>
    </div>
    <div style="display:grid; grid-template-columns: 60px 130px 1fr; gap:6px;">
      <input id="otter-new-icon" type="text" placeholder="⚡" value="⚡" style="background:#27272a; border:1px solid #3f3f46; border-radius:6px; color:#fff; padding:6px; font-size:12px; text-align:center;">
      <input id="otter-new-slash" type="text" placeholder="${t("cmd_placeholder_slash")}" style="background:#27272a; border:1px solid #3f3f46; border-radius:6px; color:#34d399; font-weight:700; padding:6px 8px; font-size:12px;">
      <input id="otter-new-title" type="text" placeholder="${t("cmd_placeholder_title")}" style="background:#27272a; border:1px solid #3f3f46; border-radius:6px; color:#fff; padding:6px 8px; font-size:12px;">
    </div>
    <textarea id="otter-new-prompt" placeholder="${t("cmd_placeholder_prompt")}" rows="2" style="width:100%; box-sizing:border-box; background:#27272a; border:1px solid #3f3f46; border-radius:6px; color:#fff; padding:6px 8px; font-size:12px; font-family:monospace; resize:vertical;"></textarea>
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <label style="display:flex; align-items:center; gap:6px; font-size:11px; color:#d1d5db; cursor:pointer;">
        <input id="otter-new-pin" type="checkbox" checked style="accent-color:#10b981;">
        <span>${t("cmd_pin_checkbox")}</span>
      </label>
      <button id="otter-create-submit" style="background:#10b981; border:none; border-radius:6px; color:#000; font-weight:700; font-size:11px; padding:6px 12px; cursor:pointer;">${t("cmd_save_command")}</button>
    </div>
    <div id="otter-create-msg" style="font-size:11px; display:none;"></div>
  `;

  // Search input
  const searchContainer = document.createElement("div");
  searchContainer.style.cssText = "padding: 10px 18px; border-bottom: 1px solid #27272a; background: #18181b;";
  const searchInput = document.createElement("input");
  searchInput.placeholder = t("cmd_search_placeholder");
  searchInput.style.cssText = `
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
  `;
  searchInput.onfocus = () => searchInput.style.borderColor = "#10b981";
  searchInput.onblur = () => searchInput.style.borderColor = "#3f3f46";
  searchContainer.appendChild(searchInput);

  // List Container
  const listContainer = document.createElement("div");
  listContainer.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 10px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `;

  function renderList(query = "") {
    listContainer.innerHTML = "";
    const q = query.toLowerCase().trim();

    const all = getAllCommands();
    const filtered = all.filter(cmd =>
      cmd.title.toLowerCase().includes(q) ||
      cmd.slash.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
      listContainer.innerHTML = `<div style="text-align:center; padding:30px; color:#71717a; font-size:13px;">${t("cmd_no_match")} "${escapeHtml(query)}".</div>`;
      return;
    }

    // Nhóm theo Category
    const groups: { [cat: string]: CommandItem[] } = {};
    for (const c of filtered) {
      const cat = c.isPinned ? t("cmd_pinned_category") : c.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(c);
    }

    for (const [category, items] of Object.entries(groups)) {
      const groupHeader = document.createElement("div");
      groupHeader.style.cssText = "font-size: 11px; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;";
      groupHeader.textContent = category;
      listContainer.appendChild(groupHeader);

      for (const item of items) {
        const row = document.createElement("div");
        row.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-radius: 8px;
          background: #202024;
          border: 1px solid #2d2d32;
          cursor: pointer;
          transition: all 0.12s ease;
        `;
        row.onmouseenter = () => {
          row.style.background = "#2a2a30";
          row.style.borderColor = "#10b981";
        };
        row.onmouseleave = () => {
          row.style.background = "#202024";
          row.style.borderColor = "#2d2d32";
        };

        row.onclick = () => {
          insertCommandPrompt(item, "", false);
          overlay.remove();
          modalOverlay = null;
        };

        const isItemPinned = item.isPinned || (pinnedStandardIds.has(item.id));

        row.innerHTML = `
          <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
            <span style="font-size:18px; line-height:1;">${item.icon}</span>
            <div style="min-width:0;">
              <div style="display:flex; align-items:center; gap:6px;">
                <strong style="font-size:13px; color:#ffffff;">${escapeHtml(item.title)}</strong>
                <code style="background:#27272a; color:#34d399; font-size:11px; padding:1px 5px; border-radius:4px; font-family:monospace;">${escapeHtml(item.slash)}</code>
                ${item.isCustom ? `<span style="font-size:9px; background:#059669; color:#fff; padding:1px 4px; border-radius:3px;">${t("cmd_badge_custom")}</span>` : ""}
              </div>
              <div style="font-size:11px; color:#9ca3af; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">${escapeHtml(item.description || item.promptTemplate)}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <button type="button" class="otter-pin-toggle-btn" title="${isItemPinned ? t('cmd_pin_tooltip_pinned') : t('cmd_pin_tooltip_unpinned')}" style="
              background: ${isItemPinned ? 'rgba(234, 179, 8, 0.2)' : 'transparent'};
              border: 1px solid ${isItemPinned ? '#eab308' : '#3f3f46'};
              color: ${isItemPinned ? '#eab308' : '#71717a'};
              border-radius: 6px;
              cursor: pointer;
              font-size: 11px;
              padding: 3px 8px;
              display: inline-flex;
              align-items: center;
              gap: 3px;
              user-select: none;
            ">
              <span>${isItemPinned ? t('cmd_pin_btn_pinned') : t('cmd_pin_btn_unpinned')}</span>
            </button>
            ${item.isCustom ? `
              <button type="button" class="otter-delete-cmd-btn" title="${t('cmd_delete_tooltip')}" style="
                background: transparent;
                border: 1px solid #3f3f46;
                color: #ef4444;
                border-radius: 6px;
                cursor: pointer;
                font-size: 11px;
                padding: 3px 6px;
              ">🗑️</button>
            ` : ""}
            <span style="font-size:11px; color:#10b981; font-weight:600; margin-left:4px; white-space:nowrap;">${t('cmd_insert_cmd')}</span>
          </div>
        `;

        const pinBtn = row.querySelector<HTMLButtonElement>(".otter-pin-toggle-btn");
        if (pinBtn) {
          pinBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (item.isCustom) {
              const newPinned = !item.isPinned;
              await fetch(`http://127.0.0.1:1993/api/commands/${item.id}/pin`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pinned: newPinned })
              }).catch(() => {});
              item.isPinned = newPinned;
              const found = customCommands.find(c => c.id === item.id);
              if (found) found.isPinned = newPinned;
              if (typeof chrome !== "undefined" && chrome.storage?.local) {
                chrome.storage.local.set({ otter_custom_commands: customCommands });
              }
            } else {
              if (pinnedStandardIds.has(item.id)) {
                pinnedStandardIds.delete(item.id);
              } else {
                pinnedStandardIds.add(item.id);
              }
              if (typeof chrome !== "undefined" && chrome.storage?.local) {
                chrome.storage.local.set({ otter_pinned_standard_ids: Array.from(pinnedStandardIds) });
              }
            }
            renderList(searchInput.value);
            renderQuickActionChips();
          };
        }

        const delBtn = row.querySelector<HTMLButtonElement>(".otter-delete-cmd-btn");
        if (delBtn && item.isCustom) {
          delBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (confirm(t("cmd_delete_confirm", { slash: item.slash }))) {
              await fetch(`http://127.0.0.1:1993/api/commands/${item.id}`, { method: "DELETE" }).catch(() => {});
              customCommands = customCommands.filter(c => c.id !== item.id);
              if (typeof chrome !== "undefined" && chrome.storage?.local) {
                chrome.storage.local.set({ otter_custom_commands: customCommands });
              }
              renderList(searchInput.value);
              renderQuickActionChips();
            }
          };
        }

        listContainer.appendChild(row);
      }
    }
  }

  // Bind Add Button & Form
  const addBtn = header.querySelector<HTMLButtonElement>("#otter-palette-add-btn");
  const cancelBtn = createForm.querySelector<HTMLButtonElement>("#otter-create-cancel");
  const submitBtn = createForm.querySelector<HTMLButtonElement>("#otter-create-submit");
  const msgEl = createForm.querySelector<HTMLElement>("#otter-create-msg");

  if (addBtn && cancelBtn && submitBtn) {
    addBtn.onclick = () => {
      createForm.style.display = createForm.style.display === "flex" ? "none" : "flex";
      if (createForm.style.display === "flex") {
        (createForm.querySelector("#otter-new-slash") as HTMLInputElement)?.focus();
      }
    };
    cancelBtn.onclick = () => {
      createForm.style.display = "none";
    };
    submitBtn.onclick = async () => {
      const icon = (createForm.querySelector("#otter-new-icon") as HTMLInputElement).value.trim() || "⚡";
      const slash = (createForm.querySelector("#otter-new-slash") as HTMLInputElement).value.trim();
      const title = (createForm.querySelector("#otter-new-title") as HTMLInputElement).value.trim();
      const promptTemplate = (createForm.querySelector("#otter-new-prompt") as HTMLTextAreaElement).value.trim();
      const isPinned = (createForm.querySelector("#otter-new-pin") as HTMLInputElement).checked;

      if (!slash || !title || !promptTemplate) {
        if (msgEl) {
          msgEl.style.display = "block";
          msgEl.style.color = "#ef4444";
          msgEl.textContent = t("cmd_error_fields");
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = t("cmd_saving");

      try {
        const res = await fetch("http://127.0.0.1:1993/api/commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ icon, slash, title, promptTemplate, isPinned })
        });
        const data = await res.json();
        if (data.ok && data.command) {
          await loadCustomAndPinnedCommands();
          createForm.style.display = "none";
          renderList(searchInput.value);
          renderQuickActionChips();
          if (msgEl) msgEl.style.display = "none";
        } else {
          throw new Error(data.error || "Không thể lưu tập lệnh.");
        }
      } catch (err: any) {
        if (msgEl) {
          msgEl.style.display = "block";
          msgEl.style.color = "#ef4444";
          msgEl.textContent = `Lỗi: ${err.message}`;
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = t("cmd_save_command");
      }
    };
  }

  searchInput.oninput = () => {
    renderList(searchInput.value);
  };

  renderList();

  // Footer
  const footer = document.createElement("div");
  footer.style.cssText = `
    padding: 10px 18px;
    background: #121215;
    border-top: 1px solid #27272a;
    font-size: 11px;
    color: #71717a;
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;
  footer.innerHTML = `
    <span>${t("cmd_hint_tip")}</span>
    <span>${t("cmd_hint_esc")}</span>
  `;

  modal.appendChild(header);
  modal.appendChild(createForm);
  modal.appendChild(searchContainer);
  modal.appendChild(listContainer);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modalOverlay = overlay;

  // Focus ô tìm kiếm ngay lập tức
  setTimeout(() => searchInput.focus(), 50);

  // Xử lý đóng modal
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove();
      modalOverlay = null;
    }
  };

  header.querySelector("#otter-palette-close")?.addEventListener("click", () => {
    overlay.remove();
    modalOverlay = null;
  });

  const onKeyEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      overlay.remove();
      modalOverlay = null;
      window.removeEventListener("keydown", onKeyEscape);
    }
  };
  window.addEventListener("keydown", onKeyEscape);
}

/**
 * Autocomplete Popup khi người dùng gõ ký tự "/" trong ô chat
 */
class SlashCommandAutocomplete {
  private popup: HTMLElement | null = null;
  private activeIndex: number = 0;
  private currentMatches: CommandItem[] = [];
  private currentPrefix: string = "";

  init() {
    document.addEventListener("input", (e) => this.handleInput(e as InputEvent), true);
    document.addEventListener("keydown", (e) => this.handleKeyDown(e), true);
  }

  private getComposerText(): string {
    const composer = findPromptComposer();
    if (!composer) return "";
    return composer.isContentEditable || composer.getAttribute("contenteditable") === "true"
      ? (composer.innerText || composer.textContent || "")
      : ((composer as HTMLTextAreaElement).value || "");
  }

  private handleInput(e: InputEvent) {
    const text = this.getComposerText();
    // Bắt chuỗi lệnh slash ở đầu dòng hoặc sau khoảng trắng (e.g. "/abc" hoặc " /abc"), tránh bắt nhầm dấu gạch chéo trong đường dẫn file, URL hay từ ghép
    const match = text.match(/(?:^|\s)\/([a-zA-Z0-9_\-]*)$/);
    if (match) {
      this.currentPrefix = match[0].trim(); // e.g. "/b" hoặc "/"
      const query = match[1].toLowerCase();
      this.currentMatches = getAllCommands().filter(cmd =>
        cmd.slash.slice(1).toLowerCase().startsWith(query) ||
        cmd.title.toLowerCase().includes(query)
      ).slice(0, 7);

      if (this.currentMatches.length > 0) {
        this.showPopup();
      } else {
        this.hidePopup();
      }
    } else {
      this.hidePopup();
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (!this.popup) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.activeIndex = (this.activeIndex + 1) % this.currentMatches.length;
      this.updateSelection();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.activeIndex = (this.activeIndex - 1 + this.currentMatches.length) % this.currentMatches.length;
      this.updateSelection();
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (this.currentMatches[this.activeIndex]) {
        e.preventDefault();
        e.stopPropagation();
        const selected = this.currentMatches[this.activeIndex];
        insertCommandPrompt(selected, this.currentPrefix);
        this.hidePopup();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.hidePopup();
    }
  }

  private showPopup() {
    const composer = findPromptComposer();
    if (!composer) return;

    if (!this.popup) {
      this.popup = document.createElement("div");
      this.popup.id = "otter-slash-autocomplete";
      this.popup.style.cssText = `
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
      `;
      document.body.appendChild(this.popup);
    }

    // Tính toán tọa độ hiển thị nổi ngay phía trên composer
    const rect = composer.getBoundingClientRect();
    const popupHeight = Math.min(this.currentMatches.length * 48 + 36, 280);
    const top = Math.max(10, rect.top - popupHeight - 8);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - 380);

    this.popup.style.top = `${top}px`;
    this.popup.style.left = `${left}px`;

    this.activeIndex = 0;
    this.renderItems();
  }

  private renderItems() {
    if (!this.popup) return;

    let html = `
      <div style="padding:6px 10px; background:#202024; border-bottom:1px solid #2d2d32; font-size:11px; color:#a1a1aa; display:flex; justify-content:space-between; align-items:center;">
        <span>${t("cmd_autocomplete_header")}</span>
        <span>${t("cmd_autocomplete_nav")}</span>
      </div>
      <div id="otter-slash-list" style="display:flex; flex-direction:column; padding:4px;">
    `;

    this.currentMatches.forEach((cmd, idx) => {
      const isSelected = idx === this.activeIndex;
      const isItemPinned = cmd.isPinned || pinnedStandardIds.has(cmd.id);
      html += `
        <div class="otter-slash-item" data-idx="${idx}" style="
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 6px;
          cursor: pointer;
          background: ${isSelected ? "#27272a" : "transparent"};
          border-left: 3px solid ${isSelected ? "#10b981" : "transparent"};
          transition: background 0.1s ease;
        ">
          <span style="font-size:16px;">${cmd.icon}</span>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:6px;">
              <code style="color:#34d399; font-weight:700; font-size:12px;">${escapeHtml(cmd.slash)}</code>
              ${isItemPinned ? `<span style="font-size:10px;" title="${t("cmd_pin_btn_pinned")}">⭐</span>` : ""}
              <span style="font-size:12px; color:#ffffff; font-weight:500;">${escapeHtml(cmd.title)}</span>
              ${cmd.isCustom ? `<span style="font-size:9px; background:#059669; color:#fff; padding:1px 4px; border-radius:3px;">${t("cmd_badge_custom")}</span>` : ""}
            </div>
            <div style="font-size:11px; color:#9ca3af; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(cmd.description || cmd.promptTemplate)}</div>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    this.popup.innerHTML = html;

    // Gắn sự kiện click vào từng item
    const items = this.popup.querySelectorAll<HTMLElement>(".otter-slash-item");
    items.forEach((item, idx) => {
      item.onclick = () => {
        const selected = this.currentMatches[idx];
        if (selected) {
          insertCommandPrompt(selected, this.currentPrefix);
          this.hidePopup();
        }
      };
      item.onmouseenter = () => {
        this.activeIndex = idx;
        this.updateSelection();
      };
    });
  }

  private updateSelection() {
    if (!this.popup) return;
    const items = this.popup.querySelectorAll<HTMLElement>(".otter-slash-item");
    items.forEach((item, idx) => {
      const isSelected = idx === this.activeIndex;
      item.style.background = isSelected ? "#27272a" : "transparent";
      item.style.borderLeft = `3px solid ${isSelected ? "#10b981" : "transparent"}`;
    });
  }

  hidePopup() {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
  }
}

export function initCommandPalette() {
  const slashAutocomplete = new SlashCommandAutocomplete();
  slashAutocomplete.init();

  loadCustomAndPinnedCommands();

  // Định kỳ giữ thanh Quick Action Chips luôn hiện diện khi người dùng chuyển cuộc trò chuyện
  setInterval(() => {
    renderQuickActionChips();
  }, 1500);

  console.log("[Otter Command Palette] Initialized with Slash Commands, Custom Commands & Quick Action Chips");
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

