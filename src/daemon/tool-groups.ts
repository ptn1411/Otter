import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { getOtterDir } from "./db";

/**
 * Bật/tắt nhóm MCP tools theo nhóm chức năng (code, fb, browser, vps...)
 * để giảm lượng token schema nạp vào AI mỗi phiên.
 *
 * - Cấu hình lưu ở ~/.otter/tool-groups.json dạng { "disabledGroups": [...] }
 *   (mặc định rỗng = bật tất cả, nhóm mới thêm sau này tự bật).
 * - createMcpServer (mcp.ts) bọc mcp.tool để ghi lại RegisteredTool theo
 *   nhóm, áp trạng thái bật/tắt ngay khi tạo phiên.
 * - Khi đổi trạng thái từ Dashboard, áp trực tiếp lên mọi phiên MCP đang
 *   sống qua RegisteredTool.enable()/disable() (SDK tự gửi tools/list_changed,
 *   tool bị tắt sẽ biến mất khỏi tools/list và không gọi được).
 */

export interface ToolGroupDef {
  id: string;
  nameVi: string;
  nameEn: string;
  descVi: string;
  descEn: string;
  /** Số tool trong nhóm (đếm từ mã nguồn tại thời điểm viết). */
  toolCount: number;
  /** Ước lượng token schema của cả nhóm (chars/3.5 từ mã nguồn). */
  estTokens: number;
}

