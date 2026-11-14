import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as crypto from "node:crypto";

const allowedWorkspaces = new Set<string>([
  path.resolve(".")
]);

// Fleet / multi-project (2026-10-31): OTTER_PROJECTS là danh sách
// project root mà daemon này được phép chạm vào, cách nhau bằng dấu
// phẩy (dấu phẩy, không phải path.delimiter, vì đường dẫn Windows có
// dấu hai chấm). Ví dụ: OTTER_PROJECTS=/home/nam/code/chatmcp,/home/nam/code/other
// Các root này được đăng ký ngay lúc load module, trước mọi assertSafePath.
if (process.env.OTTER_PROJECTS) {
  for (const raw of process.env.OTTER_PROJECTS.split(",")) {
    const p = raw.trim();
    if (p) { try { allowedWorkspaces.add(path.resolve(p)); } catch {} }
  }
}

let cachedAuthToken: string | null | undefined = undefined;

/**
 * Đăng ký thêm thư mục làm việc an toàn (ví dụ: khi người dùng chọn qua Folder Picker)
 */
export function registerAllowedWorkspace(folderPath: string): void {
  if (!folderPath) return;
  try {
    const resolved = path.resolve(folderPath);
    allowedWorkspaces.add(resolved);
  } catch (err) {
    console.warn(`[Security] Could not register workspace: ${folderPath}`, err);
  }
}

/**
 * Lấy danh sách các thư mục an toàn hiện tại
 */
export function getAllowedWorkspaces(): string[] {
  return Array.from(allowedWorkspaces);
}

/**
 * Kiểm tra và bảo vệ chống Path Traversal (Arbitrary File Read/Write).
 * Ném ngoại lệ nếu đường dẫn nằm ngoài các workspace được phép.
 */
export function assertSafePath(targetPath: string): string {
  if (!targetPath) {
    throw new Error("Đường dẫn tệp tin không hợp lệ.");
  }

  const resolved = path.resolve(targetPath);
  const isAllowed = Array.from(allowedWorkspaces).some(ws => {
    return resolved === ws || resolved.startsWith(ws + path.sep);
  });

  if (!isAllowed) {
    throw new Error(
      `Truy cập bị từ chối: Đường dẫn '${targetPath}' nằm ngoài thư mục làm việc an toàn được cấp phép. Các thư mục hợp lệ: ${Array.from(allowedWorkspaces).join(", ")}`
    );
  }

  return resolved;
}

/**
 * Lấy mã xác thực (Auth Token).
 * Ưu tiên:
 * 1. process.env.OTTER_API_KEY
 * 2. File ~/.otter/auth.token
 */
export function getAuthToken(): string | null {
  if (process.env.OTTER_API_KEY) {
    return process.env.OTTER_API_KEY.trim();
  }

  if (cachedAuthToken !== undefined) {
    return cachedAuthToken;
  }

  try {
    const tokenFile = path.join(os.homedir(), ".otter", "auth.token");
    if (fs.existsSync(tokenFile)) {
      const saved = fs.readFileSync(tokenFile, "utf-8").trim();
      if (saved) {
        cachedAuthToken = saved;
        return saved;
      }
    }
  } catch {}

  return null;
}

/**
 * Thiết lập hoặc sinh Auth Token mới và lưu vào ~/.otter/auth.token
 */
export function ensureAuthToken(): string {
  const existing = getAuthToken();
  if (existing) return existing;

  const newToken = "otter_" + crypto.randomBytes(24).toString("hex");
  try {
    const dir = path.join(os.homedir(), ".otter");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, "auth.token"), newToken, "utf-8");
    cachedAuthToken = newToken;
    console.log(`[Security] 🔑 Đã tạo khóa bảo mật mới tại ~/.otter/auth.token: ${newToken}`);
  } catch (err) {
    console.warn("[Security] Could not persist auth token to ~/.otter/auth.token", err);
    cachedAuthToken = newToken;
  }

  return newToken;
}

export function setAuthToken(token: string | null): void {
  cachedAuthToken = token;
  if (token) {
    process.env.OTTER_API_KEY = token;
  } else {
    delete process.env.OTTER_API_KEY;
  }
}

/**
 * Kiểm tra xem host hoặc IP có thuộc mạng tin cậy (Localhost, Tailscale VPN, Private LAN) không.
 */
