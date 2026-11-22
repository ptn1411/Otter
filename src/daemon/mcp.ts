import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OTTER_VERSION } from "./version";
import { registerExternalToolsToMcpServer } from "./mcp-gateway";
import {
  captureToolRegistrations,
  applyGroupState,
  trackMcpInstance,
} from "./tool-groups";
import {
  registerTerminalAndFileTools,
  registerCodebaseTools,
  registerSkillTools,
  registerDesktopTools,
  registerAgentDesktopTools,
  registerVpsTools,
  registerBrowserTools,
  registerBookmarkTools,
  registerExternalAndPromptTools,
  registerTaskBridgeTools,
  registerPlanTools,
  registerFbReplyTools,
  registerFbPostTools,
  registerDbTools,
  registerCodeTools,
  registerLoopTools,
  registerCustomCommandTools,
  registerMultiAgentTools,
  registerFleetTools,
  registerChromeTools,
  registerPageLoopTools,
  registerMotionTools,
  registerFbEngageTools,
  registerFbGroupPostTools,
  registerMuseTools,
  registerFbMediaPostTools,
  registerGpmTools,
  registerSocialBotTools,
  registerA2aTools,
  registerAntigravityCdpTools,
  registerMetaTools,
  registerToolGroupsTools
} from "./tools";

/**
 * Khởi tạo máy chủ MCP Server với đầy đủ các bộ công cụ đã được module hóa.
 * @param onActivity Callback bắn sự kiện thời gian thực lên Dashboard và Live Terminal Panel
 */