export const TOOL_GROUPS: ToolGroupDef[] = [
  // core gồm 7 tool terminal/file/media + 2 tool hệ thống tool_groups_list/set
  // (luôn bật, đăng ký ngoài cơ chế capture — xem mcp.ts).
  { id: "core", nameVi: "Máy tính & File", nameEn: "Computer & Files", descVi: "Chạy lệnh terminal, đọc/ghi/sửa file, tạo giọng nói, dựng video Remotion, nhạc nền", descEn: "Terminal commands, file read/write/edit, TTS, Remotion video, background music", toolCount: 9, estTokens: 700 },
  { id: "agent-desktop", nameVi: "Agent Desktop", nameEn: "Agent Desktop", descVi: "Quan sát và điều khiển giao diện desktop theo cấu trúc ngữ nghĩa (snapshot, click, type, refs)", descEn: "Semantic desktop observation and control (snapshot, click, type, refs)", toolCount: 75, estTokens: 4200 },
  { id: "browser", nameVi: "Trình duyệt", nameEn: "Browser", descVi: "Mở trang, đọc nội dung, bấm, gõ, cuộn, quản lý tab và profile Chrome", descEn: "Open pages, read content, click, type, scroll, manage tabs and Chrome profiles", toolCount: 15, estTokens: 804 },
  { id: "desktop", nameVi: "Màn hình Desktop", nameEn: "Desktop Control", descVi: "Chụp màn hình, điều khiển chuột và bàn phím, Computer Use Agent", descEn: "Screenshots, mouse and keyboard control, Computer Use Agent", toolCount: 6, estTokens: 305 },
  { id: "phone", nameVi: "Điện thoại Android (PhoneCloud)", nameEn: "Android Phone (PhoneCloud)", descVi: "Điều khiển điện thoại Android từ xa: cây Accessibility, chạm, vuốt, gõ chữ, mở app, clipboard, chụp ảnh màn hình", descEn: "Remote Android phone control: Accessibility UI tree, tap, swipe, type, open apps, clipboard, screenshots", toolCount: 20, estTokens: 1180 },
  { id: "code", nameVi: "Code & Dự án", nameEn: "Code & Projects", descVi: "Tìm kiếm code, symbol, outline, git status, đồ thị codebase và kiến trúc", descEn: "Code search, symbols, outline, git status, codebase graph and architecture", toolCount: 13, estTokens: 1031 },
  { id: "fb", nameVi: "Facebook tự động", nameEn: "Facebook Automation", descVi: "Đăng bài, trả lời bình luận, tương tác feed, đăng nhóm theo lịch, đăng media, bán hàng Messenger", descEn: "Posting, comment replies, feed engagement, scheduled group posts, media posts, Messenger sales", toolCount: 58, estTokens: 4651 },
  { id: "meta", nameVi: "Meta Unified", nameEn: "Meta Unified", descVi: "Gọi các cầu nối Meta CLI: Facebook, Messenger, Instagram, Threads, Meta Ads", descEn: "Meta CLI bridges: Facebook, Messenger, Instagram, Threads, Meta Ads", toolCount: 16, estTokens: 723 },
  { id: "vps", nameVi: "VPS & SSH", nameEn: "VPS & SSH", descVi: "SSH/SFTP từ xa, kiểm tra sức khỏe VPS, cài phần mềm, SSL, firewall", descEn: "Remote SSH/SFTP, VPS health audit, software install, SSL, firewall", toolCount: 13, estTokens: 961 },
  { id: "db", nameVi: "Cơ sở dữ liệu", nameEn: "Database", descVi: "Kết nối và truy vấn cơ sở dữ liệu (chỉ đọc mặc định)", descEn: "Database connections and queries (read-only by default)", toolCount: 10, estTokens: 357 },
  { id: "agents", nameVi: "Đa tác nhân & Vòng lặp", nameEn: "Multi-Agent & Loops", descVi: "Chạy Claude/Gemini/Codex, điều phối đội máy (Fleet), cầu nối task IDE, kế hoạch và vòng lặp tự động", descEn: "Run Claude/Gemini/Codex, fleet orchestration, IDE task bridge, plans and automation loops", toolCount: 57, estTokens: 3325 },
  { id: "gpm", nameVi: "GPM Login", nameEn: "GPM Login", descVi: "Quản lý profile trình duyệt antidetect GPM, tạo script tự động hóa", descEn: "GPM antidetect browser profiles, automation script generation", toolCount: 6, estTokens: 358 },
  { id: "social", nameVi: "MXH & Bot xã hội", nameEn: "Social & MXH Bot", descVi: "Bot kết nối MXH qua Socket.IO, đọc/ghi file trong MXH", descEn: "MXH Socket.IO bot client, MXH file read/write", toolCount: 8, estTokens: 518 },
  { id: "antigravity", nameVi: "Antigravity IDE", nameEn: "Antigravity IDE", descVi: "Điều khiển Antigravity qua Chrome DevTools Protocol", descEn: "Control Antigravity via Chrome DevTools Protocol", toolCount: 4, estTokens: 414 },
  { id: "muse", nameVi: "Cầu nối Muse", nameEn: "Muse Bridge", descVi: "Hỏi trợ lý Muse (agent-to-agent)", descEn: "Ask the Muse assistant (agent-to-agent)", toolCount: 1, estTokens: 86 },
  { id: "skills", nameVi: "Kỹ năng & Tiện ích", nameEn: "Skills & Utilities", descVi: "Kho kỹ năng AI, bookmark, lệnh tùy chỉnh, quản lý MCP server ngoài", descEn: "AI skills catalog, bookmarks, custom commands, external MCP server management", toolCount: 14, estTokens: 958 },
  { id: "motion", nameVi: "Motion", nameEn: "Motion", descVi: "Đọc tài nguyên Motion (motion://)", descEn: "Read Motion resources (motion://)", toolCount: 1, estTokens: 56 },
  { id: "external", nameVi: "MCP server ngoài", nameEn: "External MCP Servers", descVi: "Tool nạp động từ các MCP server ngoài trong mcp_config.json", descEn: "Tools dynamically loaded from external MCP servers in mcp_config.json", toolCount: 0, estTokens: 0 },
];

export const TOOL_GROUP_IDS = new Set(TOOL_GROUPS.map((g) => g.id));