export function isTrustedHostOrIp(hostOrIp: string | null | undefined): boolean {
  if (!hostOrIp) return false;
  let cleaned = hostOrIp.replace(/^https?:\/\//i, "").split("/")[0].trim();

  // Strip IPv4-mapped IPv6 prefix (e.g. ::ffff:100.111.68.103 hoặc [::ffff:127.0.0.1])
  if (cleaned.startsWith("::ffff:") || cleaned.startsWith("[::ffff:")) {
    cleaned = cleaned.replace(/^\[?::ffff:/i, "").replace(/\](:\d+)?$/, "");
  }

  let hostWithoutPort: string;

  if (cleaned.startsWith("[")) {
    const endBracket = cleaned.indexOf("]");
    if (endBracket !== -1) {
      hostWithoutPort = cleaned.slice(1, endBracket).toLowerCase();
    } else {
      hostWithoutPort = cleaned.replace(/^\[/, "").toLowerCase();
    }
  } else if (cleaned.includes(":") && cleaned.split(":").length > 2) {
    // Raw IPv6 address without brackets, e.g. fd7a:115c:a1e0::1 or ::1
    hostWithoutPort = cleaned.toLowerCase();
  } else {
    // Hostname or IPv4 with optional :port
    hostWithoutPort = cleaned.split(":")[0].toLowerCase();
  }

  // 1. Localhost
  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostWithoutPort)) {
    return true;
  }

  // 2. Tailscale MagicDNS (*.ts.net)
  if (hostWithoutPort.endsWith(".ts.net")) {
    return true;
  }

  // 3. Tailscale IPv6 (fd7a:115c:a1e0::/48)
  if (hostWithoutPort.startsWith("fd7a:115c:a1e0:") || hostWithoutPort.startsWith("fd7a:115c:a1e0::")) {
    return true;
  }

  // 4. IPv4 checks (Tailscale CGNAT & Private LAN)
  const parts = hostWithoutPort.split(".").map(Number);
  if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
    // Tailscale IPv4: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
      return true;
    }
    // LAN: 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) {
      return true;
    }
    // LAN: 10.0.0.0/8
    if (parts[0] === 10) {
      return true;
    }
    // LAN: 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      return true;
    }
  }

  return false;
}

/**
 * Tự động tìm IP Tailscale của máy tính hiện tại qua network interfaces
 */
export function getTailscaleIp(): string | null {
  try {
    const nets = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(nets)) {
      if (!addrs) continue;
      const isTsInterface = name.toLowerCase().includes("tailscale");
      for (const a of addrs) {
        if (a.internal) continue;
        if (isTsInterface && (a.family === "IPv4" || (a.family as any) === 4)) {
          return a.address;
        }
        const parts = a.address.split(".").map(Number);
        if (parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
          return a.address;
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Kiểm tra xác thực (Authentication).
 * Quy tắc an toàn:
 * 1. Nếu request đến từ Internet (Cloudflare Tunnel hoặc remote host công khai), BẮT BUỘC phải có token.
 * 2. Nếu request đến từ Localhost, mạng Tailscale VPN hoặc Private LAN, được miễn trừ token khi OTTER_API_KEY chưa đặt.
 * 3. Nếu có OTTER_API_KEY được cấu hình (kể cả trên localhost/Tailscale), BẮT BUỘC phải có token.
 * 4. Hỗ trợ Authorization: Bearer <token> hoặc query param ?token=<token>.
 */
export function isRequestAuthorized(req: Request, url: URL, clientIp?: string): boolean {
  const token = getAuthToken();

  // Kiểm tra Header Authorization
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.trim().startsWith("Bearer ")) {
    const provided = authHeader.trim().slice(7).trim();
    if (token && provided === token) {
      return true;
    }
  }

  // Kiểm tra Query Parameter
  const tokenParam = url.searchParams.get("token");
  if (tokenParam && token && tokenParam.trim() === token) {
    return true;
  }

  // Kiểm tra host và client xuất xứ
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  const effectiveClientIp = clientIp || forwardedFor || realIp || "";

  // Nếu cả host VÀ client IP (nếu có) thuộc Tailscale / Localhost / Private LAN:
  // Được coi là truy cập mạng tin cậy an toàn
  const isHostTrusted = isTrustedHostOrIp(host);
  const isClientTrusted = effectiveClientIp ? isTrustedHostOrIp(effectiveClientIp) : isHostTrusted;
  const isTrustedNetwork = isHostTrusted && isClientTrusted;

  if (!isTrustedNetwork) {
    // Khi đi qua Cloudflare Tunnel hoặc truy cập ngoài mạng, BẮT BUỘC chặn nếu không có token
    return false;
  }

  // Nếu ở mạng nội bộ (Local / Tailscale / Private LAN) và người dùng chưa đặt OTTER_API_KEY, cho phép truy cập
  if (!process.env.OTTER_API_KEY) {
    return true;
  }

  return false;
}
