/**
 * Daemon LCG Route Masking & Obfuscation Table (v2 - Salted)
 * 
 * Nâng cấp bảo mật:
 * 1. Per-String 16-bit Salt: Mỗi route có 2 byte Salt đầu tiên hoàn toàn độc lập,
 *    kết hợp với MurmurHash3 mixer và 4 vòng warm-up.
 * 2. Zero-Plaintext Caching: Giải mã On-the-fly khi so khớp, không lưu cache RAM.
 * 3. Safe 32-bit Arithmetic: Thống nhất bitwise với core engine.
 */

import { LcgCipher, LCG_DEFAULT_SEED } from "../license/lcg-router";

export const OBFUSCATED_DAEMON_ROUTES = {
  // "/api/commands"
  COMMANDS: [149, 51, 192, 195, 72, 162, 154, 135, 130, 23, 240, 230, 32, 98, 233],
  // "/api/bookmarks"
  BOOKMARKS: [200, 218, 48, 155, 0, 26, 250, 190, 36, 101, 105, 120, 38, 188, 84, 73],
  // "/api/skills"
  SKILLS: [225, 67, 194, 184, 78, 49, 20, 198, 98, 86, 157, 131, 91],
  // "/api/system/license"
  SYS_LICENSE: [183, 240, 174, 230, 16, 107, 150, 23, 247, 211, 198, 115, 22, 119, 239, 162, 192, 84, 252, 47, 174],
  // "/api/system/license/activate"
  SYS_LICENSE_ACTIVATE: [156, 241, 231, 131, 60, 10, 13, 113, 220, 66, 237, 195, 199, 95, 18, 102, 28, 131, 19, 201, 178, 15, 181, 103, 61, 221, 176, 110, 149, 172],
  // "/api/system/tunnel"
  SYS_TUNNEL: [152, 188, 173, 47, 92, 2, 237, 250, 54, 238, 222, 26, 221, 103, 161, 215, 175, 237, 135, 94],
  // "/api/system/tunnel/start"
  SYS_TUNNEL_START: [219, 99, 78, 94, 161, 168, 120, 103, 32, 55, 64, 128, 20, 116, 14, 63, 251, 162, 207, 56, 189, 2, 238, 172, 57, 98],
  // "/api/system/tunnel/stop"
  SYS_TUNNEL_STOP: [61, 240, 120, 31, 32, 194, 178, 171, 220, 127, 75, 190, 8, 6, 135, 167, 198, 68, 218, 219, 250, 228, 117, 9, 51],
  // "/api/local/system/folder-picker"
  SYS_FOLDER_PICKER: [53, 255, 48, 107, 5, 84, 68, 125, 32, 182, 193, 210, 30, 120, 77, 222, 123, 29, 139, 77, 37, 49, 43, 182, 90, 177, 186, 81, 235, 191, 184, 201, 188],
  // "/api/local/system/file-picker"
  SYS_FILE_PICKER: [47, 30, 227, 48, 37, 152, 144, 159, 49, 165, 158, 159, 223, 12, 160, 244, 75, 177, 133, 88, 31, 218, 146, 208, 103, 132, 45, 79, 203, 46, 236],
  // "/api/mcp/servers"
  MCP_SERVERS: [201, 26, 226, 73, 211, 123, 172, 37, 25, 5, 177, 56, 119, 233, 156, 15, 58, 17],
  // "/api/mcp/reload"
  MCP_RELOAD: [215, 148, 53, 122, 79, 27, 153, 58, 128, 211, 6, 214, 34, 35, 195, 30, 26],
  // "/api/mcp/config"
  MCP_CONFIG: [133, 214, 228, 186, 192, 117, 238, 195, 234, 109, 107, 105, 62, 243, 97, 48, 130],
  // "/api/mcp/servers/add"
  MCP_SERVERS_ADD: [75, 93, 210, 74, 22, 79, 67, 152, 131, 119, 132, 206, 35, 164, 229, 48, 217, 149, 94, 177, 134, 144],
  // "/api/mcp/servers/delete"
  MCP_SERVERS_DEL: [147, 153, 28, 200, 3, 180, 171, 251, 122, 52, 221, 114, 145, 228, 51, 61, 44, 60, 84, 94, 176, 0, 25, 212, 179],
  // "/api/mcp/ext/"
  MCP_EXT_PREFIX: [59, 40, 41, 175, 48, 232, 223, 222, 81, 241, 97, 64, 89, 151, 129],
  // "/api/activity/v1/terminal/exec"
  ACT_TERM_EXEC: [107, 211, 27, 253, 193, 63, 210, 118, 42, 198, 52, 89, 181, 51, 206, 254, 115, 152, 245, 101, 181, 216, 49, 2, 64, 34, 75, 100, 207, 203, 55, 173],
  // "/api/activity/v1/files/read"
  ACT_FILES_READ: [86, 117, 181, 242, 54, 88, 254, 198, 215, 151, 223, 74, 69, 214, 169, 199, 233, 24, 143, 14, 224, 175, 241, 118, 41, 32, 95, 93, 66],
  // "/api/activity/v1/files/write"
  ACT_FILES_WRITE: [214, 143, 8, 43, 176, 10, 104, 211, 99, 185, 213, 199, 52, 76, 233, 16, 242, 151, 142, 233, 255, 230, 87, 227, 240, 133, 177, 220, 188, 130],
  // "/api/activity/v1/pending-bind"
  ACT_PENDING_BIND: [133, 141, 241, 19, 121, 138, 248, 176, 136, 180, 230, 114, 220, 169, 73, 207, 235, 185, 233, 91, 245, 198, 213, 233, 209, 36, 116, 16, 17, 45, 66],
  // "/api/activity/v1/bind"
  ACT_BIND: [166, 126, 162, 247, 27, 126, 240, 198, 156, 140, 232, 142, 49, 247, 224, 255, 229, 101, 18, 78, 1, 52, 61],
  // "/api/activity/v1/stream"
  ACT_STREAM: [184, 107, 61, 157, 126, 191, 212, 151, 26, 97, 209, 127, 163, 8, 205, 133, 250, 139, 28, 200, 21, 53, 70, 50, 148],
  // "/api/activity/v1/conversations/"
  ACT_CONV_PREFIX: [6, 225, 159, 87, 79, 120, 66, 175, 16, 63, 213, 128, 245, 180, 25, 231, 190, 23, 6, 229, 169, 6, 94, 35, 4, 158, 67, 187, 8, 119, 38, 176, 165],
  // "/api/activity/v1/browser/"
  ACT_BROWSER_PREFIX: [85, 61, 117, 9, 155, 88, 60, 123, 13, 236, 210, 90, 253, 171, 102, 149, 88, 5, 178, 162, 134, 160, 239, 113, 119, 1, 2],
  // "/api/activity/v1/desktop/"
  ACT_DESKTOP_PREFIX: [117, 203, 205, 62, 161, 5, 183, 85, 176, 199, 249, 12, 153, 14, 113, 97, 36, 154, 27, 132, 58, 229, 124, 89, 199, 44, 161],
} as const;