export function createMcpServer(onActivity?: (event: any) => void): McpServer {
  const mcp = new McpServer({
    name: "Otter",
    version: OTTER_VERSION
  });

  // Tool hệ thống bật/tắt nhóm MCP (tool_groups_list/set): đăng ký TRƯỚC
  // capture để luôn khả dụng, AI không tự khóa mình ra ngoài được.
  registerToolGroupsTools(mcp, onActivity);

  // Bọc mcp.tool để ghi lại RegisteredTool theo nhóm (bật/tắt từ Dashboard,
  // xem tool-groups.ts). setGroup() phải gọi trước mỗi registerXTools.
  const capture = captureToolRegistrations(mcp);
  const setGroup = capture.setGroup;

  // 1. Công cụ Terminal, File I/O và Media (TTS, Remotion, DSP Audio)
  setGroup("core");
  registerTerminalAndFileTools(mcp, onActivity);

  // 2. Bộ nhớ đồ thị mã nguồn (Codebase Memory Graph)
  setGroup("code");
  registerCodebaseTools(mcp, onActivity);

  // 3. Kho kỹ năng AI (AI Skills)
  setGroup("skills");
  registerSkillTools(mcp, onActivity);

  // 4. Điều khiển Desktop & CUA (Computer Use Agent)
  setGroup("desktop");
  registerDesktopTools(mcp, onActivity);

  // 4b. Agent Desktop (Semantic ref-based desktop control via child stdio MCP)
  setGroup("agent-desktop");
  registerAgentDesktopTools(mcp, onActivity);

  // 5. Quản trị VPS từ xa (SSH & SFTP Paramiko Bridge)
  setGroup("vps");
  registerVpsTools(mcp, onActivity);

  // 6. Tự động hóa trình duyệt web (Browser Automation)
  setGroup("browser");
  registerBrowserTools(mcp, onActivity);

  // 7. Quản lý kho Bookmark & Tìm kiếm tri thức cá nhân
  setGroup("skills");
  registerBookmarkTools(mcp, onActivity);

  // 8. Quản lý tập lệnh tùy chỉnh & phím tắt của người dùng (Custom Slash Commands & Pinning)
  setGroup("skills");
  registerCustomCommandTools(mcp, onActivity);

  // 9. Cấu hình External MCP Servers & Prompt Workflow chuẩn
  setGroup("skills");
  registerExternalAndPromptTools(mcp, onActivity);

  // 10. Cầu nối nhiệm vụ AI IDE Worker (Giano / Task Bridge)
  setGroup("agents");
  registerTaskBridgeTools(mcp, onActivity);

  // 10b. Plan code liên tục (Phase 1) — chạy sau Task Bridge để dùng chung bảng tasks
  setGroup("agents");
  registerPlanTools(mcp, onActivity);

  // 10c. FB Reply Loop — tracker phiên trả lời bình luận Facebook
  setGroup("fb");
  registerFbReplyTools(mcp, onActivity);

  // 10d. FB Auto Post — tracker phiên đăng bài digest tin mới (mode auto)
  setGroup("fb");
  registerFbPostTools(mcp, onActivity);

  // 10d2. FB Feed Engagement — tracker và thực thi tương tác Bảng feed tự động
  setGroup("fb");
  registerFbEngageTools(mcp, onActivity);

  // 10e. DB Manager (Python) — wrapper mỏng spawn tools/db-manager/bin/dbm,
  // dùng chung profiles qua DBM_HOME, chỉ đọc mặc định (xem db-tools.ts)
  setGroup("db");
  registerDbTools(mcp, onActivity);

  // 10f. Code workspace — tìm kiếm/liệt kê/symbol/outline/git status không
  // cần index (ripgrep + regex), và sửa task plan (xem code-tools.ts)
  setGroup("code");
  registerCodeTools(mcp, onActivity);

  // 10g. Loop controller — vòng lặp code chuẩn (state machine + final gate
  // có cưỡng chế, xem loop-controller.ts và loop-tools.ts)
  setGroup("agents");
  registerLoopTools(mcp, onActivity);

  // 11. Nạp động các công cụ từ các server MCP ngoài (mcp_config.json)
  setGroup("external");
  registerExternalToolsToMcpServer(mcp, onActivity);

  // 12. Điều khiển Multi-Agent CLI (Claude, Gemini, Codex)
  setGroup("agents");
  registerMultiAgentTools(mcp, onActivity);

  // 13. Fleet / multi-node — hub điều phối + worker inbox (B2)
  setGroup("agents");
  registerFleetTools(mcp, onActivity);

  // 13b. A2A store-and-forward coordination (Phase 1)
  setGroup("agents");
  registerA2aTools(mcp, onActivity);

  // 14. Chrome theo profile — mở đúng profile Chrome trên máy này
  setGroup("browser");
  registerChromeTools(mcp, onActivity);
  setGroup("agents");
  registerPageLoopTools(mcp, onActivity);

  // 13. Motion MCP free — đọc tài nguyên motion:// mà gateway không proxy
  // (2 tool search/insert của Motion đã có qua gateway từ mcp_config.json;
  // xem src/daemon/motion-mcp.ts — server Motion+ không nối, cần đăng nhập)
  setGroup("motion");
  registerMotionTools(mcp, onActivity);

  // 15. FB Scheduled Group Posting
  setGroup("fb");
  registerFbGroupPostTools(mcp, onActivity);

  // 16. Cầu nối AI đối tác Muse (Agent-to-Agent Collaboration)
  setGroup("muse");
  registerMuseTools(mcp, onActivity);

  // 17. Đăng bài Video, Hình ảnh & Hàng đợi Batch Facebook (Profile, Group, Page)
  setGroup("fb");
  registerFbMediaPostTools(mcp, onActivity);

  // 18. GPM Automate V3 & GPM Login Local API Bridge
  setGroup("gpm");
  registerGpmTools(mcp, onActivity);

  // 19. Social Task Mesh — Bot Client kết nối MXH Socket.IO
  setGroup("social");
  registerSocialBotTools(mcp, onActivity);

  // 20. Antigravity IDE CDP Bridge — Điều khiển trực tiếp Antigravity qua Chrome DevTools Protocol
  setGroup("antigravity");
  registerAntigravityCdpTools(mcp, onActivity);

  // 21. Meta Unified Toolset — gọi các cầu nối Meta CLI (fb, msg, ig, th, ads)
  // qua Reverse RPC trên localhost (Phase #22/#23)
  setGroup("meta");
  registerMetaTools(mcp, onActivity);

  // Áp trạng thái bật/tắt nhóm (Dashboard) và theo dõi phiên để áp trực tiếp
  // khi người dùng đổi trạng thái (xem tool-groups.ts).
  applyGroupState(capture.handlesByGroup);
  trackMcpInstance(mcp, capture.handlesByGroup);

  return mcp;
}
