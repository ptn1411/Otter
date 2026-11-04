import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExternalToolsToMcpServer } from "./mcp-gateway";
import {
  registerTerminalAndFileTools,
  registerCodebaseTools,
  registerSkillTools,
  registerDesktopTools,
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
  registerFbMediaPostTools
} from "./tools";

/**
 * Khởi tạo máy chủ MCP Server với đầy đủ các bộ công cụ đã được module hóa.
 * @param onActivity Callback bắn sự kiện thời gian thực lên Dashboard và Live Terminal Panel
 */
export function createMcpServer(onActivity?: (event: any) => void): McpServer {
  const mcp = new McpServer({
    name: "Otter",
    version: "2.0.0"
  });

  // 1. Công cụ Terminal, File I/O và Media (TTS, Remotion, DSP Audio)
  registerTerminalAndFileTools(mcp, onActivity);

  // 2. Bộ nhớ đồ thị mã nguồn (Codebase Memory Graph)
  registerCodebaseTools(mcp, onActivity);

  // 3. Kho kỹ năng AI (AI Skills)
  registerSkillTools(mcp, onActivity);

  // 4. Điều khiển Desktop & CUA (Computer Use Agent)
  registerDesktopTools(mcp, onActivity);

  // 5. Quản trị VPS từ xa (SSH & SFTP Paramiko Bridge)
  registerVpsTools(mcp, onActivity);

  // 6. Tự động hóa trình duyệt web (Browser Automation)
  registerBrowserTools(mcp, onActivity);

  // 7. Quản lý kho Bookmark & Tìm kiếm tri thức cá nhân
  registerBookmarkTools(mcp, onActivity);

  // 8. Quản lý tập lệnh tùy chỉnh & phím tắt của người dùng (Custom Slash Commands & Pinning)
  registerCustomCommandTools(mcp, onActivity);

  // 9. Cấu hình External MCP Servers & Prompt Workflow chuẩn
  registerExternalAndPromptTools(mcp, onActivity);

  // 10. Cầu nối nhiệm vụ AI IDE Worker (Giano / Task Bridge)
  registerTaskBridgeTools(mcp, onActivity);

  // 10b. Plan code liên tục (Phase 1) — chạy sau Task Bridge để dùng chung bảng tasks
  registerPlanTools(mcp, onActivity);

  // 10c. FB Reply Loop — tracker phiên trả lời bình luận Facebook
  registerFbReplyTools(mcp, onActivity);

  // 10d. FB Auto Post — tracker phiên đăng bài digest tin mới (mode auto)
  registerFbPostTools(mcp, onActivity);

  // 10d2. FB Feed Engagement — tracker và thực thi tương tác Bảng feed tự động
  registerFbEngageTools(mcp, onActivity);

  // 10e. DB Manager (Python) — wrapper mỏng spawn tools/db-manager/bin/dbm,
  // dùng chung profiles qua DBM_HOME, chỉ đọc mặc định (xem db-tools.ts)
  registerDbTools(mcp, onActivity);

  // 10f. Code workspace — tìm kiếm/liệt kê/symbol/outline/git status không
  // cần index (ripgrep + regex), và sửa task plan (xem code-tools.ts)
  registerCodeTools(mcp, onActivity);

  // 10g. Loop controller — vòng lặp code chuẩn (state machine + final gate
  // có cưỡng chế, xem loop-controller.ts và loop-tools.ts)
  registerLoopTools(mcp, onActivity);

  // 11. Nạp động các công cụ từ các server MCP ngoài (mcp_config.json)
  registerExternalToolsToMcpServer(mcp, onActivity);

  // 12. Điều khiển Multi-Agent CLI (Claude, Gemini, Codex)
  registerMultiAgentTools(mcp, onActivity);

  // 13. Fleet / multi-node — hub điều phối + worker inbox (B2)
  registerFleetTools(mcp, onActivity);

  // 14. Chrome theo profile — mở đúng profile Chrome trên máy này
  registerChromeTools(mcp, onActivity);
  registerPageLoopTools(mcp, onActivity);

  // 13. Motion MCP free — đọc tài nguyên motion:// mà gateway không proxy
  // (2 tool search/insert của Motion đã có qua gateway từ mcp_config.json;
  // xem src/daemon/motion-mcp.ts — server Motion+ không nối, cần đăng nhập)
  registerMotionTools(mcp, onActivity);

  // 15. FB Scheduled Group Posting
  registerFbGroupPostTools(mcp, onActivity);

  // 16. Cầu nối AI đối tác Muse (Agent-to-Agent Collaboration)
  registerMuseTools(mcp, onActivity);

  // 17. Đăng bài Video, Hình ảnh & Hàng đợi Batch Facebook (Profile, Group, Page)
  registerFbMediaPostTools(mcp, onActivity);

  return mcp;
}