export type DaemonRouteKey = keyof typeof OBFUSCATED_DAEMON_ROUTES;

/**
 * Lấy đường dẫn API đã giải mã từ khóa LCG của daemon (Zero-Plaintext Caching: On-the-fly)
 */
export function getDaemonRoute(key: DaemonRouteKey): string {
  const bytes = OBFUSCATED_DAEMON_ROUTES[key];
  if (!bytes) throw new Error(`Không tìm thấy daemon route cho key: ${key}`);
  return LcgCipher.deobfuscate(bytes, LCG_DEFAULT_SEED);
}

/**
 * Khớp nối chính xác đường dẫn router (ẩn không dùng chuỗi thô)
 */
export function matchDaemonRoute(pathname: string, key: DaemonRouteKey): boolean {
  return pathname === getDaemonRoute(key);
}

/**
 * Khớp nối tiền tố (Prefix) đường dẫn router
 */
export function matchDaemonRoutePrefix(pathname: string, key: DaemonRouteKey): boolean {
  return pathname.startsWith(getDaemonRoute(key));
}

/**
 * Khớp nối regex đường dẫn con dựa trên route gốc
 */
export function matchDaemonSubPath(pathname: string, baseKey: DaemonRouteKey, subPattern: string): RegExpMatchArray | null {
  const base = getDaemonRoute(baseKey);
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escapedBase}${subPattern}$`);
  return pathname.match(regex);
}
