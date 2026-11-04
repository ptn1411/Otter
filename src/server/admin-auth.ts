import { verifyFirebaseIdToken } from "./license-server";

// Khóa bảo mật quản trị viên Master Secret Key (Cryptographic High Entropy 64-hex Key)
export const DEFAULT_ADMIN_SECRET = "otter_adm_a935049c68814164a537f74a627efaf320fce555cad84cb8828a066c78214e94";

export function getAdminSecret(): string {
  return (process.env.OTTER_ADMIN_KEY || DEFAULT_ADMIN_SECRET).trim();
}

// Danh sách email Google có quyền Quản Trị Tối Cao duy nhất
export const ALLOWED_ADMIN_EMAILS: string[] = [
  "zvw180ptn1411@gmail.com"
];

export function getAdminEmails(): string[] {
  const envEmails = process.env.OTTER_ADMIN_EMAILS;
  if (envEmails) {
    const list = envEmails.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    if (list.length > 0) return list;
  }
  return ALLOWED_ADMIN_EMAILS;
}

export function getRequestCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export interface AdminAuthResult {
  authorized: boolean;
  user?: string;
}

/**
 * Kiểm tra quyền hạn quản trị viên qua Cookie Session, Master Key, hoặc Bearer Token
 */
export function verifyAdminAuth(req: Request, body?: any): AdminAuthResult {
  const adminSecret = getAdminSecret();
  const allowedEmails = getAdminEmails();

  // 1. Kiểm tra session cookie
  const sessionVal = getRequestCookie(req, "otter_admin_session");
  if (sessionVal) {
    const trimmed = sessionVal.trim();
    if (trimmed === adminSecret) {
      return { authorized: true, user: "Master Key" };
    }
    // Session dạng email được ký/xác thực (vd: "email:zvw180ptn1411@gmail.com")
    if (trimmed.startsWith("email:")) {
      const email = trimmed.replace("email:", "").toLowerCase();
      if (allowedEmails.includes(email)) {
        return { authorized: true, user: email };
      }
    }
  }

  // 2. Kiểm tra header X-Admin-Key
  const headerKey = req.headers.get("x-admin-key") || req.headers.get("X-Admin-Key");
  if (headerKey && headerKey.trim() === adminSecret) {
    return { authorized: true, user: "Header Master Key" };
  }

  // 3. Kiểm tra header Authorization (Bearer hoặc Basic)
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (authHeader) {
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (bearer === adminSecret) {
      return { authorized: true, user: "Bearer Master Key" };
    }
    if (authHeader.startsWith("Basic ")) {
      try {
        const decoded = atob(authHeader.substring(6));
        const [, pass] = decoded.split(":");
        if (pass && pass.trim() === adminSecret) {
          return { authorized: true, user: "Basic Auth" };
        }
      } catch {}
    }
  }

  // 4. Kiểm tra body admin_key (nếu có truyền trong JSON)
  if (body && typeof body.admin_key === "string" && body.admin_key.trim() === adminSecret) {
    return { authorized: true, user: "JSON Master Key" };
  }

  // 5. Kiểm tra Query Param ?admin_key=...
  try {
    const u = new URL(req.url);
    const qKey = u.searchParams.get("admin_key");
    if (qKey && qKey.trim() === adminSecret) {
      return { authorized: true, user: "Query Master Key" };
    }
  } catch {}

  return { authorized: false };
}

/**
 * Xác thực đăng nhập Google Firebase ID Token độc quyền cho Admin
 */
export async function verifyAdminFirebaseToken(idToken: string): Promise<{
  authorized: boolean;
  email?: string;
  name?: string;
  error?: string;
}> {
  if (!idToken) {
    return { authorized: false, error: "Thiếu ID Token xác thực từ Google" };
  }

  const result = await verifyFirebaseIdToken(idToken);
  if (!result.valid || !result.email) {
    return { authorized: false, error: result.error || "Token Google không hợp lệ hoặc đã hết hạn" };
  }

  const email = result.email.trim().toLowerCase();
  const allowedEmails = getAdminEmails();

  if (!allowedEmails.includes(email)) {
    return {
      authorized: false,
      error: "Từ chối truy cập: Tài khoản Google không có quyền quản trị viên hệ thống!",
    };
  }

  return {
    authorized: true,
    email,
    name: result.name || email,
  };
}

/**
 * Tạo chuỗi Set-Cookie cho phiên Admin (30 ngày)
 */
export function createAdminSessionCookie(value: string): string {
  return `otter_admin_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

/**
 * Tạo chuỗi xóa Cookie khi đăng xuất
 */
export function clearAdminSessionCookie(): string {
  return "otter_admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
}
