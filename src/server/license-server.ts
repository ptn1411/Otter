import { Database } from "bun:sqlite";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { PRODUCT_ID, LICENSE_VERSION, getPublicKey } from "../daemon/license/constants";
import { decodeBase32ToHexPrefix } from "../daemon/license/support-code";
import { bytesToBase64, base64ToBytes, canonicalJSON, signPayload, verifySignature } from "../daemon/license/crypto";
import { allowLicenseRequest } from "../daemon/license/rate-limit";
import { sendLicenseEmail } from "./mailer";
import { isEncryptedEnvelope, decryptPayload, encryptedJsonResponse } from "../daemon/license/payload-cipher";
import { matchLcgRoute, getLcgRoute, matchDynamicKnockPath, type LcgRouteKey } from "../daemon/license/lcg-router";
import { LcgHmacGuard } from "../daemon/license/lcg-hmac";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { verifyAdminAuth, verifyAdminFirebaseToken, createAdminSessionCookie, clearAdminSessionCookie } from "./admin-auth";
import { renderAdminLoginPage, renderAdminDashboard } from "./views";

// Master Private Key — KHÔNG còn fallback ghi cứng trong source.
// Server ký license CHỈ chạy khi có key qua env MASTER_PRIVATE_KEY
// (hex 64 ký tự) hoặc file MASTER_PRIVATE_KEY_FILE (nội dung hex, quyền 0600).
// Không có key -> throw ngay (fail closed), không bao giờ ký bằng key mặc định.
// Key cũ đã bị thu hồi: xem scripts/rotate-license-key.ts và
// docs/plans/2026-10-31-license-rotation.md để biết quy trình xoay key.
function getMasterPrivateKey(): Uint8Array {
  let hex = (process.env.MASTER_PRIVATE_KEY || "").trim();
  const defaultKeyPath = path.join(os.homedir(), ".otter", "master-private-key.txt");
  const keyFile = process.env.MASTER_PRIVATE_KEY_FILE || (fs.existsSync(defaultKeyPath) ? defaultKeyPath : "");
  if (!hex && keyFile) {
    try {
      hex = fs.readFileSync(keyFile, "utf8").trim();
    } catch (err: any) {
      throw new Error(`Không đọc được MASTER_PRIVATE_KEY_FILE: ${err.message}`);
    }
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "MASTER_PRIVATE_KEY chưa cấu hình hoặc sai định dạng (cần hex 64 ký tự). " +
      "Chạy bun scripts/rotate-license-key.ts để sinh key mới, rồi đặt env trên server trước khi ký license."
    );
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function initLicenseDatabase(dbPath?: string): Database {
  const finalPath = dbPath || path.join(process.cwd(), "data", "license-server.sqlite");
  const dir = path.dirname(finalPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(finalPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");

  db.run(`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      license_key TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      package_type TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      max_devices INTEGER DEFAULT 1,
      issued_at TEXT NOT NULL,
      expires_at TEXT,
      status TEXT CHECK(status IN ('active', 'revoked', 'expired')) DEFAULT 'active',
      note TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);
    CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);

    CREATE TABLE IF NOT EXISTS activations (
      id TEXT PRIMARY KEY,
      license_key TEXT NOT NULL,
      device_hash TEXT NOT NULL,
      support_code TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      last_heartbeat TEXT NOT NULL,
      leased_expires_at TEXT NOT NULL,
      ip_address TEXT,
      FOREIGN KEY(license_key) REFERENCES licenses(license_key)
    );

    CREATE INDEX IF NOT EXISTS idx_activations_key ON activations(license_key);
    CREATE INDEX IF NOT EXISTS idx_activations_support ON activations(support_code);

    CREATE TABLE IF NOT EXISTS trial_claims (
      email TEXT PRIMARY KEY,
      license_key TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      ip_address TEXT,
      device_info TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_trial_claims_email ON trial_claims(email);

    CREATE TABLE IF NOT EXISTS push_tokens (
      email TEXT NOT NULL,
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      device_info TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_push_tokens_email ON push_tokens(email);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      package_type TEXT NOT NULL,
      package_title TEXT,
      amount INTEGER NOT NULL,
      memo TEXT NOT NULL,
      signals TEXT,
      hw TEXT,
      fp TEXT,
      webrtc_ip TEXT,
      client_ip TEXT,
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      created_at TEXT NOT NULL,
      approved_at TEXT,
      license_key TEXT,
      note TEXT,
      aff_code TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

    CREATE TABLE IF NOT EXISTS app_versions (
      component TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      min_supported_version TEXT,
      download_url TEXT NOT NULL,
      changelog TEXT,
      release_date TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  try {
    db.run("ALTER TABLE orders ADD COLUMN aff_code TEXT");
  } catch {}

  // Khởi tạo phiên bản mặc định ban đầu nếu chưa có
  try {
    const ext = db.query("SELECT * FROM app_versions WHERE component = 'extension'").get();
    if (!ext) {
      db.run(
        `INSERT INTO app_versions (component, version, min_supported_version, download_url, changelog, release_date, updated_at)
         VALUES ('extension', '2.0.0', '2.0.0', 'https://otter.gpt.io.vn/otter-extension.zip', 'Phiên bản chính thức v2.0.0: Tự động hóa Agentic trên ChatGPT Web', date('now'), datetime('now'))`
      );
    }
    const daemon = db.query("SELECT * FROM app_versions WHERE component = 'daemon'").get();
    if (!daemon) {
      db.run(
        `INSERT INTO app_versions (component, version, min_supported_version, download_url, changelog, release_date, updated_at)
         VALUES ('daemon', '2.0.0', '2.0.0', 'https://otter.gpt.io.vn/otter-windows-x64.exe', 'Phiên bản daemon v2.0.0: Quản lý PTY Terminal và MCP tools', date('now'), datetime('now'))`
      );
    }
  } catch {}

  return db;
}

/**
 * So sánh 2 chuỗi Semantic Version (VD: "2.1.0" và "2.0.0")
 * Trả về 1 nếu v1 > v2; -1 nếu v1 < v2; 0 nếu bằng nhau
 */
export function compareSemver(v1: string, v2: string): number {
  const parse = (v: string) => (v || "").replace(/^[^\d]*/, "").split(".").map(n => parseInt(n, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * Ký tạo Token bản quyền chuẩn Ed25519
 */
export function signLicenseToken(payload: Record<string, unknown>): string {
  const payloadJson = canonicalJSON(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const privateKey = getMasterPrivateKey();
  const signatureBytes = signPayload(payloadBytes, privateKey);

  const payloadB64 = bytesToBase64(payloadBytes);
  const sigB64 = bytesToBase64(signatureBytes);
  return `${payloadB64}.${sigB64}`;
}

export interface IssuePackageOptions {
  email: string;
  package_type: 'trial' | 'pro' | 'enterprise';
  duration_days: number;
  max_devices?: number;
  note?: string;
  send_email?: boolean;
}

/**
 * Cấp một License mới và lưu vào hệ thống
 */
export async function issueLicense(
  db: Database,
  options: IssuePackageOptions
): Promise<{
  success: boolean;
  license_key: string;
  email: string;
  package_type: string;
  duration_days: number;
  expires_at: string | null;
  max_devices: number;
  email_sent: boolean;
}> {
  const email = options.email.trim().toLowerCase();
  const packageType = options.package_type || 'pro';
  const durationDays = options.duration_days ?? 30;
  const maxDevices = options.max_devices ?? (packageType === 'enterprise' ? 5 : 1);

  const now = new Date();
  const issuedAt = now.toISOString();

  let expiresAt: string | null = null;
  if (durationDays > 0) {
    const expDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    expiresAt = expDate.toISOString();
  }

  // Tạo license_key định dạng thân thiện và độc nhất
  const randomSuffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const prefix = packageType.toUpperCase();
  const rawLicenseKey = `OTTER-${prefix}-${durationDays}D-${randomSuffix}`;

  const id = crypto.randomUUID();

  // Lưu vào database
  db.run(
    `INSERT INTO licenses (id, license_key, email, package_type, duration_days, max_devices, issued_at, expires_at, status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [id, rawLicenseKey, email, packageType, durationDays, maxDevices, issuedAt, expiresAt, options.note || '']
  );

  // Gửi email chứa mã token cho khách hàng nếu bật send_email
  let emailSent = false;
  if (options.send_email !== false) {
    const mailRes = await sendLicenseEmail({
      to: email,
      subject: `🦦 Mã Kích Hoạt Bản Quyền Otter (Gói ${packageType.toUpperCase()} - ${durationDays > 0 ? durationDays + ' ngày' : 'Trọn đời'})`,
      licenseKey: rawLicenseKey,
      packageType,
      durationDays,
      expiresAt,
    });
    emailSent = mailRes.success;
  }

  return {
    success: true,
    license_key: rawLicenseKey,
    email,
    package_type: packageType,
    duration_days: durationDays,
    expires_at: expiresAt,
    max_devices: maxDevices,
    email_sent: emailSent,
  };
}

export interface ClaimTrialOptions {
  email: string;
  name?: string;
  ip_address?: string;
  device_info?: string;
}

/**
 * Khởi tạo Firebase Admin SDK với Service Account key của dự án otter-aeccc
 */
export function initFirebaseAdmin(): boolean {
  if (getApps().length > 0) return true;

  const candidatePaths = [
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    path.join(process.cwd(), "otter-aeccc-firebase-adminsdk-fbsvc-81d80ed7e0.json"),
    path.join(process.cwd(), "config", "firebase-service-account.json"),
  ].filter(Boolean) as string[];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const serviceAccount = JSON.parse(fs.readFileSync(p, "utf-8"));
        initializeApp({
          credential: cert(serviceAccount)
        });
        console.log(`[Firebase Admin] 🔥 Đã nạp Service Account key thành công từ: ${path.basename(p)}`);
        return true;
      } catch (err: any) {
        console.warn(`[Firebase Admin] ⚠️ Lỗi nạp key từ ${p}:`, err.message);
      }
    }
  }
  return false;
}

/**
 * Gửi Web Push Notification qua Firebase Cloud Messaging (FCM) Admin SDK
 */
export async function sendFcmWebPush(
  token: string,
  payload: { title: string; body: string; data?: Record<string, string> }
): Promise<boolean> {
  initFirebaseAdmin();
  if (getApps().length === 0 || !token) return false;

  try {
    await getMessaging().send({
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      webpush: {
        notification: {
          icon: "https://raw.githubusercontent.com/ptn1411/skill/main/qr-sepay.png",
          badge: "🦦",
        },
        fcmOptions: {
          link: "./index.html"
        }
      },
      data: payload.data
    });
    console.log(`[FCM] 📲 Đã gửi Web Push Notification tới token: ${token.slice(0, 15)}...`);
    return true;
  } catch (err: any) {
    console.warn(`[FCM] Gửi Web Push thất bại:`, err.message);
    return false;
  }
}

/**
 * Xác thực Firebase ID Token với Firebase Admin SDK (Chính thức từ Google)
 * Có fallback sang Google Identity Toolkit REST API
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<{
  valid: boolean;
  email?: string;
  email_verified?: boolean;
  name?: string;
  uid?: string;
  error?: string;
}> {
  if (!idToken || typeof idToken !== "string") {
    return { valid: false, error: "Thiếu ID token" };
  }

  // 1. Xác thực bằng Firebase Admin SDK nếu đã khởi tạo (Bảo mật 100%, chuẩn Google)
  initFirebaseAdmin();
  if (getApps().length > 0) {
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      return {
        valid: true,
        email: (decoded.email || "").trim().toLowerCase(),
        email_verified: decoded.email_verified === true,
        name: decoded.name || decoded.email,
        uid: decoded.uid,
      };
    } catch (adminErr: any) {
      console.warn("[Firebase Admin] verifyIdToken lỗi:", adminErr.message);
      // Fallback xuống Google Identity Toolkit REST API bên dưới
    }
  }

  // 2. Fallback sang Google Identity Toolkit REST API (Native fetch)
  const apiKey = process.env.FIREBASE_API_KEY || "AIzaSyBmRwlVmrO1qX6Og_2clEeD4dSH1k6Hdjc";

  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    });

    const data = await res.json() as any;

    if (!res.ok || !data.users || data.users.length === 0) {
      const errMsg = data?.error?.message || "Token không hợp lệ hoặc đã hết hạn";
      return { valid: false, error: errMsg };
    }

    const user = data.users[0];
    return {
      valid: true,
      email: (user.email || "").trim().toLowerCase(),
      email_verified: user.emailVerified === true,
      name: user.displayName || user.email,
      uid: user.localId,
    };
  } catch (err: any) {
    return { valid: false, error: `Lỗi kết nối tới Google Auth: ${err.message}` };
  }
}

/**
 * Cấp gói dùng thử 30 ngày cho người dùng đăng nhập bằng Google (Chỉ 1 lần duy nhất)
 */
export async function claimTrialLicense(
  db: Database,
  options: ClaimTrialOptions
): Promise<{
  success: boolean;
  error?: string;
  already_claimed?: boolean;
  license_key?: string;
  email?: string;
  duration_days?: number;
  expires_at?: string | null;
  email_sent?: boolean;
  message?: string;
}> {
  const email = (options.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { success: false, error: "Địa chỉ email không hợp lệ" };
  }

  // Cấp mới / tạo lại gói trial 30 ngày (không giới hạn 1 email 1 lần, người dùng có thể tạo lại key bất cứ lúc nào)
  const licResult = await issueLicense(db, {
    email,
    package_type: "trial",
    duration_days: 30,
    max_devices: 1,
    note: `Google Sign-In Trial: ${options.name || 'User'}`,
    send_email: true,
  });

  if (!licResult.success) {
    return { success: false, error: "Không thể tạo mã bản quyền dùng thử" };
  }

  // Lưu hoặc cập nhật vào bảng trial_claims
  try {
    db.run(
      `INSERT OR REPLACE INTO trial_claims (email, license_key, claimed_at, ip_address, device_info)
       VALUES (?, ?, ?, ?, ?)`,
      [email, licResult.license_key, new Date().toISOString(), options.ip_address || "127.0.0.1", options.name || options.device_info || ""]
    );
  } catch {}

  return {
    success: true,
    license_key: licResult.license_key,
    email,
    duration_days: 30,
    expires_at: licResult.expires_at,
    email_sent: licResult.email_sent,
    message: "Đã kích hoạt 30 ngày dùng thử miễn phí và gửi mã bản quyền vào email của bạn!",
  };
}

export interface ActivateOptions {
  email: string;
  license_key: string;
  support_code: string;
  device_hash?: string;
  ip_address?: string;
}

/**
 * Kích hoạt bản quyền cho mã máy (Support Code / Device Hash)
 */
export async function activateDevice(
  db: Database,
  options: ActivateOptions
): Promise<{
  success: boolean;
  error?: string;
  leased_token?: string;
  expires_at?: string | null;
  leased_expires_at?: string;
  package_type?: string;
  customer?: string;
}> {
  const email = options.email.trim().toLowerCase();
  const licenseKey = options.license_key.trim();
  const supportCode = (options.support_code || '').trim().toUpperCase();
  
  // Wildcard device ('*' / 'ALL') KHÔNG còn được phép: token device_hash '*'
  // trước đây được client chấp nhận trên mọi máy, làm vô hiệu giới hạn
  // max_devices. Muốn nhiều máy thì cấp max_devices cao hơn, mỗi máy một
  // support_code riêng.
  if (supportCode === '*' || supportCode === 'ALL') {
    return { success: false, error: 'Support code wildcard (* / ALL) không còn được phép — mỗi máy phải có support code riêng' };
  }

  let deviceHash = options.device_hash;
  if (!deviceHash && supportCode) {
    try {
      deviceHash = decodeBase32ToHexPrefix(supportCode);
    } catch {
      deviceHash = supportCode;
    }
  }
  if (!deviceHash) deviceHash = supportCode;

  if (!email || !licenseKey || !supportCode) {
    return { success: false, error: 'Thiếu thông tin: email, license_key hoặc support_code (mã máy)' };
  }

  // Tìm license trong database
  const lic = db.query(
    "SELECT * FROM licenses WHERE license_key = ? AND LOWER(email) = ?"
  ).get(licenseKey, email) as any;

  if (!lic) {
    return { success: false, error: 'Mã license không tồn tại hoặc không khớp với email đăng ký' };
  }

  if (lic.status !== 'active') {
    return { success: false, error: `Bản quyền này đã bị vô hiệu hóa (${lic.status})` };
  }

  const now = Date.now();

  // Kiểm tra thời hạn gói tổng
  if (lic.expires_at) {
    const expTime = new Date(lic.expires_at).getTime();
    if (expTime < now) {
      return { success: false, error: 'Gói bản quyền này đã hết hạn sử dụng' };
    }
  }

  // Đếm các thiết bị đã kích hoạt khác thiết bị hiện tại
  const existingDevices = db.query(
    "SELECT DISTINCT support_code FROM activations WHERE license_key = ?"
  ).all(licenseKey) as { support_code: string }[];

  const isCurrentDeviceAlreadyRegistered = existingDevices.some(d => d.support_code === supportCode);

  if (!isCurrentDeviceAlreadyRegistered && existingDevices.length >= lic.max_devices) {
    return {
      success: false,
      error: `Đã vượt quá giới hạn thiết bị cho phép (${lic.max_devices} máy). Vui lòng gỡ bớt thiết bị cũ hoặc nâng cấp gói.`,
    };
  }

  // Tính thời hạn thuê (Leased Token): Mặc định 7 ngày hoặc theo thời hạn gói tổng nếu ngắn hơn
  const leasedDurationMs = 7 * 24 * 60 * 60 * 1000;
  let leasedExpiresMs = now + leasedDurationMs;
  if (lic.expires_at) {
    const totalExpMs = new Date(lic.expires_at).getTime();
    if (totalExpMs < leasedExpiresMs) {
      leasedExpiresMs = totalExpMs;
    }
  }
  const leasedExpiresAt = new Date(leasedExpiresMs).toISOString();

  // Tạo và ký Leased Token chuẩn Ed25519
  const payload = {
    product_id: PRODUCT_ID,
    version: LICENSE_VERSION,
    license_type: lic.package_type,
    issued_at: new Date(now).toISOString(),
    expires_at: lic.expires_at,
    leased_expires_at: leasedExpiresAt,
    device_hash: deviceHash,
    customer: lic.email,
    tier: lic.package_type,
    license_key: lic.license_key,
  };

  const leasedToken = signLicenseToken(payload);

  // Cập nhật hoặc lưu vào bảng activations
  const actId = crypto.randomUUID();
  db.run(
    `INSERT INTO activations (id, license_key, device_hash, support_code, activated_at, last_heartbeat, leased_expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actId,
      licenseKey,
      deviceHash,
      supportCode,
      new Date(now).toISOString(),
      new Date(now).toISOString(),
      leasedExpiresAt,
      options.ip_address || '127.0.0.1',
    ]
  );

  return {
    success: true,
    leased_token: leasedToken,
    expires_at: lic.expires_at,
    leased_expires_at: leasedExpiresAt,
    package_type: lic.package_type,
    customer: lic.email,
  };
}

/**
 * Gia hạn Leased Token qua Heartbeat ngầm
 */
export async function heartbeatDevice(
  db: Database,
  leasedToken: string,
  supportCode: string
): Promise<{
  success: boolean;
  error?: string;
  leased_token?: string;
  leased_expires_at?: string;
}> {
  if (!leasedToken || !leasedToken.includes('.')) {
    return { success: false, error: 'Định dạng leased token không hợp lệ' };
  }

  try {
    const [payloadB64, sigB64] = leasedToken.split('.');
    if (!payloadB64 || !sigB64) {
      return { success: false, error: 'Định dạng leased token không hợp lệ' };
    }

    // BẮT BUỘC: verify chữ ký Ed25519 bằng public key hiện tại TRƯỚC KHI
    // tin bất kỳ trường nào trong payload. Trước đây heartbeat không verify,
    // nên ai biết license_key cũng tự tạo payload rồi xin ký lại thành token
    // hợp lệ — key cũ bị thu hồi cũng vì lý do này (token cũ ký bằng key cũ
    // sẽ fail verify ở đây và bị từ chối).
    const payloadBytes = base64ToBytes(payloadB64);
    const signatureBytes = base64ToBytes(sigB64);
    const signatureValid = await verifySignature(payloadBytes, signatureBytes, getPublicKey());
    if (!signatureValid) {
      return { success: false, error: 'Chữ ký leased token không hợp lệ (token giả mạo hoặc ký bằng key cũ đã thu hồi)' };
    }

    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));

    const licenseKey = payload.license_key;
    if (!licenseKey) {
      return { success: false, error: 'Không tìm thấy license key trong token' };
    }

    const lic = db.query(
      "SELECT * FROM licenses WHERE license_key = ?"
    ).get(licenseKey) as any;

    if (!lic || lic.status !== 'active') {
      return { success: false, error: 'Bản quyền không tồn tại hoặc đã bị thu hồi' };
    }

    const now = Date.now();
    if (lic.expires_at && new Date(lic.expires_at).getTime() < now) {
      return { success: false, error: 'Gói bản quyền đã hết hạn' };
    }

    // Token đã hết hạn thuê thì KHÔNG được gia hạn bằng chính nó — phải
    // kích hoạt lại bằng license_key + email.
    if (payload.leased_expires_at && new Date(payload.leased_expires_at).getTime() < now) {
      return { success: false, error: 'Leased token đã hết hạn, vui lòng kích hoạt lại bằng license_key + email' };
    }

    // Activation phải còn tồn tại và khớp device — admin thu hồi bằng cách
    // xóa activations sẽ chặn heartbeat ngay, không đợi tới hết hạn leased.
    const activation = db.query(
      "SELECT * FROM activations WHERE license_key = ? AND support_code = ?"
    ).get(licenseKey, supportCode) as any;
    if (!activation) {
      return { success: false, error: 'Thiết bị chưa kích hoạt hoặc đã bị thu hồi' };
    }
    if (payload.device_hash && activation.device_hash && payload.device_hash !== activation.device_hash) {
      return { success: false, error: 'Leased token không khớp với thiết bị đã kích hoạt' };
    }

    // Gia hạn thêm 7 ngày
    let leasedExpiresMs = now + 7 * 24 * 60 * 60 * 1000;
    if (lic.expires_at) {
      const totalExpMs = new Date(lic.expires_at).getTime();
      if (totalExpMs < leasedExpiresMs) {
        leasedExpiresMs = totalExpMs;
      }
    }
    const newLeasedExpiresAt = new Date(leasedExpiresMs).toISOString();

    payload.issued_at = new Date(now).toISOString();
    payload.leased_expires_at = newLeasedExpiresAt;

    const renewedToken = signLicenseToken(payload);

    db.run(
      `UPDATE activations SET last_heartbeat = ?, leased_expires_at = ? 
       WHERE license_key = ? AND support_code = ?`,
      [new Date(now).toISOString(), newLeasedExpiresAt, licenseKey, supportCode]
    );

    return {
      success: true,
      leased_token: renewedToken,
      leased_expires_at: newLeasedExpiresAt,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Lỗi xử lý heartbeat' };
  }
}

/**
 * Khởi chạy License Server HTTP
 */
export function startLicenseServer(port: number = Number(process.env.LICENSE_SERVER_PORT || 1994), dbPath?: string) {
  const db = initLicenseDatabase(dbPath);
  initFirebaseAdmin();

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      const securityHeaders = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "X-XSS-Protection": "1; mode=block",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      };

      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Ottr-Nonce, X-Ottr-Timestamp, X-Ottr-Signature, X-Otter-Encrypted",
        ...securityHeaders,
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      const isRouteMatch = (key: LcgRouteKey) => matchLcgRoute(url.pathname, key) || matchDynamicKnockPath(url.pathname, key);

      const clientNonce = req.headers.get("x-ottr-nonce") || req.headers.get("X-Ottr-Nonce") || "";
      const reqTime = Number(req.headers.get("x-ottr-timestamp") || req.headers.get("X-Ottr-Timestamp") || 0);
      const reqSig = req.headers.get("x-ottr-signature") || req.headers.get("X-Ottr-Signature") || "";

      let cachedRawBody: string | null = null;
      if (reqSig) {
        cachedRawBody = await req.clone().text();
        const isValid = await LcgHmacGuard.verifyData(url.pathname, clientNonce, reqTime, cachedRawBody, reqSig);
        if (!isValid) {
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // Helper đọc body tự động giải mã và phản hồi tự động mã hóa
      const parseBody = async () => {
        const isEncryptedHeader = req.headers.get("X-Otter-Encrypted") === "1";
        const raw = cachedRawBody !== null ? (cachedRawBody ? JSON.parse(cachedRawBody) : {}) : await req.json();
        if (isEncryptedEnvelope(raw)) {
          return { body: decryptPayload(raw), isEncrypted: true };
        }
        return { body: raw, isEncrypted: isEncryptedHeader };
      };

      const respond = async (data: any, isEncrypted: boolean, status: number = 200) => {
        if (reqSig && clientNonce) {
          const envelope = await LcgHmacGuard.createSignedEnvelope(url.pathname, clientNonce, data);
          return Response.json(envelope, { status, headers: corsHeaders });
        }
        if (isEncrypted) {
          return encryptedJsonResponse(data, status, corsHeaders);
        }
        return Response.json(data, { status, headers: corsHeaders });
      };

      // 0. API Quản Trị Viên (Google Firebase & Master Key)
      if (url.pathname === "/api/admin/login-firebase" && req.method === "POST") {
        try {
          const body = await req.json().catch(() => ({}));
          const idToken = (body.idToken || body.id_token || "").trim();
          const authResult = await verifyAdminFirebaseToken(idToken);
          if (authResult.authorized && authResult.email) {
            return new Response(JSON.stringify({
              success: true,
              message: `Chào mừng Quản trị viên tối cao: ${authResult.name || authResult.email}!`
            }), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": createAdminSessionCookie(`email:${authResult.email}`),
                ...corsHeaders,
              },
            });
          }
          return new Response(JSON.stringify({
            success: false,
            error: authResult.error || "Tài khoản Google không có quyền quản trị viên"
          }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      if ((url.pathname === "/api/admin/logout" || url.pathname === "/logout") && (req.method === "POST" || req.method === "GET")) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/",
            "Set-Cookie": clearAdminSessionCookie(),
            ...corsHeaders,
          },
        });
      }

      // 1. API Cấp gói bản quyền & Gửi email (Yêu cầu quyền Admin)
      if (isRouteMatch("ISSUE") && req.method === "POST") {
        try {
          const { body, isEncrypted } = await parseBody();
          const auth = verifyAdminAuth(req, body);
          if (!auth.authorized) {
            return await respond({ success: false, error: "Unauthorized: Yêu cầu quyền quản trị viên (Admin Key)" }, isEncrypted, 401);
          }
          const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
          const cleanEmail = String(body.email || "").trim().toLowerCase();
          if (!cleanEmail || !emailRegex.test(cleanEmail)) {
            return await respond({ success: false, error: "Định dạng email khách hàng không hợp lệ" }, isEncrypted, 400);
          }
          body.email = cleanEmail;
          const result = await issueLicense(db, body as IssuePackageOptions);
          return await respond(result, isEncrypted);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      // 1.1 API Nhận Dùng Thử 30 Ngày qua Google Sign-In (Bắt buộc xác thực Google Token)
      if ((url.pathname === "/api/claim-trial" || url.pathname === "/claim-trial") && req.method === "POST") {
        try {
          const { body, isEncrypted } = await parseBody();
          const clientIp = req.headers.get("x-forwarded-for") || "127.0.0.1";

          // Bắt buộc xác thực Google Firebase ID Token chống giả mạo
          const idToken = body.id_token || body.idToken || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
          if (!idToken) {
            return await respond({
              success: false,
              error: "Yêu cầu đăng nhập Google để nhận bản quyền dùng thử (Thiếu Firebase ID Token)!"
            }, isEncrypted, 401);
          }

          const authResult = await verifyFirebaseIdToken(idToken);
          if (!authResult.valid || !authResult.email) {
            return await respond({
              success: false,
              error: `Xác thực Firebase Token thất bại: ${authResult.error || "Token không hợp lệ hoặc đã hết hạn"}`
            }, isEncrypted, 401);
          }

          const verifiedEmail = authResult.email;
          const verifiedName = authResult.name || body.name;

          const result = await claimTrialLicense(db, {
            email: verifiedEmail,
            name: verifiedName,
            ip_address: clientIp,
            device_info: req.headers.get("user-agent") || "",
          });

          // Lưu Web Push (FCM) Token nếu có
          if (body.fcm_token && result.success) {
            try {
              db.run(
                `INSERT OR REPLACE INTO push_tokens (email, token, created_at, device_info)
                 VALUES (?, ?, ?, ?)`,
                [verifiedEmail, body.fcm_token.trim(), new Date().toISOString(), req.headers.get("user-agent") || ""]
              );

              // Gửi Web Push Notification tức thì qua Firebase Cloud Messaging Admin SDK
              sendFcmWebPush(body.fcm_token.trim(), {
                title: "🦦 Otter Assistant: Kích Hoạt 30 Ngày Dùng Thử!",
                body: `Chúc mừng! Mã bản quyền: ${result.license_key}. Hạn dùng 30 ngày. Đã gửi email kích hoạt.`,
                data: {
                  license_key: result.license_key || "",
                  expires_at: result.expires_at || ""
                }
              }).catch(() => {});
            } catch {}
          }

          return await respond(result, isEncrypted, result.success ? 200 : 400);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      // 1.2 API Lưu Web Push (FCM) Token (Yêu cầu xác thực chính chủ hoặc Admin)
      if ((url.pathname === "/api/save-push-token" || url.pathname === "/save-push-token") && req.method === "POST") {
        try {
          const { body, isEncrypted } = await parseBody();
          const email = (body.email || "").trim().toLowerCase();
          const token = (body.token || body.fcm_token || "").trim();
          if (!email || !token) {
            return await respond({ success: false, error: "Thiếu email hoặc token" }, isEncrypted, 400);
          }

          // Kiểm tra quyền hạn: Phải có Google ID Token của chính email đó hoặc quyền Admin
          const idToken = body.id_token || body.idToken || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
          const auth = verifyAdminAuth(req, body);
          let isOwner = false;
          if (idToken) {
            const authResult = await verifyFirebaseIdToken(idToken);
            if (authResult.valid && authResult.email === email) {
              isOwner = true;
            }
          }

          if (!auth.authorized && !isOwner) {
            return await respond({
              success: false,
              error: "Unauthorized: Yêu cầu đăng nhập Google chính chủ hoặc quyền quản trị viên"
            }, isEncrypted, 401);
          }

          db.run(
            `INSERT OR REPLACE INTO push_tokens (email, token, created_at, device_info)
             VALUES (?, ?, ?, ?)`,
            [email, token, new Date().toISOString(), body.device_info || req.headers.get("user-agent") || ""]
          );
          return await respond({ success: true, message: "Đã lưu Web Push token thành công" }, isEncrypted);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      // 1.3 API Kiểm tra trạng thái Dùng Thử của Email (Bảo vệ thông tin License Key)
      if ((url.pathname === "/api/trial-status" || url.pathname === "/trial-status") && req.method === "GET") {
        const email = (url.searchParams.get("email") || "").trim().toLowerCase();
        if (!email) {
          return Response.json({ error: "Missing email" }, { status: 400, headers: corsHeaders });
        }

        // Kiểm tra xác thực: Nếu là Admin hoặc có Google ID Token của chính email đó
        const idToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const auth = verifyAdminAuth(req);
        let isOwner = false;
        if (idToken) {
          const authResult = await verifyFirebaseIdToken(idToken);
          if (authResult.valid && authResult.email === email) {
            isOwner = true;
          }
        }

        const claim = db.query("SELECT * FROM trial_claims WHERE email = ?").get(email) as any;
        
        // Chỉ trả về license_key khi có xác thực Admin hoặc chính chủ Google account
        // Khách vãng lai / scanner không có auth: CHỈ nhận boolean has_claimed
        return Response.json({
          has_claimed: !!claim,
          license_key: (auth.authorized || isOwner) ? (claim?.license_key || null) : undefined,
          claimed_at: claim?.claimed_at || null,
        }, { headers: corsHeaders });
      }

      // 1.35 API Kiểm Tra Phiên Bản Mới & Cập Nhật Tự Động (Public)
      if ((url.pathname === "/api/version" || url.pathname === "/api/check-update") && req.method === "GET") {
        const component = url.searchParams.get("component") || "extension";
        const clientVersion = url.searchParams.get("client_version") || "";
        const verRecord = db.query("SELECT * FROM app_versions WHERE component = ?").get(component) as any;
        if (!verRecord) {
          return Response.json({ error: "Component not found" }, { status: 404, headers: corsHeaders });
        }

        const isUpdateAvailable = clientVersion ? compareSemver(verRecord.version, clientVersion) > 0 : false;
        const isMandatory = clientVersion && verRecord.min_supported_version
          ? compareSemver(verRecord.min_supported_version, clientVersion) > 0
          : false;

        return Response.json({
          component: verRecord.component,
          version: verRecord.version,
          client_version: clientVersion || null,
          update_available: isUpdateAvailable,
          mandatory: isMandatory,
          min_supported_version: verRecord.min_supported_version,
          download_url: verRecord.download_url,
          changelog: verRecord.changelog,
          release_date: verRecord.release_date
        }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/versions" && req.method === "GET") {
        const allVersions = db.query("SELECT * FROM app_versions").all() as any[];
        return Response.json({ success: true, versions: allVersions }, { headers: corsHeaders });
      }

      // 1.4 API Gửi Đơn Hàng Mua Gói & Thu Thập Tín Hiệu Máy (Public)
      if ((url.pathname === "/api/orders" || url.pathname === "/orders") && req.method === "POST") {
        try {
          const { body, isEncrypted } = await parseBody();
          const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
          const cleanEmail = String(body.email || "").trim().toLowerCase();
          if (!cleanEmail || !emailRegex.test(cleanEmail)) {
            return await respond({ success: false, error: "Vui lòng nhập địa chỉ email hợp lệ" }, isEncrypted, 400);
          }

          const packageType = String(body.package_type || "1nam").trim();
          const packageTitle = String(body.package_title || "Gói Bản Quyền Otter").trim();
          const amount = Number(body.amount) || 0;
          const memo = String(body.memo || `OTTER ${cleanEmail.split("@")[0].toUpperCase()}`).trim();
          
          let signalsObj: any = null;
          let signalsRaw = "";
          if (typeof body.signals === "string") {
            signalsRaw = body.signals;
            try { signalsObj = JSON.parse(body.signals); } catch {}
          } else if (body.signals && typeof body.signals === "object") {
            signalsObj = body.signals;
            signalsRaw = JSON.stringify(body.signals);
          }

          const hw = signalsObj?.hw ? String(signalsObj.hw) : null;
          const fp = signalsObj?.fp ? String(signalsObj.fp) : null;
          const webrtcIp = Array.isArray(signalsObj?.webrtc) ? signalsObj.webrtc.join(", ") : (signalsObj?.webrtc ? String(signalsObj.webrtc) : null);
          const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";

          const orderId = crypto.randomUUID();
          const createdAt = new Date().toISOString();
          const affCode = body.aff_code ? String(body.aff_code).trim().slice(0, 64) : null;

          db.run(
            `INSERT INTO orders (id, email, package_type, package_title, amount, memo, signals, hw, fp, webrtc_ip, client_ip, status, created_at, aff_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
            [orderId, cleanEmail, packageType, packageTitle, amount, memo, signalsRaw, hw, fp, webrtcIp, clientIp, createdAt, affCode]
          );

          return await respond({
            success: true,
            order_id: orderId,
            message: "Đơn hàng của bạn đã được ghi nhận! Quản trị viên sẽ kiểm tra thanh toán và kích hoạt gói cho bạn."
          }, isEncrypted, 201);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      // 1.5 API Duyệt Đơn Hàng Thủ Công & Tự Động Cấp License (Admin Only)
      if (url.pathname === "/api/admin/orders/approve" && req.method === "POST") {
        try {
          const { body, isEncrypted } = await parseBody();
          const auth = verifyAdminAuth(req, body);
          if (!auth.authorized) {
            return await respond({ success: false, error: "Unauthorized: Yêu cầu quyền quản trị viên" }, isEncrypted, 401);
          }

          const orderId = String(body.order_id || "").trim();
          if (!orderId) {
            return await respond({ success: false, error: "Thiếu order_id" }, isEncrypted, 400);
          }

          const order = db.query("SELECT * FROM orders WHERE id = ?").get(orderId) as any;
          if (!order) {
            return await respond({ success: false, error: "Không tìm thấy đơn hàng" }, isEncrypted, 404);
          }

          if (order.status === "approved" && order.license_key) {
            return await respond({ success: true, message: "Đơn hàng này đã được duyệt trước đó!", license_key: order.license_key }, isEncrypted);
          }

          // Phân loại gói
          let packageType: 'trial' | 'pro' | 'enterprise' = 'pro';
          let durationDays = 365;
          let maxDevices = 2;

          const pCode = (order.package_type || "").toLowerCase();
          if (pCode.includes("vinhvien") || pCode.includes("vip") || pCode.includes("enterprise")) {
            packageType = "enterprise";
            durationDays = 0;
            maxDevices = 5;
          } else if (pCode.includes("1nam") || pCode.includes("year")) {
            packageType = "pro";
            durationDays = 365;
            maxDevices = 2;
          } else if (pCode.includes("trial") || pCode.includes("test")) {
            packageType = "trial";
            durationDays = 3;
            maxDevices = 1;
          } else {
            packageType = "pro";
            durationDays = 30;
            maxDevices = 1;
          }

          if (body.duration_days !== undefined) durationDays = Number(body.duration_days);
          if (body.max_devices !== undefined) maxDevices = Number(body.max_devices);

          // Cấp license và tự động gửi email cho khách
          const lic = await issueLicense(db, {
            email: order.email,
            package_type: packageType,
            duration_days: durationDays,
            max_devices: maxDevices,
            note: `Duyệt đơn #${order.id.slice(0, 8)} - Memo: ${order.memo}`,
            send_email: true,
          });

          const approvedAt = new Date().toISOString();
          db.run(
            `UPDATE orders SET status = 'approved', approved_at = ?, license_key = ? WHERE id = ?`,
            [approvedAt, lic.license_key, orderId]
          );

          return await respond({
            success: true,
            order_id: orderId,
            license_key: lic.license_key,
            message: `Đã duyệt đơn #${orderId.slice(0, 8)} thành công! Đã cấp mã ${lic.license_key} và gửi email cho khách.`
          }, isEncrypted);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      // 1.6 API Xóa Đơn Hàng (Admin Only)
      if (url.pathname === "/api/admin/orders/delete" && req.method === "POST") {
        try {
          const { body, isEncrypted } = await parseBody();
          const auth = verifyAdminAuth(req, body);
          if (!auth.authorized) {
            return await respond({ success: false, error: "Unauthorized: Yêu cầu quyền quản trị viên" }, isEncrypted, 401);
          }

          const orderId = String(body.order_id || "").trim();
          if (!orderId) {
            return await respond({ success: false, error: "Thiếu order_id" }, isEncrypted, 400);
          }

          db.run("DELETE FROM orders WHERE id = ?", [orderId]);
          return await respond({ success: true, message: `Đã xóa đơn hàng #${orderId.slice(0, 8)} thành công` }, isEncrypted);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      // 1.7 API Thu hồi hoặc Kích hoạt lại License (Admin Only)
      if (url.pathname === "/api/admin/licenses/revoke" && req.method === "POST") {
        try {
          const { body, isEncrypted } = await parseBody();
          const auth = verifyAdminAuth(req, body);
          if (!auth.authorized) {
            return await respond({ success: false, error: "Unauthorized: Yêu cầu quyền quản trị viên" }, isEncrypted, 401);
          }

          const licenseKey = String(body.license_key || "").trim();
          const reason = String(body.reason || "Thu hồi bởi quản trị viên").trim();
          if (!licenseKey) {
            return await respond({ success: false, error: "Thiếu license_key" }, isEncrypted, 400);
          }

          db.run("UPDATE licenses SET status = 'revoked', note = ? WHERE license_key = ?", [reason, licenseKey]);
          // Hủy kích hoạt mọi máy tính đang dùng key này
          db.run("DELETE FROM activations WHERE license_key = ?", [licenseKey]);

          return await respond({
            success: true,
            message: `Đã thu hồi thành công license: ${licenseKey}. Thiết bị đang sử dụng key này sẽ bị ngắt kết nối.`
          }, isEncrypted);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      if (url.pathname === "/api/admin/licenses/reactivate" && req.method === "POST") {
        try {
          const { body, isEncrypted } = await parseBody();
          const auth = verifyAdminAuth(req, body);
          if (!auth.authorized) {
            return await respond({ success: false, error: "Unauthorized: Yêu cầu quyền quản trị viên" }, isEncrypted, 401);
          }

          const licenseKey = String(body.license_key || "").trim();
          if (!licenseKey) {
            return await respond({ success: false, error: "Thiếu license_key" }, isEncrypted, 400);
          }

          db.run("UPDATE licenses SET status = 'active', note = 'Kích hoạt lại bởi admin' WHERE license_key = ?", [licenseKey]);

          return await respond({
            success: true,
            message: `Đã kích hoạt lại thành công license: ${licenseKey}`
          }, isEncrypted);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      // 1.8 API Cập nhật & Phát hành phiên bản mới (Admin Only)
      if (url.pathname === "/api/admin/version/update" && req.method === "POST") {
        try {
          const { body, isEncrypted } = await parseBody();
          const auth = verifyAdminAuth(req, body);
          if (!auth.authorized) {
            return await respond({ success: false, error: "Unauthorized: Yêu cầu quyền quản trị viên" }, isEncrypted, 401);
          }

          const component = String(body.component || "extension").trim();
          const version = String(body.version || "").trim();
          const downloadUrl = String(body.download_url || "").trim();
          const changelog = String(body.changelog || "").trim();
          const minSupportedVersion = String(body.min_supported_version || version).trim();

          if (!version) {
            return await respond({ success: false, error: "Vui lòng nhập phiên bản (ví dụ: 2.1.0)" }, isEncrypted, 400);
          }

          const now = new Date().toISOString();
          db.run(
            `INSERT INTO app_versions (component, version, min_supported_version, download_url, changelog, release_date, updated_at)
             VALUES (?, ?, ?, ?, ?, date('now'), ?)
             ON CONFLICT(component) DO UPDATE SET
               version = excluded.version,
               min_supported_version = excluded.min_supported_version,
               download_url = excluded.download_url,
               changelog = excluded.changelog,
               release_date = date('now'),
               updated_at = excluded.updated_at`,
            [component, version, minSupportedVersion, downloadUrl, changelog, now]
          );

          return await respond({
            success: true,
            message: `Đã phát hành phiên bản mới ${version} cho ${component}! Mọi client sẽ nhận gợi ý cập nhật.`
          }, isEncrypted);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      // 2. API Kích hoạt bản quyền từ máy khách (Device + Email + License Key)
      if (isRouteMatch("ACTIVATE") && req.method === "POST") {
        try {
          const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("x-real-ip") || "unknown";
          if (!allowLicenseRequest(`server-activate:${clientIp}`, 30)) {
            return await respond({ success: false, error: "Quá nhiều lần kích hoạt, thử lại sau 1 phút" }, false, 429);
          }
          const { body, isEncrypted } = await parseBody();
          const result = await activateDevice(db, body as ActivateOptions);
          return await respond(result, isEncrypted, result.success ? 200 : 400);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      // 3. API Heartbeat ngầm làm mới Leased Token
      if (isRouteMatch("HEARTBEAT") && req.method === "POST") {
        try {
          const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("x-real-ip") || "unknown";
          if (!allowLicenseRequest(`server-heartbeat:${clientIp}`, 60)) {
            return await respond({ success: false, error: "Quá nhiều heartbeat, thử lại sau 1 phút" }, false, 429);
          }
          const { body, isEncrypted } = await parseBody();
          const result = await heartbeatDevice(db, body.leased_token, body.support_code);
          return await respond(result, isEncrypted, result.success ? 200 : 400);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      // 4. API Thu hồi bản quyền (Revoke - Yêu cầu quyền Admin)
      if (isRouteMatch("REVOKE") && req.method === "POST") {
        try {
          const { body, isEncrypted } = await parseBody();
          const auth = verifyAdminAuth(req, body);
          if (!auth.authorized) {
            return await respond({ success: false, error: "Unauthorized: Yêu cầu quyền quản trị viên (Admin Key)" }, isEncrypted, 401);
          }
          db.run("UPDATE licenses SET status = 'revoked', note = ? WHERE license_key = ?", [body.reason || 'Revoked by admin', body.license_key]);
          return await respond({ success: true, message: `Đã thu hồi license ${body.license_key}` }, isEncrypted);
        } catch (err: any) {
          return await respond({ success: false, error: err.message }, false, 500);
        }
      }

      // 5. API Tra cứu trạng thái (Yêu cầu quyền Admin)
      if (isRouteMatch("STATUS") && req.method === "GET") {
        const isEncrypted = req.headers.get("X-Otter-Encrypted") === "1";
        const auth = verifyAdminAuth(req);
        if (!auth.authorized) {
          return await respond({ error: "Unauthorized: Yêu cầu quyền quản trị viên" }, isEncrypted, 401);
        }
        const key = url.searchParams.get("key");
        if (!key) return await respond({ error: "Missing key" }, isEncrypted, 400);
        const lic = db.query("SELECT * FROM licenses WHERE license_key = ?").get(key) as any;
        if (!lic) return await respond({ error: "Not found" }, isEncrypted, 404);
        const acts = db.query("SELECT * FROM activations WHERE license_key = ?").all(key);
        return await respond({ license: lic, activations: acts }, isEncrypted);
      }

      // 6. Giao diện Web Admin Dashboard bảo mật tại GET / và /admin
      if ((url.pathname === "/" || url.pathname === "/admin") && (req.method === "GET" || req.method === "HEAD")) {
        const cspHeader = "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src 'self' https://*.firebaseapp.com; img-src 'self' data: https:;";

        const htmlHeaders = {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": cspHeader,
          ...corsHeaders,
        };

        if (req.method === "HEAD") {
          return new Response(null, { headers: htmlHeaders });
        }
        const adminAuth = verifyAdminAuth(req);
        if (!adminAuth.authorized) {
          return new Response(renderAdminLoginPage(), {
            status: 200,
            headers: htmlHeaders,
          });
        }

        return new Response(renderAdminDashboard(db, port, adminAuth.user || "Admin"), {
          status: 200,
          headers: htmlHeaders,
        });
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    }
  });

  console.log(`[License Server] 🚀 Máy chủ bản quyền đang hoạt động tại: http://127.0.0.1:${port}`);
  return server;
}

// Nếu chạy trực tiếp file từ CLI: bun src/server/license-server.ts
if (import.meta.main) {
  startLicenseServer();
}