/** Các preset bật/tắt nhanh (dùng chung cho Dashboard, REST và MCP tool). */
export const TOOL_GROUP_PRESETS: Record<string, string[] | null> = {
  all: null, // null = bật tất cả
  minimal: ["core", "browser"],
  code: ["core", "code", "agents", "skills"],
  fb: ["core", "browser", "fb", "meta"],
  phone: ["core", "phone", "browser"],
};

// ---------------------------------------------------------------------------
// Cấu hình bền vững: ~/.otter/tool-groups.json
// ---------------------------------------------------------------------------

function configPath(): string {
  return path.join(getOtterDir(), "tool-groups.json");
}

let disabledGroups: Set<string> | null = null;

export function resetToolGroupConfig(): void {
  disabledGroups = null;
}

export function loadToolGroupConfig(): Set<string> {
  if (disabledGroups) return disabledGroups;
  disabledGroups = new Set();
  try {
    const raw = fs.readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.disabledGroups) ? parsed.disabledGroups : [];
    for (const id of list) {
      if (typeof id === "string" && TOOL_GROUP_IDS.has(id)) disabledGroups.add(id);
    }
  } catch {
    // Chưa có file cấu hình -> bật tất cả.
  }
  return disabledGroups;
}

function saveToolGroupConfig(): void {
  try {
    fs.writeFileSync(
      configPath(),
      JSON.stringify({ disabledGroups: [...loadToolGroupConfig()] }, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.warn("[ToolGroups] Không lưu được cấu hình:", err);
  }
}

export function isGroupEnabled(groupId: string): boolean {
  return !loadToolGroupConfig().has(groupId);
}

// ---------------------------------------------------------------------------
// Ghi lại RegisteredTool theo nhóm + áp trạng thái lên phiên đang sống
// ---------------------------------------------------------------------------

type RegisteredToolHandle = { enable: () => void; disable: () => void };

interface TrackedInstance {
  mcp: McpServer;
  handlesByGroup: Map<string, RegisteredToolHandle[]>;
}

const liveInstances = new Set<TrackedInstance>();

/**
 * Bọc mcp.tool để ghi lại mọi RegisteredTool được đăng ký, gắn nhãn nhóm
 * hiện hành. Trả về bộ điều khiển: setGroup() trước khi gọi registerXTools,
 * và handlesByGroup để áp trạng thái.
 */
export function captureToolRegistrations(mcp: McpServer): {
  setGroup: (groupId: string) => void;
  handlesByGroup: Map<string, RegisteredToolHandle[]>;
} {
  const handlesByGroup = new Map<string, RegisteredToolHandle[]>();
  let currentGroup = "core";
  const originalTool = (mcp as any).tool.bind(mcp);
  (mcp as any).tool = (...args: any[]) => {
    const registered = originalTool(...args);
    const list = handlesByGroup.get(currentGroup) ?? [];
    list.push(registered as RegisteredToolHandle);
    handlesByGroup.set(currentGroup, list);
    return registered;
  };
  return {
    setGroup: (groupId: string) => {
      currentGroup = groupId;
    },
    handlesByGroup,
  };
}

/** Áp trạng thái bật/tắt hiện hành lên một phiên MCP. */
export function applyGroupState(handlesByGroup: Map<string, RegisteredToolHandle[]>): void {
  const disabled = loadToolGroupConfig();
  for (const [groupId, handles] of handlesByGroup) {
    const enabled = !disabled.has(groupId);
    for (const h of handles) {
      try {
        if (enabled) h.enable();
        else h.disable();
      } catch {
        // Phiên đã đóng hoặc chưa kết nối transport — bỏ qua.
      }
    }
  }
}

/** Đăng ký một phiên MCP vào danh sách theo dõi; tự gỡ khi phiên đóng. */
export function trackMcpInstance(
  mcp: McpServer,
  handlesByGroup: Map<string, RegisteredToolHandle[]>
): void {
  const tracked: TrackedInstance = { mcp, handlesByGroup };
  liveInstances.add(tracked);
  const server: any = (mcp as any).server;
  if (server) {
    const prevOnClose = server.onclose;
    server.onclose = () => {
      liveInstances.delete(tracked);
      try {
        prevOnClose?.();
      } catch {}
    };
  }
}

export function getLiveSessionCount(): number {
  return liveInstances.size;
}

// ---------------------------------------------------------------------------
// API trạng thái + thay đổi (dùng bởi routes/tool-groups-routes.ts)
// ---------------------------------------------------------------------------

export interface ToolGroupState extends ToolGroupDef {
  enabled: boolean;
  /** Số tool thực tế đã đăng ký trong các phiên đang sống (nhóm external động). */
  liveToolCount: number;
}

export function getToolGroupsState(): {
  groups: ToolGroupState[];
  totalTools: number;
  enabledTools: number;
  totalEstTokens: number;
  enabledEstTokens: number;
  liveSessions: number;
} {
  const disabled = loadToolGroupConfig();
  // Đếm tool thực tế từ một phiên đang sống (nếu có) để nhóm external có số thật.
  const liveCounts = new Map<string, number>();
  for (const inst of liveInstances) {
    for (const [groupId, handles] of inst.handlesByGroup) {
      liveCounts.set(groupId, Math.max(liveCounts.get(groupId) ?? 0, handles.length));
    }
    break; // Chỉ cần một phiên làm mẫu.
  }

  const groups: ToolGroupState[] = TOOL_GROUPS.map((g) => {
    const live = liveCounts.get(g.id);
    const toolCount = g.id === "external" ? (live ?? 0) : g.toolCount;
    return {
      ...g,
      toolCount,
      enabled: !disabled.has(g.id),
      liveToolCount: live ?? g.toolCount,
    };
  });

  const totalTools = groups.reduce((s, g) => s + g.toolCount, 0);
  const enabledTools = groups.filter((g) => g.enabled).reduce((s, g) => s + g.toolCount, 0);
  const totalEstTokens = groups.reduce((s, g) => s + g.estTokens, 0);
  const enabledEstTokens = groups.filter((g) => g.enabled).reduce((s, g) => s + g.estTokens, 0);

  return {
    groups,
    totalTools,
    enabledTools,
    totalEstTokens,
    enabledEstTokens,
    liveSessions: liveInstances.size,
  };
}

/**
 * Bật/tắt một hoặc nhiều nhóm. Lưu cấu hình rồi áp ngay lên mọi phiên
 * MCP đang sống. Trả về trạng thái mới.
 */
export function setToolGroupsEnabled(changes: Record<string, boolean>): ReturnType<typeof getToolGroupsState> {
  const disabled = loadToolGroupConfig();
  for (const [groupId, enabled] of Object.entries(changes)) {
    if (!TOOL_GROUP_IDS.has(groupId)) continue;
    if (enabled) disabled.delete(groupId);
    else disabled.add(groupId);
  }
  saveToolGroupConfig();
  for (const inst of [...liveInstances]) {
    applyGroupState(inst.handlesByGroup);
  }
  return getToolGroupsState();
}

/** Áp một preset (all/minimal/code/fb). Ném lỗi nếu preset không tồn tại. */
export function applyToolGroupPreset(preset: string): ReturnType<typeof getToolGroupsState> {
  if (!(preset in TOOL_GROUP_PRESETS)) {
    throw new Error(
      `Preset không tồn tại: ${preset}. Các preset hợp lệ: ${Object.keys(TOOL_GROUP_PRESETS).join(", ")}`
    );
  }
  const keep = TOOL_GROUP_PRESETS[preset];
  const changes: Record<string, boolean> = {};
  for (const g of TOOL_GROUPS) {
    changes[g.id] = keep === null ? true : keep.includes(g.id);
  }
  return setToolGroupsEnabled(changes);
}
