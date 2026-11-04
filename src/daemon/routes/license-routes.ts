import { corsHeaders, jsonResponse, errorResponse } from "./common";
import {
  initLicenseDatabase,
  issueLicense,
  activateDevice,
  heartbeatDevice,
  type IssuePackageOptions,
  type ActivateOptions,
} from "../../server/license-server";
import {
  isEncryptedEnvelope,
  decryptPayload,
  encryptedJsonResponse,
} from "../license/payload-cipher";
import { matchLcgRoute } from "../license/lcg-router";
import { verifyAdminAuth } from "../../server/admin-auth";
import { allowLicenseRequest } from "../license/rate-limit";

// Khởi tạo shared license database cho daemon
let licenseDbInstance: ReturnType<typeof initLicenseDatabase> | null = null;

function getLicenseServerDb() {
  if (!licenseDbInstance) {
    licenseDbInstance = initLicenseDatabase();
  }
  return licenseDbInstance;
}

export async function handleLicenseRoutes(req: Request, url: URL): Promise<Response | null> {
  const db = getLicenseServerDb();

  const parseBody = async () => {
    const isEncryptedHeader = req.headers.get("X-Otter-Encrypted") === "1";
    const raw = await req.json();
    if (isEncryptedEnvelope(raw)) {
      return { body: decryptPayload(raw), isEncrypted: true };
    }
    return { body: raw, isEncrypted: isEncryptedHeader };
  };

  const respond = (data: any, isEncrypted: boolean, status: number = 200) => {
    if (isEncrypted) {
      return encryptedJsonResponse(data, status, corsHeaders);
    }
    return jsonResponse(data, status);
  };

  // Bảo mật route: ISSUE / REVOKE / STATUS trước đây KHÔNG kiểm tra admin
  // (bản server thật thì có) — ai gọi được daemon là cấp/thu hồi/tra cứu
  // được license. Giờ khóa bằng cùng verifyAdminAuth như server.
  // ACTIVATE / HEARTBEAT là public theo thiết kế (máy khách cần gọi để
  // kích hoạt/gia hạn) nhưng bị rate limit chống brute-force.
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip") || "local";
  const requireAdmin = () => {
    const auth = verifyAdminAuth(req);
    if (!auth.authorized) return respond({ success: false, error: "Unauthorized: Yêu cầu quyền quản trị viên" }, false, 401);
    return null;
  };

  // 1. Cấp gói mới & Gửi email (Admin only)
  if (matchLcgRoute(url.pathname, "ISSUE") && req.method === "POST") {
    try {
      const denied = requireAdmin();
      if (denied) return denied;
      const { body, isEncrypted } = await parseBody();
      if (!body.email) {
        return respond({ success: false, error: "Vui lòng cung cấp email khách hàng" }, isEncrypted, 400);
      }
      const result = await issueLicense(db, body as IssuePackageOptions);
      return respond(result, isEncrypted);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 2. Kích hoạt thiết bị (Device + Email + License Key)
  if (matchLcgRoute(url.pathname, "ACTIVATE") && req.method === "POST") {
    try {
      if (!allowLicenseRequest(`daemon-activate:${clientIp}`, 30)) {
        return respond({ success: false, error: "Quá nhiều lần kích hoạt, thử lại sau 1 phút" }, false, 429);
      }
      const { body, isEncrypted } = await parseBody();
      const result = await activateDevice(db, body as ActivateOptions);
      return respond(result, isEncrypted, result.success ? 200 : 400);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 3. Heartbeat gia hạn leased token
  if (matchLcgRoute(url.pathname, "HEARTBEAT") && req.method === "POST") {
    try {
      if (!allowLicenseRequest(`daemon-heartbeat:${clientIp}`, 60)) {
        return respond({ success: false, error: "Quá nhiều heartbeat, thử lại sau 1 phút" }, false, 429);
      }
      const { body, isEncrypted } = await parseBody();
      const result = await heartbeatDevice(db, body.leased_token, body.support_code);
      return respond(result, isEncrypted, result.success ? 200 : 400);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 4. Thu hồi license (Admin only)
  if (matchLcgRoute(url.pathname, "REVOKE") && req.method === "POST") {
    try {
      const denied = requireAdmin();
      if (denied) return denied;
      const { body, isEncrypted } = await parseBody();
      db.run(
        "UPDATE licenses SET status = 'revoked', note = ? WHERE license_key = ?",
        [body.reason || "Revoked", body.license_key]
      );
      return respond({ success: true, message: `Đã thu hồi license ${body.license_key}` }, isEncrypted);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 5. Tra cứu trạng thái license (Admin only — trước đây ai biết key
  // cũng tra được toàn bộ license + activations, kể cả email và IP)
  if (matchLcgRoute(url.pathname, "STATUS") && req.method === "GET") {
    const denied = requireAdmin();
    if (denied) return denied;
    const key = url.searchParams.get("key");
    const isEncrypted = req.headers.get("X-Otter-Encrypted") === "1";
    if (!key) return errorResponse("Missing license key", 400);
    const lic = db.query("SELECT * FROM licenses WHERE license_key = ?").get(key) as any;
    if (!lic) return errorResponse("License not found", 404);
    const acts = db.query("SELECT * FROM activations WHERE license_key = ?").all(key);
    return respond({ license: lic, activations: acts }, isEncrypted);
  }

  return null;
}
