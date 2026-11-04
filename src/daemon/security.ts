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
 * Kiểm tra xác thực (Authentication).
 * Quy tắc an toàn:
 * 1. Nếu request đến từ Internet (Cloudflare Tunnel hoặc remote host khác localhost), BẮT BUỘC phải có token.
 * 2. Nếu có OTTER_API_KEY được cấu hình (kể cả trên localhost), BẮT BUỘC phải có token.
 * 3. Hỗ trợ Authorization: Bearer <token> hoặc query param ?token=<token>.
 */
export function isRequestAuthorized(req: Request, url: URL): boolean {
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

  // Kiểm tra host xuất xứ
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const isExternal = !host.includes("localhost") && !host.includes("127.0.0.1") && !host.includes("[::1]");

  if (isExternal) {
    // Khi đi qua Cloudflare Tunnel hoặc truy cập ngoài mạng, BẮT BUỘC chặn nếu không có token
    return false;
  }

  // Nếu ở localhost và người dùng chưa đặt OTTER_API_KEY, cho phép local development
  if (!process.env.OTTER_API_KEY) {
    return true;
  }

  return false;
}
